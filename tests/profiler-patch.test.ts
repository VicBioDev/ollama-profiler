import { describe, expect, it } from 'vitest'
import type { ProfilerJob, ProfilerPatch, ProfilerSnapshot, ServerRecord } from '@shared/types.js'
import { applyProfilerPatch } from '@shared/snapshot.js'

describe('profiler snapshot patches', () => {
  it('replaces changed records without rebuilding unchanged data', () => {
    const first = server('server-1', 'checking')
    const second = server('server-2', 'online')
    const running = job(1)
    const snapshot = profilerSnapshot([first, second], [running])
    const updatedFirst = server('server-1', 'online')
    const updatedJob = job(32)

    const patched = applyProfilerPatch(snapshot, {
      servers: [updatedFirst],
      jobs: [updatedJob],
      updatedAt: '2026-08-01T01:00:32Z'
    })

    expect(patched.servers).toEqual([updatedFirst, second])
    expect(patched.servers[1]).toBe(second)
    expect(patched.jobs).toEqual([updatedJob])
    expect(patched.settings).toBe(snapshot.settings)
    expect(patched.updatedAt).toBe('2026-08-01T01:00:32Z')
  })

  it('accepts records that are not present in the initial snapshot', () => {
    const patch: ProfilerPatch = {
      servers: [server('server-2', 'online')],
      updatedAt: '2026-08-01T01:00:01Z'
    }

    const patched = applyProfilerPatch(
      profilerSnapshot([server('server-1', 'online')], []),
      patch
    )

    expect(patched.servers.map(({ id }) => id)).toEqual(['server-1', 'server-2'])
  })
})

function profilerSnapshot(servers: ServerRecord[], jobs: ProfilerJob[]): ProfilerSnapshot {
  return {
    servers,
    jobs,
    settings: {
      scanConcurrency: 8,
      benchmarkConcurrency: 8,
      connectTimeoutMs: 5_000,
      requestTimeoutMs: 15_000,
      benchmarkTimeoutMs: 120_000,
      maxResponseBytes: 1_048_576,
      benchmarkPrompt: 'Test prompt',
      benchmarkNumPredict: 64,
      benchmarkMinTokens: 8,
      allowPrivateNetworks: true
    },
    updatedAt: '2026-08-01T01:00:00Z'
  }
}

function server(id: string, status: ServerRecord['status']): ServerRecord {
  return {
    id,
    endpoint: `http://${id}:11434`,
    source: 'manual',
    status,
    failureCount: 0,
    benchmarkApproved: false,
    firstDiscoveredAt: '2026-08-01T00:00:00Z',
    lastDiscoveredAt: '2026-08-01T00:00:00Z',
    models: []
  }
}

function job(completed: number): ProfilerJob {
  return {
    id: 'scan-1',
    kind: 'scan',
    status: 'running',
    label: 'Check all servers on launch',
    completed,
    total: 64,
    createdAt: '2026-08-01T01:00:00Z',
    updatedAt: `2026-08-01T01:00:${String(completed).padStart(2, '0')}Z`
  }
}
