use crate::error::{AppError, AppResult};
use crate::types::{
    DiscoveryCandidate, DiscoverySource, ImportIssue, ImportPreview, ImportProvider,
};
use chrono::{DateTime, Utc};
use encoding_rs::GBK;
use flate2::read::GzDecoder;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashSet};
use std::io::{Cursor, Read};
use std::net::IpAddr;
use std::path::Path;
use url::{Host, Url};
use uuid::Uuid;

const MAX_IMPORT_BYTES: usize = 50 * 1024 * 1024;
const MAX_CELL_LENGTH: usize = 64 * 1024;
const MAX_ROWS: usize = 20_000;
const ENDPOINT_KEYS: &[&str] = &["endpoint", "link", "url", "address"];
const IMPORT_HEADER_KEYS: &[&str] = &[
    "endpoint",
    "link",
    "url",
    "address",
    "host",
    "hostname",
    "domain",
    "ip",
    "ip_str",
    "port",
    "protocol",
    "scheme",
    "country",
    "country_name",
    "region",
    "city",
    "asn",
    "org",
    "organization",
];

pub fn parse_discovery_bytes(contents: &[u8], filename: &str) -> AppResult<ImportPreview> {
    if contents.is_empty() {
        return Err(AppError::message("The selected file is empty"));
    }
    if contents.len() > MAX_IMPORT_BYTES {
        return Err(AppError::message("Import files are limited to 50 MiB"));
    }

    let uncompressed = if filename.to_ascii_lowercase().ends_with(".gz") || is_gzip(contents) {
        let mut output = Vec::new();
        GzDecoder::new(Cursor::new(contents))
            .take((MAX_IMPORT_BYTES + 1) as u64)
            .read_to_end(&mut output)?;
        if output.len() > MAX_IMPORT_BYTES {
            return Err(AppError::message("Import files are limited to 50 MiB"));
        }
        output
    } else {
        contents.to_vec()
    };
    if is_zip(&uncompressed) {
        return Err(AppError::message(
            "XLSX is not supported; export the results as CSV or JSON",
        ));
    }

    let text = decode_text(&uncompressed);
    let rows = read_text_rows(&text, filename)?;
    build_preview(rows, filename)
}

fn read_text_rows(text: &str, filename: &str) -> AppResult<Vec<Map<String, Value>>> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if let Ok(payload) = serde_json::from_str::<Value>(trimmed) {
            return Ok(unpack_json(payload));
        }
        let rows = read_ndjson(trimmed);
        if !rows.is_empty() {
            return Ok(rows);
        }
        return Err(AppError::message("The JSON export is malformed"));
    }
    if filename.to_ascii_lowercase().ends_with(".json.gz") {
        return Ok(read_ndjson(trimmed));
    }
    read_delimited_rows(trimmed, filename)
}

fn unpack_json(payload: Value) -> Vec<Map<String, Value>> {
    match payload {
        Value::Array(values) => values.into_iter().filter_map(as_object_owned).collect(),
        Value::Object(mut object) => {
            if let Some(Value::Array(values)) = object.remove("matches") {
                return values.into_iter().filter_map(as_object_owned).collect();
            }
            if let Some(Value::Array(values)) = object.remove("results") {
                let fields = normalize_fields(object.get("fields"));
                return values
                    .into_iter()
                    .map(|value| match value {
                        Value::Object(row) => row,
                        Value::Array(cells) => fields
                            .iter()
                            .enumerate()
                            .map(|(index, field)| {
                                (
                                    field.clone(),
                                    cells.get(index).cloned().unwrap_or(Value::Null),
                                )
                            })
                            .collect(),
                        _ => Map::new(),
                    })
                    .collect();
            }
            if let Some(Value::Array(values)) = object.remove("data") {
                return values.into_iter().filter_map(as_object_owned).collect();
            }
            vec![object]
        }
        _ => Vec::new(),
    }
}

fn read_ndjson(text: &str) -> Vec<Map<String, Value>> {
    let mut rows = Vec::new();
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(Value::Object(value)) = serde_json::from_str::<Value>(line) else {
            return Vec::new();
        };
        rows.push(value);
    }
    rows
}

