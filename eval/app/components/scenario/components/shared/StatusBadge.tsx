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
  // Record basis. The map is keyed on the VALUE, not the field, so `absent`
  // needs its own entry: before the rename `negative` only rendered red by
  // colliding with log_outcome's `negative` above, and nothing would have
  // caught all three evidence badges silently turning gray.
  stated: 'green',
  inferred: 'amber',
  absent: 'gray',
  // Proof shortfall — why a conclusion is not higher. `gap` and `conflict` are
  // the two a researcher can act on, so they carry the warning colours.
  ceiling: 'blue',
  gap: 'amber',
  conflict: 'red',
  none: 'gray',
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
