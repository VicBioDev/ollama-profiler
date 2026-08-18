import { describe, expect, it } from 'vitest'
import type { ServerRecord } from '@shared/types.js'
import {
  createServerExportCsv,
  createServerExportFileName,
  createSub2ApiExportJson
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
    expect(createServerExportFileName(undefined, date, 'sub2api')).toBe(
      'Ollama Profiler - Sub2API - 2026-07-26.json'
    )
  })
})

describe('server Sub2API JSON export', () => {
  it('maps each selected server to an OpenAI API Key account', () => {
    const json = createSub2ApiExportJson(
      [server],
      new Date('2026-08-18T09:28:01.000Z')
    )
    const payload = JSON.parse(json) as {
      exported_at: string
      proxies: unknown[]
      accounts: Array<{
        name: string
        platform: string
        type: string
        credentials: {
          api_key: string
          base_url: string
          model_mapping: Record<string, string>
        }
        extra: {
          openai_apikey_responses_websockets_v2_enabled: boolean
          openai_apikey_responses_websockets_v2_mode: string
          openai_long_context_billing_enabled: boolean
        }
        concurrency: number
        priority: number
        rate_multiplier: number
        auto_pause_on_expired: boolean
      }>
    }

    expect(payload).toEqual({
      exported_at: '2026-08-18T09:28:01Z',
      proxies: [],
      accounts: [
        {
          name: 'http://192.168.17.20:11434',
          platform: 'openai',
          type: 'apikey',
          credentials: {
            api_key: 'http://192.168.17.20:11434',
            base_url: 'http://192.168.17.20:11434/',
            model_mapping: {
              'llama3.1:8b': 'llama3.1:8b',
              'qwen3:32b': 'qwen3:32b'
            }
          },
          extra: {
            openai_apikey_responses_websockets_v2_enabled: false,
            openai_apikey_responses_websockets_v2_mode: 'off',
            openai_long_context_billing_enabled: false
          },
          concurrency: 1,
          priority: 1,
          rate_multiplier: 1,
          auto_pause_on_expired: true
        }
      ]
    })
  })

  it('omits cloud-tagged models and keeps only installed local models', () => {
    const json = createSub2ApiExportJson([
      {
        ...server,
        endpoint: 'http://89.169.110.227:11434/',
        models: [
          {
            ...server.models[0]!,
            id: 'local-qwen',
            name: 'qwen3.6:27b'
          },
          {
            ...server.models[0]!,
            id: 'cloud-kimi',
            name: 'kimi-k2.7-code:cloud'
          },
          {
            ...server.models[0]!,
            id: 'uninstalled',
            name: 'removed:latest',
            installed: false
          }
        ]
      }
    ])
    const payload = JSON.parse(json) as {
      accounts: Array<{
        name: string
        credentials: {
          api_key: string
          base_url: string
          model_mapping: Record<string, string>
        }
      }>
    }

    expect(payload.accounts[0]?.name).toBe('http://89.169.110.227:11434')
    expect(payload.accounts[0]?.credentials.api_key).toBe(
      'http://89.169.110.227:11434'
    )
    expect(payload.accounts[0]?.credentials.base_url).toBe(
      'http://89.169.110.227:11434/'
    )
    expect(payload.accounts[0]?.credentials.model_mapping).toEqual({
      'qwen3.6:27b': 'qwen3.6:27b'
    })
  })
})
