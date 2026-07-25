import { Save, Shield, Workflow } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'

interface SettingsPageProps {
  readonly settings: AppSettings
  readonly busy: boolean
  readonly onSaveSettings: (settings: Partial<AppSettings>) => Promise<void>
}

type EditableNumberKey =
  | 'scanConcurrency'
  | 'benchmarkConcurrency'
  | 'requestTimeoutMs'
  | 'benchmarkTimeoutMs'
  | 'benchmarkNumPredict'

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
          <div className="form-grid two-columns">
            <label>
              <span>Parallel inventory scans</span>
              <input
                max={32}
                min={1}
                onBlur={() => restoreEmptyNumber('scanConcurrency')}
                onChange={(event) =>
                  updateNumber('scanConcurrency', event.target.value)
                }
                type="number"
                value={draft.scanConcurrency}
              />
            </label>
            <label>
              <span>Parallel server benchmarks</span>
              <input
                max={16}
                min={1}
                onBlur={() => restoreEmptyNumber('benchmarkConcurrency')}
                onChange={(event) =>
                  updateNumber('benchmarkConcurrency', event.target.value)
                }
                type="number"
                value={draft.benchmarkConcurrency}
              />
            </label>
            <p className="form-note">
              Models on the same server always benchmark one at a time, regardless of these
              values.
            </p>
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
    scanConcurrency: String(settings.scanConcurrency),
    benchmarkConcurrency: String(settings.benchmarkConcurrency),
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
    scanConcurrency: parseDraftNumber(draft.scanConcurrency, fallback.scanConcurrency),
    benchmarkConcurrency: parseDraftNumber(
      draft.benchmarkConcurrency,
      fallback.benchmarkConcurrency
    ),
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
