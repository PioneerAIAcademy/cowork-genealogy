import { useMemo } from 'react'
import { useResearchData } from '../../contexts/ResearchDataContext'
import Card from '../shared/Card'
import { isOpenableUrl, openExternal } from '../../lib/external'
import { groupCollections, type ExternalCollectionRow } from '../../lib/externalCollections'
import styles from './CollectionsSection.module.css'

// These links point at Ancestry, MyHeritage and other sites, so they go through
// the generic `openExternal` channel with the URL shown as its own text.

function years(row: ExternalCollectionRow): string {
  if (!row.start_year && !row.end_year) return ''
  if (row.start_year === row.end_year) return row.start_year
  return `${row.start_year || '?'}–${row.end_year || '?'}`
}

function CollectionItem({ row }: { row: ExternalCollectionRow }): React.JSX.Element {
  const details = [years(row), row.cost, row.content_type].filter(Boolean).join(' · ')
  const url = row.url.trim()
  return (
    <li className={styles.listItem}>
      <span className={styles.itemName}>{row.link_text || url}</span>
      {details && <span className={styles.itemDetail}>{details}</span>}
      {isOpenableUrl(url) ? (
        <button type="button" className={styles.link} onClick={() => openExternal(url)}>
          {url}
        </button>
      ) : (
        <code className={styles.url}>{url}</code>
      )}
    </li>
  )
}

export default function CollectionsSection(): React.JSX.Element {
  const { collections } = useResearchData()
  const places = useMemo(() => groupCollections(collections), [collections])

  if (places.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Collections</h2>
        <p className={styles.empty}>
          No collection lists fetched yet. FamilySearch&apos;s curated collections on
          other sites — Ancestry, MyHeritage and the like — are saved here per place
          when a place is surveyed.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Collections</h2>
      {places.map(({ place, groups, rowCount }) => (
        <Card
          key={place}
          id={`collections-${place}`}
          title={place}
          summary={
            rowCount === 0
              ? 'Fetched — nothing specific to this place'
              : `${rowCount} collection${rowCount === 1 ? '' : 's'} · ${groups.length} record type${groups.length === 1 ? '' : 's'}`
          }
        >
          {groups.map(({ recordType, rows }) => (
            <div key={recordType} className={styles.block}>
              <div className={styles.blockLabel}>{recordType}</div>
              <ul className={styles.list}>
                {rows.map((row) => (
                  <CollectionItem key={row.key || row.url} row={row} />
                ))}
              </ul>
            </div>
          ))}
        </Card>
      ))}
    </div>
  )
}
