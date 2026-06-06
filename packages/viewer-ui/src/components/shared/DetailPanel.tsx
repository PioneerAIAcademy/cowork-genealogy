import styles from './DetailPanel.module.css'

interface DetailPanelProps {
  data: unknown
}

export default function DetailPanel({ data }: DetailPanelProps): React.JSX.Element {
  return (
    <div className={styles.panel}>
      <div className={styles.label}>JSON</div>
      <pre className={styles.code}>{JSON.stringify(data, null, 2)}</pre>
    </div>
  )
}
