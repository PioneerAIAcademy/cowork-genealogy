import { useMemo } from 'react'
import { useResearchData } from '../../contexts/ResearchDataContext'
import { inferProgress } from '../../lib/progress'
import styles from './ProgressPipeline.module.css'

export default function ProgressPipeline(): React.JSX.Element | null {
  const { research, activeSection, setActiveSection } = useResearchData()

  const stages = useMemo(() => {
    if (!research) return null
    return inferProgress(research)
  }, [research])

  if (!stages) return null

  return (
    <nav className={styles.pipeline} aria-label="Research progress — jump to a stage">
      {stages.map((stage, i) => {
        // Status, not control: a click NAVIGATES the rail to the section that
        // stage produced — it never re-runs the agent. Pending stages have no
        // artifacts yet, so they're disabled rather than landing on an empty view.
        const navigable = stage.status !== 'pending'
        const current = activeSection === stage.section
        return (
          <div key={stage.name} className={styles.stageWrapper}>
            {i > 0 && <div className={`${styles.connector} ${styles[stage.status]}`} />}
            <button
              type="button"
              className={`${styles.stage} ${styles[stage.status]} ${current ? styles.current : ''}`}
              disabled={!navigable}
              aria-current={current ? 'page' : undefined}
              onClick={navigable ? () => setActiveSection(stage.section) : undefined}
              title={navigable ? `Go to ${stage.label}` : `${stage.label} — not started yet`}
              aria-label={navigable ? `Go to ${stage.label}` : `${stage.label}, not started yet`}
            >
              <span className={styles.dot} />
              <span className={styles.label}>{stage.label}</span>
            </button>
          </div>
        )
      })}
    </nav>
  )
}
