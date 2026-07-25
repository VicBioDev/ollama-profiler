import {
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  ServerExportOptions,
  ServerExportResult,
  ServerRecord,
  ServerStatus
} from '@shared/types'
import { APP_COPY } from '../data/uiCopy'
import {
  bestServerSpeed,
  installedModels,
  serverModelSpeed
} from '../utils/format'
import { EmptyState } from '../components/EmptyState'
import { ServerTable } from '../components/ServerTable'

interface ServersPageProps {
  readonly servers: ServerRecord[]
  readonly busy: boolean
  readonly onNavigateToImport: () => void
  readonly onSelectServer: (serverId: string) => void
  readonly onDeleteServers: (serverIds: string[]) => Promise<void>
  readonly onExportServers: (
    options: ServerExportOptions
  ) => Promise<ServerExportResult | null>
}

export interface ModelSuggestion {
  readonly name: string
  readonly serverCount: number
}

export const SERVER_PAGE_SIZE = 50

export function ServersPage({
  servers,
  busy,
  onDeleteServers,
  onExportServers,
  onNavigateToImport,
  onSelectServer
}: Readonly<ServersPageProps>): React.JSX.Element {
  const [modelQuery, setModelQuery] = useState('')
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [status, setStatus] = useState<ServerStatus | 'all'>('all')
  const [region, setRegion] = useState('')
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [notice, setNotice] = useState<string>()

  const modelCatalog = useMemo(() => buildModelCatalog(servers), [servers])

  const regions = useMemo(
    () =>
      Array.from(
        new Set(
          servers
            .map((server) => server.country?.trim())
            .filter((value): value is string => Boolean(value))
        )
      ).sort((left, right) => left.localeCompare(right)),
    [servers]
  )

  const modelSuggestions = useMemo(() => {
    return suggestModels(modelCatalog, modelQuery)
  }, [modelCatalog, modelQuery])

  const selectedModelName = useMemo(
    () => resolveExactModelName(modelCatalog, modelQuery),
    [modelCatalog, modelQuery]
  )

  const filtered = useMemo(() => {
    return filterServers(
      servers,
      modelQuery,
      status,
      region,
      selectedModelName
    )
  }, [modelQuery, region, selectedModelName, servers, status])

  const pagination = useMemo(
    () => paginateServers(filtered, page),
    [filtered, page]
  )
  const filteredIdKey = filtered.map((server) => server.id).join('\0')

  useEffect(() => {
    if (page !== pagination.page) setPage(pagination.page)
  }, [page, pagination.page])

  useEffect(() => {
    const visibleIds = new Set(filtered.map((server) => server.id))
    setSelectedIds((current) => {
      const next = new Set(
        [...current].filter((serverId) => visibleIds.has(serverId))
      )
      return next.size === current.size ? current : next
    })
  }, [filteredIdKey])

  const toggleServer = (serverId: string, selected: boolean): void => {
    setNotice(undefined)
    setSelectedIds((current) => {
      const next = new Set(current)
      if (selected) next.add(serverId)
      else next.delete(serverId)
      return next
    })
  }

  const toggleAll = (selected: boolean): void => {
    setNotice(undefined)
    setSelectedIds(
      selected ? new Set(filtered.map((server) => server.id)) : new Set()
    )
  }

  const deleteSelected = async (): Promise<void> => {
    const serverIds = [...selectedIds]
    if (
      serverIds.length === 0 ||
      !window.confirm(
        `Delete ${serverIds.length} selected server${serverIds.length === 1 ? '' : 's'} and all local benchmark history? This cannot be undone.`
      )
    ) {
      return
    }
    await onDeleteServers(serverIds)
    setSelectedIds(new Set())
    setNotice(
      `Deleted ${serverIds.length} server${serverIds.length === 1 ? '' : 's'}.`
    )
  }

  const exportSelected = async (): Promise<void> => {
    const serverIds = [...selectedIds]
    if (serverIds.length === 0) return
    const result = await onExportServers({
      serverIds,
      modelName: selectedModelName
    })
    if (!result) return
    setNotice(
      `Exported ${result.count} server${result.count === 1 ? '' : 's'} to CSV.`
    )
  }

  return (
    <div className="page-content">
      <header className="section-title">
        <div>
          <span className="eyebrow">SERVER INVENTORY</span>
          <h1>Servers</h1>
          <p>Find servers by model name, status, and country-level region.</p>
        </div>
        <span className="large-count">{filtered.length}</span>
      </header>
      {notice ? (
        <div aria-live="polite" className="notice success">
          {notice}
        </div>
      ) : null}
      <section className="panel">
        <div className="filter-bar">
          <div className="search-control model-search-control">
            <Search size={15} />
            <input
              aria-autocomplete="list"
              aria-controls="model-search-suggestions"
              aria-expanded={suggestionsOpen}
              aria-label="Search discovered models"
              onBlur={() => setSuggestionsOpen(false)}
              onChange={(event) => {
                setModelQuery(event.target.value)
                setPage(1)
                setSuggestionsOpen(true)
              }}
              onFocus={() => setSuggestionsOpen(true)}
              placeholder="Search models — start typing for suggestions"
              role="combobox"
              value={modelQuery}
            />
            {suggestionsOpen ? (
              <div
                className="model-suggestions"
                id="model-search-suggestions"
                role="listbox"
              >
                {modelSuggestions.length > 0 ? (
                  modelSuggestions.map((suggestion) => (
                    <button
                      aria-selected={suggestion.name === modelQuery}
                      key={suggestion.name}
                      onClick={() => {
                        setModelQuery(suggestion.name)
                        setPage(1)
                        setSuggestionsOpen(false)
                      }}
                      onMouseDown={(event) => event.preventDefault()}
                      role="option"
                      type="button"
                    >
                      <span className="model-suggestion-name">
                        {suggestion.name}
                      </span>
                      <span className="model-suggestion-count">
                        {suggestion.serverCount}{' '}
                        {suggestion.serverCount === 1 ? 'server' : 'servers'}
                      </span>
                    </button>
                  ))
                ) : (
                  <span className="model-suggestions-empty">
                    No discovered model matches
                  </span>
                )}
              </div>
            ) : null}
          </div>
          <select
            aria-label="Server status"
            onChange={(event) => {
              setStatus(event.target.value as ServerStatus | 'all')
              setPage(1)
            }}
            value={status}
          >
            <option value="all">All states</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="unknown">Unchecked</option>
            <option value="checking">Checking</option>
          </select>
          <select
            aria-label="Region (country)"
            onChange={(event) => {
              setRegion(event.target.value)
              setPage(1)
            }}
            value={region}
          >
            <option value="">All regions</option>
            {regions.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </div>
        {selectedIds.size > 0 ? (
          <div className="bulk-toolbar">
            <div>
              <strong>{selectedIds.size} selected</strong>
              <span>
                {selectedModelName
                  ? `Export TPS for ${selectedModelName}`
                  : 'Export each server’s best TPS'}
              </span>
            </div>
            <div className="bulk-toolbar-actions">
              <button
                className="button ghost compact"
                disabled={busy}
                onClick={() => setSelectedIds(new Set())}
                type="button"
              >
                <X size={13} />
                Clear
              </button>
              <button
                className="button secondary compact"
                disabled={busy}
                onClick={() => void exportSelected().catch(() => undefined)}
                type="button"
              >
                <Download size={13} />
                Export CSV
              </button>
              <button
                className="button danger compact"
                disabled={busy}
                onClick={() => void deleteSelected().catch(() => undefined)}
                type="button"
              >
                <Trash2 size={13} />
                Delete
              </button>
            </div>
          </div>
        ) : null}
        {filtered.length > 0 ? (
          <ServerTable
            onSelect={onSelectServer}
            onSelectAll={toggleAll}
            onSelectionChange={toggleServer}
            selectedIds={selectedIds}
            selectedScopeCount={selectedIds.size}
            selectionScopeCount={filtered.length}
            servers={pagination.items}
            speedModelName={selectedModelName}
          />
        ) : (
          <EmptyState
            actionLabel={servers.length === 0 ? 'Import endpoints' : undefined}
            body={
              servers.length === 0
                ? APP_COPY.emptyServersBody
                : 'No servers match the current filters.'
            }
            onAction={servers.length === 0 ? onNavigateToImport : undefined}
            title={servers.length === 0 ? APP_COPY.emptyServersTitle : 'No matching servers'}
          />
        )}
        {pagination.totalPages > 1 ? (
          <nav aria-label="Server pagination" className="pagination">
            <span>
              {pagination.start + 1}–{pagination.end} of {filtered.length}
            </span>
            <div>
              <button
                aria-label="Previous server page"
                className="icon-button"
                disabled={pagination.page === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                type="button"
              >
                <ChevronLeft size={15} />
              </button>
              <strong>
                Page {pagination.page} of {pagination.totalPages}
              </strong>
              <button
                aria-label="Next server page"
                className="icon-button"
                disabled={pagination.page === pagination.totalPages}
                onClick={() =>
                  setPage((current) =>
                    Math.min(pagination.totalPages, current + 1)
                  )
                }
                type="button"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </nav>
        ) : null}
      </section>
    </div>
  )
}

export function buildModelCatalog(servers: ServerRecord[]): ModelSuggestion[] {
  const counts = new Map<string, number>()
  for (const server of servers) {
    const installedNames = new Set(
      installedModels(server).map((model) => model.name)
    )
    for (const name of installedNames) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return [...counts].map(([name, serverCount]) => ({ name, serverCount }))
}

export function suggestModels(
  models: ModelSuggestion[],
  query: string,
  limit = 8
): ModelSuggestion[] {
  const lowered = query.trim().toLowerCase()
  return models
    .filter((model) => !lowered || model.name.toLowerCase().includes(lowered))
    .sort((left, right) => {
      if (left.serverCount !== right.serverCount) {
        return right.serverCount - left.serverCount
      }
      const leftStarts = left.name.toLowerCase().startsWith(lowered)
      const rightStarts = right.name.toLowerCase().startsWith(lowered)
      return (
        Number(rightStarts) - Number(leftStarts) ||
        left.name.localeCompare(right.name)
      )
    })
    .slice(0, limit)
}

export function filterServers(
  servers: ServerRecord[],
  modelQuery: string,
  status: ServerStatus | 'all',
  region: string,
  speedModelName?: string
): ServerRecord[] {
  const loweredModel = modelQuery.trim().toLowerCase()
  return servers
    .filter((server) => {
      if (status !== 'all' && server.status !== status) return false
      if (region && server.country !== region) return false
      return (
        !loweredModel ||
        installedModels(server).some((candidate) =>
          candidate.name.toLowerCase().includes(loweredModel)
        )
      )
    })
    .sort((left, right) => {
      const availability =
        Number(right.status === 'online') - Number(left.status === 'online')
      if (availability !== 0) return availability
      const speed = (
        speedModelName ? serverModelSpeed(right, speedModelName) : bestServerSpeed(right)
      ) ?? -1
      const leftSpeed = (
        speedModelName ? serverModelSpeed(left, speedModelName) : bestServerSpeed(left)
      ) ?? -1
      const speedDifference = speed - leftSpeed
      if (speedDifference !== 0) return speedDifference
      return Date.parse(right.lastDiscoveredAt) - Date.parse(left.lastDiscoveredAt)
    })
}

export function resolveExactModelName(
  models: ModelSuggestion[],
  query: string
): string | undefined {
  const normalizedQuery = query.trim().toLowerCase()
  return models.find((model) => model.name.toLowerCase() === normalizedQuery)?.name
}

export interface ServerPagination {
  readonly items: ServerRecord[]
  readonly page: number
  readonly totalPages: number
  readonly start: number
  readonly end: number
}

export function paginateServers(
  servers: ServerRecord[],
  requestedPage: number,
  pageSize = SERVER_PAGE_SIZE
): ServerPagination {
  const safePageSize = Math.max(1, Math.floor(pageSize))
  const totalPages = Math.max(1, Math.ceil(servers.length / safePageSize))
  const page = Math.min(totalPages, Math.max(1, Math.floor(requestedPage)))
  const start = (page - 1) * safePageSize
  const end = Math.min(servers.length, start + safePageSize)
  return {
    items: servers.slice(start, end),
    page,
    totalPages,
    start,
    end
  }
}
