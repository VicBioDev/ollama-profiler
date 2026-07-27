import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
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
  readonly onRestartUpdate?: () => void
  readonly updateState?: AppUpdateState
}

export function Sidebar({
  activePage,
  hasServers,
  localState,
  onCheckForUpdates,
  onInstallUpdate,
  onNavigate,
  onRestartUpdate,
  updateState
}: Readonly<SidebarProps>): React.JSX.Element {
  const [showUpdateConfirmation, setShowUpdateConfirmation] = useState(false)
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
    updateState?.phase === 'ready-to-restart' ||
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
          <span
            aria-label={`Version ${APP_VERSION}. Current version`}
            className="sidebar-current-version"
          >
            v{APP_VERSION}
          </span>
          <button
            className="sidebar-check-update"
            disabled={updaterBusy}
            onClick={onCheckForUpdates}
            type="button"
          >
            {updateState?.phase === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
        {updateState?.phase === 'available' && updateState.version ? (
          <div className="sidebar-update-notice">
            <small>{updateState.label}</small>
            <button
              className="sidebar-update-action"
              onClick={() => setShowUpdateConfirmation(true)}
              type="button"
            >
              Update
            </button>
          </div>
        ) : updateState?.phase === 'ready-to-restart' && updateState.version ? (
          <div className="sidebar-update-notice ready">
            <small>v{updateState.version} is ready</small>
            <button
              className="sidebar-restart-action"
              onClick={onRestartUpdate}
              type="button"
            >
              Restart now
            </button>
          </div>
        ) : updateState && updateState.phase !== 'idle' ? (
          <small>{updateState.label}</small>
        ) : null}
      </div>
      {showUpdateConfirmation &&
      updateState?.phase === 'available' &&
      updateState.version ? (
        <div className="update-dialog-backdrop">
          <section
            aria-labelledby="update-dialog-title"
            aria-modal="true"
            className="update-dialog"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setShowUpdateConfirmation(false)
              }
            }}
            role="dialog"
          >
            <span className="update-dialog-eyebrow">Application update</span>
            <h2 id="update-dialog-title">Update to v{updateState.version}?</h2>
            <p>
              Review what is included. The update will only download and install
              after you confirm.
            </p>
            <div className="update-release-notes">
              <strong>What’s new</strong>
              <div>
                {updateState.notes ??
                  'No release notes were provided for this version.'}
              </div>
            </div>
            <div className="update-dialog-actions">
              <button
                autoFocus
                className="button secondary"
                onClick={() => setShowUpdateConfirmation(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setShowUpdateConfirmation(false)
                  onInstallUpdate?.()
                }}
                type="button"
              >
                Download &amp; install
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </aside>
  )
}
