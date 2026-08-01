use crate::types::{BenchmarkStatus, ServerModel, ServerRecord};
use chrono::{DateTime, Duration, Utc};

const FAILURE_BACKOFF_HOURS: [i64; 4] = [1, 6, 24, 72];
pub const MAX_BENCHMARK_HISTORY_PER_MODEL: usize = 100;

pub fn is_cloud_model_name(name: &str) -> bool {
    let normalized = name.trim().to_ascii_lowercase();
    let tag = normalized
        .rsplit_once(':')
        .map(|(_, tag)| tag)
        .or_else(|| normalized.rsplit_once('/').map(|(_, tag)| tag))
        .unwrap_or(&normalized);
    tag == "cloud"
        || tag.starts_with("cloud-")
        || tag.ends_with("-cloud")
        || tag.contains("-cloud-")
}

pub fn is_benchmarkable_local_model(model: &ServerModel) -> bool {
    model.installed
        && model.capabilities.iter().any(|value| value == "completion")
        && !is_cloud_model_name(&model.name)
}

pub fn is_benchmark_due(model: &ServerModel, server: &ServerRecord, now: DateTime<Utc>) -> bool {
    let latest_server_attempt = server
        .models
        .iter()
        .filter_map(|candidate| candidate.benchmarks.first())
        .filter_map(|result| {
            DateTime::parse_from_rfc3339(&result.finished_at)
                .ok()
                .map(|value| value.with_timezone(&Utc))
        })
        .max();
    if latest_server_attempt.is_some_and(|latest| now - latest < Duration::minutes(30)) {
        return false;
    }
    let Some(last) = model.benchmarks.first() else {
        return true;
    };
    let Ok(finished) = DateTime::parse_from_rfc3339(&last.finished_at) else {
        return true;
    };
    let elapsed = now - finished.with_timezone(&Utc);
    if last.status == BenchmarkStatus::Success {
        return elapsed >= Duration::hours(24);
    }
    let failures = model
        .benchmarks
        .iter()
        .take_while(|result| result.status == BenchmarkStatus::Failed)
        .count()
        .max(1);
    let hours = FAILURE_BACKOFF_HOURS[(failures - 1).min(FAILURE_BACKOFF_HOURS.len() - 1)];
    elapsed >= Duration::hours(hours)
}

pub fn prune_benchmark_history(model: &mut ServerModel, now: DateTime<Utc>) {
    let cutoff = now - Duration::days(90);
    model.benchmarks.retain(|result| {
        DateTime::parse_from_rfc3339(&result.finished_at)
            .map(|value| value.with_timezone(&Utc) >= cutoff)
            .unwrap_or(false)
    });
    model.benchmarks.truncate(MAX_BENCHMARK_HISTORY_PER_MODEL);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{BenchmarkResult, DiscoverySource, ServerStatus};

    fn result(status: BenchmarkStatus, finished_at: &str) -> BenchmarkResult {
        BenchmarkResult {
            id: format!("{status:?}-{finished_at}"),
            status,
            started_at: finished_at.into(),
            finished_at: finished_at.into(),
            tokens_per_second: None,
            ttft_ms: None,
            client_total_ms: None,
            eval_count: None,
            eval_duration_ns: None,
            prompt_eval_count: None,
            prompt_eval_duration_ns: None,
            load_duration_ns: None,
            total_duration_ns: None,
            done_reason: None,
            error_code: None,
            error_message: None,
        }
    }

    fn model(benchmarks: Vec<BenchmarkResult>) -> ServerModel {
        ServerModel {
            id: "model".into(),
            name: "qwen3:8b".into(),
            digest: None,
            family: None,
            parameter_size: None,
            quantization: None,
            size_bytes: None,
            capabilities: vec!["completion".into()],
            installed: true,
            first_seen_at: "2026-01-01T00:00:00Z".into(),
            last_seen_at: "2026-01-01T00:00:00Z".into(),
            benchmarks,
        }
    }

    fn server(model: ServerModel) -> ServerRecord {
        ServerRecord {
            id: "server".into(),
            endpoint: "http://127.0.0.1:11434".into(),
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
            first_discovered_at: "2026-01-01T00:00:00Z".into(),
            last_discovered_at: "2026-01-01T00:00:00Z".into(),
            last_checked_at: None,
            last_online_at: None,
            last_error_code: None,
            last_error_message: None,
            models: vec![model],
        }
    }

    #[test]
    fn identifies_cloud_model_tags() {
        assert!(is_cloud_model_name("qwen3:cloud"));
        assert!(is_cloud_model_name("qwen3:latest-cloud"));
        assert!(!is_cloud_model_name("qwen3:8b"));
    }

    #[test]
    fn applies_success_and_failure_backoff() {
        let now = DateTime::parse_from_rfc3339("2026-07-25T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let recent = model(vec![result(
            BenchmarkStatus::Success,
            "2026-07-24T13:00:00Z",
        )]);
        assert!(!is_benchmark_due(&recent, &server(recent.clone()), now));
        let old = model(vec![result(
            BenchmarkStatus::Success,
            "2026-07-24T11:00:00Z",
        )]);
        assert!(is_benchmark_due(&old, &server(old.clone()), now));
    }

    #[test]
    fn prunes_expired_and_excess_benchmark_history() {
        let mut value = model(
            (0..120)
                .map(|_| result(BenchmarkStatus::Success, "2026-07-24T13:00:00Z"))
                .collect(),
        );
        value
            .benchmarks
            .push(result(BenchmarkStatus::Failed, "2026-01-01T00:00:00Z"));
        let now = DateTime::parse_from_rfc3339("2026-08-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        prune_benchmark_history(&mut value, now);

        assert_eq!(value.benchmarks.len(), MAX_BENCHMARK_HISTORY_PER_MODEL);
        assert!(
            value
                .benchmarks
                .iter()
                .all(|result| result.finished_at != "2026-01-01T00:00:00Z")
        );
    }
}
