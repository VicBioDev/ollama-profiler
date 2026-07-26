import { describe, expect, it } from 'vitest'
import {
  buildChatModelCatalog,
  routeChatModels,
  searchChatModelCatalog
} from '@shared/chat-routing.js'
import type {
  BenchmarkResult,
  ServerModel,
  ServerRecord
} from '@shared/types.js'

function benchmark(tokensPerSecond: number): BenchmarkResult {
  return {
    id: `benchmark-${tokensPerSecond}`,
    status: 'success',
    startedAt: '2026-07-26T00:00:00Z',
    finishedAt: '2026-07-26T00:00:01Z',
    tokensPerSecond
  }
}

function model(
  name: string,
  tokensPerSecond?: number
): ServerModel {
  return {
    id: name,
    name,
    capabilities: ['completion'],
    installed: true,
    firstSeenAt: '2026-07-26T00:00:00Z',
    lastSeenAt: '2026-07-26T00:00:00Z',
    benchmarks:
      tokensPerSecond === undefined ? [] : [benchmark(tokensPerSecond)]
  }
}

function server(
  id: string,
  models: ServerModel[],
  benchmarkApproved = true
): ServerRecord {
  return {
    id,
    endpoint: `http://10.0.0.${id}:11434`,
    source: 'manual',
    status: 'online',
    failureCount: 0,
    benchmarkApproved,
    firstDiscoveredAt: '2026-07-26T00:00:00Z',
    lastDiscoveredAt: '2026-07-26T00:00:00Z',
    models
  }
}

describe('stateless chat routing', () => {
  it('uses a globally fastest assignment with one model per server', () => {
    const servers = [
      server('1', [model('qwen3:8b', 100), model('llama3.1:8b', 99)]),
      server('2', [model('qwen3:8b', 95)]),
      server('3', [model('llama3.1:8b', 10)])
    ]

    const route = routeChatModels(servers, ['qwen3:8b', 'llama3.1:8b'])

    expect(route?.targets).toMatchObject([
      { modelName: 'qwen3:8b', serverId: '2', tokensPerSecond: 95 },
      { modelName: 'llama3.1:8b', serverId: '1', tokensPerSecond: 99 }
    ])
    expect(new Set(route?.targets.map(({ serverId }) => serverId)).size).toBe(2)
  })

  it('rejects duplicate models, more than four models, and shared-server-only routes', () => {
    const oneServer = [
      server('1', [model('qwen3:8b', 100), model('llama3.1:8b', 99)])
    ]

    expect(routeChatModels(oneServer, ['qwen3:8b', 'qwen3:8b'])).toBeUndefined()
    expect(routeChatModels(oneServer, ['qwen3:8b', 'llama3.1:8b'])).toBeUndefined()
    expect(
      routeChatModels(oneServer, ['a', 'b', 'c', 'd', 'e'])
    ).toBeUndefined()
  })

  it('catalogs only online, approved, local completion models', () => {
    const approved = server('1', [
      model('qwen3:8b', 42),
      { ...model('nomic-embed-text:latest'), capabilities: ['embedding'] },
      model('kimi-k2.7-code:cloud', 300)
    ])
    const unapproved = server('2', [model('llama3.1:8b', 80)], false)
    const offline = {
      ...server('3', [model('gemma3:12b', 70)]),
      status: 'offline' as const
    }

    expect(buildChatModelCatalog([approved, unapproved, offline])).toEqual([
      {
        name: 'qwen3:8b',
        serverCount: 1,
        bestTokensPerSecond: 42
      }
    ])
  })

  it('sorts the catalog by eligible-server popularity, then model name', () => {
    const servers = [
      server('1', [
        model('zeta:latest', 120),
        model('qwen3:8b', 30),
        model('alpha:latest', 90)
      ]),
      server('2', [model('qwen3:8b', 20)]),
      server('3', [model('qwen3:8b', 10)])
    ]

    expect(buildChatModelCatalog(servers).map(({ name }) => name)).toEqual([
      'qwen3:8b',
      'alpha:latest',
      'zeta:latest'
    ])
  })

  it('searches model names without changing popularity order', () => {
    const catalog = buildChatModelCatalog([
      server('1', [model('qwen3:8b'), model('qwen2.5:7b'), model('llama3.1:8b')]),
      server('2', [model('qwen3:8b')])
    ])

    expect(searchChatModelCatalog(catalog, ' QWEN ').map(({ name }) => name))
      .toEqual(['qwen3:8b', 'qwen2.5:7b'])
  })
})
