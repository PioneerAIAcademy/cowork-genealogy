import { useMemo } from 'react'
import { useResearchData } from '../../contexts/ResearchDataContext'
import Card from '../shared/Card'
import Linkify from '../shared/Linkify'
import type { Locality, LocalityPageRead, LocalityVolumeSummary } from '../../lib/schema'
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
        const state =
          page == null
            ? 'missing'
            : page.found
              ? 'found'
              : page.outcome === 'unreachable'
                ? 'unreachable'
                : 'notfound'
        const title =
          state === 'found'
            ? `${label}: read`
            : state === 'notfound'
              ? `${label}: no page for this place (404)`
              : state === 'unreachable'
                ? `${label}: wiki unreachable — the page may exist`
                : `${label}: not attempted`
        const mark =
          state === 'found' ? '✓' : state === 'notfound' ? '—' : state === 'unreachable' ? '!' : '·'
        return (
          <span
            key={key}
            className={`${styles.coverageChip} ${styles[state]}`}
            title={title}
          >
            {mark} {label}
          </span>
        )
      })}
    </div>
  )
}

function count(n: number | null | undefined): string {
  return n == null ? 'unknown' : n.toLocaleString()
}

// How the unindexed volumes of a group can be reached: by full-text search, or
// only by paging through the images. Indexed volumes are in neither count.
function accessDetail(b: { browse_only: number | null; fulltext_only: number | null }): string {
  return `${count(b.browse_only)} browse-only · ${count(b.fulltext_only)} full-text only`
}

function VolumeSummary({ summary }: { summary: LocalityVolumeSummary }): React.JSX.Element {
  const years = [summary.start_year, summary.end_year].filter((y) => y != null).join('–')
  return (
    <div className={styles.block}>
      <div className={styles.blockLabel}>
        Digitized volumes{years && ` (${years})`}: {count(summary.total_volumes)}
        {!summary.complete && ' — partial count'}
      </div>
      <ul className={styles.list}>
        {summary.by_record_type.map((b) => (
          <li key={b.group} className={styles.listItem}>
            <span className={styles.itemName}>
              {b.group}: {count(b.volumes)}
            </span>
            <span className={styles.itemDetail}>{accessDetail(b)}</span>
          </li>
        ))}
        {summary.untyped.volumes > 0 && (
          <li className={styles.listItem}>
            <span className={styles.itemName}>No record type: {count(summary.untyped.volumes)}</span>
            <span className={styles.itemDetail}>{accessDetail(summary.untyped)}</span>
          </li>
        )}
      </ul>
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
        <p className={styles.empty}>
          No locality guides saved yet. Guides to the places under research —
          their jurisdictions, record sets, and repositories — are added during
          the locality-guide step.
        </p>
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
        const registration = loc.registration_start ?? []
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
                      {c.person_count != null && (
                        <span className={styles.itemDetail}>{count(c.person_count)} people</span>
                      )}
                      {c.record_count != null && (
                        <span className={styles.itemDetail}>{count(c.record_count)} records</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {registration.length > 0 && (
              <div className={styles.block}>
                <div className={styles.blockLabel}>Civil registration began</div>
                <ul className={styles.list}>
                  {registration.map((r, i) => (
                    <li key={i} className={styles.listItem}>
                      <span className={styles.itemName}>
                        {r.event}: {r.year}
                      </span>
                      <span className={styles.itemDetail}>{r.level} level</span>
                      <span className={styles.itemDetail}>
                        <Linkify text={r.source_url} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {loc.volume_summary && <VolumeSummary summary={loc.volume_summary} />}

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
