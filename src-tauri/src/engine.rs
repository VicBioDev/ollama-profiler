use crate::error::{AppError, AppResult};
use crate::export::create_server_export_csv;
use crate::importers::parse_discovery_bytes;
use crate::lan::{
    DiscoveredOllamaEndpoint, LanScanPlan, create_lan_scan_plan, discover_lan_ollama,
    discover_localhost_ollama,
};
use crate::model::{is_benchmark_due, is_benchmarkable_local_model};
use crate::ollama_client::{OllamaClient, OllamaClientError};
use crate::store::ProfilerStore;
use crate::types::*;
use chrono::{Duration, Utc};
use futures_util::{
    StreamExt,
    future::{Either, select},
    stream::{self, FuturesUnordered},
};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::future::Future;
use std::sync::{
    Arc, Mutex, MutexGuard,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex as AsyncMutex, watch};
use uuid::Uuid;

#[derive(Clone)]
pub struct ProfilerEngine {
    inner: Arc<EngineInner>,
}

struct EngineInner {
    app: AppHandle,
    store: Mutex<ProfilerStore>,
    import_sessions: Mutex<HashMap<String, ImportPreview>>,
    active_jobs: Mutex<HashMap<JobKind, String>>,
    server_locks: AsyncMutex<HashMap<String, Arc<AsyncMutex<()>>>>,
    last_scheduled_scan: Mutex<Option<Instant>>,
    settings_changed: watch::Sender<u64>,
    shutting_down: AtomicBool,
}

#[derive(Clone, Default)]
struct ScanOptions {
    benchmark_after_scan: bool,
    force_benchmark: bool,
    label: Option<String>,
}

const MAX_JOB_PROGRESS_SAMPLES: usize = 11;

impl ProfilerEngine {
    pub fn new(app: AppHandle, store: ProfilerStore) -> Self {
        let (settings_changed, _) = watch::channel(0);
        Self {
            inner: Arc::new(EngineInner {
                app,
                store: Mutex::new(store),
                import_sessions: Mutex::new(HashMap::new()),
                active_jobs: Mutex::new(HashMap::new()),
                server_locks: AsyncMutex::new(HashMap::new()),
                last_scheduled_scan: Mutex::new(None),
                settings_changed,
                shutting_down: AtomicBool::new(false),
            }),
        }
    }

