import { MessageSquareText, Save, Shield, Workflow } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'

const CONCURRENCY_OPTIONS = [2, 4, 8, 16, 32] as const

interface SettingsPageProps {
  readonly settings: AppSettings
  readonly busy: boolean
  readonly onSaveSettings: (settings: Partial<AppSettings>) => Promise<void>
}

type EditableNumberKey =
  | 'requestTimeoutMs'
  | 'benchmarkTimeoutMs'
  | 'benchmarkNumPredict'

type ConcurrencyKey = 'scanConcurrency' | 'benchmarkConcurrency'

type SettingsDraft = Omit<AppSettings, EditableNumberKey> &
  Record<EditableNumberKey, string>

export function SettingsPage({
  settings,
  busy,
  onSaveSettings
}: Readonly<SettingsPageProps>): React.JSX.Element {
  const [draft, setDraft] = useState(() => createSettingsDraft(settings))
  const [notice, setNotice] = useState<string>()

  useEffect(
    () => setDraft(createSettingsDraft(settings)),
    [
      settings.allowPrivateNetworks,
      settings.benchmarkConcurrency,
      settings.benchmarkMinTokens,
      settings.benchmarkNumPredict,
      settings.benchmarkPrompt,
      settings.benchmarkTimeoutMs,
      settings.connectTimeoutMs,
      settings.maxResponseBytes,
      settings.requestTimeoutMs,
      settings.scanConcurrency
    ]
  )

  const updateNumber = (key: EditableNumberKey, value: string): void => {
    setNotice(undefined)
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const updateConcurrency = (key: ConcurrencyKey, value: number): void => {
    setNotice(undefined)
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const updatePrompt = (value: string): void => {
    setNotice(undefined)
    setDraft((current) => ({ ...current, benchmarkPrompt: value }))
  }

  const restoreEmptyNumber = (key: EditableNumberKey): void => {
    setDraft((current) =>
      current[key].trim()
        ? current
        : { ...current, [key]: String(settings[key]) }
    )
  }

  const saveSettings = async (): Promise<void> => {
    await onSaveSettings(parseSettingsDraft(draft, settings))
    setNotice('Profiler settings saved.')
  }

  return (
    <div className="page-content">
      <header className="section-title">
        <div>
          <span className="eyebrow">LOCAL CONFIGURATION</span>
          <h1>Settings</h1>
          <p>Concurrency is global; every individual server remains strictly serial.</p>
        </div>
      </header>
      {notice ? <div className="notice success">{notice}</div> : null}

      <section className="settings-grid">
        <article className="panel settings-card full-width">
          <header>
            <span className="settings-icon">
              <Workflow size={17} />
            </span>
            <div>
              <h2>Concurrency</h2>
              <p>Different servers can work in parallel.</p>
            </div>
          </header>
          <div className="form-grid concurrency-grid">
            <ConcurrencyPicker
              label="Parallel inventory scans"
              name="scanConcurrency"
              onChange={(value) => updateConcurrency('scanConcurrency', value)}
              value={draft.scanConcurrency}
            />
            <ConcurrencyPicker
              label="Parallel server benchmarks"
              name="benchmarkConcurrency"
              onChange={(value) => updateConcurrency('benchmarkConcurrency', value)}
              value={draft.benchmarkConcurrency}
            />
            <p className="form-note">
              Models on the same server always benchmark one at a time, regardless of these
              values.
            </p>
          </div>
        </article>

        <article className="panel settings-card full-width">
          <header>
            <span className="settings-icon">
              <MessageSquareText size={17} />
            </span>
            <div>
              <h2>Benchmark prompt</h2>
              <p>Use the same prompt for every model so their results stay comparable.</p>
            </div>
          </header>
          <div className="form-grid">
            <label className="benchmark-prompt-field">
              <span>Test prompt</span>
              <textarea
                maxLength={2_000}
                onChange={(event) => updatePrompt(event.target.value)}
                rows={5}
                value={draft.benchmarkPrompt}
              />
              <small>
                {draft.benchmarkPrompt.length.toLocaleString()} / 2,000 characters
              </small>
            </label>
          </div>
        </article>

        <article className="panel settings-card full-width">
          <header>
            <span className="settings-icon">
              <Shield size={17} />
            </span>
            <div>
              <h2>Network and benchmark limits</h2>
              <p>Conservative defaults protect remote and local fleets.</p>
            </div>
          </header>
          <div className="form-grid three-columns">
            <label>
              <span>Request timeout (ms)</span>
              <input
                min={2000}
                onBlur={() => restoreEmptyNumber('requestTimeoutMs')}
                onChange={(event) =>
                  updateNumber('requestTimeoutMs', event.target.value)
                }
                type="number"
                value={draft.requestTimeoutMs}
              />
            </label>
            <label>
              <span>Benchmark timeout (ms)</span>
              <input
                min={10000}
                onBlur={() => restoreEmptyNumber('benchmarkTimeoutMs')}
                onChange={(event) =>
                  updateNumber('benchmarkTimeoutMs', event.target.value)
                }
                type="number"
                value={draft.benchmarkTimeoutMs}
              />
            </label>
            <label>
              <span>Generated tokens</span>
              <input
                max={512}
                min={8}
                onBlur={() => restoreEmptyNumber('benchmarkNumPredict')}
                onChange={(event) =>
                  updateNumber('benchmarkNumPredict', event.target.value)
                }
                type="number"
                value={draft.benchmarkNumPredict}
              />
            </label>
            <label className="checkbox-row">
              <input
                checked={draft.allowPrivateNetworks}
                onChange={(event) =>
                  setDraft({ ...draft, allowPrivateNetworks: event.target.checked })
                }
                type="checkbox"
              />
              <span>
                <strong>Allow LAN and localhost servers</strong>
                <small>Cloud metadata, link-local, multicast, and redirects stay blocked.</small>
              </span>
            </label>
          </div>
        </article>
      </section>
      <div className="sticky-save">
        <button className="button primary" disabled={busy} onClick={saveSettings} type="button">
          <Save size={15} />
          Save settings
        </button>
      </div>
    </div>
  )
}

export function createSettingsDraft(settings: AppSettings): SettingsDraft {
  return {
    ...settings,
    requestTimeoutMs: String(settings.requestTimeoutMs),
    benchmarkTimeoutMs: String(settings.benchmarkTimeoutMs),
    benchmarkNumPredict: String(settings.benchmarkNumPredict)
  }
}

export function parseSettingsDraft(
  draft: SettingsDraft,
  fallback: AppSettings
): AppSettings {
  return {
    ...draft,
    requestTimeoutMs: parseDraftNumber(
      draft.requestTimeoutMs,
      fallback.requestTimeoutMs
    ),
    benchmarkTimeoutMs: parseDraftNumber(
      draft.benchmarkTimeoutMs,
      fallback.benchmarkTimeoutMs
    ),
    benchmarkNumPredict: parseDraftNumber(
      draft.benchmarkNumPredict,
      fallback.benchmarkNumPredict
    )
  }
}

function parseDraftNumber(value: string, fallback: number): number {
  if (!value.trim()) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

interface ConcurrencyPickerProps {
  readonly label: string
  readonly name: ConcurrencyKey
  readonly onChange: (value: number) => void
  readonly value: number
}

function ConcurrencyPicker({
  label,
  name,
  onChange,
  value
}: Readonly<ConcurrencyPickerProps>): React.JSX.Element {
  return (
    <fieldset className="concurrency-picker">
      <legend>{label}</legend>
      <div className="concurrency-options">
        {CONCURRENCY_OPTIONS.map((option) => (
          <label key={option}>
            <input
              checked={value === option}
              name={name}
              onChange={() => onChange(option)}
              type="radio"
              value={option}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
      <small>servers at once</small>
    </fieldset>
  )
}
