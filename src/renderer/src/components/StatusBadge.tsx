interface StatusBadgeProps {
  readonly status: string
}

export function StatusBadge({ status }: Readonly<StatusBadgeProps>): React.JSX.Element {
  return <span className={`status-badge status-${status}`}>{status.replace('-', ' ')}</span>
}
