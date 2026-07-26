import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

interface CopyServerAddressButtonProps {
  readonly endpoint: string
  readonly showLabel?: boolean
}

const COPIED_FEEDBACK_MS = 1_600

export function CopyServerAddressButton({
  endpoint,
  showLabel = false
}: Readonly<CopyServerAddressButtonProps>): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return undefined
    const timeout = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
    return () => window.clearTimeout(timeout)
  }, [copied])

  const copyEndpoint = async (): Promise<void> => {
    await navigator.clipboard.writeText(endpoint)
    setCopied(true)
  }

  const label = copied ? 'Server address copied' : 'Copy server address'

  return (
    <button
      aria-label={`${label}: ${endpoint}`}
      className={`copy-address-button${showLabel ? ' labeled' : ''}${copied ? ' copied' : ''}`}
      onClick={(event) => {
        event.stopPropagation()
        void copyEndpoint().catch(() => undefined)
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      title={label}
      type="button"
    >
      {copied ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
      {showLabel ? <span>{copied ? 'Copied' : 'Copy address'}</span> : null}
    </button>
  )
}
