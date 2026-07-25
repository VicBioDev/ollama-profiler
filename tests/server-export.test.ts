import { describe, expect, it } from 'vitest'
import type { ServerRecord } from '@shared/types.js'
import {
  createServerExportCsv,
  createServerExportFileName
} from '@shared/server-export.js'

const server: ServerRecord = {
  id: 'server-1',
  endpoint: 'http://192.168.17.20:11434',
  source: 'manual',
  country: 'Singapore',
  city: 'Singapore',
  status: 'online',
  failureCount: 0,
  benchmarkApproved: true,
  firstDiscoveredAt: '2026-07-26T00:00:00.000Z',
  lastDiscoveredAt: '2026-07-26T00:00:00.000Z',
  models: [
    {
      id: 'qwen',
      name: 'qwen3:32b',
      capabilities: ['completion'],
      installed: true,
      firstSeenAt: '2026-07-26T00:00:00.000Z',
      lastSeenAt: '2026-07-26T00:00:00.000Z',
      benchmarks: [
        {
          id: 'qwen-failed',
          status: 'failed',
          startedAt: '2026-07-26T00:10:00.000Z',
          finishedAt: '2026-07-26T00:11:00.000Z'
        },
        {
          id: 'qwen-success',
          status: 'success',
          startedAt: '2026-07-26T00:00:00.000Z',
          finishedAt: '2026-07-26T00:01:00.000Z',
          tokensPerSecond: 42.25
        }
      ]
    },
    {
      id: 'llama',
      name: 'llama3.1:8b',
      capabilities: ['completion'],
      installed: true,
      firstSeenAt: '2026-07-26T00:00:00.000Z',
      lastSeenAt: '2026-07-26T00:00:00.000Z',
      benchmarks: [
        {
          id: 'llama-success',
          status: 'success',
          startedAt: '2026-07-26T00:00:00.000Z',
          finishedAt: '2026-07-26T00:01:00.000Z',
          tokensPerSecond: 120
        }
      ]
    }
  ]
}

describe('server CSV export', () => {
  it('exports the exact searched model TPS and keeps the previous success after a failure', () => {
    const csv = createServerExportCsv([server], 'qwen3:32b')

    expect(csv).toContain('"Endpoint","Region","TPS (qwen3:32b)"')
    expect(csv).toContain(
      '"http://192.168.17.20:11434","Singapore, Singapore","42.3"'
    )
    expect(csv).not.toContain('"120.0"')
  })

  it('exports the highest installed model TPS when no exact model is selected', () => {
    const csv = createServerExportCsv([server])

    expect(csv).toContain('"Endpoint","Region","Best TPS"')
    expect(csv).toContain(
      '"http://192.168.17.20:11434","Singapore, Singapore","120.0"'
    )
  })

  it('uses the product, optional safe model name, and local date in filenames', () => {
    const date = new Date(2026, 6, 26, 12)

    expect(createServerExportFileName('qwen3:32b', date)).toBe(
      'Ollama Profiler - qwen3-32b - 2026-07-26.csv'
    )
    expect(createServerExportFileName('org/model:latest', date)).toBe(
      'Ollama Profiler - org-model-latest - 2026-07-26.csv'
    )
    expect(createServerExportFileName(undefined, date)).toBe(
      'Ollama Profiler - 2026-07-26.csv'
    )
  })
})
