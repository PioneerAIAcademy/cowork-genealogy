import styles from './StatusBadge.module.css'

type BadgeColor = 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'purple'

const statusColorMap: Record<string, BadgeColor> = {
  // Question status
  open: 'gray',
  in_progress: 'amber',
  exhaustive_declared: 'blue',
  resolved: 'green',
  // Plan status
  active: 'amber',
  completed: 'green',
  superseded: 'gray',
  // Plan item status
  planned: 'gray',
  skipped: 'gray',
  // Log outcome
  positive: 'green',
  negative: 'red',
  partial: 'amber',
  error: 'red',
  // Source classification
  original: 'green',
  derivative: 'amber',
  authored: 'gray',
  // Information quality
  primary: 'green',
  secondary: 'amber',
  indeterminate: 'gray',
  // Evidence type
  direct: 'green',
  indirect: 'amber',
  // Conflict status
  unresolved: 'red',
  moot: 'gray',
  // Hypothesis status
  supported: 'green',
  ruled_out: 'red',
  // Proof tier
  proved: 'green',
  probable: 'blue',
  possible: 'amber',
  not_proved: 'gray',
  disproved: 'red',
  // Person evidence confidence
  confident: 'green',
  speculative: 'red',
  // Conflict type
  fact: 'purple',
  identity: 'blue',
  // Priority
  high: 'red',
  medium: 'amber',
  low: 'gray'
}

interface StatusBadgeProps {
  value: string
  color?: BadgeColor
}

export default function StatusBadge({ value, color }: StatusBadgeProps): React.JSX.Element {
  const resolvedColor = color ?? statusColorMap[value] ?? 'gray'
  return (
    <span className={`${styles.badge} ${styles[resolvedColor]}`}>{value.replace(/_/g, ' ')}</span>
  )
}
