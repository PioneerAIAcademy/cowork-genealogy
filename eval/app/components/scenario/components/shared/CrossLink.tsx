import styles from './CrossLink.module.css'

interface CrossLinkProps {
  id: string
  label?: string
}

// In the desktop app this navigated between sections. In the eval scoring
// viewer the scenario is shown as one read-only stack, so cross-links are
// rendered as plain inline references (the id, or a supplied label). Kept
// as a component so the lifted sections need no edits; re-enabling
// navigation later only touches this file.
export default function CrossLink({ id, label }: CrossLinkProps): React.JSX.Element {
  return (
    <span className={styles.crossLink} title={id}>
      {label ?? id}
    </span>
  )
}
