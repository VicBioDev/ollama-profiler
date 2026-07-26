import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { APP_VERSION } from '@shared/generated-version.js'
import type { ProfilerSnapshot, ServerRecord } from '@shared/types.js'
import { OverviewPage } from '@renderer/pages/OverviewPage.js'
import { ImportPage } from '@renderer/pages/ImportPage.js'
import { LocalDiscoveryPage } from '@renderer/pages/LocalDiscoveryPage.js'
import { ServerDetailPage } from '@renderer/pages/ServerDetailPage.js'
import {
  buildModelCatalog,
  filterServers,
  resolveExactModelName,
  suggestModels
} from '@renderer/pages/ServersPage.js'
import { Sidebar } from '@renderer/components/Sidebar.js'
import { ServerTable } from '@renderer/components/ServerTable.js'
import { TopBar } from '@renderer/components/TopBar.js'

const settings: ProfilerSnapshot['settings'] = {
  scanConcurrency: 8,
  benchmarkConcurrency: 4,
  connectTimeoutMs: 5_000,
  requestTimeoutMs: 15_000,
  benchmarkTimeoutMs: 120_000,
  maxResponseBytes: 1_048_576,
  benchmarkPrompt: 'Test prompt',
  benchmarkNumPredict: 64,
  benchmarkMinTokens: 8,
  allowPrivateNetworks: true
}

function snapshot(servers: ServerRecord[]): ProfilerSnapshot {
  return {
    servers,
    jobs: [],
    settings,
    updatedAt: '2026-07-25T12:00:00.000Z'
  }
}

function server(capabilities: string[], benchmarkApproved = false): ServerRecord {
  return {
    id: 'server-1',
    endpoint: 'http://127.0.0.1:11434',
    source: 'manual',
    status: 'online',
    ollamaVersion: '0.12.3',
    failureCount: 0,
    benchmarkApproved,
    firstDiscoveredAt: '2026-07-25T10:00:00.000Z',
    lastDiscoveredAt: '2026-07-25T12:00:00.000Z',
    lastCheckedAt: '2026-07-25T12:00:00.000Z',
    lastOnlineAt: '2026-07-25T12:00:00.000Z',
    models: [
      {
        id: 'model-1',
        name: capabilities.includes('completion')
          ? 'llama3.1:8b'
          : 'nomic-embed-text:latest',
        capabilities,
        installed: true,
        firstSeenAt: '2026-07-25T10:00:00.000Z',
        lastSeenAt: '2026-07-25T12:00:00.000Z',
        benchmarks: []
      }
    ]
  }
}

