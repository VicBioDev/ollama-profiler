import { EventEmitter } from 'node:events'
import { readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type {
  AppSettings,
  BenchmarkResult,
  DiscoveryCandidate,
  ImportCommitOptions,
  ImportPreview,
  ProfilerJob,
  ProfilerSnapshot,
  ServerModel,
  ServerRecord
} from '@shared/types.js'
import { isBenchmarkableLocalModel } from '@shared/model-utils.js'
import { ProfilerStore } from './store.js'
import { parseDiscoveryBuffer } from './importers.js'
import { OllamaClient, OllamaClientError } from './ollama-client.js'
import { KeyedSerialExecutor, runWithConcurrency } from './concurrency.js'
import {
  createLanScanPlan,
  discoverLanOllama,
  discoverLocalhostOllama,
  type DiscoveredOllamaEndpoint,
  type LanScanPlan
} from './lan-discovery.js'

const FAILURE_BACKOFF_MS = [
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  72 * 60 * 60 * 1000
]
const SUCCESS_RETRY_MS = 24 * 60 * 60 * 1000
const SERVER_BENCHMARK_GAP_MS = 30 * 60 * 1000

export class ProfilerEngine extends EventEmitter {
  private readonly importSessions = new Map<string, ImportPreview>()
  private readonly serverExecutor = new KeyedSerialExecutor()
  private readonly activeJobIds = new Map<ProfilerJob['kind'], string>()
  private readonly backgroundTasks = new Set<Promise<void>>()
  private monitoringTimer?: NodeJS.Timeout
  private lastScheduledScanAt = 0
  private shuttingDown = false

  constructor(private readonly store: ProfilerStore) {
    super()
  }

  async initialize(): Promise<void> {
    await this.store.load()
    this.startMonitoring()
  }

  getSnapshot(): ProfilerSnapshot {
    return this.store.get()
  }

  async previewFile(filePath: string): Promise<ImportPreview> {
    const file = await stat(filePath)
    if (file.size > 50 * 1024 * 1024) {
      throw new Error('Import files are limited to 50 MiB')
    }
    const preview = parseDiscoveryBuffer(await readFile(filePath), filePath)
    this.importSessions.set(preview.id, preview)
    return previewForRenderer(preview)
  }

  previewText(contents: string): ImportPreview {
    if (Buffer.byteLength(contents, 'utf8') > 1024 * 1024) {
      throw new Error('Pasted endpoint lists are limited to 1 MiB')
    }
    const preview = parseDiscoveryBuffer(
      Buffer.from(contents, 'utf8'),
      'pasted-endpoints.txt'
    )
    this.importSessions.set(preview.id, preview)
    return previewForRenderer(preview)
  }

  async commitImport(
    options: ImportCommitOptions
  ): Promise<{ added: number; updated: number }> {
    const preview = this.importSessions.get(options.previewId)
    if (!preview) throw new Error('The import preview expired; select the file again')
    const now = new Date().toISOString()
    const touchedIds: string[] = []
    let added = 0
    let updated = 0

    await this.store.mutate((snapshot) => {
      for (const candidate of preview.candidates) {
        const existing = snapshot.servers.find(
          (server) => server.endpoint === candidate.endpoint
        )
        if (existing) {
          const discoverySources = mergeDiscoverySources(existing, candidate.source)
          Object.assign(existing, candidate, {
            benchmarkApproved: existing.benchmarkApproved || options.benchmarkApproved,
            discoverySources,
            lastDiscoveredAt: now
          })
          touchedIds.push(existing.id)
          updated += 1
        } else {
          const server = candidateToServer(candidate, options.benchmarkApproved, now)
          snapshot.servers.push(server)
          touchedIds.push(server.id)
          added += 1
        }
      }
    })
    this.importSessions.delete(options.previewId)
    this.broadcast()
    this.queueScan(touchedIds, options.benchmarkApproved)
    return { added, updated }
  }

  testLocalhost(): string {
    this.requirePrivateNetworkAccess()
    const active = this.findActiveJobId('local-discovery')
    if (active) return active
    const job = this.createJob('local-discovery', 'Test localhost Ollama', 2)
    this.trackTask(this.runLocalhostDiscoveryJob(job.id))
    return job.id
  }

  scanLocalNetwork(): string {
    this.requirePrivateNetworkAccess()
    const active = this.findActiveJobId('lan-discovery')
    if (active) return active
    const plan = createLanScanPlan()
    const job = this.createJob(
      'lan-discovery',
      'Scan local network for Ollama',
      plan.targets.length
    )
    this.trackTask(this.runLanDiscoveryJob(job.id, plan))
    return job.id
  }

  scanServers(serverIds?: string[]): string {
    return this.queueScan(serverIds, false)
  }

  benchmarkServers(serverIds?: string[]): string {
    const active = this.findActiveJobId('benchmark')
    if (active) return active
    const snapshot = this.store.get()
    const ids =
      serverIds?.filter((id) => snapshot.servers.some((server) => server.id === id)) ??
      snapshot.servers
        .filter((server) => isServerReadyForBenchmark(server))
        .map((server) => server.id)
    const eligibleIds = ids.filter((id) => {
      const server = snapshot.servers.find((candidate) => candidate.id === id)
      return server ? isServerReadyForBenchmark(server) : false
    })
    if (eligibleIds.length === 0) {
      throw new Error(
        'No online, approved servers with generation-capable models are ready to benchmark'
      )
    }
    const label =
      eligibleIds.length === 1
        ? 'Re-run server benchmark'
        : `Re-run benchmarks for ${eligibleIds.length} servers`
    return this.queueBenchmark(eligibleIds, true, label)
  }

  async setBenchmarkApproval(serverId: string, approved: boolean): Promise<void> {
    await this.store.mutate((snapshot) => {
      const server = requireServer(snapshot, serverId)
      server.benchmarkApproved = approved
    })
    this.broadcast()
  }

  async updateSettings(changes: Partial<AppSettings>): Promise<AppSettings> {
    let settings: AppSettings | undefined
    await this.store.mutate((snapshot) => {
      snapshot.settings = validateSettings({ ...snapshot.settings, ...changes })
      settings = snapshot.settings
    })
    this.broadcast()
    return { ...(settings as AppSettings) }
  }

  async removeServer(serverId: string): Promise<void> {
    await this.removeServers([serverId])
  }

  async removeServers(serverIds: string[]): Promise<void> {
    const selectedIds = new Set(serverIds)
    if (selectedIds.size === 0) return
    await this.store.mutate((snapshot) => {
      snapshot.servers = snapshot.servers.filter(
        (server) => !selectedIds.has(server.id)
      )
    })
    this.broadcast()
  }

  dispose(): void {
    if (this.monitoringTimer) clearInterval(this.monitoringTimer)
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true
    this.dispose()
    await this.store.mutate((snapshot) => {
      const now = new Date().toISOString()
      for (const job of snapshot.jobs) {
        if (job.status !== 'queued' && job.status !== 'running') continue
        job.status = 'cancelled'
        job.updatedAt = now
        job.summary = 'Cancelled because the application closed.'
        delete job.errorMessage
      }
    })
    this.activeJobIds.clear()
    this.broadcast()
    const tasks = [...this.backgroundTasks]
    if (tasks.length > 0) {
      await Promise.race([
        Promise.allSettled(tasks),
        new Promise<void>((resolve) => setTimeout(resolve, 250))
      ])
    }
  }

  private async runLocalhostDiscoveryJob(jobId: string): Promise<void> {
    await this.setJobRunning(jobId)
    try {
      const discovered = await discoverLocalhostOllama(
        this.store.get().settings,
        (completed) => this.setJobProgress(jobId, completed)
      )
      const persisted = await this.persistDiscoveredServers(discovered, 'localhost')
      const summary =
        discovered.length === 0
          ? 'No Ollama server found on localhost:11434.'
          : `Found Ollama ${discovered[0]?.version ?? ''} on this device.`
      await this.finishJob(jobId, 'completed', undefined, summary)
      if (persisted.serverIds.length > 0) this.scanServers(persisted.serverIds)
    } catch (error) {
      await this.finishJob(jobId, 'failed', messageOf(error))
    }
  }

  private async runLanDiscoveryJob(jobId: string, plan: LanScanPlan): Promise<void> {
    await this.setJobRunning(jobId)
    if (plan.targets.length === 0) {
      await this.finishJob(
        jobId,
        'failed',
        'No active RFC1918 IPv4 network interface was found'
      )
      return
    }

    let lastReported = 0
    let progressChain = Promise.resolve()
    try {
      const discovered = await discoverLanOllama(
        plan,
        this.store.get().settings,
        (completed, total) => {
          if (completed !== total && completed - lastReported < 16) return
          lastReported = completed
          progressChain = progressChain.then(() => this.setJobProgress(jobId, completed))
          return progressChain
        }
      )
      await progressChain

      const knownLocalhost = this.store
        .get()
        .servers.some((server) =>
          (server.discoverySources ?? [server.source]).includes('localhost')
        )
      const filtered = knownLocalhost
        ? discovered.filter((candidate) => !plan.selfAddresses.includes(candidate.ip))
        : discovered
      const persisted = await this.persistDiscoveredServers(filtered, 'lan-scan')
      const summary =
        filtered.length === 0
          ? `No Ollama servers found across ${plan.targets.length} local addresses.`
          : `Found ${filtered.length} Ollama server${filtered.length === 1 ? '' : 's'} across ${plan.networks.length} local network${plan.networks.length === 1 ? '' : 's'}.`
      await this.finishJob(jobId, 'completed', undefined, summary)
      if (persisted.serverIds.length > 0) this.scanServers(persisted.serverIds)
    } catch (error) {
      await this.finishJob(jobId, 'failed', messageOf(error))
    }
  }

  private async persistDiscoveredServers(
    discovered: DiscoveredOllamaEndpoint[],
    source: 'localhost' | 'lan-scan'
  ): Promise<{ added: number; updated: number; serverIds: string[] }> {
    const now = new Date().toISOString()
    const serverIds: string[] = []
    let added = 0
    let updated = 0

    await this.store.mutate((snapshot) => {
      for (const candidate of discovered) {
        const existing =
          source === 'localhost'
            ? snapshot.servers.find((server) => isLoopbackEndpoint(server.endpoint))
            : snapshot.servers.find((server) => server.endpoint === candidate.endpoint)
        if (existing) {
          existing.discoverySources = mergeDiscoverySources(existing, source)
          existing.ip = candidate.ip
          existing.status = 'online'
          existing.ollamaVersion = candidate.version
          existing.failureCount = 0
          existing.lastDiscoveredAt = now
          existing.lastCheckedAt = now
          existing.lastOnlineAt = now
          existing.city ??= source === 'localhost' ? 'This device' : 'Local network'
          delete existing.lastErrorCode
          delete existing.lastErrorMessage
          serverIds.push(existing.id)
          updated += 1
          continue
        }

        const server = candidateToServer(
          {
            endpoint: candidate.endpoint,
            source,
            ip: candidate.ip,
            city: source === 'localhost' ? 'This device' : 'Local network',
            sourceUpdatedAt: now
          },
          false,
          now
        )
        server.status = 'online'
        server.ollamaVersion = candidate.version
        server.lastCheckedAt = now
        server.lastOnlineAt = now
        snapshot.servers.push(server)
        serverIds.push(server.id)
        added += 1
      }
    })
    this.broadcast()
    return { added, updated, serverIds }
  }

  private requirePrivateNetworkAccess(): void {
    if (!this.store.get().settings.allowPrivateNetworks) {
      throw new Error('Enable LAN and localhost servers in Settings first')
    }
  }

  private findActiveJobId(kind: ProfilerJob['kind']): string | undefined {
    const inMemory = this.activeJobIds.get(kind)
    if (inMemory) return inMemory
    return this.store
      .get()
      .jobs.find(
        (job) =>
          job.kind === kind && (job.status === 'queued' || job.status === 'running')
      )?.id
  }

  private queueScan(serverIds?: string[], benchmarkAfterScan = false): string {
    const active = this.findActiveJobId('scan')
    if (active) return active
    const snapshot = this.store.get()
    const ids =
      serverIds?.filter((id) => snapshot.servers.some((server) => server.id === id)) ??
      snapshot.servers.map((server) => server.id)
    const label =
      ids.length === 1 ? 'Scan server inventory' : `Scan ${ids.length} server inventories`
    const job = this.createJob('scan', label, ids.length)
    this.trackTask(this.runScanJob(job.id, ids, benchmarkAfterScan))
    return job.id
  }

  private async runScanJob(
    jobId: string,
    serverIds: string[],
    benchmarkAfterScan: boolean
  ): Promise<void> {
    await this.setJobRunning(jobId)
    const settings = this.store.get().settings
    const readyForBenchmark: string[] = []
    try {
      await runWithConcurrency(serverIds, settings.scanConcurrency, async (serverId) => {
        if (this.shuttingDown) return
        const succeeded = await this.serverExecutor.run(serverId, () =>
          this.scanOneServer(serverId)
        )
        if (succeeded) {
          const current = this.store
            .get()
            .servers.find((server) => server.id === serverId)
          if (
            benchmarkAfterScan &&
            current &&
            isServerReadyForBenchmark(current)
          ) {
            readyForBenchmark.push(serverId)
          }
        }
        await this.incrementJob(jobId)
      })
      await this.finishJob(jobId, 'completed')
      if (!this.shuttingDown && readyForBenchmark.length > 0) {
        this.queueBenchmark(
          readyForBenchmark,
          false,
          'Benchmark approved local models'
        )
      }
    } catch (error) {
      await this.finishJob(jobId, 'failed', messageOf(error))
    }
  }

  private async scanOneServer(serverId: string): Promise<boolean> {
    const before = this.store.get()
    const server = before.servers.find((candidate) => candidate.id === serverId)
    if (!server) return false
    await this.store.mutate((snapshot) => {
      const current = requireServer(snapshot, serverId)
      current.status = 'checking'
      current.lastCheckedAt = new Date().toISOString()
    })
    this.broadcast()

    try {
      const inventory = await new OllamaClient(server.endpoint, before.settings).inventory()
      const now = new Date().toISOString()
      await this.store.mutate((snapshot) => {
        const current = requireServer(snapshot, serverId)
        current.status = 'online'
        current.ollamaVersion = inventory.version
        current.failureCount = 0
        current.lastOnlineAt = now
        current.lastCheckedAt = now
        delete current.lastErrorCode
        delete current.lastErrorMessage

        const returnedNames = new Set(inventory.models.map((model) => model.name))
        for (const model of current.models) {
          model.installed = returnedNames.has(model.name)
        }
        for (const discovered of inventory.models) {
          const existing = current.models.find((model) => model.name === discovered.name)
          if (existing) {
            Object.assign(existing, discovered, {
              installed: true,
              lastSeenAt: now
            })
          } else {
            current.models.push({
              id: randomUUID(),
              ...discovered,
              installed: true,
              firstSeenAt: now,
              lastSeenAt: now,
              benchmarks: []
            })
          }
        }
      })
      this.broadcast()
      return true
    } catch (error) {
      const normalized = normalizeError(error)
      await this.store.mutate((snapshot) => {
        const current = requireServer(snapshot, serverId)
        current.failureCount += 1
        current.status = current.failureCount >= 3 ? 'offline' : 'unknown'
        current.lastCheckedAt = new Date().toISOString()
        current.lastErrorCode = normalized.code
        current.lastErrorMessage = normalized.message
      })
      this.broadcast()
      return false
    }
  }

  private async runBenchmarkJob(
    jobId: string,
    serverIds: string[],
    force: boolean
  ): Promise<void> {
    await this.setJobRunning(jobId)
    const settings = this.store.get().settings
    try {
      await runWithConcurrency(
        serverIds,
        settings.benchmarkConcurrency,
        async (serverId) => {
          if (this.shuttingDown) return
          await this.serverExecutor.run(serverId, () =>
            this.benchmarkOneServer(serverId, force)
          )
          await this.incrementJob(jobId)
        }
      )
      await this.finishJob(jobId, 'completed')
    } catch (error) {
      await this.finishJob(jobId, 'failed', messageOf(error))
    }
  }

  private async benchmarkOneServer(serverId: string, force: boolean): Promise<void> {
    const snapshot = this.store.get()
    const server = snapshot.servers.find((candidate) => candidate.id === serverId)
    if (!server || !server.benchmarkApproved || server.status !== 'online') return
    const client = new OllamaClient(server.endpoint, snapshot.settings)
    const models = server.models.filter(
      (model) =>
        isBenchmarkableLocalModel(model) &&
        (force || isBenchmarkDue(model, server))
    )

    for (const model of models) {
      if (this.shuttingDown) return
      const current = this.store
        .get()
        .servers.find((candidate) => candidate.id === serverId)
        ?.models.find((candidate) => candidate.id === model.id)
      if (!current) continue

      const startedAt = new Date().toISOString()
      try {
        const result = await client.benchmark(model.name)
        await this.appendBenchmark(serverId, model.id, result)
      } catch (error) {
        const normalized = normalizeError(error)
        const failed: BenchmarkResult = {
          id: randomUUID(),
          status: 'failed',
          startedAt,
          finishedAt: new Date().toISOString(),
          errorCode: normalized.code,
          errorMessage: normalized.message
        }
        await this.appendBenchmark(serverId, model.id, failed)
      }
      this.broadcast()
    }
  }

  private async appendBenchmark(
    serverId: string,
    modelId: string,
    result: BenchmarkResult
  ): Promise<void> {
    await this.store.mutate((snapshot) => {
      const server = requireServer(snapshot, serverId)
      const model = server.models.find((candidate) => candidate.id === modelId)
      if (!model) throw new Error('Model not found')
      model.benchmarks.unshift(result)
      const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
      model.benchmarks = model.benchmarks
        .filter((candidate) => Date.parse(candidate.finishedAt) >= cutoff)
        .slice(0, 500)
    })
  }

  private createJob(
    kind: ProfilerJob['kind'],
    label: string,
    total: number
  ): ProfilerJob {
    const now = new Date().toISOString()
    const job: ProfilerJob = {
      id: randomUUID(),
      kind,
      status: 'queued',
      label,
      completed: 0,
      total,
      createdAt: now,
      updatedAt: now
    }
    this.activeJobIds.set(kind, job.id)
    void this.store
      .mutate((snapshot) => {
        snapshot.jobs.unshift(job)
        snapshot.jobs = snapshot.jobs.slice(0, 50)
      })
      .then(() => this.broadcast())
    return job
  }

  private async setJobRunning(jobId: string): Promise<void> {
    await this.store.mutate((snapshot) => {
      const job = snapshot.jobs.find((candidate) => candidate.id === jobId)
      if (!job || job.status === 'cancelled') return
      job.status = 'running'
      job.updatedAt = new Date().toISOString()
    })
    this.broadcast()
  }

  private async incrementJob(jobId: string): Promise<void> {
    await this.store.mutate((snapshot) => {
      const job = snapshot.jobs.find((candidate) => candidate.id === jobId)
      if (!job || (job.status !== 'queued' && job.status !== 'running')) return
      job.completed = Math.min(job.total, job.completed + 1)
      job.updatedAt = new Date().toISOString()
    })
    this.broadcast()
  }

  private async setJobProgress(jobId: string, completed: number): Promise<void> {
    await this.store.mutate((snapshot) => {
      const job = snapshot.jobs.find((candidate) => candidate.id === jobId)
      if (!job || (job.status !== 'queued' && job.status !== 'running')) return
      job.completed = Math.min(job.total, Math.max(job.completed, completed))
      job.updatedAt = new Date().toISOString()
    })
    this.broadcast()
  }

  private async finishJob(
    jobId: string,
    status: 'completed' | 'failed',
    errorMessage?: string,
    summary?: string
  ): Promise<void> {
    let finishedKind: ProfilerJob['kind'] | undefined
    await this.store.mutate((snapshot) => {
      const job = snapshot.jobs.find((candidate) => candidate.id === jobId)
      if (!job || job.status === 'cancelled') return
      finishedKind = job.kind
      job.status = status
      job.completed = status === 'completed' ? job.total : job.completed
      job.updatedAt = new Date().toISOString()
      job.errorMessage = errorMessage
      job.summary = summary
    })
    if (finishedKind && this.activeJobIds.get(finishedKind) === jobId) {
      this.activeJobIds.delete(finishedKind)
    }
    this.broadcast()
  }

  private queueBenchmark(
    serverIds: string[],
    force: boolean,
    label: string
  ): string {
    const active = this.findActiveJobId('benchmark')
    if (active) return active
    const job = this.createJob('benchmark', label, serverIds.length)
    this.trackTask(this.runBenchmarkJob(job.id, serverIds, force))
    return job.id
  }

  private trackTask(task: Promise<void>): void {
    this.backgroundTasks.add(task)
    void task
      .finally(() => this.backgroundTasks.delete(task))
      .catch(() => undefined)
  }

  private startMonitoring(): void {
    this.monitoringTimer = setInterval(() => {
      if (this.shuttingDown) return
      const snapshot = this.store.get()
      const now = Date.now()
      if (now - this.lastScheduledScanAt >= 60 * 60 * 1000) {
        if (this.findActiveJobId('scan') || this.findActiveJobId('benchmark')) return
        this.lastScheduledScanAt = now
        if (snapshot.servers.length > 0) this.queueScan(undefined, true)
        return
      }
      const dueServers = snapshot.servers
        .filter(
          (server) =>
            server.status === 'online' &&
            server.benchmarkApproved &&
            server.models.some(
              (model) =>
                isBenchmarkableLocalModel(model) &&
                isBenchmarkDue(model, server)
            )
        )
        .map((server) => server.id)
      if (dueServers.length > 0) {
        this.queueBenchmark(dueServers, false, 'Scheduled local model benchmarks')
      }
    }, 10 * 60 * 1000)
    this.monitoringTimer.unref()
  }

  private broadcast(): void {
    this.emit('snapshot', this.getSnapshot())
  }
}

function candidateToServer(
  candidate: DiscoveryCandidate,
  benchmarkApproved: boolean,
  now: string
): ServerRecord {
  return {
    id: randomUUID(),
    ...candidate,
    discoverySources: [candidate.source],
    status: 'unknown',
    failureCount: 0,
    benchmarkApproved,
    firstDiscoveredAt: now,
    lastDiscoveredAt: now,
    models: []
  }
}

function mergeDiscoverySources(
  server: ServerRecord,
  source: DiscoveryCandidate['source']
): DiscoveryCandidate['source'][] {
  return [...new Set([...(server.discoverySources ?? [server.source]), source])]
}

function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const hostname = new URL(endpoint).hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

function previewForRenderer(preview: ImportPreview): ImportPreview {
  return {
    ...preview,
    candidates: preview.candidates.slice(0, 100),
    issues: preview.issues.slice(0, 100)
  }
}

function requireServer(snapshot: ProfilerSnapshot, serverId: string): ServerRecord {
  const server = snapshot.servers.find((candidate) => candidate.id === serverId)
  if (!server) throw new Error('Server not found')
  return server
}

function isServerReadyForBenchmark(server: ServerRecord): boolean {
  return (
    server.status === 'online' &&
    server.benchmarkApproved &&
    server.models.some(isBenchmarkableLocalModel)
  )
}

export function isBenchmarkDue(
  model: ServerModel,
  server: ServerRecord,
  now = Date.now()
): boolean {
  const latestServerAttempt = server.models
    .flatMap((candidate) => candidate.benchmarks.slice(0, 1))
    .sort((left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt))[0]
  if (
    latestServerAttempt &&
    now - Date.parse(latestServerAttempt.finishedAt) < SERVER_BENCHMARK_GAP_MS
  ) {
    return false
  }
  const last = model.benchmarks[0]
  if (!last) return true
  const elapsed = now - Date.parse(last.finishedAt)
  if (last.status === 'success') return elapsed >= SUCCESS_RETRY_MS
  const failures = consecutiveFailures(model.benchmarks)
  const backoff =
    FAILURE_BACKOFF_MS[Math.min(failures - 1, FAILURE_BACKOFF_MS.length - 1)] ??
    60 * 60 * 1000
  return elapsed >= backoff
}

function consecutiveFailures(results: BenchmarkResult[]): number {
  let failures = 0
  for (const result of results) {
    if (result.status !== 'failed') break
    failures += 1
  }
  return Math.max(1, failures)
}

function validateSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    scanConcurrency: clampInteger(settings.scanConcurrency, 1, 32),
    benchmarkConcurrency: clampInteger(settings.benchmarkConcurrency, 1, 16),
    connectTimeoutMs: clampInteger(settings.connectTimeoutMs, 1_000, 60_000),
    requestTimeoutMs: clampInteger(settings.requestTimeoutMs, 2_000, 300_000),
    benchmarkTimeoutMs: clampInteger(settings.benchmarkTimeoutMs, 10_000, 600_000),
    maxResponseBytes: clampInteger(settings.maxResponseBytes, 64 * 1024, 8 * 1024 * 1024),
    benchmarkNumPredict: clampInteger(settings.benchmarkNumPredict, 8, 512),
    benchmarkMinTokens: clampInteger(settings.benchmarkMinTokens, 1, 128),
    benchmarkPrompt: settings.benchmarkPrompt.trim().slice(0, 2_000)
  }
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  const parsed = Math.round(Number(value))
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : minimum))
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof OllamaClientError) {
    return { code: error.code, message: error.message }
  }
  return { code: 'unexpected_error', message: messageOf(error) }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
