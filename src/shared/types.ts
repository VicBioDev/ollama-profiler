export type DiscoverySource =
  | 'manual'
  | 'localhost'
  | 'lan-scan'
  | 'fofa-file'
  | 'shodan-file'
export type ServerStatus = 'unknown' | 'checking' | 'online' | 'offline'
export type BenchmarkStatus = 'queued' | 'running' | 'success' | 'failed' | 'not-supported'
export type JobKind =
  | 'import'
  | 'local-discovery'
  | 'lan-discovery'
  | 'scan'
  | 'benchmark'
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface DiscoveryCandidate {
  endpoint: string
  source: DiscoverySource
  ip?: string
  country?: string
  region?: string
  city?: string
  asn?: string
  organization?: string
  sourceUpdatedAt?: string
}

export interface BenchmarkResult {
  id: string
  status: BenchmarkStatus
  startedAt: string
  finishedAt: string
  tokensPerSecond?: number
  ttftMs?: number
  clientTotalMs?: number
  evalCount?: number
  evalDurationNs?: number
  promptEvalCount?: number
  promptEvalDurationNs?: number
  loadDurationNs?: number
  totalDurationNs?: number
  doneReason?: string
  errorCode?: string
  errorMessage?: string
}

export interface ServerModel {
  id: string
  name: string
  digest?: string
  family?: string
  parameterSize?: string
  quantization?: string
  sizeBytes?: number
  capabilities: string[]
  installed: boolean
  firstSeenAt: string
  lastSeenAt: string
  benchmarks: BenchmarkResult[]
}

export interface ServerRecord extends DiscoveryCandidate {
  id: string
  discoverySources?: DiscoverySource[]
  status: ServerStatus
  ollamaVersion?: string
  failureCount: number
  benchmarkApproved: boolean
  firstDiscoveredAt: string
  lastDiscoveredAt: string
  lastCheckedAt?: string
  lastOnlineAt?: string
  lastErrorCode?: string
  lastErrorMessage?: string
  models: ServerModel[]
}

export interface ProfilerJob {
  id: string
  kind: JobKind
  status: JobStatus
  label: string
  completed: number
  total: number
  createdAt: string
  updatedAt: string
  targetServerIds?: string[]
  benchmarkStartedAt?: string
  summary?: string
  errorMessage?: string
}

export interface AppSettings {
  scanConcurrency: number
  benchmarkConcurrency: number
  connectTimeoutMs: number
  requestTimeoutMs: number
  benchmarkTimeoutMs: number
  maxResponseBytes: number
  benchmarkPrompt: string
  benchmarkNumPredict: number
  benchmarkMinTokens: number
  allowPrivateNetworks: boolean
}

export interface ProfilerSnapshot {
  servers: ServerRecord[]
  jobs: ProfilerJob[]
  settings: AppSettings
  updatedAt: string
}

export interface ImportIssue {
  row: number
  message: string
}

export interface ImportPreview {
  id: string
  filename: string
  provider: 'fofa' | 'shodan' | 'generic'
  totalRows: number
  validRows: number
  duplicateRows: number
  invalidRows: number
  candidates: DiscoveryCandidate[]
  issues: ImportIssue[]
}

export interface ImportCommitOptions {
  previewId: string
  benchmarkApproved: boolean
}

export interface ServerExportOptions {
  serverIds: string[]
  modelName?: string
}

export interface ServerExportResult {
  filePath: string
  count: number
}

export interface ServerFilter {
  query?: string
  model?: string
  status?: ServerStatus | 'all'
}

export type DesktopNavigationTarget =
  | 'overview'
  | 'servers'
  | 'imports'
  | 'settings'
  | 'local'

export interface DesktopApi {
  readonly platform: string
  getSnapshot: () => Promise<ProfilerSnapshot>
  subscribe: (listener: (snapshot: ProfilerSnapshot) => void) => () => void
  subscribeToNavigation: (
    listener: (target: DesktopNavigationTarget) => void
  ) => () => void
  selectImportFile: () => Promise<ImportPreview | null>
  previewText: (contents: string) => Promise<ImportPreview>
  commitImport: (options: ImportCommitOptions) => Promise<{ added: number; updated: number }>
  testLocalhost: () => Promise<string>
  scanLocalNetwork: () => Promise<string>
  profileAllServers: (resumeIncomplete?: boolean) => Promise<string>
  setBenchmarkApproval: (serverId: string, approved: boolean) => Promise<void>
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
  removeServer: (serverId: string) => Promise<void>
  removeServers: (serverIds: string[]) => Promise<void>
  exportServers: (
    options: ServerExportOptions
  ) => Promise<ServerExportResult | null>
}
