use crate::error::{AppError, AppResult};
use crate::types::{JobStatus, ProfilerSnapshot};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedDocument {
    schema_version: u8,
    snapshot: ProfilerSnapshot,
}

pub struct ProfilerStore {
    path: PathBuf,
    snapshot: ProfilerSnapshot,
}

impl ProfilerStore {
    pub fn load(path: PathBuf) -> AppResult<Self> {
        let now = Utc::now().to_rfc3339();
        let mut store = Self {
            path,
            snapshot: ProfilerSnapshot::empty(now),
        };

        if store.path.exists() {
            let contents = fs::read_to_string(&store.path)?;
            let document: PersistedDocument = serde_json::from_str(&contents)?;
            if document.schema_version != 1 {
                return Err(AppError::message("Unsupported database schema"));
            }
            store.snapshot = document.snapshot;
            store.normalize_loaded_state();
        }
        store.save()?;
        Ok(store)
    }

    pub fn get(&self) -> ProfilerSnapshot {
        self.snapshot.clone()
    }

    pub fn mutate<T>(
        &mut self,
        mutator: impl FnOnce(&mut ProfilerSnapshot) -> AppResult<T>,
    ) -> AppResult<T> {
        let result = mutator(&mut self.snapshot)?;
        self.snapshot.updated_at = Utc::now().to_rfc3339();
        self.save()?;
        Ok(result)
    }

    pub fn cancel_running_jobs(&mut self) -> AppResult<()> {
        self.mutate(|snapshot| {
            let now = Utc::now().to_rfc3339();
            for job in &mut snapshot.jobs {
                if matches!(job.status, JobStatus::Queued | JobStatus::Running) {
                    job.status = JobStatus::Cancelled;
                    job.updated_at = now.clone();
                    job.summary = Some("Cancelled because the application closed.".into());
                    job.error_message = None;
                }
            }
            Ok(())
        })
    }

    fn normalize_loaded_state(&mut self) {
        let now = Utc::now().to_rfc3339();
        for job in self.snapshot.jobs.iter_mut().take(50) {
            let interrupted = matches!(job.status, JobStatus::Queued | JobStatus::Running)
                || (job.status == JobStatus::Failed
                    && job.error_message.as_deref() == Some("Interrupted when the app closed"));
            if interrupted {
                job.status = JobStatus::Cancelled;
                job.updated_at = now.clone();
                job.summary = Some("Cancelled because the application closed.".into());
                job.error_message = None;
            }
        }
        self.snapshot.jobs.truncate(50);

        let cutoff = Utc::now() - Duration::days(90);
        for server in &mut self.snapshot.servers {
            if server.discovery_sources.is_empty() {
                server.discovery_sources.push(server.source.clone());
            }
            for model in &mut server.models {
                model.benchmarks.retain(|result| {
                    DateTime::parse_from_rfc3339(&result.finished_at)
                        .map(|value| value.with_timezone(&Utc) >= cutoff)
                        .unwrap_or(false)
                });
            }
        }
    }

    fn save(&self) -> AppResult<()> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| AppError::message("Application data path has no parent"))?;
        fs::create_dir_all(parent)?;
        let temporary_path = self.path.with_extension("json.tmp");
        let document = PersistedDocument {
            schema_version: 1,
            snapshot: self.snapshot.clone(),
        };
        let mut contents = serde_json::to_vec_pretty(&document)?;
        contents.push(b'\n');
        write_private_file(&temporary_path, &contents)?;
        fs::rename(temporary_path, &self.path)?;
        Ok(())
    }
}

fn write_private_file(path: &Path, contents: &[u8]) -> AppResult<()> {
    let mut options = fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(contents)?;
    file.sync_all()?;
    Ok(())
}

pub fn migrate_legacy_data(target_directory: &Path) -> AppResult<PathBuf> {
    fs::create_dir_all(target_directory)?;
    let target = target_directory.join("profiler-data.json");
    if target.exists() {
        return Ok(target);
    }

    let mut legacy_directories = Vec::new();
    if let Some(directory) = dirs_next::data_dir() {
        legacy_directories.push(directory.join("Ollama Profiler"));
    }
    if let Some(directory) = dirs_next::config_dir() {
        legacy_directories.push(directory.join("Ollama Profiler"));
    }

    for directory in legacy_directories {
        let source = directory.join("profiler-data.json");
        if !source.exists() || source == target {
            continue;
        }
        if fs::rename(&source, &target).is_err() {
            fs::copy(&source, &target)?;
        }
        let _ = fs::remove_file(directory.join("profiler-secrets.json"));
        break;
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{JobKind, ProfilerJob};
    use uuid::Uuid;

    #[test]
    fn loads_electron_data_and_cancels_interrupted_jobs() {
        let directory =
            std::env::temp_dir().join(format!("ollama-profiler-store-{}", Uuid::new_v4()));
        let path = directory.join("profiler-data.json");
        fs::create_dir_all(&directory).unwrap();

        let mut snapshot = ProfilerSnapshot::empty("2026-07-25T00:00:00Z".into());
        snapshot.jobs.push(ProfilerJob {
            id: "running-job".into(),
            kind: JobKind::Scan,
            status: JobStatus::Running,
            label: "Interrupted scan".into(),
            completed: 1,
            total: 2,
            created_at: "2026-07-25T00:00:00Z".into(),
            updated_at: "2026-07-25T00:00:00Z".into(),
            progress_samples: Vec::new(),
            target_server_ids: Vec::new(),
            benchmark_started_at: None,
            summary: None,
            error_message: None,
        });
        let document = PersistedDocument {
            schema_version: 1,
            snapshot,
        };
        fs::write(&path, serde_json::to_vec_pretty(&document).unwrap()).unwrap();

        let loaded = ProfilerStore::load(path).unwrap().get();
        assert_eq!(loaded.jobs[0].status, JobStatus::Cancelled);
        assert_eq!(
            loaded.jobs[0].summary.as_deref(),
            Some("Cancelled because the application closed.")
        );

        fs::remove_dir_all(directory).unwrap();
    }
}
