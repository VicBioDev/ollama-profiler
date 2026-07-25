import { Activity, Gauge, RefreshCw } from 'lucide-react'
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
  readonly scanAction?: TopBarAction
  readonly benchmarkAction?: TopBarAction
}

export function TopBar({
  busy,
  jobs,
  scanAction,
  benchmarkAction
}: Readonly<TopBarProps>): React.JSX.Element {
  const activeJobs = jobs.filter((job) => job.status === 'queued' || job.status === 'running')
  const activeScan = activeJobs.find((job) => job.kind === 'scan')
  const activeBenchmark = activeJobs.find((job) => job.kind === 'benchmark')
  const profilingActive = Boolean(activeScan || activeBenchmark)
  const primaryJob = activeJobs[0]

  return (
    <header className="topbar">
      {primaryJob ? (
        <div aria-live="polite" className="task-state">
          <Activity size={14} />
          <span>
            {primaryJob.label}
            {primaryJob.total > 0
              ? ` · ${primaryJob.completed}/${primaryJob.total}`
              : ''}
            {activeJobs.length > 1 ? ` · +${activeJobs.length - 1} more` : ''}
          </span>
        </div>
      ) : <span />}
      <div className="topbar-actions">
        {scanAction ? (
          <button
            className="button secondary compact"
            disabled={busy || profilingActive || scanAction.disabled}
            onClick={scanAction.onClick}
            title={scanAction.disabled ? scanAction.disabledReason : undefined}
            type="button"
          >
            <RefreshCw className={activeScan ? 'spin' : ''} size={14} />
            {activeScan ? 'Scanning…' : scanAction.label}
          </button>
        ) : null}
        {benchmarkAction ? (
          <button
            className="button primary compact"
            disabled={busy || profilingActive || benchmarkAction.disabled}
            onClick={benchmarkAction.onClick}
            title={benchmarkAction.disabled ? benchmarkAction.disabledReason : undefined}
            type="button"
          >
            <Gauge className={activeBenchmark ? 'spin' : ''} size={14} />
            {activeBenchmark ? 'Benchmarking…' : benchmarkAction.label}
          </button>
        ) : null}
      </div>
    </header>
  )
}
