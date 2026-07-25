import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { BenchmarkResult, ServerModel, ServerRecord } from '@shared/types.js'
import { createEmptySnapshot } from '@main/defaults.js'
import { isBenchmarkDue } from '@main/services/profiler-engine.js'
import { ProfilerStore } from '@main/services/store.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

function result(status: BenchmarkResult['status'], finishedAt: string): BenchmarkResult {
  return {
    id: `${status}-${finishedAt}`,
    status,
    startedAt: finishedAt,
    finishedAt
  }
}

function serverWith(model: ServerModel): ServerRecord {
  return {
    id: 'server',
    endpoint: 'http://127.0.0.1:11434',
    source: 'manual',
    status: 'online',
    failureCount: 0,
    benchmarkApproved: true,
    firstDiscoveredAt: '2026-01-01T00:00:00.000Z',
    lastDiscoveredAt: '2026-01-01T00:00:00.000Z',
    models: [model]
  }
}

describe('persistence and benchmark scheduling', () => {
  it('marks interrupted jobs cancelled, keeps completed jobs, and prunes old history', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ollama-profiler-store-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'profiler-data.json')
    const snapshot = createEmptySnapshot()
    snapshot.jobs = [
      {
        id: 'running',
        kind: 'scan',
        status: 'running',
        label: 'Scan',
        completed: 1,
        total: 2,
        createdAt: '2026-07-25T10:00:00.000Z',
        updatedAt: '2026-07-25T10:00:00.000Z'
      },
      {
        id: 'completed',
        kind: 'import',
        status: 'completed',
        label: 'Import',
        completed: 1,
        total: 1,
        createdAt: '2026-07-25T09:00:00.000Z',
        updatedAt: '2026-07-25T09:00:00.000Z'
      }
    ]
    snapshot.servers = [
      serverWith({
        id: 'model',
        name: 'qwen3:8b',
        capabilities: ['completion'],
        installed: true,
        firstSeenAt: '2025-01-01T00:00:00.000Z',
        lastSeenAt: '2026-07-25T10:00:00.000Z',
        benchmarks: [result('success', '2025-01-01T00:00:00.000Z')]
      })
    ]
    await writeFile(filePath, JSON.stringify({ schemaVersion: 1, snapshot }))

    const loaded = await new ProfilerStore(filePath).load()

    expect(loaded.jobs[0]).toMatchObject({
      id: 'running',
      status: 'cancelled',
      summary: 'Cancelled because the application closed.'
    })
    expect(loaded.jobs[0]?.errorMessage).toBeUndefined()
    expect(loaded.jobs[1]).toMatchObject({ id: 'completed', status: 'completed' })
    expect(loaded.servers[0]?.models[0]?.benchmarks).toEqual([])
    expect(JSON.parse(await readFile(filePath, 'utf8')).snapshot.jobs[0].status).toBe(
      'cancelled'
    )
  })

  it('uses 24-hour success retry and escalating failure backoff', () => {
    const now = Date.parse('2026-07-25T12:00:00.000Z')
    const model: ServerModel = {
      id: 'model',
      name: 'qwen3:8b',
      capabilities: ['completion'],
      installed: true,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-07-25T12:00:00.000Z',
      benchmarks: [result('success', '2026-07-24T13:00:00.000Z')]
    }
    const server = serverWith(model)

    expect(isBenchmarkDue(model, server, now)).toBe(false)
    model.benchmarks = [result('success', '2026-07-24T11:00:00.000Z')]
    expect(isBenchmarkDue(model, server, now)).toBe(true)

    model.benchmarks = [result('failed', '2026-07-25T10:30:00.000Z')]
    expect(isBenchmarkDue(model, server, now)).toBe(true)
    model.benchmarks = [
      result('failed', '2026-07-25T10:30:00.000Z'),
      result('failed', '2026-07-25T10:00:00.000Z')
    ]
    expect(isBenchmarkDue(model, server, now)).toBe(false)

    const newModel = {
      ...model,
      id: 'new-model',
      name: 'llama3.1:8b',
      benchmarks: []
    }
    const recentlyBenchmarkedServer = {
      ...server,
      models: [
        newModel,
        {
          ...model,
          id: 'recent-model',
          benchmarks: [result('success', '2026-07-25T11:45:00.000Z')]
        }
      ]
    }
    expect(isBenchmarkDue(newModel, recentlyBenchmarkedServer, now)).toBe(false)
  })
})
