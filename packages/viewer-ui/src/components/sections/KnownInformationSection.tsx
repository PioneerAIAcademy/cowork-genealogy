import { useResearchData } from '../../contexts/ResearchDataContext'
import type { HoldingType } from '../../lib/schema'
import Card from '../shared/Card'
import StatusBadge from '../shared/StatusBadge'
import CrossLink from '../shared/CrossLink'
import Linkify from '../shared/Linkify'
import styles from './KnownInformationSection.module.css'

const holdingTypeLabels: Record<HoldingType, string> = {
  document: 'Document',
  prior_research: 'Prior Research',
  oral_knowledge: 'Family Knowledge',
  gedcom: 'GEDCOM / Tree File',
  photo: 'Photo',
  artifact: 'Artifact',
  other: 'Other'
}

export default function KnownInformationSection(): React.JSX.Element {
  const { research } = useResearchData()
  const items = research?.known_holdings ?? []

  if (items.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Known Information</h2>
        <p className={styles.empty}>
          No known information recorded. Holdings the researcher already has —
          documents, prior research, and family knowledge — are gathered when the
          project is initialized.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Known Information</h2>
      <p className={styles.intro}>
        What the researcher already has on hand, surveyed before new research
        begins. These are starting points, not verified evidence — each is
        promoted into a proper source when its document is examined.
      </p>
      {items.map((kh) => {
        const typeLabel = holdingTypeLabels[kh.holding_type] ?? kh.holding_type
        const personIds = kh.relates_to_person_ids ?? []

        return (
          <Card
            key={kh.id}
            id={kh.id}
            title={kh.description}
            badges={
              <>
                <StatusBadge value={typeLabel} color="gray" />
                <StatusBadge value={kh.confidence} />
                {kh.promoted ? <StatusBadge value="promoted" color="green" /> : null}
              </>
            }
            summary={kh.promoted ? 'Promoted to a source' : 'Not yet examined'}
            rawData={kh}
            footer={
              personIds.length > 0 ? (
                <div className={styles.linkList}>
                  {personIds.map((pid) => (
                    <CrossLink key={pid} id={pid} />
                  ))}
                </div>
              ) : undefined
            }
          >
            <div className={styles.body}>
              {kh.relevant_facts && (
                <div className={styles.subsection}>
                  <div className={styles.subLabel}>Facts it may supply</div>
                  <p className={styles.text}><Linkify text={kh.relevant_facts} /></p>
                </div>
              )}
              {personIds.length > 0 && (
                <div className={styles.subsection}>
                  <div className={styles.subLabel}>Relates to</div>
                  <div className={styles.linkList}>
                    {personIds.map((pid) => (
                      <CrossLink key={pid} id={pid} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
