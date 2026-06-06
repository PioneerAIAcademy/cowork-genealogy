import styles from './Pill.module.css'

interface PillProps {
  label: string
  tone?: 'primary' | 'matched'
}

// Shared small badge for PRIMARY (every record card) and MATCHED (when an
// assertion's "View in record" link opened the sidecar to a specific person).
export default function Pill({ label, tone = 'primary' }: PillProps): React.JSX.Element {
  return <span className={`${styles.pill} ${styles[tone]}`}>{label}</span>
}
