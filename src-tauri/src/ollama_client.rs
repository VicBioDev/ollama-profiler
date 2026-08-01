use crate::types::{
    AppSettings, BenchmarkResult, BenchmarkStatus, OllamaInventory, OllamaModelDetails, ServerModel,
};
use chrono::Utc;
use futures_util::StreamExt;
use reqwest::{Client, Method, Response, redirect::Policy};
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::net::lookup_host;
use tokio::sync::OnceCell;
use url::{Host, Url};
use uuid::Uuid;

#[derive(Debug, Error)]
#[error("{message}")]
pub struct OllamaClientError {
    pub code: String,
    pub message: String,
}

impl OllamaClientError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

pub type ClientResult<T> = Result<T, OllamaClientError>;

#[derive(Clone)]
pub struct OllamaClient {
    endpoint: String,
    settings: AppSettings,
    session: Arc<OnceCell<ClientSession>>,
}

struct ClientSession {
    client: Client,
    resolved: SocketAddr,
}

impl OllamaClient {
    pub fn new(endpoint: String, settings: AppSettings) -> Self {
        Self {
            endpoint,
            settings,
            session: Arc::new(OnceCell::new()),
        }
    }

    pub async fn probe_version(&self) -> ClientResult<String> {
        let payload = self.request_json("/api/version", None).await?;
        string_value(payload.get("version")).ok_or_else(|| {
            OllamaClientError::new("invalid_version", "Ollama did not return a version")
        })
    }