describe('state-driven interface', () => {
  it('offers export upload without online provider APIs', () => {
    const html = renderToStaticMarkup(
      <ImportPage
        busy={false}
        onCommit={async () => ({ added: 0, updated: 0 })}
        onPreviewText={async () => {
          throw new Error('not called')
        }}
        onSelectFile={async () => null}
      />
    )

    expect(html).toContain('Choose file')
    expect(html).toContain('Paste endpoints')
    expect(html).toContain('FOFA, Shodan, or endpoint list')
    expect(html).not.toContain('Shodan API')
    expect(html).not.toContain('Search directly')
    expect(html).not.toContain('API key')
  })

  it('shows only the import next step for an empty app', () => {
    const html = renderToStaticMarkup(
      <OverviewPage
        onNavigateToImport={() => undefined}
        onSelectServer={() => undefined}
        snapshot={snapshot([])}
      />
    )

    expect(html).toContain('Start with your servers.')
    expect(html).toContain('Import servers')
    expect(html).not.toContain('Online servers')
    expect(html).not.toContain('Recent tasks')
  })

  it('hides benchmark metrics until a benchmark attempt exists', () => {
    const html = renderToStaticMarkup(
      <OverviewPage
        onNavigateToImport={() => undefined}
        onSelectServer={() => undefined}
        snapshot={snapshot([server(['completion'])])}
      />
    )

    expect(html).toContain('Online servers')
    expect(html).toContain('Installed models')
    expect(html).not.toContain('Benchmark success')
    expect(html).not.toContain('Fastest model')
  })

  it('removes irrelevant navigation and scan actions before import', () => {
    const sidebar = renderToStaticMarkup(
      <Sidebar
        activePage="overview"
        hasServers={false}
        localState="idle"
        onNavigate={() => undefined}
      />
    )
    const topbar = renderToStaticMarkup(
      <TopBar busy={false} jobs={[]} />
    )

    expect(sidebar).not.toContain('>Servers<')
    expect(sidebar).toContain('>Import<')
    expect(sidebar).toContain('>Localhost<')
    expect(sidebar).toContain(`Version ${APP_VERSION}`)
    expect(sidebar).toContain(`v${APP_VERSION}`)
    expect(sidebar).not.toContain('Local data only')
    expect(sidebar).not.toContain('No hosted service')
    expect(topbar).not.toContain('Scan all')
    expect(topbar).not.toContain('Profiler ready')
  })

  it('shows benchmark permission only for generation-capable models', () => {
    const embeddingHtml = renderToStaticMarkup(
      <ServerDetailPage
        onApprovalChange={() => undefined}
        onBack={() => undefined}
        onRemove={() => undefined}
        server={server(['embedding'])}
      />
    )
    const completionHtml = renderToStaticMarkup(
      <ServerDetailPage
        onApprovalChange={() => undefined}
        onBack={() => undefined}
        onRemove={() => undefined}
        server={server(['completion'])}
      />
    )

    expect(embeddingHtml).toContain('Embedding only')
    expect(embeddingHtml).not.toContain('Allow generation benchmarks?')
    expect(completionHtml).toContain('Allow generation benchmarks?')
    expect(completionHtml).not.toContain('Benchmark models')
  })

  it('marks cloud models as skipped instead of locally benchmarkable', () => {
    const cloudServer = server(['completion'], true)
    cloudServer.models[0]!.name = 'kimi-k2.7-code:cloud'
    const html = renderToStaticMarkup(
      <ServerDetailPage
        onApprovalChange={() => undefined}
        onBack={() => undefined}
        onRemove={() => undefined}
        server={cloudServer}
      />
    )

    expect(html).toContain('Cloud model · skipped')
    expect(html).toContain('requires Ollama sign-in')
    expect(html).not.toContain('Generation benchmarks enabled')
  })

  it('suggests model names and filters servers by model, state, and country', () => {
    const singapore = server(['completion'])
    singapore.country = 'Singapore'
    const japan = {
      ...server(['completion']),
      id: 'server-2',
      country: 'Japan',
      models: [
        {
          ...server(['completion']).models[0]!,
          id: 'model-2',
          name: 'qwen3:32b'
        }
      ]
    }
    const secondJapan = {
      ...japan,
      id: 'server-3',
      models: [
        { ...japan.models[0]!, id: 'model-3' },
        { ...japan.models[0]!, id: 'model-3-duplicate' }
      ]
    }
    const catalog = buildModelCatalog([singapore, japan, secondJapan])

    expect(suggestModels(catalog, '')[0]).toEqual({
      name: 'qwen3:32b',
      serverCount: 2
    })
    expect(suggestModels(catalog, 'qwen')).toEqual([
      { name: 'qwen3:32b', serverCount: 2 }
    ])
    expect(filterServers([singapore, japan], 'qwen', 'online', 'Japan')).toEqual([
      japan
    ])
  })

  it('shows and sorts the speed for the exact searched model', () => {
    const slowerQwen = {
      ...server(['completion']),
      id: 'server-1',
      endpoint: 'http://10.0.0.1:11434',
      models: [
        {
          ...server(['completion']).models[0]!,
          id: 'qwen-slower',
          name: 'qwen3:32b',
          benchmarks: [
            {
              id: 'qwen-slower-result',
              status: 'success' as const,
              startedAt: '2026-07-25T11:00:00.000Z',
              finishedAt: '2026-07-25T11:01:00.000Z',
              tokensPerSecond: 18
            }
          ]
        },
        {
          ...server(['completion']).models[0]!,
          id: 'other-faster',
          name: 'llama3.1:8b',
          benchmarks: [
            {
              id: 'other-faster-result',
              status: 'success' as const,
              startedAt: '2026-07-25T11:00:00.000Z',
              finishedAt: '2026-07-25T11:01:00.000Z',
              tokensPerSecond: 120
            }
          ]
        }
      ]
    }
    const fasterQwen = {
      ...slowerQwen,
      id: 'server-2',
      endpoint: 'http://10.0.0.2:11434',
      models: [
        {
          ...slowerQwen.models[0]!,
          id: 'qwen-faster',
          benchmarks: [
            {
              ...slowerQwen.models[0]!.benchmarks[0]!,
              id: 'qwen-faster-result',
              tokensPerSecond: 42
            }
          ]
        }
      ]
    }
    const catalog = buildModelCatalog([slowerQwen, fasterQwen])
    const selectedModel = resolveExactModelName(catalog, 'QWEN3:32B')
    const sorted = filterServers(
      [slowerQwen, fasterQwen],
      'qwen3:32b',
      'online',
      '',
      selectedModel
    )
    const html = renderToStaticMarkup(
      <ServerTable
        onSelect={() => undefined}
        servers={sorted}
        speedModelName={selectedModel}
      />
    )

    expect(selectedModel).toBe('qwen3:32b')
    expect(sorted.map((candidate) => candidate.id)).toEqual(['server-2', 'server-1'])
    expect(html).toContain('Best speed<small title="qwen3:32b">(qwen3:32b)</small>')
    expect(html).toContain('42.0 tok/s')
    expect(html).toContain('18.0 tok/s')
    expect(html).not.toContain('120.0 tok/s')
  })

  it('exposes one global scan and benchmark action in every server context', () => {
    const overview = renderToStaticMarkup(
      <TopBar
        busy={false}
        jobs={[]}
        profileAction={{ label: 'Scan & benchmark all', onClick: () => undefined }}
      />
    )
    const serverContext = renderToStaticMarkup(
      <TopBar
        busy={false}
        jobs={[]}
        profileAction={{ label: 'Scan & benchmark all', onClick: () => undefined }}
      />
    )

    expect(overview).toContain('Scan &amp; benchmark all')
    expect(serverContext).toContain('Scan &amp; benchmark all')
    expect(serverContext).not.toContain('Scan server')
    expect(serverContext).not.toContain('Re-run benchmark')
  })

  it('shows the current profiling stage and prevents duplicate global actions', () => {
    const scanning = renderToStaticMarkup(
      <TopBar
        busy={false}
        jobs={[
          {
            id: 'scan-job',
            kind: 'scan',
            status: 'running',
            label: 'Scan all servers',
            completed: 1,
            total: 2,
            createdAt: '2026-07-26T00:00:00.000Z',
            updatedAt: '2026-07-26T00:00:00.000Z'
          }
        ]}
        profileAction={{
          label: 'Scan & benchmark all',
          onClick: () => undefined
        }}
      />
    )
    const benchmarking = renderToStaticMarkup(
      <TopBar
        busy={false}
        jobs={[
          {
            id: 'benchmark-job',
            kind: 'benchmark',
            status: 'running',
            label: 'Re-run benchmarks for 2 servers',
            completed: 1,
            total: 2,
            createdAt: '2026-07-26T00:00:00.000Z',
            updatedAt: '2026-07-26T00:00:00.000Z'
          }
        ]}
        profileAction={{
          label: 'Scan & benchmark all',
          onClick: () => undefined
        }}
      />
    )

    expect(scanning).toContain('Scan all servers · 1/2')
    expect(scanning).toContain('Scanning all…')
    expect(scanning.match(/disabled/g)?.length).toBe(1)
    expect(benchmarking).toContain('Re-run benchmarks for 2 servers · 1/2')
    expect(benchmarking).toContain('Benchmarking all…')
    expect(benchmarking.match(/disabled/g)?.length).toBe(1)
  })

  it('shows only local discovery actions before a local scan', () => {
    const html = renderToStaticMarkup(
      <LocalDiscoveryPage
        onScanLocalNetwork={async () => undefined}
        onSelectServer={() => undefined}
        onShowSettings={() => undefined}
        onTestLocalhost={async () => undefined}
        snapshot={snapshot([])}
      />
    )

    expect(html).toContain('Test localhost')
    expect(html).toContain('Scan local network')
    expect(html).not.toContain('Ollama endpoints')
  })

  it('shows discovered localhost and LAN servers in the local page', () => {
    const local = server(['completion'])
    local.discoverySources = ['manual', 'localhost']
    const lan = {
      ...server(['embedding']),
      id: 'server-2',
      endpoint: 'http://192.168.17.20:11434',
      source: 'lan-scan' as const,
      discoverySources: ['lan-scan' as const],
      city: 'Local network'
    }
    const html = renderToStaticMarkup(
      <LocalDiscoveryPage
        onScanLocalNetwork={async () => undefined}
        onSelectServer={() => undefined}
        onShowSettings={() => undefined}
        onTestLocalhost={async () => undefined}
        snapshot={snapshot([local, lan])}
      />
    )

    expect(html).toContain('Local servers')
    expect(html).toContain('http://127.0.0.1:11434')
    expect(html).toContain('http://192.168.17.20:11434')
  })
})
