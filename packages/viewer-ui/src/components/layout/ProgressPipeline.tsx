import { useMemo } from 'react'
import { useResearchData } from '../../contexts/ResearchDataContext'
import { inferProgress } from '../../lib/progress'
import styles from './ProgressPipeline.module.css'

export default function ProgressPipeline(): React.JSX.Element | null {
  const { research } = useResearchData()

  const stages = useMemo(() => {
    if (!research) return null
    return inferProgress(research)
  }, [research])

  if (!stages) return null

  return (
    <div className={styles.pipeline}>
      {stages.map((stage, i) => (
        <div key={stage.name} className={styles.stageWrapper}>
          {i > 0 && <div className={`${styles.connector} ${styles[stage.status]}`} />}
          <div className={`${styles.stage} ${styles[stage.status]}`} title={stage.label}>
            <div className={styles.dot} />
            <span className={styles.label}>{stage.label}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
