import { AlertTriangle, CheckCircle2, FileSearch } from 'lucide-react'
import type { ImportPreview } from '@shared/types'

interface ImportPreviewCardProps {
  readonly preview: ImportPreview
  readonly approved: boolean
  readonly busy: boolean
  readonly onApprovedChange: (approved: boolean) => void
  readonly onCommit: () => void
  readonly onClear: () => void
}

export function ImportPreviewCard({
  preview,
  approved,
  busy,
  onApprovedChange,
  onCommit,
  onClear
}: Readonly<ImportPreviewCardProps>): React.JSX.Element {
  return (
    <section className="panel import-preview">
      <header className="panel-heading">
        <div>
          <span className="eyebrow">PREVIEW</span>
          <h2>{preview.filename}</h2>
        </div>
        <span className="provider-badge">{preview.provider}</span>
      </header>
      <div className="import-metrics">
        <div>
          <span>Total rows</span>
          <strong>{preview.totalRows}</strong>
        </div>
        <div>
          <span>Valid</span>
          <strong>{preview.validRows}</strong>
        </div>
        <div>
          <span>Duplicates</span>
          <strong>{preview.duplicateRows}</strong>
        </div>
        <div>
          <span>Invalid</span>
          <strong>{preview.invalidRows}</strong>
        </div>
      </div>
      <div className="preview-list">
        {preview.candidates.slice(0, 8).map((candidate) => (
          <div key={candidate.endpoint}>
            <CheckCircle2 size={14} />
            <code>{candidate.endpoint}</code>
            <span>{candidate.country || candidate.source}</span>
          </div>
        ))}
        {preview.validRows > 8 ? (
          <small className="preview-more">+ {preview.validRows - 8} more valid endpoints</small>
        ) : null}
      </div>
      {preview.issues.length > 0 ? (
        <details className="issue-list">
          <summary>
            <AlertTriangle size={14} />
            {preview.invalidRows} invalid rows
          </summary>
          {preview.issues.slice(0, 8).map((issue) => (
            <p key={`${issue.row}-${issue.message}`}>
              Row {issue.row}: {issue.message}
            </p>
          ))}
        </details>
      ) : null}
      <label className="permission-check">
        <input
          checked={approved}
          onChange={(event) => onApprovedChange(event.target.checked)}
          type="checkbox"
        />
        <span>
          <strong>I own or have permission to benchmark these servers</strong>
          <small>
            After the read-only inventory scan, completion models will be tested serially per
            server. Different servers run in parallel.
          </small>
        </span>
      </label>
      <footer className="panel-actions">
        <button className="button ghost" disabled={busy} onClick={onClear} type="button">
          Cancel
        </button>
        <button
          className="button primary"
          disabled={busy || preview.validRows === 0}
          onClick={onCommit}
          type="button"
        >
          <FileSearch size={15} />
          Import and scan
        </button>
      </footer>
    </section>
  )
}