fn read_delimited_rows(text: &str, filename: &str) -> AppResult<Vec<Map<String, Value>>> {
    let delimiter = if filename.to_ascii_lowercase().ends_with(".tsv") || prefers_tabs(text) {
        b'\t'
    } else {
        b','
    };
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .has_headers(false)
        .flexible(true)
        .from_reader(text.as_bytes());
    let records: Vec<Vec<String>> = reader
        .records()
        .map(|record| {
            record.map(|values| {
                values
                    .iter()
                    .map(|value| value.to_string())
                    .collect::<Vec<_>>()
            })
        })
        .collect::<Result<_, _>>()?;
    let records: Vec<Vec<String>> = records
        .into_iter()
        .filter(|record| record.iter().any(|value| !value.trim().is_empty()))
        .collect();
    let Some(first) = records.first() else {
        return Ok(Vec::new());
    };
    if records
        .iter()
        .flatten()
        .any(|value| value.len() > MAX_CELL_LENGTH)
    {
        return Err(AppError::message("An import field exceeds 64 KiB"));
    }

    let headers: Vec<String> = first.iter().map(|value| normalize_key(value)).collect();
    let has_header = headers
        .iter()
        .any(|value| IMPORT_HEADER_KEYS.contains(&value.as_str()));
    if !has_header {
        return Ok(records
            .into_iter()
            .map(|record| {
                Map::from_iter([(
                    "endpoint".into(),
                    Value::String(record.first().cloned().unwrap_or_default()),
                )])
            })
            .collect());
    }

    Ok(records
        .into_iter()
        .skip(1)
        .map(|record| {
            headers
                .iter()
                .enumerate()
                .map(|(index, header)| {
                    (
                        header.clone(),
                        Value::String(record.get(index).cloned().unwrap_or_default()),
                    )
                })
                .collect()
        })
        .collect())
}

fn build_preview(rows: Vec<Map<String, Value>>, filename: &str) -> AppResult<ImportPreview> {
    if rows.is_empty() {
        return Err(AppError::message(
            "No data rows were found in the selected file",
        ));
    }
    if rows.len() > MAX_ROWS {
        return Err(AppError::message("Import files are limited to 20,000 rows"));
    }
    let provider = detect_provider(&rows);
    let mut candidates = BTreeMap::<String, DiscoveryCandidate>::new();
    let mut issues = Vec::new();
    let mut duplicate_rows = 0;
    let mut invalid_rows = 0;

    for (index, row) in rows.iter().enumerate() {
        let result = if provider == ImportProvider::Shodan {
            normalize_shodan_row(row)
        } else {
            normalize_generic_row(
                row,
                if provider == ImportProvider::Fofa {
                    DiscoverySource::FofaFile
                } else {
                    DiscoverySource::Manual
                },
            )
        };
        match result {
            Ok(candidate) => {
                if candidates.contains_key(&candidate.endpoint) {
                    duplicate_rows += 1;
                } else {
                    candidates.insert(candidate.endpoint.clone(), candidate);
                }
            }
            Err(error) => {
                invalid_rows += 1;
                if issues.len() < 100 {
                    issues.push(ImportIssue {
                        row: index + 1,
                        message: error.to_string(),
                    });
                }
            }
        }
    }

    let total_rows = rows.len();
    let values: Vec<DiscoveryCandidate> = candidates.into_values().collect();
    Ok(ImportPreview {
        id: Uuid::new_v4().to_string(),
        filename: Path::new(filename)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(filename)
            .to_string(),
        provider,
        total_rows,
        valid_rows: values.len(),
        duplicate_rows,
        invalid_rows,
        candidates: values,
        issues,
    })
}