    pub fn start_monitoring(&self) {
        let engine = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval_at(
                tokio::time::Instant::now() + std::time::Duration::from_secs(600),
                std::time::Duration::from_secs(600),
            );
            loop {
                interval.tick().await;
                if engine.inner.shutting_down.load(Ordering::Relaxed) {
                    break;
                }
                let _ = engine.run_monitoring_cycle();
            }
        });
    }

    pub fn get_snapshot(&self) -> AppResult<ProfilerSnapshot> {
        Ok(self.store()?.get())
    }

    pub fn preview_file(&self, file_path: String) -> AppResult<ImportPreview> {
        let metadata = fs::metadata(&file_path)?;
        if metadata.len() > 50 * 1024 * 1024 {
            return Err(AppError::message("Import files are limited to 50 MiB"));
        }
        let preview = parse_discovery_bytes(&fs::read(&file_path)?, &file_path)?;
        self.import_sessions()?
            .insert(preview.id.clone(), preview.clone());
        Ok(preview_for_renderer(&preview))
    }

    pub fn preview_text(&self, contents: String) -> AppResult<ImportPreview> {
        if contents.len() > 1024 * 1024 {
            return Err(AppError::message(
                "Pasted endpoint lists are limited to 1 MiB",
            ));
        }
        let preview = parse_discovery_bytes(contents.as_bytes(), "pasted-endpoints.txt")?;
        self.import_sessions()?
            .insert(preview.id.clone(), preview.clone());
        Ok(preview_for_renderer(&preview))
    }

    pub fn commit_import(&self, options: ImportCommitOptions) -> AppResult<ImportCommitResult> {
        let preview = self
            .import_sessions()?
            .get(&options.preview_id)
            .cloned()
            .ok_or_else(|| {
                AppError::message("The import preview expired; select the file again")
            })?;
        let now = Utc::now().to_rfc3339();
        let result = self.mutate(|snapshot| {
            let mut added = 0;
            let mut updated = 0;
            for candidate in &preview.candidates {
                if let Some(existing) = snapshot
                    .servers
                    .iter_mut()
                    .find(|server| server.endpoint == candidate.endpoint)
                {
                    apply_candidate(existing, candidate, &now);
                    existing.benchmark_approved |= options.benchmark_approved;
                    updated += 1;
                } else {
                    snapshot.servers.push(candidate_to_server(
                        candidate,
                        options.benchmark_approved,
                        &now,
                    ));
                    added += 1;
                }
            }
            Ok(ImportCommitResult { added, updated })
        })?;
        self.import_sessions()?.remove(&options.preview_id);
        self.broadcast();
        let _ = self.profile_all_servers(false);
        Ok(result)
    }

    pub fn test_localhost(&self) -> AppResult<String> {
        self.require_private_network_access()?;
        if let Some(active) = self.find_active_job(JobKind::LocalDiscovery)? {
            return Ok(active);
        }
        let job_id = self.create_job(JobKind::LocalDiscovery, "Test localhost Ollama".into(), 2)?;
        let engine = self.clone();
        let task_id = job_id.clone();
        tauri::async_runtime::spawn(async move {
            engine.run_localhost_discovery(task_id).await;
        });
        Ok(job_id)
    }

    pub fn scan_local_network(&self) -> AppResult<String> {
        self.require_private_network_access()?;
        if let Some(active) = self.find_active_job(JobKind::LanDiscovery)? {
            return Ok(active);
        }
        let plan = create_lan_scan_plan()?;
        let job_id = self.create_job(
            JobKind::LanDiscovery,
            "Scan local network for Ollama".into(),
            plan.targets.len(),
        )?;
        let engine = self.clone();
        let task_id = job_id.clone();
        tauri::async_runtime::spawn(async move {
            engine.run_lan_discovery(task_id, plan).await;
        });
        Ok(job_id)
    }

    pub fn profile_all_servers(&self, resume_incomplete: bool) -> AppResult<String> {
        if let Some(active) = self.find_active_job(JobKind::Scan)? {
            return Ok(active);
        }
        if let Some(active) = self.find_active_job(JobKind::Benchmark)? {
            return Ok(active);
        }
        let snapshot = self.get_snapshot()?;
        if snapshot.servers.is_empty() {
            return Err(AppError::message(
                "Add at least one server before starting a scan and benchmark",
            ));
        }
        if resume_incomplete && let Some(previous) = latest_incomplete_benchmark(&snapshot).cloned()
        {
            let benchmark_started_at = previous
                .benchmark_started_at
                .unwrap_or_else(|| previous.created_at.clone());
            let targets: HashSet<String> = if previous.target_server_ids.is_empty() {
                snapshot
                    .servers
                    .iter()
                    .map(|server| server.id.clone())
                    .collect()
            } else {
                previous.target_server_ids.into_iter().collect()
            };
            let remaining = snapshot
                .servers
                .iter()
                .filter(|server| {
                    targets.contains(&server.id)
                        && server.models.iter().any(|model| {
                            is_benchmarkable_local_model(model)
                                && !was_benchmarked_since(model, &benchmark_started_at)
                        })
                })
                .map(|server| server.id.clone())
                .collect();
            return self.queue_benchmark(
                remaining,
                false,
                Some(benchmark_started_at),
                "Continue interrupted benchmarks".into(),
            );
        }
        self.queue_scan(
            None,
            ScanOptions {
                benchmark_after_scan: true,
                force_benchmark: true,
                label: Some("Scan all servers".into()),
            },
        )
    }

    pub fn set_benchmark_approval(&self, server_id: String, approved: bool) -> AppResult<()> {
        self.mutate(|snapshot| {
            require_server_mut(snapshot, &server_id)?.benchmark_approved = approved;
            Ok(())
        })?;
        self.broadcast();
        Ok(())
    }

    pub fn update_settings(&self, patch: AppSettingsPatch) -> AppResult<AppSettings> {
        let settings = self.mutate(|snapshot| {
            snapshot.settings = snapshot.settings.apply_patch(patch);
            Ok(snapshot.settings.clone())
        })?;
        self.inner
            .settings_changed
            .send_modify(|version| *version = version.wrapping_add(1));
        self.broadcast();
        Ok(settings)
    }

    pub async fn chat_models(&self, request: ChatRequest) -> AppResult<ChatResponse> {
        let prompt = request.prompt.trim().to_string();
        if prompt.is_empty() {
            return Err(AppError::message("Enter a message before sending"));
        }
        if prompt.chars().count() > 20_000 {
            return Err(AppError::message(
                "Chat messages are limited to 20,000 characters",
            ));
        }
        if request.targets.is_empty() || request.targets.len() > 4 {
            return Err(AppError::message("Choose between one and four models"));
        }

        let server_ids: HashSet<&str> = request
            .targets
            .iter()
            .map(|target| target.server_id.as_str())
            .collect();
        if server_ids.len() != request.targets.len() {
            return Err(AppError::message(
                "Comparison models must run on different servers",
            ));
        }
        let model_names: HashSet<String> = request
            .targets
            .iter()
            .map(|target| target.model_name.trim().to_ascii_lowercase())
            .collect();
        if model_names.len() != request.targets.len() {
            return Err(AppError::message("Choose each model only once"));
        }

        let snapshot = self.get_snapshot()?;
        let mut prepared = Vec::with_capacity(request.targets.len());
        for target in request.targets {
            let server = snapshot
                .servers
                .iter()
                .find(|server| server.id == target.server_id)
                .ok_or_else(|| AppError::message("A selected server is no longer available"))?;
            if server.status != ServerStatus::Online {
                return Err(AppError::message(format!(
                    "{} is no longer online",
                    server.endpoint
                )));
            }
            if !server.benchmark_approved {
                return Err(AppError::message(format!(
                    "Generation is not enabled for {}",
                    server.endpoint
                )));
            }
            let model = server
                .models
                .iter()
                .find(|model| model.name.eq_ignore_ascii_case(target.model_name.trim()))
                .filter(|model| is_benchmarkable_local_model(model))
                .ok_or_else(|| {
                    AppError::message(format!(
                        "{} is not available for chat on {}",
                        target.model_name, server.endpoint
                    ))
                })?;
            prepared.push((
                server.id.clone(),
                server.endpoint.clone(),
                model.name.clone(),
            ));
        }

        let settings = snapshot.settings;
        let mut results = stream::iter(prepared.into_iter().enumerate())
            .map(|(index, (server_id, endpoint, model_name))| {
                let engine = self.clone();
                let prompt = prompt.clone();
                let settings = settings.clone();
                async move {
                    let lock = engine.server_lock(&server_id).await;
                    let _guard = lock.lock().await;
                    let started = Instant::now();
                    let result = OllamaClient::new(endpoint.clone(), settings)
                        .chat(&model_name, &prompt)
                        .await;
                    let elapsed_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
                    let reply = match result {
                        Ok(content) => ChatModelReply {
                            server_id,
                            endpoint,
                            model_name,
                            elapsed_ms,
                            content: Some(content),
                            error_code: None,
                            error_message: None,
                        },
                        Err(error) => ChatModelReply {
                            server_id,
                            endpoint,
                            model_name,
                            elapsed_ms,
                            content: None,
                            error_code: Some(error.code),
                            error_message: Some(error.message),
                        },
                    };
                    (index, reply)
                }
            })
            .buffer_unordered(4)
            .collect::<Vec<_>>()
            .await;
        results.sort_by_key(|(index, _)| *index);
        Ok(ChatResponse {
            results: results.into_iter().map(|(_, reply)| reply).collect(),
        })
    }

    pub fn remove_server(&self, server_id: String) -> AppResult<()> {
        self.remove_servers(vec![server_id])
    }

    pub fn remove_servers(&self, server_ids: Vec<String>) -> AppResult<()> {
        let selected: HashSet<String> = server_ids.into_iter().collect();
        if selected.is_empty() {
            return Ok(());
        }
        self.mutate(|snapshot| {
            snapshot
                .servers
                .retain(|server| !selected.contains(&server.id));
            Ok(())
        })?;
        self.broadcast();
        Ok(())
    }

    pub fn export_servers(
        &self,
        options: ServerExportOptions,
        file_path: String,
    ) -> AppResult<ServerExportResult> {
        let unique_ids: HashSet<String> = options.server_ids.into_iter().collect();
        let model_name = options
            .model_name
            .filter(|value| !value.is_empty() && value.len() <= 512);
        let snapshot = self.get_snapshot()?;
        let servers: Vec<ServerRecord> = snapshot
            .servers
            .into_iter()
            .filter(|server| unique_ids.contains(&server.id))
            .collect();
        if servers.is_empty() {
            return Err(AppError::message("Select at least one server to export"));
        }
        fs::write(
            &file_path,
            create_server_export_csv(&servers, model_name.as_deref()),
        )?;
        Ok(ServerExportResult {
            file_path,
            count: servers.len(),
        })
    }

    pub fn shutdown(&self) {
        if self.inner.shutting_down.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Ok(mut store) = self.store() {
            let _ = store.cancel_running_jobs();
        }
        if let Ok(mut active) = self.inner.active_jobs.lock() {
            active.clear();
        }
    }

    async fn run_localhost_discovery(&self, job_id: String) {
        if self.set_job_running(&job_id).is_err() {
            return;
        }
        let settings = match self.get_snapshot() {
            Ok(snapshot) => snapshot.settings,
            Err(error) => {
                let _ = self.finish_job(&job_id, JobStatus::Failed, Some(error.to_string()), None);
                return;
            }
        };
        let engine = self.clone();
        let progress_id = job_id.clone();
        let on_progress = Arc::new(move |completed, _total| {
            let _ = engine.set_job_progress(&progress_id, completed);
        });
        let discovered = discover_localhost_ollama(&settings, on_progress).await;
        let server_ids = match self.persist_discovered(&discovered, DiscoverySource::Localhost) {
            Ok(ids) => ids,
            Err(error) => {
                let _ = self.finish_job(&job_id, JobStatus::Failed, Some(error.to_string()), None);
                return;
            }
        };
        let summary = if discovered.is_empty() {
            "No Ollama server found on localhost:11434.".into()
        } else {
            format!(
                "Found Ollama {} on this device.",
                discovered
                    .first()
                    .map(|value| value.version.as_str())
                    .unwrap_or_default()
            )
        };
        let _ = self.finish_job(&job_id, JobStatus::Completed, None, Some(summary));
        if !server_ids.is_empty() {
            let _ = self.queue_scan(Some(server_ids), ScanOptions::default());
        }
    }

    async fn run_lan_discovery(&self, job_id: String, plan: LanScanPlan) {
        if self.set_job_running(&job_id).is_err() {
            return;
        }
        if plan.targets.is_empty() {
            let _ = self.finish_job(
                &job_id,
                JobStatus::Failed,
                Some("No active RFC1918 IPv4 network interface was found".into()),
                None,
            );
            return;
        }
        let settings = match self.get_snapshot() {
            Ok(snapshot) => snapshot.settings,
            Err(error) => {
                let _ = self.finish_job(&job_id, JobStatus::Failed, Some(error.to_string()), None);
                return;
            }
        };
        let engine = self.clone();
        let progress_id = job_id.clone();
        let last_reported = Arc::new(AtomicUsize::new(0));
        let on_progress = Arc::new(move |completed: usize, total: usize| {
            let previous = last_reported.load(Ordering::Relaxed);
            if completed == total || completed.saturating_sub(previous) >= 16 {
                last_reported.store(completed, Ordering::Relaxed);
                let _ = engine.set_job_progress(&progress_id, completed);
            }
        });
        let mut discovered = discover_lan_ollama(&plan, &settings, on_progress).await;
        let known_localhost =
            self.get_snapshot()
                .map(|snapshot| {
                    snapshot.servers.iter().any(|server| {
                        discovery_sources(server).contains(&DiscoverySource::Localhost)
                    })
                })
                .unwrap_or(false);
        if known_localhost {
            discovered.retain(|value| !plan.self_addresses.contains(&value.ip));
        }
        let server_ids = match self.persist_discovered(&discovered, DiscoverySource::LanScan) {
            Ok(ids) => ids,
            Err(error) => {
                let _ = self.finish_job(&job_id, JobStatus::Failed, Some(error.to_string()), None);
                return;
            }
        };
        let summary = if discovered.is_empty() {
            format!(
                "No Ollama servers found across {} local addresses.",
                plan.targets.len()
            )
        } else {
            format!(
                "Found {} Ollama server{} across {} local network{}.",
                discovered.len(),
                if discovered.len() == 1 { "" } else { "s" },
                plan.networks.len(),
                if plan.networks.len() == 1 { "" } else { "s" }
            )
        };
        let _ = self.finish_job(&job_id, JobStatus::Completed, None, Some(summary));
        if !server_ids.is_empty() {
            let _ = self.queue_scan(Some(server_ids), ScanOptions::default());
        }
    }

    fn persist_discovered(
        &self,
        discovered: &[DiscoveredOllamaEndpoint],
        source: DiscoverySource,
    ) -> AppResult<Vec<String>> {
        let now = Utc::now().to_rfc3339();
        let ids = self.mutate(|snapshot| {
            let mut server_ids = Vec::new();
            for candidate in discovered {
                let existing = if source == DiscoverySource::Localhost {
                    snapshot
                        .servers
                        .iter_mut()
                        .find(|server| is_loopback_endpoint(&server.endpoint))
                } else {
                    snapshot
                        .servers
                        .iter_mut()
                        .find(|server| server.endpoint == candidate.endpoint)
                };
                if let Some(server) = existing {
                    merge_discovery_source(server, source.clone());
                    server.ip = Some(candidate.ip.clone());
                    server.status = ServerStatus::Online;
                    server.ollama_version = Some(candidate.version.clone());
                    server.failure_count = 0;
                    server.last_discovered_at = now.clone();
                    server.last_checked_at = Some(now.clone());
                    server.last_online_at = Some(now.clone());
                    if server.city.is_none() {
                        server.city = Some(if source == DiscoverySource::Localhost {
                            "This device".into()
                        } else {
                            "Local network".into()
                        });
                    }
                    server.last_error_code = None;
                    server.last_error_message = None;
                    server_ids.push(server.id.clone());
                } else {
                    let candidate = DiscoveryCandidate {
                        endpoint: candidate.endpoint.clone(),
                        source: source.clone(),
                        ip: Some(candidate.ip.clone()),
                        country: None,
                        region: None,
                        city: Some(if source == DiscoverySource::Localhost {
                            "This device".into()
                        } else {
                            "Local network".into()
                        }),
                        asn: None,
                        organization: None,
                        source_updated_at: Some(now.clone()),
                    };
                    let mut server = candidate_to_server(&candidate, false, &now);
                    server.status = ServerStatus::Online;
                    server.last_checked_at = Some(now.clone());
                    server.last_online_at = Some(now.clone());
                    server.ollama_version = Some(
                        discovered
                            .iter()
                            .find(|value| value.endpoint == server.endpoint)
                            .map(|value| value.version.clone())
                            .unwrap_or_default(),
                    );
                    server_ids.push(server.id.clone());
                    snapshot.servers.push(server);
                }
            }
            Ok(server_ids)
        })?;
        self.broadcast();
        Ok(ids)
    }

    fn queue_scan(
        &self,
        server_ids: Option<Vec<String>>,
        options: ScanOptions,
    ) -> AppResult<String> {
        if let Some(active) = self.find_active_job(JobKind::Scan)? {
            return Ok(active);
        }
        let snapshot = self.get_snapshot()?;
        let ids = server_ids
            .unwrap_or_else(|| {
                snapshot
                    .servers
                    .iter()
                    .map(|server| server.id.clone())
                    .collect()
            })
            .into_iter()
            .filter(|id| snapshot.servers.iter().any(|server| &server.id == id))
            .collect::<Vec<_>>();
        let label = options.label.clone().unwrap_or_else(|| {
            if ids.len() == 1 {
                "Scan server inventory".into()
            } else {
                format!("Scan {} server inventories", ids.len())
            }
        });
        let job_id = self.create_job(JobKind::Scan, label, ids.len())?;
        let engine = self.clone();
        let task_id = job_id.clone();
        tauri::async_runtime::spawn(async move {
            engine.run_scan_job(task_id, ids, options).await;
        });
        Ok(job_id)
    }

    async fn run_scan_job(&self, job_id: String, server_ids: Vec<String>, options: ScanOptions) {
        if self.set_job_running(&job_id).is_err() {
            return;
        }
        let ready = Arc::new(Mutex::new(Vec::<String>::new()));
        run_with_dynamic_concurrency(
            server_ids,
            self.inner.settings_changed.subscribe(),
            || {
                self.get_snapshot()
                    .map(|snapshot| snapshot.settings.scan_concurrency)
                    .unwrap_or(1)
            },
            |server_id| {
                let engine = self.clone();
                let job_id = job_id.clone();
                let ready = ready.clone();
                let options = options.clone();
                async move {
                    if engine.inner.shutting_down.load(Ordering::Relaxed) {
                        return;
                    }
                    let lock = engine.server_lock(&server_id).await;
                    let _guard = lock.lock().await;
                    if engine.scan_one_server(&server_id).await
                        && options.benchmark_after_scan
                        && engine
                            .get_snapshot()
                            .ok()
                            .and_then(|snapshot| {
                                snapshot
                                    .servers
                                    .into_iter()
                                    .find(|server| server.id == server_id)
                            })
                            .is_some_and(|server| is_server_ready_for_benchmark(&server))
                        && let Ok(mut values) = ready.lock()
                    {
                        values.push(server_id.clone());
                    }
                    let _ = engine.increment_job(&job_id);
                }
            },
        )
        .await;
        let _ = self.finish_job(&job_id, JobStatus::Completed, None, None);
        let ready = ready
            .lock()
            .map(|values| values.clone())
            .unwrap_or_default();
        if !self.inner.shutting_down.load(Ordering::Relaxed) && !ready.is_empty() {
            let _ = self.queue_benchmark(
                ready,
                options.force_benchmark,
                None,
                "Benchmark all approved local models".into(),
            );
        }
    }

    async fn scan_one_server(&self, server_id: &str) -> bool {
        let snapshot = match self.get_snapshot() {
            Ok(snapshot) => snapshot,
            Err(_) => return false,
        };
        let Some(server) = snapshot
            .servers
            .iter()
            .find(|server| server.id == server_id)
            .cloned()
        else {
            return false;
        };
        let _ = self.mutate(|snapshot| {
            let current = require_server_mut(snapshot, server_id)?;
            current.status = ServerStatus::Checking;
            current.last_checked_at = Some(Utc::now().to_rfc3339());
            Ok(())
        });
        self.broadcast();

        match OllamaClient::new(server.endpoint, snapshot.settings)
            .inventory()
            .await
        {
            Ok(inventory) => {
                let now = Utc::now().to_rfc3339();
                let result = self.mutate(|snapshot| {
                    let current = require_server_mut(snapshot, server_id)?;
                    current.status = ServerStatus::Online;
                    current.ollama_version = Some(inventory.version);
                    current.failure_count = 0;
                    current.last_online_at = Some(now.clone());
                    current.last_checked_at = Some(now.clone());
                    current.last_error_code = None;
                    current.last_error_message = None;
                    let returned: HashSet<String> = inventory
                        .models
                        .iter()
                        .map(|model| model.name.clone())
                        .collect();
                    for model in &mut current.models {
                        model.installed = returned.contains(&model.name);
                    }
                    for discovered in inventory.models {
                        if let Some(existing) = current
                            .models
                            .iter_mut()
                            .find(|model| model.name == discovered.name)
                        {
                            existing.digest = discovered.digest;
                            existing.size_bytes = discovered.size_bytes;
                            existing.family = discovered.family;
                            existing.parameter_size = discovered.parameter_size;
                            existing.quantization = discovered.quantization;
                            existing.capabilities = discovered.capabilities;
                            existing.installed = true;
                            existing.last_seen_at = now.clone();
                        } else {
                            current.models.push(ServerModel {
                                id: Uuid::new_v4().to_string(),
                                name: discovered.name,
                                digest: discovered.digest,
                                family: discovered.family,
                                parameter_size: discovered.parameter_size,
                                quantization: discovered.quantization,
                                size_bytes: discovered.size_bytes,
                                capabilities: discovered.capabilities,
                                installed: true,
                                first_seen_at: now.clone(),
                                last_seen_at: now.clone(),
                                benchmarks: Vec::new(),
                            });
                        }
                    }
                    Ok(())
                });
                self.broadcast();
                result.is_ok()
            }
            Err(error) => {
                let _ = self.mutate(|snapshot| {
                    let current = require_server_mut(snapshot, server_id)?;
                    current.failure_count += 1;
                    current.status = if current.failure_count >= 3 {
                        ServerStatus::Offline
                    } else {
                        ServerStatus::Unknown
                    };
                    current.last_checked_at = Some(Utc::now().to_rfc3339());
                    current.last_error_code = Some(error.code);
                    current.last_error_message = Some(error.message);
                    Ok(())
                });
                self.broadcast();
                false
            }
        }
    }

    fn queue_benchmark(
        &self,
        server_ids: Vec<String>,
        force: bool,
        resume_started_at: Option<String>,
        label: String,
    ) -> AppResult<String> {
        if let Some(active) = self.find_active_job(JobKind::Benchmark)? {
            return Ok(active);
        }
        let benchmark_started_at = resume_started_at
            .clone()
            .unwrap_or_else(|| Utc::now().to_rfc3339());
        let job_id = self.create_job_with_context(
            JobKind::Benchmark,
            label,
            server_ids.len(),
            server_ids.clone(),
            Some(benchmark_started_at),
        )?;
        let engine = self.clone();
        let task_id = job_id.clone();
        tauri::async_runtime::spawn(async move {
            engine
                .run_benchmark_job(task_id, server_ids, force, resume_started_at)
                .await;
        });
        Ok(job_id)
    }

    async fn run_benchmark_job(
        &self,
        job_id: String,
        server_ids: Vec<String>,
        force: bool,
        resume_started_at: Option<String>,
    ) {
        if self.set_job_running(&job_id).is_err() {
            return;
        }
        run_with_dynamic_concurrency(
            server_ids,
            self.inner.settings_changed.subscribe(),
            || {
                self.get_snapshot()
                    .map(|snapshot| snapshot.settings.benchmark_concurrency)
                    .unwrap_or(1)
            },
            |server_id| {
                let engine = self.clone();
                let job_id = job_id.clone();
                let resume_started_at = resume_started_at.clone();
                async move {
                    if engine.inner.shutting_down.load(Ordering::Relaxed) {
                        return;
                    }
                    let lock = engine.server_lock(&server_id).await;
                    let _guard = lock.lock().await;
                    engine
                        .benchmark_one_server(&server_id, force, resume_started_at.as_deref())
                        .await;
                    let _ = engine.increment_job(&job_id);
                }
            },
        )
        .await;
        let _ = self.finish_job(&job_id, JobStatus::Completed, None, None);
    }

    async fn benchmark_one_server(
        &self,
        server_id: &str,
        force: bool,
        resume_started_at: Option<&str>,
    ) {
        let snapshot = match self.get_snapshot() {
            Ok(snapshot) => snapshot,
            Err(_) => return,
        };
        let Some(server) = snapshot
            .servers
            .iter()
            .find(|server| server.id == server_id)
            .cloned()
        else {
            return;
        };
        if !server.benchmark_approved || server.status != ServerStatus::Online {
            return;
        }
        let models: Vec<ServerModel> = server
            .models
            .iter()
            .filter(|model| {
                is_benchmarkable_local_model(model)
                    && resume_started_at.map_or_else(
                        || force || is_benchmark_due(model, &server, Utc::now()),
                        |started_at| !was_benchmarked_since(model, started_at),
                    )
            })
            .cloned()
            .collect();
        let client = OllamaClient::new(server.endpoint, snapshot.settings);
        for model in models {
            if self.inner.shutting_down.load(Ordering::Relaxed) {
                return;
            }
            let started_at = Utc::now().to_rfc3339();
            let result = match client.benchmark(&model.name).await {
                Ok(result) => result,
                Err(error) => failed_benchmark(error, started_at),
            };
            let _ = self.append_benchmark(server_id, &model.id, result);
            self.broadcast();
        }
    }

    fn append_benchmark(
        &self,
        server_id: &str,
        model_id: &str,
        result: BenchmarkResult,
    ) -> AppResult<()> {
        self.mutate(|snapshot| {
            let server = require_server_mut(snapshot, server_id)?;
            let model = server
                .models
                .iter_mut()
                .find(|model| model.id == model_id)
                .ok_or_else(|| AppError::message("Model not found"))?;
            model.benchmarks.insert(0, result);
            let cutoff = Utc::now() - Duration::days(90);
            model.benchmarks.retain(|candidate| {
                chrono::DateTime::parse_from_rfc3339(&candidate.finished_at)
                    .map(|value| value.with_timezone(&Utc) >= cutoff)
                    .unwrap_or(false)
            });
            model.benchmarks.truncate(500);
            Ok(())
        })
    }

    fn run_monitoring_cycle(&self) -> AppResult<()> {
        if self.find_active_job(JobKind::Scan)?.is_some()
            || self.find_active_job(JobKind::Benchmark)?.is_some()
        {
            return Ok(());
        }
        let snapshot = self.get_snapshot()?;
        let should_scan = {
            let mut last = self
                .inner
                .last_scheduled_scan
                .lock()
                .map_err(|_| AppError::message("Monitoring state is unavailable"))?;
            let should = last.is_none_or(|value| value.elapsed().as_secs() >= 3_600);
            if should {
                *last = Some(Instant::now());
            }
            should
        };
        if should_scan {
            if !snapshot.servers.is_empty() {
                let _ = self.queue_scan(
                    None,
                    ScanOptions {
                        benchmark_after_scan: true,
                        ..ScanOptions::default()
                    },
                );
            }
            return Ok(());
        }
        let due: Vec<String> = snapshot
            .servers
            .iter()
            .filter(|server| {
                server.status == ServerStatus::Online
                    && server.benchmark_approved
                    && server.models.iter().any(|model| {
                        is_benchmarkable_local_model(model)
                            && is_benchmark_due(model, server, Utc::now())
                    })
            })
            .map(|server| server.id.clone())
            .collect();
        if !due.is_empty() {
            let _ =
                self.queue_benchmark(due, false, None, "Scheduled local model benchmarks".into());
        }
        Ok(())
    }

    fn require_private_network_access(&self) -> AppResult<()> {
        if !self.get_snapshot()?.settings.allow_private_networks {
            return Err(AppError::message(
                "Enable LAN and localhost servers in Settings first",
            ));
        }
        Ok(())
    }

    fn find_active_job(&self, kind: JobKind) -> AppResult<Option<String>> {
        if let Some(id) = self.active_jobs()?.get(&kind) {
            return Ok(Some(id.clone()));
        }
        Ok(self
            .get_snapshot()?
            .jobs
            .into_iter()
            .find(|job| {
                job.kind == kind && matches!(job.status, JobStatus::Queued | JobStatus::Running)
            })
            .map(|job| job.id))
    }

    fn create_job(&self, kind: JobKind, label: String, total: usize) -> AppResult<String> {
        self.create_job_with_context(kind, label, total, Vec::new(), None)
    }

    fn create_job_with_context(
        &self,
        kind: JobKind,
        label: String,
        total: usize,
        target_server_ids: Vec<String>,
        benchmark_started_at: Option<String>,
    ) -> AppResult<String> {
        let now = Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();
        let job = ProfilerJob {
            id: id.clone(),
            kind: kind.clone(),
            status: JobStatus::Queued,
            label,
            completed: 0,
            total,
            created_at: now.clone(),
            updated_at: now,
            progress_samples: Vec::new(),
            target_server_ids,
            benchmark_started_at,
            summary: None,
            error_message: None,
        };
        self.active_jobs()?.insert(kind, id.clone());
        self.mutate(|snapshot| {
            snapshot.jobs.insert(0, job);
            snapshot.jobs.truncate(50);
            Ok(())
        })?;
        self.broadcast();
        Ok(id)
    }

    fn set_job_running(&self, job_id: &str) -> AppResult<()> {
        self.mutate(|snapshot| {
            if let Some(job) = snapshot.jobs.iter_mut().find(|job| job.id == job_id)
                && job.status != JobStatus::Cancelled
            {
                job.status = JobStatus::Running;
                let now = Utc::now().to_rfc3339();
                job.updated_at = now.clone();
                job.progress_samples = vec![JobProgressSample {
                    completed: job.completed,
                    recorded_at: now,
                }];
            }
            Ok(())
        })?;
        self.broadcast();
        Ok(())
    }

    fn increment_job(&self, job_id: &str) -> AppResult<()> {
        self.mutate(|snapshot| {
            if let Some(job) = snapshot.jobs.iter_mut().find(|job| job.id == job_id)
                && matches!(job.status, JobStatus::Queued | JobStatus::Running)
            {
                let completed = (job.completed + 1).min(job.total);
                record_job_progress(job, completed, Utc::now().to_rfc3339());
            }
            Ok(())
        })?;
        self.broadcast();
        Ok(())
    }

    fn set_job_progress(&self, job_id: &str, completed: usize) -> AppResult<()> {
        self.mutate(|snapshot| {
            if let Some(job) = snapshot.jobs.iter_mut().find(|job| job.id == job_id)
                && matches!(job.status, JobStatus::Queued | JobStatus::Running)
            {
                let completed = job.completed.max(completed).min(job.total);
                if completed > job.completed {
                    record_job_progress(job, completed, Utc::now().to_rfc3339());
                }
            }
            Ok(())
        })?;
        self.broadcast();
        Ok(())
    }

    fn finish_job(
        &self,
        job_id: &str,
        status: JobStatus,
        error_message: Option<String>,
        summary: Option<String>,
    ) -> AppResult<()> {
        let kind = self.mutate(|snapshot| {
            let Some(job) = snapshot.jobs.iter_mut().find(|job| job.id == job_id) else {
                return Ok(None);
            };
            if job.status == JobStatus::Cancelled {
                return Ok(None);
            }
            let kind = job.kind.clone();
            job.status = status.clone();
            if status == JobStatus::Completed {
                job.completed = job.total;
            }
            job.updated_at = Utc::now().to_rfc3339();
            job.error_message = error_message;
            job.summary = summary;
            Ok(Some(kind))
        })?;
        if let Some(kind) = kind {
            let mut active = self.active_jobs()?;
            if active.get(&kind).is_some_and(|id| id == job_id) {
                active.remove(&kind);
            }
        }
        self.broadcast();
        Ok(())
    }

    async fn server_lock(&self, server_id: &str) -> Arc<AsyncMutex<()>> {
        let mut locks = self.inner.server_locks.lock().await;
        locks
            .entry(server_id.to_string())
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
            .clone()
    }

    fn mutate<T>(
        &self,
        mutator: impl FnOnce(&mut ProfilerSnapshot) -> AppResult<T>,
    ) -> AppResult<T> {
        self.store()?.mutate(mutator)
    }

    fn broadcast(&self) {
        if let Ok(snapshot) = self.get_snapshot() {
            let _ = self.inner.app.emit("profiler:snapshot", snapshot);
        }
    }

    fn store(&self) -> AppResult<MutexGuard<'_, ProfilerStore>> {
        self.inner
            .store
            .lock()
            .map_err(|_| AppError::message("Application data store is unavailable"))
    }

    fn import_sessions(&self) -> AppResult<MutexGuard<'_, HashMap<String, ImportPreview>>> {
        self.inner
            .import_sessions
            .lock()
            .map_err(|_| AppError::message("Import session store is unavailable"))
    }

    fn active_jobs(&self) -> AppResult<MutexGuard<'_, HashMap<JobKind, String>>> {
        self.inner
            .active_jobs
            .lock()
            .map_err(|_| AppError::message("Job state is unavailable"))
    }
}

