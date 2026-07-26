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
  readonly onNavigate: (page: PageId) => void
  readonly showSettings?: boolean
  readonly updateState?: AppUpdateState
}

export function Sidebar({
  activePage,
  hasServers,
  localState,
  onCheckForUpdates,
  onNavigate,
  showSettings = true,
  updateState
}: Readonly<SidebarProps>): React.JSX.Element {
  const Mark = APP_COPY.mark
  const availableItems = showSettings
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => item.id !== 'settings')
  const visibleItems = hasServers
    ? availableItems
    : availableItems.filter(
        (item) => item.id !== 'servers' && item.id !== 'chat'
      )
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
      <button
        aria-label={`Version ${APP_VERSION}. ${updateState?.label ?? 'Check for updates'}`}
        className={`sidebar-version ${updateState?.phase ?? 'idle'}`}
        data-tauri-drag-region="false"
        disabled={
          updateState?.phase === 'checking' ||
          updateState?.phase === 'downloading' ||
          updateState?.phase === 'installing' ||
          updateState?.phase === 'restarting'
        }
        onClick={onCheckForUpdates}
        title={updateState?.detail ?? 'Click to check for updates'}
        type="button"
      >
        <span>v{APP_VERSION}</span>
        {updateState && updateState.phase !== 'idle' ? (
          <small>{updateState.label}</small>
        ) : null}
      </button>
    </aside>
  )
}