    pub async fn inventory(
        &self,
        previous_models: &[ServerModel],
        previous_version: Option<&str>,
    ) -> ClientResult<OllamaInventory> {
        let version = self.probe_version().await?;
        let tags = self.request_json("/api/tags", None).await?;
        let raw_models = tags
            .get("models")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                OllamaClientError::new("invalid_tags", "Ollama did not return a model list")
            })?;
        let mut models = Vec::new();
        let previous_by_name = previous_models
            .iter()
            .map(|model| (model.name.as_str(), model))
            .collect::<HashMap<_, _>>();

        for raw_tag in raw_models {
            let Some(tag) = raw_tag.as_object() else {
                continue;
            };
            let Some(name) = string_value(tag.get("name").or_else(|| tag.get("model"))) else {
                continue;
            };
            if name.len() > 512 || name.contains('\0') {
                continue;
            }
            let digest = string_value(tag.get("digest"));
            let cached = reusable_model_details(
                previous_by_name.get(name.as_str()).copied(),
                previous_version,
                &version,
                &name,
                digest.as_deref(),
            );
            let show = if cached.is_some() {
                Map::new()
            } else {
                match self
                    .request_json(
                        "/api/show",
                        Some(json!({ "model": name, "verbose": false })),
                    )
                    .await
                {
                    Ok(value) => value,
                    Err(error) if error.code == "http_404" => continue,
                    Err(_) => Map::new(),
                }
            };
            let details = show
                .get("details")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let tag_details = tag
                .get("details")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let capabilities = cached.map_or_else(
                || {
                    show.get("capabilities")
                        .and_then(Value::as_array)
                        .map(|values| {
                            values
                                .iter()
                                .filter_map(Value::as_str)
                                .map(str::to_string)
                                .collect()
                        })
                        .unwrap_or_default()
                },
                |model| model.capabilities.clone(),
            );

            models.push(OllamaModelDetails {
                name,
                digest,
                size_bytes: positive_u64(tag.get("size"))
                    .or_else(|| cached.and_then(|model| model.size_bytes)),
                family: string_value(details.get("family").or_else(|| tag_details.get("family")))
                    .or_else(|| cached.and_then(|model| model.family.clone())),
                parameter_size: string_value(
                    details
                        .get("parameter_size")
                        .or_else(|| tag_details.get("parameter_size")),
                )
                .or_else(|| cached.and_then(|model| model.parameter_size.clone())),
                quantization: string_value(
                    details
                        .get("quantization_level")
                        .or_else(|| tag_details.get("quantization_level")),
                )
                .or_else(|| cached.and_then(|model| model.quantization.clone())),
                capabilities,
            });
        }
        Ok(OllamaInventory { version, models })
    }

    pub async fn benchmark(&self, model: &str) -> ClientResult<BenchmarkResult> {
        validate_model_name(model)?;
        let started_at = Utc::now().to_rfc3339();
        let started = Instant::now();
        let target = self.target_url("/api/generate")?;
        let session = self.session().await?;
        let response = session
            .client
            .post(target)
            .timeout(Duration::from_millis(self.settings.benchmark_timeout_ms))
            .json(&json!({
                "model": model,
                "prompt": self.settings.benchmark_prompt,
                "stream": true,
                "keep_alive": 0,
                "options": {
                    "temperature": 0,
                    "num_predict": self.settings.benchmark_num_predict
                }
            }))
            .send()
            .await
            .map_err(normalize_reqwest_error)?;
        let response = verify_response(response, session.resolved)?;

        let mut stream = response.bytes_stream();
        let mut pending = String::new();
        let mut total_bytes = 0usize;
        let mut first_token_at: Option<Instant> = None;
        let mut final_event: Option<Map<String, Value>> = None;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(normalize_reqwest_error)?;
            total_bytes += chunk.len();
            if total_bytes > self.settings.max_response_bytes {
                return Err(OllamaClientError::new(
                    "response_too_large",
                    "Benchmark response exceeded the size limit",
                ));
            }
            pending.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(position) = pending.find('\n') {
                let line = pending[..position]
                    .trim_end_matches('\r')
                    .trim()
                    .to_string();
                pending.drain(..=position);
                if !line.is_empty() {
                    consume_benchmark_event(&line, &mut first_token_at, &mut final_event)?;
                }
            }
        }
        if !pending.trim().is_empty() {
            consume_benchmark_event(pending.trim(), &mut first_token_at, &mut final_event)?;
        }

        let finished = Instant::now();
        let final_event = final_event.ok_or_else(|| {
            OllamaClientError::new(
                "incomplete_stream",
                "Benchmark stream ended without final metrics",
            )
        })?;
        let eval_count = positive_u64(final_event.get("eval_count")).ok_or_else(|| {
            OllamaClientError::new("missing_metrics", "Benchmark response has no usage metrics")
        })?;
        let eval_duration_ns = positive_u64(final_event.get("eval_duration")).ok_or_else(|| {
            OllamaClientError::new("missing_metrics", "Benchmark response has no usage metrics")
        })?;
        if eval_count < self.settings.benchmark_min_tokens {
            return Err(OllamaClientError::new(
                "insufficient_tokens",
                format!("Only {eval_count} generated tokens were returned"),
            ));
        }

        Ok(BenchmarkResult {
            id: Uuid::new_v4().to_string(),
            status: BenchmarkStatus::Success,
            started_at,
            finished_at: Utc::now().to_rfc3339(),
            tokens_per_second: Some(tokens_per_second(eval_count, eval_duration_ns)?),
            ttft_ms: first_token_at
                .map(|instant| instant.duration_since(started).as_secs_f64() * 1000.0),
            client_total_ms: Some(finished.duration_since(started).as_secs_f64() * 1000.0),
            eval_count: Some(eval_count),
            eval_duration_ns: Some(eval_duration_ns),
            prompt_eval_count: positive_u64(final_event.get("prompt_eval_count")),
            prompt_eval_duration_ns: positive_u64(final_event.get("prompt_eval_duration")),
            load_duration_ns: positive_u64(final_event.get("load_duration")),
            total_duration_ns: positive_u64(final_event.get("total_duration")),
            done_reason: string_value(final_event.get("done_reason")),
            error_code: None,
            error_message: None,
        })
    }

    pub async fn chat(&self, model: &str, prompt: &str) -> ClientResult<String> {
        validate_model_name(model)?;
        let payload = self
            .request_json_with_timeout(
                "/api/chat",
                Some(json!({
                    "model": model,
                    "messages": [{ "role": "user", "content": prompt }],
                    "stream": false
                })),
                self.settings.benchmark_timeout_ms,
            )
            .await?;
        if let Some(error) = payload.get("error") {
            return Err(OllamaClientError::new("ollama_error", text_value(error)));
        }
        payload
            .get("message")
            .and_then(Value::as_object)
            .and_then(|message| string_value(message.get("content")))
            .ok_or_else(|| {
                OllamaClientError::new(
                    "invalid_chat_response",
                    "Ollama did not return a chat message",
                )
            })
    }

    async fn request_json(
        &self,
        path: &str,
        body: Option<Value>,
    ) -> ClientResult<Map<String, Value>> {
        self.request_json_with_timeout(path, body, self.settings.request_timeout_ms)
            .await
    }

    async fn request_json_with_timeout(
        &self,
        path: &str,
        body: Option<Value>,
        timeout_ms: u64,
    ) -> ClientResult<Map<String, Value>> {
        let target = self.target_url(path)?;
        let session = self.session().await?;
        let bytes = request_bytes(
            session,
            target,
            body,
            timeout_ms,
            self.settings.max_response_bytes,
        )
        .await?;
        serde_json::from_slice::<Value>(&bytes)
            .map_err(|error| OllamaClientError::new("invalid_json", error.to_string()))?
            .as_object()
            .cloned()
            .ok_or_else(|| OllamaClientError::new("invalid_json", "JSON response is not an object"))
    }

    fn target_url(&self, path: &str) -> ClientResult<Url> {
        let base = format!("{}/", self.endpoint.trim_end_matches('/'));
        Url::parse(&base)
            .and_then(|url| url.join(path.trim_start_matches('/')))
            .map_err(|_| OllamaClientError::new("invalid_endpoint", "Invalid Ollama endpoint"))
    }

    async fn session(&self) -> ClientResult<&ClientSession> {
        self.session
            .get_or_try_init(|| async {
                let target = self.target_url("/")?;
                let resolved =
                    resolve_target(&target, self.settings.allow_private_networks).await?;
                let client = build_client(&target, resolved, self.settings.connect_timeout_ms)?;
                Ok(ClientSession { client, resolved })
            })
            .await
    }
}