fn record_job_progress(job: &mut ProfilerJob, completed: usize, recorded_at: String) {
    job.completed = completed;
    job.updated_at = recorded_at.clone();
    job.progress_samples.push(JobProgressSample {
        completed,
        recorded_at,
    });
    let overflow = job
        .progress_samples
        .len()
        .saturating_sub(MAX_JOB_PROGRESS_SAMPLES);
    if overflow > 0 {
        job.progress_samples.drain(..overflow);
    }
}

fn latest_incomplete_benchmark(snapshot: &ProfilerSnapshot) -> Option<&ProfilerJob> {
    snapshot
        .jobs
        .iter()
        .find(|job| job.kind == JobKind::Benchmark)
        .filter(|job| {
            matches!(job.status, JobStatus::Cancelled | JobStatus::Failed)
                && job.completed < job.total
        })
}

fn was_benchmarked_since(model: &ServerModel, started_at: &str) -> bool {
    let Ok(started_at) = chrono::DateTime::parse_from_rfc3339(started_at) else {
        return false;
    };
    model.benchmarks.iter().any(|result| {
        chrono::DateTime::parse_from_rfc3339(&result.finished_at)
            .map(|finished_at| finished_at >= started_at)
            .unwrap_or(false)
    })
}

fn apply_candidate(server: &mut ServerRecord, candidate: &DiscoveryCandidate, now: &str) {
    merge_discovery_source(server, candidate.source.clone());
    server.ip = candidate.ip.clone().or(server.ip.take());
    server.country = candidate.country.clone().or(server.country.take());
    server.region = candidate.region.clone().or(server.region.take());
    server.city = candidate.city.clone().or(server.city.take());
    server.asn = candidate.asn.clone().or(server.asn.take());
    server.organization = candidate
        .organization
        .clone()
        .or(server.organization.take());
    server.source_updated_at = candidate
        .source_updated_at
        .clone()
        .or(server.source_updated_at.take());
    server.last_discovered_at = now.to_string();
}

