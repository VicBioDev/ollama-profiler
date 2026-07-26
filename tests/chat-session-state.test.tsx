// @vitest-environment jsdom

import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerRecord } from '@shared/types.js'
import {
  ChatPage,
  createChatSessionState,
  type ChatSessionState
} from '@renderer/pages/ChatPage.js'

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

describe('chat session state', () => {
  it('keeps the current test across page navigation and clears it after an app remount', async () => {
    const onChat = vi.fn(async () => ({
      results: [
        {
          serverId: 'server-1',
          modelName: 'qwen3:8b',
          endpoint: 'http://127.0.0.1:11434',
          elapsedMs: 125,
          content: 'Session-only reply'
        }
      ]
    }))

    await act(async () => {
      root.render(<ChatSessionHarness onChat={onChat} />)
    })

    const prompt = chatPrompt()
    await act(async () => {
      setTextAreaValue(prompt, 'Keep this test while I navigate')
      findButton('Send').click()
    })

    expect(onChat).toHaveBeenCalledWith({
      prompt: 'Keep this test while I navigate',
      targets: [{ serverId: 'server-1', modelName: 'qwen3:8b' }]
    })
    expect(container.textContent).toContain('Session-only reply')

    act(() => findButton('Leave Chat').click())
    expect(container.querySelector('textarea')).toBeNull()

    act(() => findButton('Return to Chat').click())
    expect(chatPrompt().value).toBe('Keep this test while I navigate')
    expect(container.textContent).toContain('Session-only reply')

    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(<ChatSessionHarness onChat={onChat} />))

    expect(chatPrompt().value).toBe('')
    expect(container.textContent).not.toContain('Session-only reply')
  })
})

function ChatSessionHarness({
  onChat
}: Readonly<{
  onChat: React.ComponentProps<typeof ChatPage>['onChat']
}>): React.JSX.Element {
  const [showChat, setShowChat] = useState(true)
  const [sessionState, setSessionState] = useState<ChatSessionState>(
    createChatSessionState
  )

  return (
    <>
      <button onClick={() => setShowChat((current) => !current)} type="button">
        {showChat ? 'Leave Chat' : 'Return to Chat'}
      </button>
      {showChat ? (
        <ChatPage
          onChat={onChat}
          onSessionStateChange={setSessionState}
          onShowServers={() => undefined}
          servers={[chatServer]}
          sessionState={sessionState}
        />
      ) : null}
    </>
  )
}

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
      benchmarks: []
    }
  ]
}

function chatPrompt(): HTMLTextAreaElement {
  const prompt = container.querySelector<HTMLTextAreaElement>('textarea')
  if (!prompt) throw new Error('Chat prompt was not rendered')
  return prompt
}

function findButton(label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === label
  )
  if (!button) throw new Error(`${label} button was not rendered`)
  return button
}

function setTextAreaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )?.set
  if (!setter) throw new Error('HTML textarea value setter is unavailable')
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
