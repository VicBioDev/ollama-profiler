import {
  ArrowLeft,
  Clock3,
  Cloud,
  Gauge,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import type { ServerRecord } from '@shared/types'
import {
  isBenchmarkableLocalModel,
  isCloudModelName
} from '@shared/model-utils'
import {
  formatDate,
  formatDuration,
  formatSpeed,
  installedModels,
  latestAttempt,
  latestSuccess
} from '../utils/format'
import { CopyServerAddressButton } from '../components/CopyServerAddressButton'
import { StatusBadge } from '../components/StatusBadge'

interface ServerDetailPageProps {
  readonly server: ServerRecord
  readonly onBack: () => void
  readonly onApprovalChange: (approved: boolean) => void
  readonly onRemove: () => void
}

export function ServerDetailPage({
  server,
  onBack,
  onApprovalChange,
  onRemove
}: Readonly<ServerDetailPageProps>): React.JSX.Element {
  const models = installedModels(server)
  const completionModels = models.filter(isBenchmarkableLocalModel)

  return (
    <div className="page-content">
      <button className="text-button back-button" onClick={onBack} type="button">
        <ArrowLeft size={15} />
        Back to servers
      </button>
      <header className="detail-hero">
        <div>
          <div className="detail-state">
            <StatusBadge status={server.status} />
            <span>{server.ollamaVersion ? `Ollama ${server.ollamaVersion}` : 'Version unknown'}</span>
          </div>
          <div className="detail-endpoint">
            <h1>{server.endpoint}</h1>
            <CopyServerAddressButton endpoint={server.endpoint} showLabel />
          </div>
          <p>{[server.city, server.region, server.country].filter(Boolean).join(', ') || server.source}</p>
        </div>
      </header>

      <section className="fact-strip">
        <div>
          <span>Last online</span>
          <strong>{formatDate(server.lastOnlineAt)}</strong>
        </div>
        <div>
          <span>Installed models</span>
          <strong>{models.length}</strong>
        </div>
        <div>
          <span>Source</span>
          <strong>{server.source}</strong>
        </div>
        <div>
          <span>Organization</span>
          <strong>{server.organization || '—'}</strong>
        </div>
      </section>

      {completionModels.length > 0 ? (
        <section className="permission-panel">
          <div>
            <ShieldCheck size={18} />
            <span>
              <strong>
                {server.benchmarkApproved
                  ? 'Generation benchmarks enabled'
                  : 'Allow generation benchmarks?'}
              </strong>
              <small>
                {server.benchmarkApproved
                  ? `${completionModels.length} compatible model${completionModels.length === 1 ? '' : 's'} will be included the next time Scan & benchmark all runs.`
                  : 'Enable only for a server you own or are authorized to profile.'}
              </small>
            </span>
          </div>
          <label className="switch">
            <input
              checked={server.benchmarkApproved}
              onChange={(event) => onApprovalChange(event.target.checked)}
              type="checkbox"
            />
            <span />
          </label>
        </section>
      ) : null}

      <section className="panel models-panel">
        <header className="panel-heading">
          <div>
            <span className="eyebrow">MODEL PROFILE</span>
            <h2>Installed models</h2>
          </div>
          <span className="panel-count">{models.length}</span>
        </header>
        <div className="model-list">
          {models.map((model) => {
            const attempt = latestAttempt(model)
            const success = latestSuccess(model)
            const supportsCompletion = model.capabilities.includes('completion')
            const isCloudModel = isCloudModelName(model.name)
            return (
              <article className="model-row" key={model.id}>
                <div className="model-name">
                  <strong>{model.name}</strong>
                  <span>
                    {[model.parameterSize, model.quantization, model.family]
                      .filter(Boolean)
                      .map((value) => (
                        <small key={value}>{value}</small>
                      ))}
                  </span>
                </div>
                <div className="model-capabilities">
                  {model.capabilities.length > 0
                    ? model.capabilities.map((capability) => (
                        <span key={capability}>{capability}</span>
                      ))
                    : <span>unknown</span>}
                </div>
                <div className="model-result">
                  {isCloudModel ? (
                    <span className="model-skip-reason">
                      <Cloud size={14} />
                      Cloud model · skipped
                      <small>requires Ollama sign-in</small>
                    </span>
                  ) : !supportsCompletion ? (
                    <span className="muted-text">Embedding only · no generation test</span>
                  ) : success ? (
                    <>
                      <div className="model-metric">
                        <Gauge size={14} />
                        <span>
                          <strong>{formatSpeed(success.tokensPerSecond)}</strong>
                          <small>latest success</small>
                        </span>
                      </div>
                      <div className="model-metric">
                        <Clock3 size={14} />
                        <span>
                          <strong>{formatDuration(success.ttftMs)}</strong>
                          <small>first token</small>
                        </span>
                      </div>
                      {attempt ? (
                        <div className="model-attempt">
                          <StatusBadge status={attempt.status} />
                          <small>{formatDate(attempt.finishedAt)}</small>
                          {attempt.status === 'failed' ? <p>{attempt.errorMessage}</p> : null}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <span className="muted-text">
                      {server.benchmarkApproved ? 'Ready to test' : 'Not tested'}
                    </span>
                  )}
                </div>
              </article>
            )
          })}
          {models.length === 0 ? (
            <p className="quiet-copy padded-copy">
              Run Scan &amp; benchmark all to load this server’s model inventory.
            </p>
          ) : null}
        </div>
      </section>

      <footer className="danger-zone">
        <div>
          <strong>Remove this server</strong>
          <small>This removes its local inventory and benchmark history.</small>
        </div>
        <button className="button danger" onClick={onRemove} type="button">
          <Trash2 size={14} />
          Remove
        </button>
      </footer>
    </div>
  )
}
