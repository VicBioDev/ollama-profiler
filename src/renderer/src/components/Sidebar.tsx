import type { LucideIcon } from 'lucide-react'
import { APP_VERSION } from '@shared/generated-version'
import type { AppUpdateState } from '../hooks/useAppUpdater'
import { APP_COPY, NAV_ITEMS } from '../data/uiCopy'

export type PageId = (typeof NAV_ITEMS)[number]['id']

interface SidebarProps {
  readonly activePage: PageId
  readonly hasServers: boolean
  readonly localState: 'idle' | 'busy' | 'online'
  readonly onCheckForUpdates?: () => void
  readonly onInstallUpdate?: () => void
  readonly onNavigate: (page: PageId) => void
  readonly updateState?: AppUpdateState
}

export function Sidebar({
  activePage,
  hasServers,
  localState,
  onCheckForUpdates,
  onInstallUpdate,
  onNavigate,
  updateState
}: Readonly<SidebarProps>): React.JSX.Element {
  const Mark = APP_COPY.mark
  const visibleItems = hasServers
    ? NAV_ITEMS
    : NAV_ITEMS.filter(
        (item) => item.id !== 'servers' && item.id !== 'chat'
      )
  const updaterBusy =
    updateState?.phase === 'checking' ||
    updateState?.phase === 'downloading' ||
    updateState?.phase === 'installing' ||
    updateState?.phase === 'restarting'
  return (
    <aside className="sidebar" data-tauri-drag-region="deep">
      <div className="brand">
        <span className="brand-mark">
          <Mark size={19} />
        </span>
        <span>
          <strong>{APP_COPY.name}</strong>
        </span>
        <div className="brand-tooltip">
          <strong>Fleet signal, without the noise.</strong>
          Discover models, verify availability, and compare real generation speed.
        </div>
      </div>
      <nav className="sidebar-nav" aria-label="Primary navigation">
        {visibleItems.map((item) => {
          const Icon: LucideIcon = item.icon
          return (
            <button
              className={activePage === item.id ? 'nav-item active' : 'nav-item'}
              data-tauri-drag-region="false"
              key={item.id}
              onClick={() => onNavigate(item.id)}
              title={item.label}
              type="button"
            >
              <span className="nav-icon-wrap">
                <Icon size={16} />
                {item.id === 'local' && localState !== 'idle' ? (
                  <span className={`nav-status-dot ${localState}`} />
                ) : null}
              </span>
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
      <div
        className={`sidebar-version ${updateState?.phase ?? 'idle'}`}
        data-tauri-drag-region="false"
      >
        <div className="sidebar-version-row">
          <button
            aria-label={`Version ${APP_VERSION}. Check for updates`}
            className="sidebar-current-version"
            disabled={updaterBusy}
            onClick={onCheckForUpdates}
            type="button"
          >
            <span>v{APP_VERSION}</span>
            <span className="sidebar-version-tooltip" role="tooltip">
              Click to check for updates
            </span>
          </button>
          {updateState?.phase === 'available' && updateState.version ? (
            <button
              aria-label={`Install update v${updateState.version}`}
              className="sidebar-update-version"
              onClick={onInstallUpdate}
              title={`Click to install v${updateState.version}`}
              type="button"
            >
              → v{updateState.version}
            </button>
          ) : null}
        </div>
        {updateState &&
        updateState.phase !== 'idle' &&
        updateState.phase !== 'available' ? (
          <small>{updateState.label}</small>
        ) : null}
      </div>
    </aside>
  )
}