fn normalize_shodan_row(row: &Map<String, Value>) -> AppResult<DiscoveryCandidate> {
    let normalized = normalize_keys(row);
    let ip = text(normalized.get("ip_str").or_else(|| normalized.get("ip")));
    let port = port_value(normalized.get("port"));
    if ip.is_empty() || port.is_none() {
        return Err(AppError::message("Shodan row is missing ip_str or port"));
    }
    let port = port.unwrap_or_default();
    let location = row
        .get("location")
        .and_then(Value::as_object)
        .map(normalize_keys)
        .unwrap_or_default();
    let shodan = row
        .get("_shodan")
        .and_then(Value::as_object)
        .map(normalize_keys)
        .unwrap_or_default();
    let module_name = text(shodan.get("module")).to_ascii_lowercase();
    let uses_tls = row.get("ssl").is_some_and(Value::is_object)
        || module_name.contains("https")
        || module_name.contains("ssl")
        || module_name.contains("tls")
        || port == 443;
    let endpoint = normalize_endpoint(
        &format!("{}://{ip}:{port}", if uses_tls { "https" } else { "http" }),
        None,
        None,
    )?;

    Ok(DiscoveryCandidate {
        endpoint,
        source: DiscoverySource::ShodanFile,
        ip: some_text(&ip),
        country: optional_text(
            location
                .get("country_name")
                .or_else(|| normalized.get("country_name")),
        ),
        region: optional_text(
            location
                .get("region_code")
                .or_else(|| normalized.get("region")),
        ),
        city: optional_text(location.get("city").or_else(|| normalized.get("city"))),
        asn: optional_text(normalized.get("asn")),
        organization: optional_text(
            normalized
                .get("org")
                .or_else(|| normalized.get("organization"))
                .or_else(|| normalized.get("isp")),
        ),
        source_updated_at: optional_iso(
            normalized
                .get("timestamp")
                .or_else(|| normalized.get("last_update")),
        ),
    })
}

fn normalize_generic_row(
    row: &Map<String, Value>,
    source: DiscoverySource,
) -> AppResult<DiscoveryCandidate> {
    let normalized = normalize_keys(row);
    let explicit_endpoint = ENDPOINT_KEYS
        .iter()
        .map(|key| text(normalized.get(*key)))
        .find(|value| !value.is_empty());
    let host = text(
        normalized
            .get("host")
            .or_else(|| normalized.get("hostname"))
            .or_else(|| normalized.get("domain"))
            .or_else(|| normalized.get("ip")),
    );
    let port = port_value(normalized.get("port"));
    let scheme = text(
        normalized
            .get("protocol")
            .or_else(|| normalized.get("scheme")),
    )
    .to_ascii_lowercase();
    let endpoint = if let Some(value) = explicit_endpoint {
        normalize_endpoint(&value, port, Some(&scheme))?
    } else if !host.is_empty() {
        normalize_endpoint(&host, port, Some(&scheme))?
    } else {
        return Err(AppError::message(
            "Row has no endpoint, link, host, hostname, domain, or IP",
        ));
    };
    let parsed = Url::parse(&endpoint)?;
    let parsed_host = parsed.host_str().unwrap_or_default();

    Ok(DiscoveryCandidate {
        endpoint,
        source,
        ip: optional_text(normalized.get("ip")).or_else(|| {
            parsed_host
                .parse::<IpAddr>()
                .ok()
                .map(|address| address.to_string())
        }),
        country: optional_text(
            normalized
                .get("country_name")
                .or_else(|| normalized.get("country")),
        ),
        region: optional_text(
            normalized
                .get("region")
                .or_else(|| normalized.get("province")),
        ),
        city: optional_text(normalized.get("city")),
        asn: optional_text(normalized.get("asn")),
        organization: optional_text(
            normalized
                .get("org")
                .or_else(|| normalized.get("organization"))
                .or_else(|| normalized.get("isp")),
        ),
        source_updated_at: optional_iso(
            normalized
                .get("lastupdatetime")
                .or_else(|| normalized.get("last_update_time"))
                .or_else(|| normalized.get("updated_at")),
        ),
    })
}

