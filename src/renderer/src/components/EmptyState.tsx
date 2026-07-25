import { ServerOff } from 'lucide-react'

interface EmptyStateProps {
  readonly title: string
  readonly body: string
  readonly actionLabel?: string
  readonly onAction?: () => void
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction
}: Readonly<EmptyStateProps>): React.JSX.Element {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <ServerOff size={22} />
      </span>
      <strong>{title}</strong>
      <p>{body}</p>
      {actionLabel && onAction ? (
        <button className="button secondary compact" onClick={onAction} type="button">
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}