fn candidate_to_server(
    candidate: &DiscoveryCandidate,
    benchmark_approved: bool,
    now: &str,
) -> ServerRecord {
    ServerRecord {
        id: Uuid::new_v4().to_string(),
        endpoint: candidate.endpoint.clone(),
        source: candidate.source.clone(),
        discovery_sources: vec![candidate.source.clone()],
        ip: candidate.ip.clone(),
        country: candidate.country.clone(),
        region: candidate.region.clone(),
        city: candidate.city.clone(),
        asn: candidate.asn.clone(),
        organization: candidate.organization.clone(),
        source_updated_at: candidate.source_updated_at.clone(),
        status: ServerStatus::Unknown,
        ollama_version: None,
        failure_count: 0,
        benchmark_approved,
        first_discovered_at: now.into(),
        last_discovered_at: now.into(),
        last_checked_at: None,
        last_online_at: None,
        last_error_code: None,
        last_error_message: None,
        models: Vec::new(),
    }
}

fn merge_discovery_source(server: &mut ServerRecord, source: DiscoverySource) {
    if server.discovery_sources.is_empty() {
        server.discovery_sources.push(server.source.clone());
    }
    if !server.discovery_sources.contains(&source) {
        server.discovery_sources.push(source);
    }
}

fn discovery_sources(server: &ServerRecord) -> Vec<DiscoverySource> {
    if server.discovery_sources.is_empty() {
        vec![server.source.clone()]
    } else {
        server.discovery_sources.clone()
    }
}

