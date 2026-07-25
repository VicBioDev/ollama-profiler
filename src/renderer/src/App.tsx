import { AlertCircle, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ServerRecord } from '@shared/types'
import { isBenchmarkableLocalModel } from '@shared/model-utils'
import { Sidebar, type PageId } from './components/Sidebar'
import { TopBar, type TopBarAction } from './components/TopBar'
import { useProfiler } from './hooks/useProfiler'
import { ImportPage } from './pages/ImportPage'
import { OverviewPage } from './pages/OverviewPage'
import { LocalDiscoveryPage } from './pages/LocalDiscoveryPage'
import { ServerDetailPage } from './pages/ServerDetailPage'
import { ServersPage } from './pages/ServersPage'
import { SettingsPage } from './pages/SettingsPage'
import { isLocalDiscoveryServer } from './hooks/useLocalDiscovery'

interface AppProps {}

export default function App(_props: Readonly<AppProps>): React.JSX.Element {
  const { snapshot, busy, error, actions } = useProfiler()
  const [page, setPage] = useState<PageId>('overview')
  const [selectedServerId, setSelectedServerId] = useState<string>()
  const selectedServer = useMemo(
    () => snapshot?.servers.find((server) => server.id === selectedServerId),
    [selectedServerId, snapshot?.servers]
  )
  const localBusy = snapshot?.jobs.some(
    (job) =>
      (job.kind === 'local-discovery' || job.kind === 'lan-discovery') &&
      (job.status === 'queued' || job.status === 'running')
  )
  const localOnline = snapshot?.servers.some(
    (server) => isLocalDiscoveryServer(server) && server.status === 'online'
  )

  const navigate = (target: PageId): void => {
    setPage(target)
    setSelectedServerId(undefined)
  }

  if (!snapshot) {
    return (
      <main className="boot-screen">
        <span className="loader" />
        <strong>Opening local profiler…</strong>
      </main>
    )
  }

  const scanAction: TopBarAction | undefined =
    snapshot.servers.length === 0
      ? undefined
      : {
          label: selectedServer ? 'Scan server' : 'Scan all',
          onClick: () =>
            void actions.scanServers(selectedServer ? [selectedServer.id] : undefined)
        }
  const benchmarkAction = createBenchmarkAction(
    page,
    selectedServer,
    snapshot.servers,
    (serverIds) => void actions.benchmarkServers(serverIds)
  )

  return (
    <div className="app-shell">
      <Sidebar
        activePage={page}
        hasServers={snapshot.servers.length > 0}
        localState={localBusy ? 'busy' : localOnline ? 'online' : 'idle'}
        onNavigate={navigate}
      />
      <div className="main-shell">
        <TopBar
          benchmarkAction={benchmarkAction}
          busy={busy}
          jobs={snapshot.jobs}
          scanAction={scanAction}
        />
        {error ? (
          <div className="global-error">
            <AlertCircle size={16} />
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={actions.clearError} type="button">
              <X size={15} />
            </button>
          </div>
        ) : null}
        <main>
          {selectedServer ? (
            <ServerDetailPage
              onApprovalChange={(approved) =>
                void actions.setBenchmarkApproval(selectedServer.id, approved)
              }
              onBack={() => setSelectedServerId(undefined)}
              onRemove={() => {
                if (
                  !window.confirm(
                    `Remove ${selectedServer.endpoint} and its local benchmark history?`
                  )
                ) {
                  return
                }
                void actions.removeServer(selectedServer.id)
                setSelectedServerId(undefined)
              }}
              server={selectedServer}
            />
          ) : page === 'overview' ? (
            <OverviewPage
              onNavigateToImport={() => navigate('imports')}
              onSelectServer={setSelectedServerId}
              snapshot={snapshot}
            />
          ) : page === 'servers' ? (
            <ServersPage
              busy={busy}
              onDeleteServers={actions.removeServers}
              onExportServers={actions.exportServers}
              onNavigateToImport={() => navigate('imports')}
              onSelectServer={setSelectedServerId}
              servers={snapshot.servers}
            />
          ) : page === 'imports' ? (
            <ImportPage
              busy={busy}
              onCommit={(previewId, approved) =>
                actions.commitImport({ previewId, benchmarkApproved: approved })
              }
              onSelectFile={actions.selectImportFile}
              onPreviewText={actions.previewText}
            />
          ) : page === 'local' ? (
            <LocalDiscoveryPage
              onScanLocalNetwork={actions.scanLocalNetwork}
              onSelectServer={setSelectedServerId}
              onShowSettings={() => navigate('settings')}
              onTestLocalhost={actions.testLocalhost}
              snapshot={snapshot}
            />
          ) : (
            <SettingsPage
              busy={busy}
              onSaveSettings={actions.updateSettings}
              settings={snapshot.settings}
            />
          )}
        </main>
      </div>
    </div>
  )
}

function createBenchmarkAction(
  page: PageId,
  selectedServer: ServerRecord | undefined,
  servers: ServerRecord[],
  onBenchmark: (serverIds: string[]) => void
): TopBarAction | undefined {
  if (selectedServer) {
    const hasHistory = selectedServer.models.some((model) => model.benchmarks.length > 0)
    const disabledReason = benchmarkDisabledReason(selectedServer)
    return {
      label: hasHistory ? 'Re-run benchmark' : 'Run benchmark',
      onClick: () => onBenchmark([selectedServer.id]),
      disabled: Boolean(disabledReason),
      disabledReason
    }
  }
  if (page !== 'servers') return undefined

  const eligible = servers.filter((server) => !benchmarkDisabledReason(server))
  return {
    label: `Run benchmarks (${eligible.length})`,
    onClick: () => onBenchmark(eligible.map((server) => server.id)),
    disabled: eligible.length === 0,
    disabledReason:
      eligible.length === 0
        ? 'Approve benchmarking on an online server with a generation-capable model first.'
        : undefined
  }
}

function benchmarkDisabledReason(server: ServerRecord): string | undefined {
  if (!server.benchmarkApproved) return 'Enable benchmark permission for this server first.'
  if (server.status !== 'online') return 'The server must be online before benchmarking.'
  if (!server.models.some(isBenchmarkableLocalModel)) {
    return 'Scan the server first to find a generation-capable model.'
  }
  return undefined
}
