import Markdown from 'react-markdown'
import { useResearchData } from '../../contexts/ResearchDataContext'
import type { Question } from '../../lib/schema'
import Card from '../shared/Card'
import StatusBadge from '../shared/StatusBadge'
import CrossLink from '../shared/CrossLink'
import styles from './ProofSummariesSection.module.css'

export default function ProofSummariesSection(): React.JSX.Element {
  const { research, getById } = useResearchData()
  const items = research?.proof_summaries ?? []

  if (items.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Proof Summaries</h2>
        <p className={styles.empty}>No proof summaries recorded.</p>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Proof Summaries</h2>
      {items.map((ps) => {
        const questionEntry = getById(ps.question_id)
        const question = questionEntry?.item as Question | undefined
        const title = question?.question ?? ps.question_id

        return (
          <Card
            key={ps.id}
            id={ps.id}
            title={title}
            badges={
              <>
                <StatusBadge value={ps.tier} />
                <StatusBadge value={ps.vehicle} />
              </>
            }
            summary={ps.exhaustive_search_summary}
            rawData={ps}
            footer={
              <div className={styles.footer}>
                {ps.supporting_assertion_ids.length > 0 && (
                  <>
                    <span className={styles.footerLabel}>Assertions:</span>
                    {ps.supporting_assertion_ids.map((aid) => (
                      <CrossLink key={aid} id={aid} />
                    ))}
                  </>
                )}
                {ps.resolved_conflict_ids.length > 0 && (
                  <>
                    <span className={styles.footerLabel}>Resolved conflicts:</span>
                    {ps.resolved_conflict_ids.map((cid) => (
                      <CrossLink key={cid} id={cid} />
                    ))}
                  </>
                )}
              </div>
            }
          >
            <div className={styles.body}>
              <div className={styles.narrative}>
                <Markdown>{ps.narrative_markdown}</Markdown>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