fn is_loopback_endpoint(endpoint: &str) -> bool {
    url::Url::parse(endpoint)
        .ok()
        .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
        .is_some_and(|host| matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1"))
}

fn preview_for_renderer(preview: &ImportPreview) -> ImportPreview {
    let mut output = preview.clone();
    output.candidates.truncate(100);
    output.issues.truncate(100);
    output
}

fn require_server_mut<'a>(
    snapshot: &'a mut ProfilerSnapshot,
    server_id: &str,
) -> AppResult<&'a mut ServerRecord> {
    snapshot
        .servers
        .iter_mut()
        .find(|server| server.id == server_id)
        .ok_or_else(|| AppError::message("Server not found"))
}

fn is_server_ready_for_benchmark(server: &ServerRecord) -> bool {
    server.status == ServerStatus::Online
        && server.benchmark_approved
        && server.models.iter().any(is_benchmarkable_local_model)
}

fn failed_benchmark(error: OllamaClientError, started_at: String) -> BenchmarkResult {
    BenchmarkResult {
        id: Uuid::new_v4().to_string(),
        status: BenchmarkStatus::Failed,
        started_at,
        finished_at: Utc::now().to_rfc3339(),
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
        error_code: Some(error.code),
        error_message: Some(error.message),
    }
}

