// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ServerExportOptions,
  ServerRecord
} from '@shared/types.js'
import { ServersPage } from '@renderer/pages/ServersPage.js'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  vi.restoreAllMocks()
  act(() => root.unmount())
  container.remove()
})

describe('server bulk actions', () => {
  it('selects all current exact-model results and forwards that model to export', async () => {
    let exported: ServerExportOptions | undefined
    act(() => {
      root.render(
        <ServersPage
          busy={false}
          onDeleteServers={async () => undefined}
          onExportServers={async (options) => {
            exported = options
            return { filePath: 'servers.csv', count: options.serverIds.length }
          }}
          onNavigateToImport={() => undefined}
          onSelectServer={() => undefined}
          servers={[
            server('server-qwen', 'qwen3:32b'),
            server('server-llama', 'llama3.1:8b')
          ]}
        />
      )
    })

    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search discovered models"]'
    )
    if (!search) throw new Error('Model search was not rendered')
    act(() => setInputValue(search, 'qwen3:32b'))

    const selectAll = container.querySelector<HTMLInputElement>(
      'input[aria-label="Select all 1 filtered servers"]'
    )
    if (!selectAll) throw new Error('Filtered select-all was not rendered')
    act(() => selectAll.click())

    expect(container.textContent).toContain('1 selected')
    expect(container.textContent).toContain('Export TPS for qwen3:32b')

    const exportButton = findButton('Export CSV')
    await act(async () => exportButton.click())

    expect(exported).toEqual({
      serverIds: ['server-qwen'],
      modelName: 'qwen3:32b'
    })
    expect(container.textContent).toContain('Exported 1 server to CSV.')
  })

  it('supports individual multi-selection and confirmed bulk deletion', async () => {
    let deletedIds: string[] = []
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    act(() => {
      root.render(
        <ServersPage
          busy={false}
          onDeleteServers={async (serverIds) => {
            deletedIds = serverIds
          }}
          onExportServers={async () => null}
          onNavigateToImport={() => undefined}
          onSelectServer={() => undefined}
          servers={[
            server('server-qwen', 'qwen3:32b'),
            server('server-llama', 'llama3.1:8b')
          ]}
        />
      )
    })

    const rowSelections = [
      ...container.querySelectorAll<HTMLInputElement>(
        'tbody input[type="checkbox"]'
      )
    ]
    act(() => {
      rowSelections[0]?.click()
      rowSelections[1]?.click()
    })
    expect(container.textContent).toContain('2 selected')

    const deleteButton = findButton('Delete')
    await act(async () => deleteButton.click())

    expect(deletedIds).toEqual(['server-qwen', 'server-llama'])
    expect(window.confirm).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Deleted 2 servers.')
  })

  it('paginates at 50 rows while select-all covers every filtered result', async () => {
    let exported: ServerExportOptions | undefined
    const servers = Array.from({ length: 51 }, (_, index) =>
      server(`server-${String(index + 1).padStart(2, '0')}`, 'qwen3:32b')
    )
    act(() => {
      root.render(
        <ServersPage
          busy={false}
          onDeleteServers={async () => undefined}
          onExportServers={async (options) => {
            exported = options
            return { filePath: 'servers.csv', count: options.serverIds.length }
          }}
          onNavigateToImport={() => undefined}
          onSelectServer={() => undefined}
          servers={servers}
        />
      )
    })

    expect(
      container.querySelectorAll('tbody input[type="checkbox"]')
    ).toHaveLength(50)
    expect(container.textContent).toContain('1–50 of 51')
    expect(container.textContent).toContain('Page 1 of 2')

    const selectAll = container.querySelector<HTMLInputElement>(
      'input[aria-label="Select all 51 filtered servers"]'
    )
    if (!selectAll) throw new Error('Cross-page select-all was not rendered')
    act(() => selectAll.click())
    expect(container.textContent).toContain('51 selected')

    const next = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Next server page"]'
    )
    if (!next) throw new Error('Next page was not rendered')
    act(() => next.click())

    const secondPageRows = [
      ...container.querySelectorAll<HTMLInputElement>(
        'tbody input[type="checkbox"]'
      )
    ]
    expect(secondPageRows).toHaveLength(1)
    expect(secondPageRows[0]?.checked).toBe(true)
    expect(container.textContent).toContain('51–51 of 51')
    expect(container.textContent).toContain('Page 2 of 2')

    await act(async () => findButton('Export CSV').click())
    expect(exported?.serverIds).toHaveLength(51)
    expect(exported?.modelName).toBeUndefined()
  })
})

function server(id: string, modelName: string): ServerRecord {
  const now = '2026-07-26T00:00:00.000Z'
  return {
    id,
    endpoint: `http://${id}:11434`,
    source: 'manual',
    country: 'Singapore',
    city: 'Singapore',
    status: 'online',
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

function findButton(label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
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
