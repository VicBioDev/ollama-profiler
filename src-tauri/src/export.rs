use crate::model::is_cloud_model_name;
use crate::types::{BenchmarkStatus, ServerRecord};
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{Map, Value};

pub fn create_server_export_csv(servers: &[ServerRecord], model_name: Option<&str>) -> String {
    let speed_heading = model_name
        .map(|name| format!("TPS ({name})"))
        .unwrap_or_else(|| "Best TPS".into());
    let mut output = String::from("\u{feff}");
    output.push_str(&csv_row(&["Endpoint", "Region", &speed_heading]));
    output.push_str("\r\n");
    for server in servers {
        let region = [server.city.as_deref(), server.country.as_deref()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(", ");
        let speed = speed_for_export(server, model_name)
            .map(|value| format!("{value:.1}"))
            .unwrap_or_default();
        output.push_str(&csv_row(&[&server.endpoint, &region, &speed]));
        output.push_str("\r\n");
    }
    output
}

pub fn create_sub2api_export_json(servers: &[ServerRecord], exported_at: DateTime<Utc>) -> String {
    let accounts = servers
        .iter()
        .map(|server| {
            let address = server_node_address(&server.endpoint);
            Value::Object(Map::from_iter([
                ("name".into(), Value::String(address.clone())),
                ("platform".into(), Value::String("openai".into())),
                ("type".into(), Value::String("apikey".into())),
                (
                    "credentials".into(),
                    Value::Object(Map::from_iter([
                        ("api_key".into(), Value::String(address.clone())),
                        ("base_url".into(), Value::String(format!("{address}/"))),
                        ("model_mapping".into(), sub2api_model_mapping(server)),
                    ])),
                ),
                (
                    "extra".into(),
                    Value::Object(Map::from_iter([
                        (
                            "openai_apikey_responses_websockets_v2_enabled".into(),
                            Value::Bool(false),
                        ),
                        (
                            "openai_apikey_responses_websockets_v2_mode".into(),
                            Value::String("off".into()),
                        ),
                        (
                            "openai_long_context_billing_enabled".into(),
                            Value::Bool(false),
                        ),
                    ])),
                ),
                ("concurrency".into(), Value::from(1)),
                ("priority".into(), Value::from(1)),
                ("rate_multiplier".into(), Value::from(1)),
                ("auto_pause_on_expired".into(), Value::Bool(true)),
            ]))
        })
        .collect::<Vec<_>>();
    let payload = Value::Object(Map::from_iter([
        (
            "exported_at".into(),
            Value::String(exported_at.to_rfc3339_opts(SecondsFormat::Secs, true)),
        ),
        ("proxies".into(), Value::Array(Vec::new())),
        ("accounts".into(), Value::Array(accounts)),
    ]));
    let mut output = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".into());
    output.push('\n');
    output
}

fn server_node_address(endpoint: &str) -> String {
    endpoint.trim().trim_end_matches('/').to_string()
}

fn sub2api_model_mapping(server: &ServerRecord) -> Value {
    let mut names = server
        .models
        .iter()
        .filter(|model| model.installed && !is_cloud_model_name(&model.name))
        .map(|model| model.name.clone())
        .collect::<Vec<_>>();
    names.sort();
    Value::Object(
        names
            .into_iter()
            .map(|name| (name.clone(), Value::String(name)))
            .collect(),
    )
}

fn speed_for_export(server: &ServerRecord, model_name: Option<&str>) -> Option<f64> {
    let installed = server.models.iter().filter(|model| model.installed);
    if let Some(name) = model_name {
        return installed
            .filter(|model| model.name.eq_ignore_ascii_case(name.trim()))
            .flat_map(|model| &model.benchmarks)
            .find(|result| result.status == BenchmarkStatus::Success)
            .and_then(|result| result.tokens_per_second);
    }
    installed
        .flat_map(|model| &model.benchmarks)
        .filter(|result| result.status == BenchmarkStatus::Success)
        .filter_map(|result| result.tokens_per_second)
        .reduce(f64::max)
}

fn csv_row(values: &[&str]) -> String {
    values
        .iter()
        .map(|value| {
            let protected = if value.starts_with(['=', '+', '-', '@', '\t', '\r']) {
                format!("'{value}")
            } else {
                (*value).to_string()
            };
            format!("\"{}\"", protected.replace('"', "\"\""))
        })
        .collect::<Vec<_>>()
        .join(",")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{DiscoverySource, ServerModel, ServerStatus};
    use chrono::TimeZone;

    fn model(name: &str, installed: bool) -> ServerModel {
        ServerModel {
            id: name.into(),
            name: name.into(),
            digest: None,
            family: None,
            parameter_size: None,
            quantization: None,
            size_bytes: None,
            capabilities: vec!["completion".into()],
            installed,
            first_seen_at: "2026-07-26T00:00:00Z".into(),
            last_seen_at: "2026-07-26T00:00:00Z".into(),
            benchmarks: Vec::new(),
        }
    }

    fn server(endpoint: &str, models: Vec<ServerModel>) -> ServerRecord {
        ServerRecord {
            id: "server-1".into(),
            endpoint: endpoint.into(),
            source: DiscoverySource::Manual,
            discovery_sources: vec![DiscoverySource::Manual],
            ip: None,
            country: None,
            region: None,
            city: None,
            asn: None,
            organization: None,
            source_updated_at: None,
            status: ServerStatus::Online,
            ollama_version: None,
            failure_count: 0,
            benchmark_approved: true,
            first_discovered_at: "2026-07-26T00:00:00Z".into(),
            last_discovered_at: "2026-07-26T00:00:00Z".into(),
            last_checked_at: None,
            last_online_at: None,
            last_error_code: None,
            last_error_message: None,
            models,
        }
    }

    #[test]
    fn maps_servers_to_sub2api_openai_apikey_accounts() {
        let exported_at = Utc.with_ymd_and_hms(2026, 8, 18, 9, 28, 1).unwrap();
        let json = create_sub2api_export_json(
            &[server(
                "http://192.168.17.20:11434/",
                vec![
                    model("qwen3:32b", true),
                    model("kimi-k2.7-code:cloud", true),
                    model("removed:latest", false),
                    model("llama3.1:8b", true),
                ],
            )],
            exported_at,
        );
        let payload: Value = serde_json::from_str(&json).expect("valid json");
        assert_eq!(payload["exported_at"], "2026-08-18T09:28:01Z");
        assert_eq!(payload["proxies"], Value::Array(Vec::new()));
        assert_eq!(payload["accounts"][0]["name"], "http://192.168.17.20:11434");
        assert_eq!(payload["accounts"][0]["platform"], "openai");
        assert_eq!(payload["accounts"][0]["type"], "apikey");
        assert_eq!(
            payload["accounts"][0]["credentials"]["api_key"],
            "http://192.168.17.20:11434"
        );
        assert_eq!(
            payload["accounts"][0]["credentials"]["base_url"],
            "http://192.168.17.20:11434/"
        );
        assert_eq!(
            payload["accounts"][0]["credentials"]["model_mapping"],
            Value::Object(Map::from_iter([
                (
                    "llama3.1:8b".into(),
                    Value::String("llama3.1:8b".into())
                ),
                ("qwen3:32b".into(), Value::String("qwen3:32b".into())),
            ]))
        );
        assert_eq!(payload["accounts"][0]["concurrency"], 1);
        assert_eq!(payload["accounts"][0]["priority"], 1);
        assert_eq!(payload["accounts"][0]["rate_multiplier"], 1);
        assert_eq!(payload["accounts"][0]["auto_pause_on_expired"], true);
    }
}
