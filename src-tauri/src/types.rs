use serde::{Deserialize, Serialize};

const CONCURRENCY_LEVELS: [usize; 5] = [8, 16, 32, 64, 128];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DiscoverySource {
    Manual,
    Localhost,
    LanScan,
    FofaFile,
    ShodanFile,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServerStatus {
    Unknown,
    Checking,
    Online,
    Offline,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum BenchmarkStatus {
    Queued,
    Running,
    Success,
    Failed,
    NotSupported,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum JobKind {
    Import,
    LocalDiscovery,
    LanDiscovery,
    Scan,
    Benchmark,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryCandidate {
    pub endpoint: String,
    pub source: DiscoverySource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asn: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organization: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_updated_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkResult {
    pub id: String,
    pub status: BenchmarkStatus,
    pub started_at: String,
    pub finished_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens_per_second: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ttft_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_total_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_duration_ns: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_eval_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_eval_duration_ns: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub load_duration_ns: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_duration_ns: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerModel {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameter_size: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quantization: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    pub installed: bool,
    pub first_seen_at: String,
    pub last_seen_at: String,
    #[serde(default)]
    pub benchmarks: Vec<BenchmarkResult>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerRecord {
    pub id: String,
    pub endpoint: String,
    pub source: DiscoverySource,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub discovery_sources: Vec<DiscoverySource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asn: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organization: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_updated_at: Option<String>,
    pub status: ServerStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ollama_version: Option<String>,
    pub failure_count: u32,
    pub benchmark_approved: bool,
    pub first_discovered_at: String,
    pub last_discovered_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_checked_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_online_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error_message: Option<String>,
    #[serde(default)]
    pub models: Vec<ServerModel>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgressSample {
    pub completed: usize,
    pub recorded_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilerJob {
    pub id: String,
    pub kind: JobKind,
    pub status: JobStatus,
    pub label: String,
    pub completed: usize,
    pub total: usize,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub progress_samples: Vec<JobProgressSample>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub target_server_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub benchmark_started_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub scan_concurrency: usize,
    pub benchmark_concurrency: usize,
    pub connect_timeout_ms: u64,
    pub request_timeout_ms: u64,
    pub benchmark_timeout_ms: u64,
    pub max_response_bytes: usize,
    pub benchmark_prompt: String,
    pub benchmark_num_predict: u64,
    pub benchmark_min_tokens: u64,
    pub allow_private_networks: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            scan_concurrency: 8,
            benchmark_concurrency: 8,
            connect_timeout_ms: 5_000,
            request_timeout_ms: 15_000,
            benchmark_timeout_ms: 120_000,
            max_response_bytes: 1024 * 1024,
            benchmark_prompt: "Reply with a concise description of what an Ollama server does."
                .into(),
            benchmark_num_predict: 64,
            benchmark_min_tokens: 8,
            allow_private_networks: true,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsPatch {
    pub scan_concurrency: Option<usize>,
    pub benchmark_concurrency: Option<usize>,
    pub connect_timeout_ms: Option<u64>,
    pub request_timeout_ms: Option<u64>,
    pub benchmark_timeout_ms: Option<u64>,
    pub max_response_bytes: Option<usize>,
    pub benchmark_prompt: Option<String>,
    pub benchmark_num_predict: Option<u64>,
    pub benchmark_min_tokens: Option<u64>,
    pub allow_private_networks: Option<bool>,
}

impl AppSettings {
    pub fn apply_patch(&self, patch: AppSettingsPatch) -> Self {
        Self {
            scan_concurrency: patch.scan_concurrency.map_or_else(
                || normalize_concurrency(self.scan_concurrency),
                normalize_concurrency,
            ),
            benchmark_concurrency: patch.benchmark_concurrency.map_or_else(
                || normalize_concurrency(self.benchmark_concurrency),
                normalize_concurrency,
            ),
            connect_timeout_ms: patch
                .connect_timeout_ms
                .unwrap_or(self.connect_timeout_ms)
                .clamp(1_000, 60_000),
            request_timeout_ms: patch
                .request_timeout_ms
                .unwrap_or(self.request_timeout_ms)
                .clamp(2_000, 300_000),
            benchmark_timeout_ms: patch
                .benchmark_timeout_ms
                .unwrap_or(self.benchmark_timeout_ms)
                .clamp(10_000, 600_000),
            max_response_bytes: patch
                .max_response_bytes
                .unwrap_or(self.max_response_bytes)
                .clamp(64 * 1024, 8 * 1024 * 1024),
            benchmark_prompt: patch
                .benchmark_prompt
                .unwrap_or_else(|| self.benchmark_prompt.clone())
                .trim()
                .chars()
                .take(2_000)
                .collect(),
            benchmark_num_predict: patch
                .benchmark_num_predict
                .unwrap_or(self.benchmark_num_predict)
                .clamp(8, 512),
            benchmark_min_tokens: patch
                .benchmark_min_tokens
                .unwrap_or(self.benchmark_min_tokens)
                .clamp(1, 128),
            allow_private_networks: patch
                .allow_private_networks
                .unwrap_or(self.allow_private_networks),
        }
    }
}

fn normalize_concurrency(value: usize) -> usize {
    let mut closest = CONCURRENCY_LEVELS[0];
    let mut closest_distance = closest.abs_diff(value);
    for option in CONCURRENCY_LEVELS.into_iter().skip(1) {
        let distance = option.abs_diff(value);
        if distance < closest_distance {
            closest = option;
            closest_distance = distance;
        }
    }
    closest
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilerSnapshot {
    #[serde(default)]
    pub servers: Vec<ServerRecord>,
    #[serde(default)]
    pub jobs: Vec<ProfilerJob>,
    #[serde(default)]
    pub settings: AppSettings,
    pub updated_at: String,
}

impl ProfilerSnapshot {
    pub fn empty(now: String) -> Self {
        Self {
            servers: Vec::new(),
            jobs: Vec::new(),
            settings: AppSettings::default(),
            updated_at: now,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportIssue {
    pub row: usize,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub id: String,
    pub filename: String,
    pub provider: ImportProvider,
    pub total_rows: usize,
    pub valid_rows: usize,
    pub duplicate_rows: usize,
    pub invalid_rows: usize,
    pub candidates: Vec<DiscoveryCandidate>,
    pub issues: Vec<ImportIssue>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ImportProvider {
    Fofa,
    Shodan,
    Generic,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommitOptions {
    pub preview_id: String,
    pub benchmark_approved: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommitResult {
    pub added: usize,
    pub updated: usize,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerExportOptions {
    pub server_ids: Vec<String>,
    #[serde(default)]
    pub model_name: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerExportResult {
    pub file_path: String,
    pub count: usize,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatModelTarget {
    pub server_id: String,
    pub model_name: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub prompt: String,
    pub targets: Vec<ChatModelTarget>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatModelReply {
    pub server_id: String,
    pub endpoint: String,
    pub model_name: String,
    pub elapsed_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub results: Vec<ChatModelReply>,
}

#[derive(Clone, Debug)]
pub struct OllamaModelDetails {
    pub name: String,
    pub digest: Option<String>,
    pub size_bytes: Option<u64>,
    pub family: Option<String>,
    pub parameter_size: Option<String>,
    pub quantization: Option<String>,
    pub capabilities: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct OllamaInventory {
    pub version: String,
    pub models: Vec<OllamaModelDetails>,
}

#[cfg(test)]
mod tests {
    use super::{AppSettings, AppSettingsPatch, CONCURRENCY_LEVELS};

    #[test]
    fn settings_accept_every_supported_concurrency_level() {
        for concurrency in CONCURRENCY_LEVELS {
            let settings = AppSettings::default().apply_patch(AppSettingsPatch {
                scan_concurrency: Some(concurrency),
                benchmark_concurrency: Some(concurrency),
                ..AppSettingsPatch::default()
            });

            assert_eq!(settings.scan_concurrency, concurrency);
            assert_eq!(settings.benchmark_concurrency, concurrency);
        }
    }

    #[test]
    fn settings_normalize_legacy_concurrency_to_the_nearest_level() {
        for (legacy, expected) in [(2, 8), (10, 8), (12, 8), (15, 16), (48, 32), (200, 128)] {
            let settings = AppSettings::default().apply_patch(AppSettingsPatch {
                scan_concurrency: Some(legacy),
                benchmark_concurrency: Some(legacy),
                ..AppSettingsPatch::default()
            });

            assert_eq!(settings.scan_concurrency, expected);
            assert_eq!(settings.benchmark_concurrency, expected);
        }
    }
}
