import { useResearchData } from '../../contexts/ResearchDataContext'
import Card from '../shared/Card'
import CrossLink from '../shared/CrossLink'
import Linkify from '../shared/Linkify'
import styles from './RejectedLinksSection.module.css'

export default function RejectedLinksSection(): React.JSX.Element {
  const { research } = useResearchData()
  const items = research?.rejected_links ?? []

  if (items.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Rejected Links</h2>
        <p className={styles.empty}>
          No rejected links. A record the researcher says is not this person is recorded
          here during the person-evidence step, in the researcher&apos;s own words.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Rejected Links</h2>
      {items.map((rj) => (
        <Card
          key={rj.id}
          id={rj.id}
          title={rj.id}
          rawData={rj}
          // Always visible: a hedge read as a "no" must be seen without a click,
          // and a legacy row never falls back to `reason`.
          summary={
            rj.researcher_words ? (
              <q className={styles.quote}>{rj.researcher_words}</q>
            ) : (
              <span className={styles.missing}>
                Researcher&apos;s words not recorded (row predates the field)
              </span>
            )
          }
        >
          <div className={styles.body}>
            <div className={styles.row}>
              <span className={styles.label}>Assertion:</span>
              <CrossLink id={rj.assertion_id} label="Assertion" />
            </div>
            <div className={styles.row}>
              <span className={styles.label}>Person:</span>
              <CrossLink id={rj.person_id} label="Person" />
            </div>
            {rj.reason && (
              <div className={styles.row}>
                <span className={styles.label}>Reason:</span>
                <span className={styles.text}><Linkify text={rj.reason} /></span>
              </div>
            )}
            <div className={styles.row}>
              <span className={styles.label}>Created:</span> {rj.created}
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
