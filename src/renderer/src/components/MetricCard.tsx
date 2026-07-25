import type { LucideIcon } from 'lucide-react'

interface MetricCardProps {
  readonly label: string
  readonly value: string
  readonly detail: string
  readonly icon: LucideIcon
  readonly tone?: 'default' | 'accent' | 'warning'
}

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'default'
}: Readonly<MetricCardProps>): React.JSX.Element {
  return (
    <article className={`metric-card tone-${tone}`}>
      <span className="metric-icon">
        <Icon size={16} />
      </span>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}
