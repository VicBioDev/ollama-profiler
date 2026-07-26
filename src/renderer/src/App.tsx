import { AlertCircle, X } from 'lucide-react'
import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog'
import { useEffect, useMemo, useState } from 'react'
import { Sidebar, type PageId } from './components/Sidebar'
import { TopBar, type TopBarAction } from './components/TopBar'
import { useProfiler } from './hooks/useProfiler'
import { useAppUpdater } from './hooks/useAppUpdater'
import { ImportPage } from './pages/ImportPage'
import { OverviewPage } from './pages/OverviewPage'
import { LocalDiscoveryPage } from './pages/LocalDiscoveryPage'
import { ServerDetailPage } from './pages/ServerDetailPage'
import { ServersPage } from './pages/ServersPage'
import { SettingsPage } from './pages/SettingsPage'
import {
  ChatPage,
  createChatSessionState
} from './pages/ChatPage'
import { isLocalDiscoveryServer } from './hooks/useLocalDiscovery'
import { useBenchmarkContinuationOnLaunch } from './hooks/useBenchmarkContinuationOnLaunch'
import { confirmBenchmarkContinuation } from '@shared/job-utils'

interface AppProps {}

export default function App(_props: Readonly<AppProps>): React.JSX.Element {
  const { snapshot, busy, error, actions } = useProfiler()
  const updater = useAppUpdater()
  const [page, setPage] = useState<PageId>('overview')
  const [selectedServerId, setSelectedServerId] = useState<string>()
  const [chatSessionState, setChatSessionState] = useState(
    createChatSessionState
  )
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

  useEffect(
    () => window.ollamaProfiler.subscribeToNavigation((target) => navigate(target)),
    []
  )
  useBenchmarkContinuationOnLaunch(
    snapshot,
    confirmDialog,
    actions.profileAllServers
  )

  if (!snapshot) {
    return (
      <main className="boot-screen">
        <span className="loader" />
        <strong>Opening local profiler…</strong>
      </main>
    )
  }

  const profileAction: TopBarAction | undefined =
    snapshot.servers.length === 0
      ? undefined
      : {
          label: 'Scan & benchmark all',
          onClick: () => {
            void confirmBenchmarkContinuation(snapshot.jobs, confirmDialog).then((resume) =>
              actions.profileAllServers(resume)
            )
          }
        }

  return (
    <div className="app-shell">
      <Sidebar
        activePage={page}
        hasServers={snapshot.servers.length > 0}
        localState={localBusy ? 'busy' : localOnline ? 'online' : 'idle'}
        onNavigate={navigate}
        onCheckForUpdates={() => void updater.checkForUpdates()}
        onInstallUpdate={() => void updater.installUpdate()}
        updateState={updater.state}
      />
      <div className="main-shell">
        <TopBar
          busy={busy}
          jobs={snapshot.jobs}
          profileAction={profileAction}
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
          ) : page === 'chat' ? (
            <ChatPage
              onChat={actions.chatModels}
              onSessionStateChange={setChatSessionState}
              onShowServers={() => navigate('servers')}
              servers={snapshot.servers}
              sessionState={chatSessionState}
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
