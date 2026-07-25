import { FileUp } from 'lucide-react'
import { useState } from 'react'
import type { ImportPreview } from '@shared/types'
import { ImportPreviewCard } from '../components/ImportPreviewCard'

interface ImportPageProps {
  readonly busy: boolean
  readonly onSelectFile: () => Promise<ImportPreview | null>
  readonly onPreviewText: (contents: string) => Promise<ImportPreview>
  readonly onCommit: (
    previewId: string,
    approved: boolean
  ) => Promise<{ added: number; updated: number }>
}

export function ImportPage({
  busy,
  onSelectFile,
  onPreviewText,
  onCommit
}: Readonly<ImportPageProps>): React.JSX.Element {
  const [preview, setPreview] = useState<ImportPreview>()
  const [approved, setApproved] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [showPaste, setShowPaste] = useState(false)
  const [pastedEndpoints, setPastedEndpoints] = useState('')

  const selectFile = async (): Promise<void> => {
    const selected = await onSelectFile()
    if (selected) {
      setPreview(selected)
      setNotice(undefined)
    }
  }

  const previewPastedEndpoints = async (): Promise<void> => {
    const result = await onPreviewText(pastedEndpoints)
    setPreview(result)
    setNotice(undefined)
  }

  const commit = async (): Promise<void> => {
    if (!preview) return
    const result = await onCommit(preview.id, approved)
    setNotice(`Imported ${result.added} new and refreshed ${result.updated} existing servers.`)
    setPreview(undefined)
    setApproved(false)
  }

  return (
    <div className="page-content">
      <header className="section-title">
        <div>
          <span className="eyebrow">DISCOVERY INPUT</span>
          <h1>Import endpoints</h1>
          <p>Bring your own fleet list or asset-search export. Nothing is uploaded elsewhere.</p>
        </div>
      </header>
      {notice ? <div className="notice success">{notice}</div> : null}
      <section className="import-source-grid">
        <article className="source-card">
          <span className="source-icon">
            <FileUp size={20} />
          </span>
          <div>
            <span className="eyebrow">FILE IMPORT</span>
            <h2>FOFA, Shodan, or endpoint list</h2>
            <p>
              Supports Shodan <code>.json.gz</code>, JSON, CSV, TSV, and text.
              Provider and location fields are read only from the selected file.
            </p>
          </div>
          {showPaste ? (
            <div className="paste-editor">
              <textarea
                autoFocus
                onChange={(event) => setPastedEndpoints(event.target.value)}
                placeholder={'http://192.168.1.20:11434\nollama.example.com:11434'}
                rows={5}
                value={pastedEndpoints}
              />
              <div className="source-actions">
                <button
                  className="button primary"
                  disabled={busy || !pastedEndpoints.trim()}
                  onClick={previewPastedEndpoints}
                  type="button"
                >
                  Preview endpoints
                </button>
                <button
                  className="button ghost"
                  onClick={() => setShowPaste(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="source-actions">
              <button className="button primary" disabled={busy} onClick={selectFile} type="button">
                Choose file
              </button>
              <button className="button secondary" onClick={() => setShowPaste(true)} type="button">
                Paste endpoints
              </button>
            </div>
          )}
        </article>
      </section>
      {preview ? (
        <ImportPreviewCard
          approved={approved}
          busy={busy}
          onApprovedChange={setApproved}
          onClear={() => setPreview(undefined)}
          onCommit={commit}
          preview={preview}
        />
      ) : null}
    </div>
  )
}
