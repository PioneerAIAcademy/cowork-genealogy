import { useResearchData } from '../../contexts/ResearchDataContext'
import Card from '../shared/Card'
import StatusBadge from '../shared/StatusBadge'
import CrossLink from '../shared/CrossLink'
import styles from './HypothesesSection.module.css'

export default function HypothesesSection(): React.JSX.Element {
  const { research } = useResearchData()
  const items = research?.hypotheses ?? []

  if (items.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Hypotheses</h2>
        <p className={styles.empty}>No hypotheses recorded.</p>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Hypotheses</h2>
      {items.map((hyp) => {
        const supportCount = hyp.supporting_assertion_ids.length
        const contradictCount = hyp.contradicting_assertion_ids.length
        const summaryText = `${supportCount} supporting, ${contradictCount} contradicting`

        return (
          <Card
            key={hyp.id}
            id={hyp.id}
            title={hyp.claim}
            badges={<StatusBadge value={hyp.status} />}
            summary={summaryText}
            rawData={hyp}
            footer={
              hyp.related_question_ids.length > 0 ? (
                <div className={styles.footer}>
                  <span className={styles.footerLabel}>Related questions:</span>
                  {hyp.related_question_ids.map((qid) => (
                    <CrossLink key={qid} id={qid} />
                  ))}
                </div>
              ) : undefined
            }
          >
            <div className={styles.body}>
              {hyp.supporting_assertion_ids.length > 0 && (
                <div className={styles.subsection}>
                  <div className={styles.subLabel}>Supporting Assertions</div>
                  <div className={styles.linkList}>
                    {hyp.supporting_assertion_ids.map((aid) => (
                      <CrossLink key={aid} id={aid} />
                    ))}
                  </div>
                </div>
              )}

              {hyp.contradicting_assertion_ids.length > 0 && (
                <div className={styles.subsection}>
                  <div className={styles.subLabel}>Contradicting Assertions</div>
                  <div className={styles.linkList}>
                    {hyp.contradicting_assertion_ids.map((aid) => (
                      <CrossLink key={aid} id={aid} />
                    ))}
                  </div>
                </div>
              )}

              {hyp.ruled_out_reason && (
                <div className={styles.subsection}>
                  <div className={styles.subLabel}>Ruled Out Reason</div>
                  <p className={styles.text}>{hyp.ruled_out_reason}</p>
                </div>
              )}

              {hyp.notes && (
                <div className={styles.subsection}>
                  <div className={styles.subLabel}>Notes</div>
                  <p className={styles.text}>{hyp.notes}</p>
                </div>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
