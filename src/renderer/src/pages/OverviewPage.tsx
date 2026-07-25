import {
  ArrowRight,
  Box,
  CheckCircle2,
  Gauge,
  Server
} from 'lucide-react'
import type { ProfilerSnapshot } from '@shared/types'
import { APP_COPY } from '../data/uiCopy'
import { bestServerSpeed, formatNumber, formatRelative } from '../utils/format'
import { EmptyState } from '../components/EmptyState'
import { MetricCard } from '../components/MetricCard'
import { ServerTable } from '../components/ServerTable'
import { StatusBadge } from '../components/StatusBadge'

interface OverviewPageProps {
  readonly snapshot: ProfilerSnapshot
  readonly onNavigateToImport: () => void
  readonly onSelectServer: (serverId: string) => void
}

export function OverviewPage({
  snapshot,
  onNavigateToImport,
  onSelectServer
}: Readonly<OverviewPageProps>): React.JSX.Element {
  const online = snapshot.servers.filter((server) => server.status === 'online').length
  const uniqueModels = new Set(
    snapshot.servers.flatMap((server) =>
      server.models.filter((model) => model.installed).map((model) => model.name)
    )
  ).size
  const results = snapshot.servers.flatMap((server) =>
    server.models.flatMap((model) => model.benchmarks)
  )
  const successes = results.filter((result) => result.status === 'success')
  const successRate = results.length === 0 ? 0 : (successes.length / results.length) * 100
  const fastest = Math.max(
    0,
    ...snapshot.servers.map((server) => bestServerSpeed(server) ?? 0)
  )
  const recentServers = [...snapshot.servers]
    .sort(
      (left, right) =>
        Date.parse(right.lastOnlineAt ?? right.lastDiscoveredAt) -
        Date.parse(left.lastOnlineAt ?? left.lastDiscoveredAt)
    )
    .slice(0, 6)

  if (snapshot.servers.length === 0) {
    return (
      <div className="focused-state">
        <span className="focused-mark">
          <Gauge size={24} />
        </span>
        <span className="eyebrow">OLLAMA FLEET PROFILING</span>
        <h1>Start with your servers.</h1>
        <p>
          Import a FOFA or Shodan export, or choose a simple endpoint list.
          The app will discover installed models before asking about benchmarks.
        </p>
        <button className="button primary focused-action" onClick={onNavigateToImport} type="button">
          Import servers
          <ArrowRight size={15} />
        </button>
        <small>Inventory scans are read-only. All data stays on this device.</small>
      </div>
    )
  }

  const hasBenchmarks = results.length > 0
  const metricCount = hasBenchmarks ? 4 : 2

  return (
    <div className="page-content">
      <section className="page-intro concise-intro">
        <div>
          <span className="eyebrow">{APP_COPY.eyebrow}</span>
          <h1>Fleet signal,<br />without the noise.</h1>
          <p>Discover models, verify availability, and compare real generation speed.</p>
        </div>
      </section>

      <section
        className={`metric-grid metric-grid-${metricCount}`}
        aria-label="Fleet summary"
      >
        <MetricCard
          detail={`${snapshot.servers.length - online} offline or unchecked`}
          icon={Server}
          label="Online servers"
          tone="accent"
          value={`${online}/${snapshot.servers.length}`}
        />
        <MetricCard
          detail="Exact names including tags"
          icon={Box}
          label="Installed models"
          value={formatNumber(uniqueModels)}
        />
        {hasBenchmarks ? (
          <>
            <MetricCard
              detail={`${successes.length} successful attempts`}
              icon={CheckCircle2}
              label="Benchmark success"
              value={`${successRate.toFixed(0)}%`}
            />
            <MetricCard
              detail="Latest successful result"
              icon={Gauge}
              label="Fastest model"
              tone="warning"
              value={fastest > 0 ? `${fastest.toFixed(1)}` : '—'}
            />
          </>
        ) : null}
      </section>

      <section className={snapshot.jobs.length > 0 ? 'content-grid' : 'content-grid single'}>
        <article className="panel">
          <header className="panel-heading">
            <div>
              <span className="eyebrow">INVENTORY</span>
              <h2>Recent servers</h2>
            </div>
            <span className="panel-count">{snapshot.servers.length} total</span>
          </header>
          {recentServers.length > 0 ? (
            <ServerTable onSelect={onSelectServer} servers={recentServers} />
          ) : (
            <EmptyState
              actionLabel="Import endpoints"
              body={APP_COPY.emptyServersBody}
              onAction={onNavigateToImport}
              title={APP_COPY.emptyServersTitle}
            />
          )}
        </article>

        {snapshot.jobs.length > 0 ? (
          <aside className="panel activity-panel">
            <header className="panel-heading compact-heading">
              <div>
                <span className="eyebrow">ACTIVITY</span>
                <h2>Recent tasks</h2>
              </div>
            </header>
            <div className="job-list">
              {snapshot.jobs.slice(0, 8).map((job) => (
                <div className="job-row" key={job.id}>
                  <div>
                    <strong>{job.label}</strong>
                    <small>{formatRelative(job.updatedAt)}</small>
                  </div>
                  <div className="job-progress">
                    <StatusBadge status={job.status} />
                    <span>
                      {job.completed}/{job.total}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        ) : null}
      </section>
    </div>
  )
}
