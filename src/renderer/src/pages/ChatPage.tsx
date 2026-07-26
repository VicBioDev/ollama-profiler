import {
  CircleAlert,
  Clock3,
  MessageSquareText,
  Search,
  Send,
  ShieldCheck,
  X,
  Zap
} from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  buildChatModelCatalog,
  routeChatModels,
  searchChatModelCatalog
} from '@shared/chat-routing'
import type {
  ChatRequest,
  ChatResponse,
  ServerRecord
} from '@shared/types'
import { formatDuration, formatSpeed } from '../utils/format'

interface ChatPageProps {
  readonly servers: ServerRecord[]
  readonly onChat: (request: ChatRequest) => Promise<ChatResponse>
  readonly onShowServers: () => void
}

export function ChatPage({
  servers,
  onChat,
  onShowServers
}: Readonly<ChatPageProps>): React.JSX.Element {
  const catalog = useMemo(() => buildChatModelCatalog(servers), [servers])
  const [selectedModelNames, setSelectedModelNames] = useState<string[]>(
    () => catalog[0] ? [catalog[0].name] : []
  )
  const [modelQuery, setModelQuery] = useState('')
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState<ChatResponse>()
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string>()
  const selectedKeys = new Set(
    selectedModelNames.map((name) => name.toLowerCase())
  )
  const availableChoices = catalog.filter(
    ({ name }) => !selectedKeys.has(name.toLowerCase())
  )
  const matchingChoices = searchChatModelCatalog(availableChoices, modelQuery)
  const route = useMemo(
    () => routeChatModels(servers, selectedModelNames),
    [selectedModelNames, servers]
  )

  const addModel = (requestedName?: string): void => {
    const exactChoice = availableChoices.find(
      ({ name }) =>
        name.toLowerCase() === (requestedName ?? modelQuery).trim().toLowerCase()
    )
    const nextName = exactChoice?.name || matchingChoices[0]?.name
    if (!nextName || selectedModelNames.length >= 4) return
    const nextSelection = [...selectedModelNames, nextName]
    if (!routeChatModels(servers, nextSelection)) {
      setNotice(
        'That combination cannot run on separate servers. Choose a model available on another generation-enabled server.'
      )
      return
    }
    setSelectedModelNames(nextSelection)
    setModelQuery('')
    setModelPickerOpen(false)
    setNotice(undefined)
    setResponse(undefined)
  }

  const removeModel = (name: string): void => {
    setSelectedModelNames((current) =>
      current.filter((candidate) => candidate !== name)
    )
    setNotice(undefined)
    setResponse(undefined)
  }

  const send = async (): Promise<void> => {
    const message = prompt.trim()
    if (!message) {
      setNotice('Enter a message before sending.')
      return
    }
    if (!route) {
      setNotice('Choose at least one model that can run on a distinct server.')
      return
    }

    setSending(true)
    setNotice(undefined)
    setResponse(undefined)
    try {
      setResponse(
        await onChat({
          prompt: message,
          targets: route.targets.map(({ serverId, modelName }) => ({
            serverId,
            modelName
          }))
        })
      )
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setSending(false)
    }
  }

  if (catalog.length === 0) {
    return (
      <div className="focused-state chat-empty-state">
        <span className="focused-mark">
          <MessageSquareText size={21} />
        </span>
        <span className="eyebrow">STATELESS CHAT</span>
        <h1>No chat-ready models.</h1>
        <p>
          Chat uses online, local completion models on servers where you have enabled
          generation. Scan your fleet and enable generation only on servers you own or
          are authorized to use.
        </p>
        <button className="button primary focused-action" onClick={onShowServers} type="button">
          Review servers
        </button>
      </div>
    )
  }

  return (
    <div className="page-content chat-page">
      <header className="page-intro">
        <div>
          <span className="eyebrow">STATELESS CHAT</span>
          <h1>One prompt. Up to four models.</h1>
          <p>
            Compare answers without creating a conversation record. Each send stands
            alone.
          </p>
        </div>
        <aside className="safety-card">
          <ShieldCheck size={18} />
          <div>
            <strong>No history stored</strong>
            <p>
              Ollama Profiler does not save prompts or replies. Each request sends only
              the current prompt.
            </p>
          </div>
        </aside>
      </header>

      <section className="panel chat-composer">
        <header className="panel-heading">
          <div>
            <span className="eyebrow">MODEL ROUTING</span>
            <h2>{selectedModelNames.length === 1 ? 'Chat with a model' : 'Compare models'}</h2>
          </div>
          <span className="panel-count">{selectedModelNames.length}/4 selected</span>
        </header>

        <div className="chat-model-picker">
          <div
            className="chat-model-search"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setModelPickerOpen(false)
              }
            }}
          >
            <Search aria-hidden="true" size={14} />
            <input
              aria-autocomplete="list"
              aria-controls="chat-model-suggestions"
              aria-expanded={modelPickerOpen}
              aria-label="Search chat models"
              disabled={selectedModelNames.length >= 4 || availableChoices.length === 0}
              onChange={(event) => {
                setModelQuery(event.target.value)
                setModelPickerOpen(true)
                setNotice(undefined)
              }}
              onFocus={() => setModelPickerOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && matchingChoices.length > 0) {
                  event.preventDefault()
                  addModel()
                } else if (event.key === 'Escape') {
                  setModelPickerOpen(false)
                }
              }}
              placeholder="Search models"
              role="combobox"
              type="search"
              value={modelQuery}
            />
            {modelPickerOpen ? (
              <div
                className="chat-model-suggestions"
                id="chat-model-suggestions"
                role="listbox"
              >
                {matchingChoices.length > 0 ? (
                  matchingChoices.map((choice) => (
                    <button
                      aria-selected="false"
                      key={choice.name}
                      onClick={() => addModel(choice.name)}
                      role="option"
                      type="button"
                    >
                      <span>{choice.name}</span>
                      <small>
                        {choice.serverCount} eligible server
                        {choice.serverCount === 1 ? '' : 's'}
                      </small>
                    </button>
                  ))
                ) : (
                  <span className="chat-model-suggestions-empty">
                    No available model matches
                  </span>
                )}
              </div>
            ) : null}
          </div>
          <button
            className="button secondary"
            disabled={selectedModelNames.length >= 4 || matchingChoices.length === 0}
            onClick={() => addModel()}
            type="button"
          >
            Add model
          </button>
        </div>
        <p className="chat-model-order-note">
          Models are ranked by how many eligible servers have them installed.
        </p>

        <div className="chat-route-grid">
          {route?.targets.map((target) => (
            <article className="chat-route-card" key={target.modelName}>
              <div>
                <strong>{target.modelName}</strong>
                <small>{target.endpoint}</small>
              </div>
              <span>
                <Zap size={13} />
                {formatSpeed(target.tokensPerSecond)}
              </span>
              <button
                aria-label={`Remove ${target.modelName}`}
                onClick={() => removeModel(target.modelName)}
                type="button"
              >
                <X size={14} />
              </button>
            </article>
          ))}
        </div>
        <p className="chat-routing-note">
          Each selected model runs on a different server. The route favors the fastest
          successful benchmark for the complete comparison.
        </p>

        <label className="chat-prompt">
          <span>Message</span>
          <textarea
            maxLength={20_000}
            onChange={(event) => {
              setPrompt(event.target.value)
              setNotice(undefined)
            }}
            placeholder="Ask every selected model the same thing…"
            rows={6}
            value={prompt}
          />
        </label>
        <div className="chat-send-row">
          <small>{prompt.length.toLocaleString()} / 20,000</small>
          <button
            className="button primary"
            disabled={sending || !prompt.trim() || !route}
            onClick={() => void send()}
            type="button"
          >
            <Send size={14} />
            {sending
              ? `Waiting for ${selectedModelNames.length} model${selectedModelNames.length === 1 ? '' : 's'}…`
              : selectedModelNames.length === 1
                ? 'Send'
                : `Send to ${selectedModelNames.length} models`}
          </button>
        </div>
      </section>

      {notice ? (
        <div className="notice warning chat-notice">
          <CircleAlert size={15} />
          {notice}
        </div>
      ) : null}

      {response ? (
        <section className={`chat-results ${response.results.length === 1 ? 'single' : ''}`}>
          {response.results.map((result) => (
            <article className="panel chat-result-card" key={`${result.serverId}:${result.modelName}`}>
              <header>
                <div>
                  <strong>{result.modelName}</strong>
                  <small>{result.endpoint}</small>
                </div>
                <span>
                  <Clock3 size={13} />
                  {formatDuration(result.elapsedMs)}
                </span>
              </header>
              {result.content ? (
                <p>{result.content}</p>
              ) : (
                <div className="chat-result-error">
                  <CircleAlert size={16} />
                  <span>
                    <strong>Model did not answer</strong>
                    <small>{result.errorMessage || result.errorCode || 'Unknown error'}</small>
                  </span>
                </div>
              )}
            </article>
          ))}
        </section>
      ) : null}
    </div>
  )
}
