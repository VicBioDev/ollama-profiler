// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ServerModel, ServerRecord } from '@shared/types.js'
import { ChatPage } from '@renderer/pages/ChatPage.js'

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

describe('chat model picker', () => {
  it('searches the popularity-ranked choices and adds the matching model', () => {
    act(() => {
      root.render(
        <ChatPage
          onChat={async () => ({ results: [] })}
          onShowServers={() => undefined}
          servers={[
            server('1', ['qwen3:8b', 'zeta:latest', 'alpha:latest']),
            server('2', ['qwen3:8b']),
            server('3', ['qwen3:8b'])
          ]}
        />
      )
    })

    expect(container.textContent).toContain('1/4 selected')
    expect(container.textContent).toContain('qwen3:8b')

    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search chat models"]'
    )
    if (!search) throw new Error('Chat model search was not rendered')
    act(() => search.focus())

    expect(suggestionNames()).toEqual(['alpha:latest', 'zeta:latest'])

    act(() => setInputValue(search, 'ZET'))
    expect(suggestionNames()).toEqual(['zeta:latest'])

    const match = container.querySelector<HTMLButtonElement>(
      '#chat-model-suggestions [role="option"]'
    )
    if (!match) throw new Error('Matching model option was not rendered')
    act(() => match.click())

    expect(container.textContent).toContain('2/4 selected')
    expect(container.textContent).toContain('zeta:latest')
    expect(search.value).toBe('')
  })
})

function server(id: string, modelNames: string[]): ServerRecord {
  const now = '2026-07-26T00:00:00Z'
  return {
    id,
    endpoint: `http://10.0.0.${id}:11434`,
    source: 'manual',
    status: 'online',
    failureCount: 0,
    benchmarkApproved: true,
    firstDiscoveredAt: now,
    lastDiscoveredAt: now,
    models: modelNames.map((name): ServerModel => ({
      id: `${id}-${name}`,
      name,
      capabilities: ['completion'],
      installed: true,
      firstSeenAt: now,
      lastSeenAt: now,
      benchmarks: []
    }))
  }
}

function suggestionNames(): string[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      '#chat-model-suggestions [role="option"]'
    )
  ].map((option) => option.querySelector('span')?.textContent ?? '')
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
