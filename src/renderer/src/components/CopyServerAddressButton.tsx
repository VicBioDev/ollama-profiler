import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

interface CopyServerAddressButtonProps {
  readonly endpoint: string
  readonly showLabel?: boolean
}

const COPIED_FEEDBACK_MS = 1_600
type CopyState = 'idle' | 'copied' | 'failed'

export function CopyServerAddressButton({
  endpoint,
  showLabel = false
}: Readonly<CopyServerAddressButtonProps>): React.JSX.Element {
  const [copyState, setCopyState] = useState<CopyState>('idle')

  useEffect(() => {
    if (copyState === 'idle') return undefined
    const timeout = window.setTimeout(() => setCopyState('idle'), COPIED_FEEDBACK_MS)
    return () => window.clearTimeout(timeout)
  }, [copyState])

  const copyEndpoint = async (): Promise<void> => {
    try {
      await window.ollamaProfiler.writeClipboardText(endpoint)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const label =
    copyState === 'copied'
      ? 'Server address copied'
      : copyState === 'failed'
        ? 'Could not copy server address'
        : 'Copy server address'

  return (
    <button
      aria-label={`${label}: ${endpoint}`}
      className={`copy-address-button${showLabel ? ' labeled' : ''}${copyState === 'copied' ? ' copied' : ''}${copyState === 'failed' ? ' failed' : ''}`}
      onClick={(event) => {
        event.stopPropagation()
        void copyEndpoint()
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      title={label}
      type="button"
    >
      {copyState === 'copied' ? (
        <Check aria-hidden="true" size={14} />
      ) : (
        <Copy aria-hidden="true" size={14} />
      )}
      {showLabel ? (
        <span>
          {copyState === 'copied'
            ? 'Copied'
            : copyState === 'failed'
              ? 'Copy failed'
              : 'Copy address'}
        </span>
      ) : null}
    </button>
  )
}
