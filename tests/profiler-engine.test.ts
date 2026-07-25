import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type RequestListener, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { ProfilerEngine } from '@main/services/profiler-engine.js'
import { ProfilerStore } from '@main/services/store.js'

const temporaryDirectories: string[] = []
const httpServers: Server[] = []

afterEach(async () => {
  await Promise.all([
    ...temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    ),
    ...httpServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
    )
  ])
})

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  httpServers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind')
  return `http://127.0.0.1:${address.port}`
}

describe('profiler task lifecycle', () => {
  it('migrates restart interruptions to cancelled tasks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ollama-profiler-test-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'profiler-data.json')
    const store = new ProfilerStore(filePath)
    await store.load()
    await store.mutate((snapshot) => {
      snapshot.jobs.push({
        id: 'interrupted-job',
        kind: 'benchmark',
        status: 'failed',
        label: 'Benchmark approved models',
        completed: 3,
        total: 10,
        createdAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:01:00.000Z',
        errorMessage: 'Interrupted when the app closed'
      })
    })

    const reloaded = new ProfilerStore(filePath)
    const snapshot = await reloaded.load()

    expect(snapshot.jobs[0]?.status).toBe('cancelled')
    expect(snapshot.jobs[0]?.errorMessage).toBeUndefined()
    expect(snapshot.jobs[0]?.summary).toBe(
      'Cancelled because the application closed.'
    )
  })

  it('deduplicates an active scan and records graceful shutdown as cancellation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ollama-profiler-test-'))
    temporaryDirectories.push(directory)
    const store = new ProfilerStore(join(directory, 'profiler-data.json'))
    const engine = new ProfilerEngine(store)
    await engine.initialize()
    await store.mutate((snapshot) => {
      snapshot.servers.push({
        id: 'server-1',
        endpoint: 'http://127.0.0.1:1',
        source: 'manual',
        status: 'unknown',
        failureCount: 0,
        benchmarkApproved: false,
        firstDiscoveredAt: '2026-07-26T00:00:00.000Z',
        lastDiscoveredAt: '2026-07-26T00:00:00.000Z',
        models: []
      })
    })

    const firstJobId = engine.scanServers()
    const duplicateJobId = engine.scanServers()

    expect(duplicateJobId).toBe(firstJobId)
    await engine.shutdown()
    await new Promise<void>((resolve) => setImmediate(resolve))

    const jobs = engine.getSnapshot().jobs
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.status).toBe('cancelled')
    expect(jobs[0]?.summary).toBe('Cancelled because the application closed.')
  })

  it('benchmarks every local generation model serially within a server', async () => {
    const requestedModels: string[] = []
    let activeRequests = 0
    let maximumActiveRequests = 0
    const endpoint = await listen((request, response) => {
      if (request.url !== '/api/generate') {
        response.statusCode = 404
        response.end()
        return
      }
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        body += chunk
      })
      request.on('end', () => {
        requestedModels.push((JSON.parse(body) as { model: string }).model)
        activeRequests += 1
        maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests)
        setTimeout(() => {
          response.setHeader('Content-Type', 'application/x-ndjson')
          response.write(`${JSON.stringify({ response: 'Hello', done: false })}\n`)
          response.end(`${JSON.stringify({
            response: '',
            done: true,
            eval_count: 64,
            eval_duration: 2_000_000_000
          })}\n`)
          activeRequests -= 1
        }, 10)
      })
    })

    const directory = await mkdtemp(join(tmpdir(), 'ollama-profiler-test-'))
    temporaryDirectories.push(directory)
    const store = new ProfilerStore(join(directory, 'profiler-data.json'))
    const engine = new ProfilerEngine(store)
    await engine.initialize()
    const now = '2026-07-26T00:00:00.000Z'
    await store.mutate((snapshot) => {
      snapshot.servers.push({
        id: 'server-1',
        endpoint,
        source: 'manual',
        status: 'online',
        failureCount: 0,
        benchmarkApproved: true,
        firstDiscoveredAt: now,
        lastDiscoveredAt: now,
        models: [
          {
            id: 'local-1',
            name: 'llama3.1:8b',
            capabilities: ['completion'],
            installed: true,
            firstSeenAt: now,
            lastSeenAt: now,
            benchmarks: []
          },
          {
            id: 'local-2',
            name: 'qwen3:32b',
            capabilities: ['completion'],
            installed: true,
            firstSeenAt: now,
            lastSeenAt: now,
            benchmarks: []
          },
          {
            id: 'cloud',
            name: 'kimi-k2.7-code:cloud',
            capabilities: ['completion'],
            installed: true,
            firstSeenAt: now,
            lastSeenAt: now,
            benchmarks: []
          },
          {
            id: 'embedding',
            name: 'nomic-embed-text:latest',
            capabilities: ['embedding'],
            installed: true,
            firstSeenAt: now,
            lastSeenAt: now,
            benchmarks: []
          }
        ]
      })
    })

    const jobId = engine.benchmarkServers(['server-1'])
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        engine.off('snapshot', check)
        reject(new Error('Benchmark job timed out'))
      }, 2_000)
      const check = (): void => {
        const job = engine.getSnapshot().jobs.find((candidate) => candidate.id === jobId)
        if (job?.status !== 'completed' && job?.status !== 'failed') return
        clearTimeout(timeout)
        engine.off('snapshot', check)
        if (job.status === 'failed') {
          reject(new Error(job.errorMessage ?? 'Benchmark job failed'))
        } else {
          resolve()
        }
      }
      engine.on('snapshot', check)
      check()
    })

    expect(requestedModels).toEqual(['llama3.1:8b', 'qwen3:32b'])
    expect(maximumActiveRequests).toBe(1)
    const models = engine.getSnapshot().servers[0]!.models
    expect(models.find((model) => model.id === 'local-1')?.benchmarks).toHaveLength(1)
    expect(models.find((model) => model.id === 'local-2')?.benchmarks).toHaveLength(1)
    expect(models.find((model) => model.id === 'cloud')?.benchmarks).toHaveLength(0)
    expect(models.find((model) => model.id === 'embedding')?.benchmarks).toHaveLength(0)
    await engine.shutdown()
  })
})
