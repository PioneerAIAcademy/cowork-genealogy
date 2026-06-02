import { useResearchData } from '../../contexts/ResearchDataContext'
import type { GedcomxPerson } from '../../lib/schema'
import { getPreferredName } from '../../lib/schema'
import Card from '../shared/Card'
import CrossLink from '../shared/CrossLink'
import styles from './TimelinesSection.module.css'

export default function TimelinesSection(): React.JSX.Element {
  const { research, gedcomx } = useResearchData()
  const items = research?.timelines ?? []

  if (items.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Timelines</h2>
        <p className={styles.empty}>No timelines recorded.</p>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Timelines</h2>
      {items.map((tl) => {
        const eventCount = tl.events.length
        const firstDate = tl.events[0]?.date
        const lastDate = tl.events[eventCount - 1]?.date
        const dateRange = firstDate && lastDate ? `${firstDate} – ${lastDate}` : ''
        const summaryText = `${eventCount} event${eventCount !== 1 ? 's' : ''}${dateRange ? ` · ${dateRange}` : ''}`

        const personNames = tl.person_ids
          .map((pid) => {
            const person = gedcomx?.persons.find((p) => p.id === pid)
            return person ? getPreferredName(person as GedcomxPerson) : pid
          })
          .join(', ')

        return (
          <Card
            key={tl.id}
            id={tl.id}
            title={tl.label}
            summary={summaryText}
            rawData={tl}
            footer={
              <div className={styles.footer}>
                {tl.hypothesis_id && (
                  <>
                    <span className={styles.footerLabel}>Hypothesis:</span>
                    <CrossLink id={tl.hypothesis_id} />
                  </>
                )}
                {personNames && <span className={styles.footerPersons}>{personNames}</span>}
              </div>
            }
          >
            <div className={styles.body}>
              <div className={styles.timeline}>
                {tl.events.map((event, idx) => {
                  // Check if there's a gap before this event
                  const gapBefore =
                    idx > 0
                      ? tl.gaps.find(
                          (g) => g.start === tl.events[idx - 1].date && g.end === event.date
                        )
                      : null

                  // Check if there's an impossibility involving this event
                  const impossibility = tl.impossibilities.find(
                    (imp) =>
                      event.assertion_ids.includes(imp.event_1_assertion_id) ||
                      event.assertion_ids.includes(imp.event_2_assertion_id)
                  )

                  const distanceKm = idx > 0 ? (event.distance_from_previous_km ?? null) : null

                  return (
                    <div key={idx}>
                      {gapBefore && (
                        <div className={`${styles.gap} ${styles[`gap_${gapBefore.severity}`]}`}>
                          <div className={styles.gapLine} />
                          <div className={styles.gapContent}>
                            <span className={styles.gapLabel}>Gap ({gapBefore.severity})</span>
                            {gapBefore.expected_events.length > 0 && (
                              <span className={styles.gapExpected}>
                                Expected: {gapBefore.expected_events.join(', ')}
                              </span>
                            )}
                            {gapBefore.notes && (
                              <span className={styles.gapNotes}>{gapBefore.notes}</span>
                            )}
                          </div>
                        </div>
                      )}

                      {distanceKm !== null && (
                        <div className={styles.distance}>
                          <div className={styles.distanceLine} />
                          <div className={styles.distanceLabel}>
                            {Math.round(distanceKm).toLocaleString()} km
                          </div>
                        </div>
                      )}

                      <div className={styles.event}>
                        <div className={styles.eventLeft}>
                          <div className={styles.eventDate}>{event.date}</div>
                          {event.date_certainty !== 'exact' && (
                            <div className={styles.eventCertainty}>{event.date_certainty}</div>
                          )}
                        </div>
                        <div className={styles.eventDot} />
                        <div className={styles.eventRight}>
                          <div className={styles.eventType}>{event.event_type}</div>
                          {event.place && <div className={styles.eventPlace}>{event.place}</div>}
                          {event.description && (
                            <div className={styles.eventDesc}>{event.description}</div>
                          )}
                          {event.assertion_ids.length > 0 && (
                            <div className={styles.eventLinks}>
                              {event.assertion_ids.map((aid) => (
                                <CrossLink key={aid} id={aid} />
                              ))}
                            </div>
                          )}
                          {event.conflict_ids && event.conflict_ids.length > 0 && (
                            <div className={styles.conflictChip}>
                              <span className={styles.conflictLabel}>
                                Conflict ({event.conflict_ids.length})
                              </span>
                              {event.conflict_note && (
                                <span className={styles.conflictNote}>
                                  {' — '}
                                  {event.conflict_note}
                                </span>
                              )}
                              <div className={styles.conflictLinks}>
                                {event.conflict_ids.map((cid) => (
                                  <CrossLink key={cid} id={cid} />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {impossibility && (
                        <div className={styles.impossibility}>
                          <div className={styles.impossibilityDesc}>
                            {impossibility.description}
                          </div>
                          <div className={styles.impossibilityLinks}>
                            <CrossLink id={impossibility.event_1_assertion_id} label="Event 1" />
                            <CrossLink id={impossibility.event_2_assertion_id} label="Event 2" />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
