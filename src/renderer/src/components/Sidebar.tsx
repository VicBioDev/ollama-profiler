import type { LucideIcon } from 'lucide-react'
import { APP_VERSION } from '@shared/generated-version'
import { APP_COPY, NAV_ITEMS } from '../data/uiCopy'

export type PageId = (typeof NAV_ITEMS)[number]['id']

interface SidebarProps {
  readonly activePage: PageId
  readonly hasServers: boolean
  readonly localState: 'idle' | 'busy' | 'online'
  readonly onNavigate: (page: PageId) => void
}

export function Sidebar({
  activePage,
  hasServers,
  localState,
  onNavigate
}: Readonly<SidebarProps>): React.JSX.Element {
  const Mark = APP_COPY.mark
  const visibleItems = hasServers
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => item.id !== 'servers')
  return (
    <aside className="sidebar">
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
              key={item.id}
              onClick={() => onNavigate(item.id)}
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
      <div aria-label={`Version ${APP_VERSION}`} className="sidebar-version">
        v{APP_VERSION}
      </div>
    </aside>
  )
}
