import { Activity, RefreshCw } from 'lucide-react'
import type { ProfilerJob } from '@shared/types'

export interface TopBarAction {
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly disabledReason?: string
}

interface TopBarProps {
  readonly busy: boolean
  readonly jobs: ProfilerJob[]
  readonly profileAction?: TopBarAction
}

export function TopBar({
  busy,
  jobs,
  profileAction
}: Readonly<TopBarProps>): React.JSX.Element {
  const activeJobs = jobs.filter((job) => job.status === 'queued' || job.status === 'running')
  const activeScan = activeJobs.find((job) => job.kind === 'scan')
  const activeBenchmark = activeJobs.find((job) => job.kind === 'benchmark')
  const profilingActive = Boolean(activeScan || activeBenchmark)
  const primaryJob = activeJobs[0]
  const estimatedRemaining = primaryJob
    ? formatEstimatedRemaining(estimateRemainingMs(primaryJob))
    : undefined

  return (
    <header className="topbar" data-tauri-drag-region="deep">
      {primaryJob ? (
        <div aria-live="polite" className="task-state">
          <Activity size={14} />
          <span>
            {primaryJob.label}
            {primaryJob.total > 0
              ? ` · ${primaryJob.completed}/${primaryJob.total}`
              : ''}
            {estimatedRemaining ? ` · ${estimatedRemaining}` : ''}
            {activeJobs.length > 1 ? ` · +${activeJobs.length - 1} more` : ''}
          </span>
        </div>
      ) : <span />}
      <div className="topbar-actions">
        {profileAction ? (
          <button
            className="button primary compact"
            data-tauri-drag-region="false"
            disabled={busy || profilingActive || profileAction.disabled}
            onClick={profileAction.onClick}
            title={profileAction.disabled ? profileAction.disabledReason : undefined}
            type="button"
          >
            <RefreshCw className={profilingActive ? 'spin' : ''} size={14} />
            {activeScan
              ? 'Scanning all…'
              : activeBenchmark
                ? 'Benchmarking all…'
                : profileAction.label}
          </button>
        ) : null}
      </div>
    </header>
  )
}

export function estimateRemainingMs(job: ProfilerJob): number | undefined {
  const remaining = job.total - job.completed
  const samples = job.progressSamples ?? []
  if (remaining <= 0 || samples.length < 2) return undefined

  const first = samples[0]
  const last = samples.at(-1)
  if (!first || !last) return undefined

  const completed = last.completed - first.completed
  const elapsedMs = Date.parse(last.recordedAt) - Date.parse(first.recordedAt)
  if (completed <= 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return undefined
  }

  return Math.ceil((elapsedMs / completed) * remaining)
}

export function formatEstimatedRemaining(
  milliseconds: number | undefined
): string | undefined {
  if (
    milliseconds === undefined ||
    !Number.isFinite(milliseconds) ||
    milliseconds <= 0
  ) {
    return undefined
  }

  const seconds = Math.ceil(milliseconds / 1_000)
  if (seconds < 10) return '<10s remaining'
  if (seconds < 60) return `~${Math.ceil(seconds / 5) * 5}s remaining`

  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `~${minutes}m remaining`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes === 0
    ? `~${hours}h remaining`
    : `~${hours}h ${remainingMinutes}m remaining`
}