pub fn normalize_endpoint(
    value: &str,
    port: Option<u16>,
    scheme: Option<&str>,
) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::message("Endpoint is empty"));
    }
    let has_scheme = trimmed
        .split_once("://")
        .is_some_and(|(prefix, _)| !prefix.is_empty());
    let candidate = if has_scheme {
        trimmed.to_string()
    } else {
        let selected_scheme = if scheme == Some("https") || port == Some(443) {
            "https"
        } else {
            "http"
        };
        let host = if trimmed.parse::<IpAddr>().is_ok_and(|value| value.is_ipv6()) {
            format!("[{trimmed}]")
        } else {
            trimmed.to_string()
        };
        let port_suffix = if port.is_some() && !has_explicit_port(&host) {
            format!(":{}", port.unwrap_or_default())
        } else {
            String::new()
        };
        format!("{selected_scheme}://{host}{port_suffix}")
    };
    let mut url =
        Url::parse(&candidate).map_err(|_| AppError::message("Endpoint is not a valid URL"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(AppError::message(
            "Only HTTP and HTTPS Ollama endpoints are supported",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::message(
            "Credentials in endpoint URLs are not supported",
        ));
    }
    url.set_path("");
    url.set_query(None);
    url.set_fragment(None);
    let selected_port =
        url.port()
            .or(port)
            .unwrap_or(if url.scheme() == "https" { 443 } else { 80 });
    let display_host = match url.host() {
        Some(Host::Ipv6(address)) => format!("[{address}]"),
        Some(host) => host.to_string(),
        None => return Err(AppError::message("Endpoint is missing a host")),
    };
    Ok(format!(
        "{}://{}:{}",
        url.scheme(),
        display_host,
        selected_port
    ))
}

fn detect_provider(rows: &[Map<String, Value>]) -> ImportProvider {
    let sample = rows.iter().take(20);
    for row in sample.clone() {
        if row.contains_key("ip_str") || row.contains_key("_shodan") {
            return ImportProvider::Shodan;
        }
    }
    for row in sample {
        let normalized = normalize_keys(row);
        let keys: HashSet<String> = normalized.keys().cloned().collect();
        if keys.contains("lastupdatetime") || keys.contains("country_name") || keys.contains("link")
        {
            return ImportProvider::Fofa;
        }
    }
    ImportProvider::Generic
}

fn normalize_keys(row: &Map<String, Value>) -> Map<String, Value> {
    row.iter()
        .map(|(key, value)| (normalize_key(key), value.clone()))
        .collect()
}

fn normalize_key(key: &str) -> String {
    let mut output = String::new();
    let mut separator = false;
    for character in key.trim().to_ascii_lowercase().chars() {
        if character.is_whitespace() || matches!(character, '.' | '/' | '-') {
            separator = true;
        } else {
            if separator && !output.is_empty() {
                output.push('_');
            }
            output.push(character);
            separator = false;
        }
    }
    output.trim_matches('_').to_string()
}

fn normalize_fields(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::String(fields)) => fields
            .split(',')
            .map(|field| field.trim().to_string())
            .collect(),
        Some(Value::Array(fields)) => fields.iter().map(text_value).collect(),
        _ => [
            "host",
            "ip",
            "port",
            "protocol",
            "country_name",
            "region",
            "city",
            "asn",
            "org",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
    }
}

fn decode_text(contents: &[u8]) -> String {
    match String::from_utf8(contents.to_vec()) {
        Ok(value) => value.trim_start_matches('\u{feff}').to_string(),
        Err(_) => {
            let (value, _, _) = GBK.decode(contents);
            value.trim_start_matches('\u{feff}').to_string()
        }
    }
}

fn prefers_tabs(text: &str) -> bool {
    let first_line = text
        .chars()
        .take(8_192)
        .collect::<String>()
        .lines()
        .next()
        .unwrap_or_default()
        .to_string();
    first_line.matches('\t').count() > first_line.matches(',').count()
}

fn text(value: Option<&Value>) -> String {
    value.map(text_value).unwrap_or_default().trim().to_string()
}

fn text_value(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        other => other.to_string().trim_matches('"').to_string(),
    }
}

fn optional_text(value: Option<&Value>) -> Option<String> {
    some_text(&text(value))
}

