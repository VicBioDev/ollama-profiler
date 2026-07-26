// @vitest-environment jsdom

import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ServerRecord, ServerStatus } from '@shared/types.js'
import {
  ServersPage,
  createServersSearchState,
  type ServersSearchState
} from '@renderer/pages/ServersPage.js'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('servers search state', () => {
  it('keeps search filters across navigation and clears them after an app remount', () => {
    const servers = [
      server('singapore-qwen', 'qwen3:8b', 'online', 'Singapore'),
      server('japan-qwen', 'qwen3:8b', 'online', 'Japan'),
      server('singapore-llama', 'llama3.1:8b', 'offline', 'Singapore')
    ]

    act(() => root.render(<ServersSearchHarness servers={servers} />))

    act(() => {
      setInputValue(modelSearch(), 'qwen')
      setSelectValue(serverStatus(), 'online')
      setSelectValue(serverRegion(), 'Singapore')
    })

    expect(container.textContent).toContain('http://singapore-qwen:11434')
    expect(container.textContent).not.toContain('http://japan-qwen:11434')
    expect(container.textContent).not.toContain('http://singapore-llama:11434')

    act(() => findButton('Leave Servers').click())
    expect(container.querySelector('input[aria-label="Search discovered models"]')).toBeNull()

    act(() => findButton('Return to Servers').click())
    expect(modelSearch().value).toBe('qwen')
    expect(serverStatus().value).toBe('online')
    expect(serverRegion().value).toBe('Singapore')
    expect(container.textContent).toContain('http://singapore-qwen:11434')

    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(<ServersSearchHarness servers={servers} />))

    expect(modelSearch().value).toBe('')
    expect(serverStatus().value).toBe('all')
    expect(serverRegion().value).toBe('')
  })

  it('keeps the current result page across navigation', () => {
    const servers = Array.from({ length: 51 }, (_, index) =>
      server(
        `server-${String(index + 1).padStart(2, '0')}`,
        'qwen3:8b',
        'online',
        'Singapore'
      )
    )

    act(() => root.render(<ServersSearchHarness servers={servers} />))
    act(() => findButton('Next server page').click())
    expect(container.textContent).toContain('Page 2 of 2')

    act(() => findButton('Leave Servers').click())
    act(() => findButton('Return to Servers').click())

    expect(container.textContent).toContain('Page 2 of 2')
    expect(container.textContent).toContain('51–51 of 51')
  })
})

function ServersSearchHarness({
  servers
}: Readonly<{
  servers: ServerRecord[]
}>): React.JSX.Element {
  const [showServers, setShowServers] = useState(true)
  const [searchState, setSearchState] = useState<ServersSearchState>(
    createServersSearchState
  )

  return (
    <>
      <button onClick={() => setShowServers((current) => !current)} type="button">
        {showServers ? 'Leave Servers' : 'Return to Servers'}
      </button>
      {showServers ? (
        <ServersPage
          busy={false}
          onDeleteServers={async () => undefined}
          onExportServers={async () => null}
          onNavigateToImport={() => undefined}
          onSearchStateChange={setSearchState}
          onSelectServer={() => undefined}
          searchState={searchState}
          servers={servers}
        />
      ) : null}
    </>
  )
}

function server(
  id: string,
  modelName: string,
  status: ServerStatus,
  country: string
): ServerRecord {
  const now = '2026-07-26T00:00:00.000Z'
  return {
    id,
    endpoint: `http://${id}:11434`,
    source: 'manual',
    country,
    city: country,
    status,
    failureCount: 0,
    benchmarkApproved: true,
    firstDiscoveredAt: now,
    lastDiscoveredAt: now,
    models: [
      {
        id: `${id}-model`,
        name: modelName,
        capabilities: ['completion'],
        installed: true,
        firstSeenAt: now,
        lastSeenAt: now,
        benchmarks: []
      }
    ]
  }
}

function modelSearch(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search discovered models"]'
  )
  if (!input) throw new Error('Model search was not rendered')
  return input
}

function serverStatus(): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Server status"]'
  )
  if (!select) throw new Error('Server status filter was not rendered')
  return select
}

function serverRegion(): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Region (country)"]'
  )
  if (!select) throw new Error('Server region filter was not rendered')
  return select
}

function findButton(label: string): HTMLButtonElement {
  const button =
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ??
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === label
    )
  if (!button) throw new Error(`${label} button was not rendered`)
  return button
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set
  if (!setter) throw new Error('HTML input value setter is unavailable')
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    'value'
  )?.set
  if (!setter) throw new Error('HTML select value setter is unavailable')
  setter.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}
