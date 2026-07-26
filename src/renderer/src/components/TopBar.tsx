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
        {profileAction ? (
          <button
            className="button primary compact"
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