fn some_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.chars().take(512).collect())
}

fn port_value(value: Option<&Value>) -> Option<u16> {
    text(value)
        .parse::<u32>()
        .ok()
        .filter(|port| (1..=65_535).contains(port))
        .map(|port| port as u16)
}

fn optional_iso(value: Option<&Value>) -> Option<String> {
    let raw = text(value);
    DateTime::parse_from_rfc3339(&raw)
        .map(|value| value.with_timezone(&Utc).to_rfc3339())
        .ok()
}

fn is_gzip(contents: &[u8]) -> bool {
    contents.starts_with(&[0x1f, 0x8b])
}

fn is_zip(contents: &[u8]) -> bool {
    contents.starts_with(&[0x50, 0x4b, 0x03, 0x04])
}

fn has_explicit_port(host: &str) -> bool {
    if host.starts_with('[') {
        return host
            .rsplit_once("]:")
            .is_some_and(|(_, port)| port.parse::<u16>().is_ok());
    }
    host.rsplit_once(':')
        .is_some_and(|(_, port)| port.parse::<u16>().is_ok())
}

fn as_object_owned(value: Value) -> Option<Map<String, Value>> {
    value.as_object().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{Compression, write::GzEncoder};
    use std::io::Write;

    #[test]
    fn parses_and_deduplicates_fofa_csv() {
        let csv = concat!(
            "host,ip,port,protocol,country_name,org\n",
            "ollama.example,203.0.113.10,11434,http,SG,\"Example, Inc.\"\n",
            "ollama.example,203.0.113.10,11434,http,SG,\"Example, Inc.\"\n"
        );
        let preview = parse_discovery_bytes(csv.as_bytes(), "fofa.csv").unwrap();
        assert_eq!(preview.provider, ImportProvider::Fofa);
        assert_eq!(preview.valid_rows, 1);
        assert_eq!(preview.duplicate_rows, 1);
        assert_eq!(
            preview.candidates[0].endpoint,
            "http://ollama.example:11434"
        );
        assert_eq!(
            preview.candidates[0].organization.as_deref(),
            Some("Example, Inc.")
        );
    }

    #[test]
    fn parses_plain_endpoint_list() {
        let preview = parse_discovery_bytes(
            b"http://ollama-a.example:11434\nollama-b.example:11434\n",
            "servers.txt",
        )
        .unwrap();
        assert_eq!(preview.valid_rows, 2);
        assert_eq!(
            preview
                .candidates
                .iter()
                .map(|candidate| candidate.endpoint.as_str())
                .collect::<Vec<_>>(),
            vec![
                "http://ollama-a.example:11434",
                "http://ollama-b.example:11434"
            ]
        );
    }

    #[test]
    fn parses_shodan_gzip_ndjson() {
        let rows = concat!(
            "{\"ip_str\":\"198.51.100.25\",\"port\":11434,\"org\":\"Lab\",\"_shodan\":{\"module\":\"http\"}}\n",
            "{\"ip_str\":\"198.51.100.26\",\"port\":443,\"ssl\":{\"cert\":{}}}\n"
        );
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(rows.as_bytes()).unwrap();
        let preview = parse_discovery_bytes(&encoder.finish().unwrap(), "shodan.json.gz").unwrap();
        assert_eq!(preview.provider, ImportProvider::Shodan);
        assert_eq!(preview.valid_rows, 2);
        assert_eq!(preview.candidates[1].endpoint, "https://198.51.100.26:443");
    }

    #[test]
    fn normalizes_ipv6_and_rejects_credentials() {
        assert_eq!(
            normalize_endpoint("2001:db8::1", Some(11434), None).unwrap(),
            "http://[2001:db8::1]:11434"
        );
        assert_eq!(
            normalize_endpoint("https://example.com:8443/api/tags?q=x", None, None).unwrap(),
            "https://example.com:8443"
        );
        assert!(
            normalize_endpoint("http://user:pass@example.com", None, None)
                .unwrap_err()
                .to_string()
                .contains("Credentials")
        );
    }
}
