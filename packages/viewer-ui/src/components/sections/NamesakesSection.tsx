import { useResearchData } from '../../contexts/ResearchDataContext'
import Card from '../shared/Card'
import CrossLink from '../shared/CrossLink'
import Linkify from '../shared/Linkify'
import styles from './NamesakesSection.module.css'

export default function NamesakesSection(): React.JSX.Element {
  const { research } = useResearchData()
  const items = research?.namesakes ?? []

  if (items.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Namesakes</h2>
        <p className={styles.empty}>
          No namesakes recorded. A same-named person a search rules out is recorded
          here, and a link to the person he is not then needs something in its
          record tying it to that person.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Namesakes</h2>
      {items.map((ns) => (
        <Card
          key={ns.id}
          id={ns.id}
          title={ns.name}
          summary={[ns.place, ns.time_period].filter(Boolean).join(', ')}
          rawData={ns}
          footer={
            <div className={styles.footer}>
              <span className={styles.footerLabel}>Not the same person as:</span>
              <CrossLink id={ns.person_id} />
            </div>
          }
        >
          <div className={styles.body}>
            {ns.record_ids.length > 0 && (
              <div className={styles.subsection}>
                <div className={styles.subLabel}>His Records</div>
                <div className={styles.linkList}>
                  {ns.record_ids.map((rid) => (
                    <span key={rid}>
                      <Linkify text={rid} />
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(ns.log_entry_ids ?? []).length > 0 && (
              <div className={styles.subsection}>
                <div className={styles.subLabel}>Found By</div>
                <div className={styles.linkList}>
                  {(ns.log_entry_ids ?? []).map((lid) => (
                    <CrossLink key={lid} id={lid} />
                  ))}
                </div>
              </div>
            )}

            {ns.notes && (
              <div className={styles.subsection}>
                <div className={styles.subLabel}>Notes</div>
                <p className={styles.text}><Linkify text={ns.notes} /></p>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  )
}
