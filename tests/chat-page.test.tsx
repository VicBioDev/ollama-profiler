import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ServerRecord } from '@shared/types.js'
import { ChatPage } from '@renderer/pages/ChatPage.js'

const chatServer: ServerRecord = {
  id: 'server-1',
  endpoint: 'http://127.0.0.1:11434',
  source: 'localhost',
  status: 'online',
  failureCount: 0,
  benchmarkApproved: true,
  firstDiscoveredAt: '2026-07-26T00:00:00Z',
  lastDiscoveredAt: '2026-07-26T00:00:00Z',
  models: [
    {
      id: 'model-1',
      name: 'qwen3:8b',
      capabilities: ['completion'],
      installed: true,
      firstSeenAt: '2026-07-26T00:00:00Z',
      lastSeenAt: '2026-07-26T00:00:00Z',
      benchmarks: [
        {
          id: 'benchmark-1',
          status: 'success',
          startedAt: '2026-07-26T00:00:00Z',
          finishedAt: '2026-07-26T00:00:01Z',
          tokensPerSecond: 42
        }
      ]
    }
  ]
}

describe('chat page', () => {
  it('explains stateless requests and automatically shows the fastest route', () => {
    const html = renderToStaticMarkup(
      <ChatPage
        onChat={async () => ({ results: [] })}
        onShowServers={() => undefined}
        servers={[chatServer]}
      />
    )

    expect(html).toContain('One prompt. Up to four models.')
    expect(html).toContain('No disk history')
    expect(html).toContain('This test stays in memory while the app is open')
    expect(html).toContain('Closing the app clears it.')
    expect(html).toContain('qwen3:8b')
    expect(html).toContain('42.0 tok/s')
    expect(html).toContain('http://127.0.0.1:11434')
    expect(html).toContain('aria-label="Search chat models"')
    expect(html).toContain(
      'Models are ranked by how many eligible servers have them installed.'
    )
  })

  it('points users to generation approval when no model is eligible', () => {
    const html = renderToStaticMarkup(
      <ChatPage
        onChat={async () => ({ results: [] })}
        onShowServers={() => undefined}
        servers={[{ ...chatServer, benchmarkApproved: false }]}
      />
    )

    expect(html).toContain('No chat-ready models.')
    expect(html).toContain('Review servers')
  })
})
