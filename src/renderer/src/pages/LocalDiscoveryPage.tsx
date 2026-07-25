import {
  ArrowRight,
  Network,
  Radar,
  Server,
  Settings
} from 'lucide-react'
import type { ProfilerSnapshot } from '@shared/types'
import { LOCAL_COPY } from '../data/uiCopy'
import { useLocalDiscovery } from '../hooks/useLocalDiscovery'
import { ServerTable } from '../components/ServerTable'
import { StatusBadge } from '../components/StatusBadge'

interface LocalDiscoveryPageProps {
  readonly snapshot: ProfilerSnapshot
  readonly onScanLocalNetwork: () => Promise<void>
  readonly onSelectServer: (serverId: string) => void
  readonly onShowSettings: () => void
  readonly onTestLocalhost: () => Promise<void>
}

export function LocalDiscoveryPage({
  snapshot,
  onScanLocalNetwork,
  onSelectServer,
  onShowSettings,
  onTestLocalhost
}: Readonly<LocalDiscoveryPageProps>): React.JSX.Element {
  const { servers, activeJob, latestJob } = useLocalDiscovery(snapshot)
  const privateNetworksEnabled = snapshot.settings.allowPrivateNetworks

  if (activeJob && servers.length === 0) {
    const isLan = activeJob.kind === 'lan-discovery'
    return (
      <div className="focused-state local-focused-state">
        <span className="focused-mark discovery-mark">
          <Radar size={24} />
        </span>
        <span className="eyebrow">{LOCAL_COPY.eyebrow}</span>
        <h1>
          {isLan ? LOCAL_COPY.lanScanningTitle : LOCAL_COPY.localhostScanningTitle}
        </h1>
        <p>{isLan ? LOCAL_COPY.lanScanningBody : LOCAL_COPY.localhostScanningBody}</p>
        <div className="discovery-progress" aria-label="Discovery progress">
          <span
            style={{
              width: `${activeJob.total === 0 ? 0 : (activeJob.completed / activeJob.total) * 100}%`
            }}
          />
        </div>
        <small>
          {activeJob.completed}/{activeJob.total} {LOCAL_COPY.progressLabel}
        </small>
      </div>
    )
  }

  if (servers.length === 0) {
    return (
      <div className="focused-state local-focused-state">
        <span className="focused-mark">
          <Server size={24} />
        </span>
        <span className="eyebrow">{LOCAL_COPY.eyebrow}</span>
        <h1>{LOCAL_COPY.title}</h1>
        <p>{LOCAL_COPY.body}</p>
        {latestJob?.summary || latestJob?.errorMessage ? (
          <div className={latestJob.status === 'failed' ? 'notice error' : 'notice'}>
            {latestJob.errorMessage ?? latestJob.summary}
          </div>
        ) : null}
        {privateNetworksEnabled ? (
          <div className="local-actions">
            <button
              className="button primary"
              onClick={() => void onTestLocalhost()}
              type="button"
            >
              {LOCAL_COPY.localhostAction}
              <ArrowRight size={15} />
            </button>
            <button
              className="button secondary"
              onClick={() => void onScanLocalNetwork()}
              type="button"
            >
              <Network size={15} />
              {LOCAL_COPY.lanAction}
            </button>
          </div>
        ) : (
          <button className="button secondary focused-action" onClick={onShowSettings} type="button">
            <Settings size={15} />
            {LOCAL_COPY.settingsAction}
          </button>
        )}
        <small>
          {privateNetworksEnabled ? LOCAL_COPY.safety : LOCAL_COPY.settingsRequired}
        </small>
      </div>
    )
  }

  return (
    <div className="page-content">
      <header className="section-title local-section-title">
        <div>
          <span className="eyebrow">{LOCAL_COPY.eyebrow}</span>
          <h1>{LOCAL_COPY.resultsTitle}</h1>
          <p>{LOCAL_COPY.resultsBody}</p>
        </div>
        <div className="local-actions">
          <button
            className="button secondary"
            disabled={Boolean(activeJob)}
            onClick={() => void onTestLocalhost()}
            type="button"
          >
            {LOCAL_COPY.retestAction}
          </button>
          <button
            className="button primary"
            disabled={Boolean(activeJob)}
            onClick={() => void onScanLocalNetwork()}
            type="button"
          >
            <Network size={15} />
            {LOCAL_COPY.rescanAction}
          </button>
        </div>
      </header>

      {latestJob ? (
        <div className="local-job-summary">
          <div>
            <strong>{latestJob.label}</strong>
            <small>{latestJob.errorMessage ?? latestJob.summary}</small>
          </div>
          <StatusBadge status={latestJob.status} />
        </div>
      ) : null}

      <section className="panel">
        <header className="panel-heading">
          <div>
            <span className="eyebrow">{LOCAL_COPY.discoveredEyebrow}</span>
            <h2>{LOCAL_COPY.endpointsTitle}</h2>
          </div>
          <span className="panel-count">
            {servers.length} {LOCAL_COPY.localCountLabel}
          </span>
        </header>
        <ServerTable onSelect={onSelectServer} servers={servers} />
      </section>
    </div>
  )
}