fn reusable_model_details<'a>(
    previous_model: Option<&'a ServerModel>,
    previous_version: Option<&str>,
    current_version: &str,
    model_name: &str,
    digest: Option<&str>,
) -> Option<&'a ServerModel> {
    let digest = digest?;
    if previous_version != Some(current_version) {
        return None;
    }
    previous_model.filter(|model| {
        model.name == model_name
            && model.digest.as_deref() == Some(digest)
            && !model.capabilities.is_empty()
    })
}

fn validate_model_name(model: &str) -> ClientResult<()> {
    if model.is_empty() || model.len() > 512 || model.contains('\0') {
        return Err(OllamaClientError::new(
            "invalid_model",
            "Invalid model name",
        ));
    }
    Ok(())
}

async fn request_bytes(
    session: &ClientSession,
    target: Url,
    body: Option<Value>,
    timeout_ms: u64,
    max_bytes: usize,
) -> ClientResult<Vec<u8>> {
    let mut request = session
        .client
        .request(
            if body.is_some() {
                Method::POST
            } else {
                Method::GET
            },
            target,
        )
        .timeout(Duration::from_millis(timeout_ms));
    if let Some(payload) = body {
        request = request.json(&payload);
    }
    let response = request.send().await.map_err(normalize_reqwest_error)?;
    let response = verify_response(response, session.resolved)?;
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(normalize_reqwest_error)?;
        if bytes.len() + chunk.len() > max_bytes {
            return Err(OllamaClientError::new(
                "response_too_large",
                "Response exceeded the size limit",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn build_client(
    target: &Url,
    resolved: SocketAddr,
    connect_timeout_ms: u64,
) -> ClientResult<Client> {
    let mut builder = Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_millis(connect_timeout_ms))
        .user_agent("OllamaProfiler/0.1");
    if let Some(host) = target.host_str()
        && matches!(target.host(), Some(Host::Domain(_)))
    {
        builder = builder.resolve(host, resolved);
    }
    builder
        .build()
        .map_err(|error| OllamaClientError::new("network_error", error.to_string()))
}

async fn resolve_target(target: &Url, allow_private_networks: bool) -> ClientResult<SocketAddr> {
    let host = target
        .host()
        .ok_or_else(|| OllamaClientError::new("invalid_endpoint", "Endpoint has no host"))?;
    let port = target
        .port_or_known_default()
        .ok_or_else(|| OllamaClientError::new("invalid_endpoint", "Endpoint has no port"))?;
    let addresses: Vec<IpAddr> = match host {
        Host::Ipv4(value) => vec![IpAddr::V4(value)],
        Host::Ipv6(value) => vec![IpAddr::V6(value)],
        Host::Domain(name) => lookup_host((name, port))
            .await
            .map_err(|_| OllamaClientError::new("dns_error", "DNS resolution failed"))?
            .map(|address| address.ip())
            .collect(),
    };
    if addresses.is_empty() {
        return Err(OllamaClientError::new(
            "dns_error",
            "DNS resolution returned no addresses",
        ));
    }
    addresses
        .into_iter()
        .find(|address| is_address_allowed(*address, allow_private_networks))
        .map(|address| SocketAddr::new(address, port))
        .ok_or_else(|| {
            OllamaClientError::new(
                "blocked_address",
                "Target resolved only to blocked or unsafe addresses",
            )
        })
}

fn verify_response(response: Response, resolved: SocketAddr) -> ClientResult<Response> {
    let status = response.status();
    if status.is_redirection() {
        return Err(OllamaClientError::new(
            "redirect_blocked",
            "HTTP redirects are not allowed",
        ));
    }
    if status.as_u16() != 200 {
        return Err(OllamaClientError::new(
            format!("http_{}", status.as_u16()),
            format!("Ollama returned HTTP {}", status.as_u16()),
        ));
    }
    if let Some(peer) = response.remote_addr()
        && peer.ip() != resolved.ip()
    {
        return Err(OllamaClientError::new(
            "dns_rebinding",
            "Connected peer differs from the validated DNS address",
        ));
    }
    Ok(response)
}

pub fn is_address_allowed(address: IpAddr, allow_private_networks: bool) -> bool {
    match address {
        IpAddr::V4(value) => {
            if value == Ipv4Addr::new(169, 254, 169, 254)
                || value == Ipv4Addr::new(100, 100, 100, 200)
                || value.is_unspecified()
                || value.is_multicast()
                || value.is_link_local()
                || value.octets()[0] >= 240
            {
                return false;
            }
            allow_private_networks
                || !(value.is_private() || value.is_loopback() || is_shared_address(value))
        }
        IpAddr::V6(value) => {
            if value
                == "fd00:ec2::254"
                    .parse::<Ipv6Addr>()
                    .unwrap_or(Ipv6Addr::UNSPECIFIED)
                || value.is_unspecified()
                || value.is_multicast()
                || value.is_unicast_link_local()
            {
                return false;
            }
            allow_private_networks || !(value.is_loopback() || is_unique_local(value))
        }
    }
}

fn is_shared_address(value: Ipv4Addr) -> bool {
    let [first, second, ..] = value.octets();
    first == 100 && (64..=127).contains(&second)
}

fn is_unique_local(value: Ipv6Addr) -> bool {
    value.segments()[0] & 0xfe00 == 0xfc00
}

fn consume_benchmark_event(
    line: &str,
    first_token_at: &mut Option<Instant>,
    final_event: &mut Option<Map<String, Value>>,
) -> ClientResult<()> {
    let event = serde_json::from_str::<Value>(line)
        .map_err(|_| OllamaClientError::new("invalid_stream", "Malformed benchmark stream"))?
        .as_object()
        .cloned()
        .ok_or_else(|| {
            OllamaClientError::new("invalid_stream", "Stream event is not a JSON object")
        })?;
    if let Some(error) = event.get("error") {
        return Err(OllamaClientError::new("ollama_error", text_value(error)));
    }
    if first_token_at.is_none()
        && (string_value(event.get("response")).is_some()
            || string_value(event.get("thinking")).is_some())
    {
        *first_token_at = Some(Instant::now());
    }
    if event.get("done").and_then(Value::as_bool) == Some(true) {
        *final_event = Some(event);
    }
    Ok(())
}

fn normalize_reqwest_error(error: reqwest::Error) -> OllamaClientError {
    if error.is_timeout() {
        OllamaClientError::new("timeout", "Ollama request timed out")
    } else if error.is_connect() {
        OllamaClientError::new("network_error", error.to_string())
    } else {
        OllamaClientError::new("network_error", error.to_string())
    }
}

fn string_value(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn text_value(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn positive_u64(value: Option<&Value>) -> Option<u64> {
    value
        .and_then(|value| value.as_u64().or_else(|| value.as_f64().map(|v| v as u64)))
        .filter(|value| *value > 0)
}

pub fn tokens_per_second(eval_count: u64, eval_duration_ns: u64) -> ClientResult<f64> {
    if eval_count == 0 || eval_duration_ns == 0 {
        return Err(OllamaClientError::new(
            "invalid_metrics",
            "Token count and evaluation duration must be positive",
        ));
    }
    Ok((eval_count as f64 * 1_000_000_000.0) / eval_duration_ns as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculates_tokens_per_second() {
        assert_eq!(tokens_per_second(50, 2_000_000_000).unwrap(), 25.0);
    }

    #[test]
    fn blocks_metadata_and_link_local_addresses() {
        assert!(!is_address_allowed(
            "169.254.169.254".parse().unwrap(),
            true
        ));
        assert!(!is_address_allowed("fe80::1".parse().unwrap(), true));
    }

    #[test]
    fn private_addresses_follow_setting() {
        let private = "192.168.1.2".parse().unwrap();
        assert!(is_address_allowed(private, true));
        assert!(!is_address_allowed(private, false));
    }

    #[test]
    fn reuses_cached_model_details_only_for_unchanged_inventory() {
        let cached = ServerModel {
            id: "model-1".into(),
            name: "qwen3:8b".into(),
            digest: Some("sha256:unchanged".into()),
            family: Some("qwen3".into()),
            parameter_size: Some("8B".into()),
            quantization: Some("Q4_K_M".into()),
            size_bytes: Some(4_000_000_000),
            capabilities: vec!["completion".into()],
            installed: true,
            first_seen_at: "2026-08-01T00:00:00Z".into(),
            last_seen_at: "2026-08-01T00:00:00Z".into(),
            benchmarks: Vec::new(),
        };

        assert!(
            reusable_model_details(
                Some(&cached),
                Some("0.11.0"),
                "0.11.0",
                "qwen3:8b",
                Some("sha256:unchanged"),
            )
            .is_some()
        );
        assert!(
            reusable_model_details(
                Some(&cached),
                Some("0.10.0"),
                "0.11.0",
                "qwen3:8b",
                Some("sha256:unchanged"),
            )
            .is_none()
        );
        assert!(
            reusable_model_details(
                Some(&cached),
                Some("0.11.0"),
                "0.11.0",
                "qwen3:8b",
                Some("sha256:changed"),
            )
            .is_none()
        );
    }
}
