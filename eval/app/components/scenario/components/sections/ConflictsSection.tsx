import { useResearchData } from '../../contexts/ResearchDataContext'
import type { Assertion } from '../../lib/schema'
import Card from '../shared/Card'
import StatusBadge from '../shared/StatusBadge'
import CrossLink from '../shared/CrossLink'
import styles from './ConflictsSection.module.css'

export default function ConflictsSection(): React.JSX.Element {
  const { research, getById } = useResearchData()
  const items = research?.conflicts ?? []

  if (items.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Conflicts</h2>
        <p className={styles.empty}>No conflicts recorded.</p>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Conflicts</h2>
      {items.map((conflict) => {
        const summaryText =
          conflict.conflict_type === 'fact'
            ? conflict.disputed_attribute
            : conflict.identity_question

        return (
          <Card
            key={conflict.id}
            id={conflict.id}
            title={conflict.description}
            className={conflict.status === 'unresolved' ? styles.unresolved : undefined}
            badges={
              <>
                <StatusBadge value={conflict.status} />
                <StatusBadge value={conflict.conflict_type} />
              </>
            }
            summary={summaryText}
            rawData={conflict}
            footer={
              conflict.blocks_question_ids.length > 0 ? (
                <div className={styles.footer}>
                  <span className={styles.footerLabel}>Blocks:</span>
                  {conflict.blocks_question_ids.map((qid) => (
                    <CrossLink key={qid} id={qid} />
                  ))}
                </div>
              ) : undefined
            }
          >
            <div className={styles.body}>
              {conflict.competing_assertion_ids.length > 0 && (
                <div className={styles.subsection}>
                  <div className={styles.subLabel}>Competing Assertions</div>
                  <ul className={styles.assertionList}>
                    {conflict.competing_assertion_ids.map((aid) => {
                      const entry = getById(aid)
                      const assertion = entry?.item as Assertion | undefined
                      const isPreferred = conflict.preferred_assertion_id === aid
                      return (
                        <li
                          key={aid}
                          className={`${styles.assertionItem} ${isPreferred ? styles.preferred : ''}`}
                        >
                          <span className={styles.assertionText}>
                            {assertion ? `${assertion.fact_type}: ${assertion.value}` : aid}
                          </span>
                          {isPreferred && <span className={styles.preferredBadge}>Preferred</span>}
                          <CrossLink id={aid} label="View" />
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {conflict.independence_analysis && (
                <div className={styles.subsection}>
                  <div className={styles.subLabel}>Independence Analysis</div>
                  <p className={styles.analysis}>{conflict.independence_analysis}</p>
                </div>
              )}

              {conflict.weighing_analysis && (
                <div className={styles.subsection}>
                  <div className={styles.subLabel}>Weighing Analysis</div>
                  <p className={styles.analysis}>{conflict.weighing_analysis}</p>
                </div>
              )}

              {conflict.resolution_rationale && (
                <div className={styles.subsection}>
                  <div className={styles.subLabel}>Resolution Rationale</div>
                  <p className={styles.analysis}>{conflict.resolution_rationale}</p>
                </div>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
