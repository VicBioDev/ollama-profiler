import { ChevronRight, MapPin } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ServerRecord } from '@shared/types'
import {
  bestServerSpeed,
  formatRelative,
  formatSpeed,
  installedModels,
  serverModelSpeed
} from '../utils/format'
import { CopyServerAddressButton } from './CopyServerAddressButton'
import { StatusBadge } from './StatusBadge'

interface ServerTableProps {
  readonly servers: ServerRecord[]
  readonly onSelect: (serverId: string) => void
  readonly speedModelName?: string
  readonly selectedIds?: ReadonlySet<string>
  readonly onSelectionChange?: (serverId: string, selected: boolean) => void
  readonly onSelectAll?: (selected: boolean) => void
  readonly selectionScopeCount?: number
  readonly selectedScopeCount?: number
}

export function ServerTable({
  servers,
  onSelect,
  speedModelName,
  selectedIds,
  onSelectionChange,
  onSelectAll,
  selectionScopeCount,
  selectedScopeCount
}: Readonly<ServerTableProps>): React.JSX.Element {
  const selectAllRef = useRef<HTMLInputElement>(null)
  const selectionEnabled = Boolean(
    selectedIds && onSelectionChange && onSelectAll
  )
  const selectedPageCount = selectionEnabled
    ? servers.filter((server) => selectedIds?.has(server.id)).length
    : 0
  const selectionTotal = selectionScopeCount ?? servers.length
  const selectedTotal = selectedScopeCount ?? selectedPageCount
  const allSelected = selectionTotal > 0 && selectedTotal === selectionTotal
  const partiallySelected = selectedTotal > 0 && !allSelected

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = partiallySelected
    }
  }, [partiallySelected])

  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            {selectionEnabled ? (
              <th className="selection-cell">
                <input
                  aria-label={`Select all ${selectionTotal} filtered servers`}
                  checked={allSelected}
                  onChange={(event) => onSelectAll?.(event.target.checked)}
                  ref={selectAllRef}
                  type="checkbox"
                />
              </th>
            ) : null}
            <th>Endpoint</th>
            <th>Status</th>
            <th>Models</th>
            <th>
              <span className="speed-column-title">
                Best speed
                {speedModelName ? (
                  <small title={speedModelName}>({speedModelName})</small>
                ) : null}
              </span>
            </th>
            <th>Last online</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {servers.map((server) => {
            const selected = selectedIds?.has(server.id) ?? false
            const models = installedModels(server)
            const modelTooltipId = `server-models-${server.id}`
            return (
              <tr
                className={selected ? 'selected-row' : undefined}
                key={server.id}
                onDoubleClick={() => onSelect(server.id)}
              >
                {selectionEnabled ? (
                  <td className="selection-cell">
                    <input
                      aria-label={`Select ${server.endpoint}`}
                      checked={selected}
                      onChange={(event) =>
                        onSelectionChange?.(server.id, event.target.checked)
                      }
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      type="checkbox"
                    />
                  </td>
                ) : null}
                <td>
                  <div className="endpoint-cell">
                    <button
                      className="endpoint-button"
                      onClick={() => onSelect(server.id)}
                      type="button"
                    >
                      <code>{server.endpoint}</code>
                      <small>
                        <MapPin size={11} />
                        {[server.city, server.country].filter(Boolean).join(', ') || server.source}
                      </small>
                    </button>
                    <CopyServerAddressButton endpoint={server.endpoint} />
                  </div>
                </td>
                <td>
                  <StatusBadge status={server.status} />
                </td>
                <td>
                  <span
                    aria-describedby={modelTooltipId}
                    aria-label={`${models.length} installed model${models.length === 1 ? '' : 's'}`}
                    className="model-count"
                    tabIndex={0}
                  >
                    {models.length}
                    <span
                      className="model-count-tooltip"
                      id={modelTooltipId}
                      role="tooltip"
                    >
                      <strong>Installed models</strong>
                      {models.length > 0 ? (
                        <span className="model-count-list">
                          {models.map((model) => (
                            <code key={model.id}>{model.name}</code>
                          ))}
                        </span>
                      ) : (
                        <small>No installed models</small>
                      )}
                    </span>
                  </span>
                </td>
                <td className="mono">
                  {formatSpeed(
                    speedModelName
                      ? serverModelSpeed(server, speedModelName)
                      : bestServerSpeed(server)
                  )}
                </td>
                <td>{formatRelative(server.lastOnlineAt)}</td>
                <td>
                  <button
                    aria-label={`Open ${server.endpoint}`}
                    className="icon-button"
                    onClick={() => onSelect(server.id)}
                    type="button"
                  >
                    <ChevronRight size={16} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
