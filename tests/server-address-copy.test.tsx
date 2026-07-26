// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerRecord } from '@shared/types.js'
import { ServerTable } from '@renderer/components/ServerTable.js'
import { ServerDetailPage } from '@renderer/pages/ServerDetailPage.js'

let container: HTMLDivElement
let root: Root
const writeText = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  writeText.mockReset()
  act(() => root.unmount())
  container.remove()
})

describe('server address copy actions', () => {
  it('copies the endpoint from a server list without opening the server', async () => {
    const onSelect = vi.fn()
    act(() => {
      root.render(<ServerTable onSelect={onSelect} servers={[server()]} />)
    })

    const copyButton = findCopyButton()
    await act(async () => copyButton.click())

    expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:11434')
    expect(onSelect).not.toHaveBeenCalled()
    expect(copyButton.getAttribute('aria-label')).toBe(
      'Server address copied: http://127.0.0.1:11434'
    )
  })

  it('copies the endpoint from the server detail page', async () => {
    act(() => {
      root.render(
        <ServerDetailPage
          onApprovalChange={() => undefined}
          onBack={() => undefined}
          onRemove={() => undefined}
          server={server()}
        />
      )
    })

    const copyButton = findCopyButton()
    await act(async () => copyButton.click())

    expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:11434')
    expect(copyButton.textContent).toBe('Copied')
  })
})

function findCopyButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label^="Copy server address"]'
  )
  if (!button) throw new Error('Copy server address button was not rendered')
  return button
}

function server(): ServerRecord {
  const now = '2026-07-26T00:00:00.000Z'
  return {
    id: 'server-1',
    endpoint: 'http://127.0.0.1:11434',
    source: 'localhost',
    status: 'online',
    failureCount: 0,
    benchmarkApproved: false,
    firstDiscoveredAt: now,
    lastDiscoveredAt: now,
    models: []
  }
}
