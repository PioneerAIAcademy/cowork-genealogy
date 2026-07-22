import { useMemo } from 'react'
import { useResearchData } from '../../contexts/ResearchDataContext'
import Card from '../shared/Card'
import Linkify from '../shared/Linkify'
import type { Locality, LocalityPageRead } from '../../lib/schema'
import styles from './LocalitiesSection.module.css'

// The four wiki place-page sections locality-guide must attempt for every
// locality. Read-coverage (all four present in pages_read) is the headline
// health signal the survey persists — render it as a fixed four-slot strip so
// a missing or 404'd section reads at a glance.
const WIKI_SECTIONS: { key: LocalityPageRead['section']; label: string }[] = [
  { key: 'home', label: 'Overview' },
  { key: 'getting_started', label: 'Getting Started' },
  { key: 'online_records', label: 'Online Records' },
  { key: 'research_tips', label: 'Research Tips' }
]

function PageCoverage({ pagesRead }: { pagesRead: LocalityPageRead[] }): React.JSX.Element {
  const bySection = new Map(pagesRead.map((p) => [p.section, p]))
  return (
    <div className={styles.coverage}>
      {WIKI_SECTIONS.map(({ key, label }) => {
        const page = bySection.get(key)
        const state = page == null ? 'missing' : page.found ? 'found' : 'notfound'
        const title =
          state === 'found'
            ? `${label}: read`
            : state === 'notfound'
              ? `${label}: no page for this place (404)`
              : `${label}: not attempted`
        return (
          <span
            key={key}
            className={`${styles.coverageChip} ${styles[state]}`}
            title={title}
          >
            {state === 'found' ? '✓' : state === 'notfound' ? '—' : '·'} {label}
          </span>
        )
      })}
    </div>
  )
}

export default function LocalitiesSection(): React.JSX.Element {
  const { research } = useResearchData()
  const localities = useMemo<Locality[]>(() => research?.localities ?? [], [research?.localities])

  if (localities.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Localities</h2>
        <p className={styles.empty}>No locality guides saved yet.</p>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Localities</h2>
      {localities.map((loc) => {
        const jurisdictions = loc.jurisdictions ?? []
        const collections = loc.collections ?? []
        const quirks = loc.quirks ?? []
        const subtitle = [loc.for_place, loc.time_period].filter(Boolean).join(' · ')

        return (
          <Card
            key={loc.id}
            id={loc.id}
            title={
              <span>
                {loc.place}
                {subtitle && <span className={styles.subtitle}> — {subtitle}</span>}
              </span>
            }
            badges={<PageCoverage pagesRead={loc.pages_read ?? []} />}
            footer={
              <span>
                {loc.source} &middot; {loc.updated ?? loc.created}
              </span>
            }
            rawData={loc}
          >
            {jurisdictions.length > 0 && (
              <div className={styles.block}>
                <div className={styles.blockLabel}>Jurisdictions</div>
                <ul className={styles.list}>
                  {jurisdictions.map((j, i) => (
                    <li key={i} className={styles.listItem}>
                      <span className={styles.itemName}>{j.name}</span>
                      {j.date_range && <span className={styles.itemDetail}>{j.date_range}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {collections.length > 0 && (
              <div className={styles.block}>
                <div className={styles.blockLabel}>Collections</div>
                <ul className={styles.list}>
                  {collections.map((c) => (
                    <li key={c.id} className={styles.listItem}>
                      <span className={styles.itemName}>{c.title}</span>
                      {c.date_range && <span className={styles.itemDetail}>{c.date_range}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {quirks.length > 0 && (
              <div className={styles.block}>
                <div className={styles.blockLabel}>Quirks</div>
                <ul className={styles.quirkList}>
                  {quirks.map((q, i) => (
                    <li key={i} className={styles.quirk}>
                      <Linkify text={q} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {loc.guide_markdown && (
              <div className={styles.block}>
                <div className={styles.blockLabel}>Guide</div>
                <div className={styles.guide}>
                  <Linkify text={loc.guide_markdown} />
                </div>
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}