async fn run_with_dynamic_concurrency<T, Task, TaskFuture, Limit>(
    items: Vec<T>,
    mut settings_changed: watch::Receiver<u64>,
    mut current_limit: Limit,
    task: Task,
) where
    Task: Fn(T) -> TaskFuture,
    TaskFuture: Future<Output = ()>,
    Limit: FnMut() -> usize,
{
    let mut pending = items.into_iter();
    let mut in_flight = FuturesUnordered::new();
    let mut has_pending = true;
    let mut settings_watch_open = true;

    loop {
        if has_pending {
            let available_slots = current_limit().max(1).saturating_sub(in_flight.len());
            for _ in 0..available_slots {
                if let Some(item) = pending.next() {
                    in_flight.push(task(item));
                } else {
                    has_pending = false;
                    break;
                }
            }
        }

        if in_flight.is_empty() {
            break;
        }

        if has_pending && settings_watch_open {
            let next_completion = in_flight.next();
            let next_settings_change = settings_changed.changed();
            futures_util::pin_mut!(next_completion, next_settings_change);
            match select(next_completion, next_settings_change).await {
                Either::Left(_) => {}
                Either::Right((result, _)) => settings_watch_open = result.is_ok(),
            }
        } else {
            let _ = in_flight.next().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::time::Duration as StdDuration;
    use tokio::sync::{Semaphore, mpsc};

    fn benchmark_job(status: JobStatus, completed: usize, total: usize) -> ProfilerJob {
        ProfilerJob {
            id: "benchmark-job".into(),
            kind: JobKind::Benchmark,
            status,
            label: "Benchmark all approved local models".into(),
            completed,
            total,
            created_at: "2026-07-26T00:00:00Z".into(),
            updated_at: "2026-07-26T00:05:00Z".into(),
            progress_samples: Vec::new(),
            target_server_ids: vec!["server-1".into()],
            benchmark_started_at: Some("2026-07-26T00:00:00Z".into()),
            summary: None,
            error_message: None,
        }
    }

    fn benchmark_model(finished_at: &str) -> ServerModel {
        ServerModel {
            id: "model-1".into(),
            name: "llama3.1:8b".into(),
            digest: None,
            family: None,
            parameter_size: None,
            quantization: None,
            size_bytes: None,
            capabilities: vec!["completion".into()],
            installed: true,
            first_seen_at: "2026-07-25T00:00:00Z".into(),
            last_seen_at: "2026-07-26T00:00:00Z".into(),
            benchmarks: vec![BenchmarkResult {
                id: "result-1".into(),
                status: BenchmarkStatus::Success,
                started_at: "2026-07-26T00:01:00Z".into(),
                finished_at: finished_at.into(),
                tokens_per_second: Some(42.0),
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
            }],
        }
    }

    #[test]
    fn keeps_only_the_latest_ten_progress_intervals() {
        let mut job = ProfilerJob {
            id: "job".into(),
            kind: JobKind::Scan,
            status: JobStatus::Running,
            label: "Scan all servers".into(),
            completed: 0,
            total: 20,
            created_at: "2026-07-26T00:00:00Z".into(),
            updated_at: "2026-07-26T00:00:00Z".into(),
            progress_samples: vec![JobProgressSample {
                completed: 0,
                recorded_at: "2026-07-26T00:00:00Z".into(),
            }],
            target_server_ids: Vec::new(),
            benchmark_started_at: None,
            summary: None,
            error_message: None,
        };

        for completed in 1..=20 {
            record_job_progress(
                &mut job,
                completed,
                format!("2026-07-26T00:00:{completed:02}Z"),
            );
        }

        assert_eq!(job.progress_samples.len(), MAX_JOB_PROGRESS_SAMPLES);
        assert_eq!(job.progress_samples[0].completed, 10);
        assert_eq!(job.progress_samples[10].completed, 20);
    }

    #[test]
    fn only_the_latest_unfinished_benchmark_can_be_resumed() {
        let mut snapshot = ProfilerSnapshot::empty("2026-07-26T00:00:00Z".into());
        snapshot
            .jobs
            .push(benchmark_job(JobStatus::Cancelled, 2, 5));
        assert!(latest_incomplete_benchmark(&snapshot).is_some());

        snapshot
            .jobs
            .insert(0, benchmark_job(JobStatus::Completed, 5, 5));
        assert!(latest_incomplete_benchmark(&snapshot).is_none());
    }

    #[test]
    fn resume_skips_models_already_attempted_during_the_interrupted_run() {
        assert!(was_benchmarked_since(
            &benchmark_model("2026-07-26T00:02:00Z"),
            "2026-07-26T00:00:00Z"
        ));
        assert!(!was_benchmarked_since(
            &benchmark_model("2026-07-25T23:59:00Z"),
            "2026-07-26T00:00:00Z"
        ));
    }

    #[test]
    fn increasing_concurrency_starts_more_work_before_the_current_task_finishes() {
        tauri::async_runtime::block_on(async {
            let limit = Arc::new(AtomicUsize::new(1));
            let (settings_tx, settings_rx) = watch::channel(0);
            let (started_tx, mut started_rx) = mpsc::unbounded_channel();
            let permits = Arc::new(Semaphore::new(0));

            let scheduler = run_with_dynamic_concurrency(
                vec![0, 1, 2, 3],
                settings_rx,
                {
                    let limit = limit.clone();
                    move || limit.load(Ordering::Relaxed)
                },
                {
                    let permits = permits.clone();
                    move |item| {
                        let permits = permits.clone();
                        let started_tx = started_tx.clone();
                        async move {
                            started_tx.send(item).expect("start receiver is open");
                            permits
                                .acquire_owned()
                                .await
                                .expect("semaphore is open")
                                .forget();
                        }
                    }
                },
            );
            let controller = async {
                assert_eq!(started_rx.recv().await, Some(0));
                limit.store(3, Ordering::Relaxed);
                settings_tx.send_modify(|version| *version += 1);

                let second = tokio::time::timeout(StdDuration::from_secs(1), started_rx.recv())
                    .await
                    .expect("a higher limit starts another task immediately");
                let third = tokio::time::timeout(StdDuration::from_secs(1), started_rx.recv())
                    .await
                    .expect("a higher limit fills every available slot immediately");
                let mut newly_started = [
                    second.expect("second task has an id"),
                    third.expect("third task has an id"),
                ];
                newly_started.sort_unstable();
                assert_eq!(newly_started, [1, 2]);

                permits.add_permits(4);
            };

            futures_util::future::join(scheduler, controller).await;
        });
    }

    #[test]
    fn decreasing_concurrency_waits_for_running_work_before_starting_more() {
        tauri::async_runtime::block_on(async {
            let limit = Arc::new(AtomicUsize::new(3));
            let (settings_tx, settings_rx) = watch::channel(0);
            let (started_tx, mut started_rx) = mpsc::unbounded_channel();
            let permits = Arc::new(Semaphore::new(0));

            let scheduler = run_with_dynamic_concurrency(
                vec![0, 1, 2, 3, 4],
                settings_rx,
                {
                    let limit = limit.clone();
                    move || limit.load(Ordering::Relaxed)
                },
                {
                    let permits = permits.clone();
                    move |item| {
                        let permits = permits.clone();
                        let started_tx = started_tx.clone();
                        async move {
                            started_tx.send(item).expect("start receiver is open");
                            permits
                                .acquire_owned()
                                .await
                                .expect("semaphore is open")
                                .forget();
                        }
                    }
                },
            );
            let controller = async {
                assert_eq!(started_rx.recv().await, Some(0));
                assert_eq!(started_rx.recv().await, Some(1));
                assert_eq!(started_rx.recv().await, Some(2));

                limit.store(1, Ordering::Relaxed);
                settings_tx.send_modify(|version| *version += 1);
                permits.add_permits(3);

                assert_eq!(
                    tokio::time::timeout(StdDuration::from_secs(1), started_rx.recv())
                        .await
                        .expect("one queued task starts after running work drains"),
                    Some(3)
                );
                assert!(
                    tokio::time::timeout(StdDuration::from_millis(50), started_rx.recv())
                        .await
                        .is_err(),
                    "the next task must wait for the new single-worker limit"
                );

                permits.add_permits(2);
            };

            futures_util::future::join(scheduler, controller).await;
        });
    }
}
