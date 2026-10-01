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

  // gps-mentor verdicts (#1223). Without these every verdict renders gray, so
  // "this proof needs work before it stands" looks the same as "looks solid".
  looks_solid: 'green',
  consider_addressing: 'amber',
  address_first: 'red',
  refused: 'gray',
  // Plan item status
  planned: 'gray',
  skipped: 'gray',
  // Skip category (#1830) — why a skipped item was skipped. Amber is reserved
  // for the three a reader can still act on: a human can often open what an
  // autonomous run cannot, and `premise_invalidated` says the PLAN wants
  // revising rather than this item dropping. The settled four are gray.
  inaccessible: 'amber',
  no_coverage: 'amber',
  premise_invalidated: 'amber',
  answered: 'gray',
  fallback_not_triggered: 'gray',
  out_of_scope: 'gray',
  user_declined: 'gray',
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
  // the two a researcher can act on, so they carry the warning colors.
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
  // Known-holding confidence (confident reuses the green above)
  unsure: 'amber',
  // Conflict type
  fact: 'purple',
  identity: 'blue',
  // Priority
  high: 'red',
  medium: 'amber',
  low: 'gray'
}

// What the researcher reads, keyed on the stored VALUE like the color map. A value
// with no entry renders with underscores as spaces. Display vocabulary:
// docs/specs/research-schema-spec.md §5.11.
const statusLabelMap: Record<string, string> = {
  exhaustive_declared: 'all reachable searched',
  original: 'Record image',
  derivative: 'Index or transcript',
  authored: 'Compiled work',
  ceiling: 'limit of online records',
  gap: 'evidence missing',
  conflict: 'conflicting evidence',
  // Proof tier; `probable` is also a person-evidence confidence, "likely" in both.
  proved: 'well established',
  probable: 'likely',
  possible: 'tentative',
  not_proved: 'not established',
  disproved: 'ruled out',
  // Skip category (#1830). The stored values are written for the gate; these
  // are what a researcher reads.
  answered: 'already answered',
  inaccessible: 'could not be reached',
  no_coverage: 'not covered by the repository',
  fallback_not_triggered: 'fallback not needed',
  out_of_scope: 'belongs to another question',
  premise_invalidated: 'the plan assumption was wrong',
  user_declined: 'declined by the researcher'
}

interface StatusBadgeProps {
  value?: string | null
  color?: BadgeColor
}

export default function StatusBadge({ value, color }: StatusBadgeProps): React.JSX.Element | null {
  if (value == null) return null
  const resolvedColor = color ?? statusColorMap[value] ?? 'gray'
  return (
    <span className={`${styles.badge} ${styles[resolvedColor]}`}>{statusLabelMap[value] ?? value.replace(/_/g, ' ')}</span>
  )
}
