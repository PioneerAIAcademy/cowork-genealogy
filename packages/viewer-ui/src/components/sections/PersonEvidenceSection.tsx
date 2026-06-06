import { useResearchData } from '../../contexts/ResearchDataContext'
import type { Assertion, GedcomxPerson } from '../../lib/schema'
import { getPreferredName } from '../../lib/schema'
import Card from '../shared/Card'
import StatusBadge from '../shared/StatusBadge'
import CrossLink from '../shared/CrossLink'
import styles from './PersonEvidenceSection.module.css'

export default function PersonEvidenceSection(): React.JSX.Element {
  const { research, gedcomx, getById } = useResearchData()
  const items = research?.person_evidence ?? []

  if (items.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Person Evidence</h2>
        <p className={styles.empty}>No person evidence recorded.</p>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Person Evidence</h2>
      {items.map((pe) => {
        const person = gedcomx?.persons.find((p) => p.id === pe.person_id)
        const personName = person ? getPreferredName(person as GedcomxPerson) : pe.person_id

        const assertionEntry = getById(pe.assertion_id)
        const assertion = assertionEntry?.item as Assertion | undefined
        const assertionSummary = assertion
          ? `${assertion.fact_type}: ${assertion.value}`
          : pe.assertion_id

        const title = `${personName} — ${assertionSummary}`

        return (
          <Card
            key={pe.id}
            id={pe.id}
            title={title}
            badges={<StatusBadge value={pe.confidence} />}
            summary={pe.rationale}
            rawData={pe}
            footer={
              <div className={styles.footer}>
                <CrossLink id={pe.assertion_id} label="Assertion" />
                <CrossLink id={pe.person_id} label="Person" />
              </div>
            }
          >
            <div className={styles.body}>
              {pe.match_score !== null && (
                <div className={styles.detail}>
                  <span className={styles.label}>Match:</span> {Math.round(pe.match_score * 100)}%
                </div>
              )}
              <div className={styles.detail}>
                <span className={styles.label}>Created:</span> {pe.created}
              </div>
              {pe.superseded_by && (
                <div className={styles.superseded}>
                  Superseded by <CrossLink id={pe.superseded_by} />
                </div>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
