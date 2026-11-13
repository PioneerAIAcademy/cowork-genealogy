import type { Locality } from '@genealogy/schema'
import { statusLabel } from '@genealogy/viewer-ui'
import { list } from '../cards/kit/view'
import { Prose } from '../rules/Prose'
import { useFile } from './FileContext'
import { sourcePeople, sourcesNewestFirst, sourceTitle } from './model'
import { Open } from './Open'

interface CollectionRow {
  link_text?: string
  url?: string
  place?: string
  record_types?: string[]
  start_year?: string
  end_year?: string
}

function DirectMentions() {
  const { research, index } = useFile()
  const sources = sourcesNewestFirst(research)
  if (sources.length === 0) return null
  return (
    <section>
      <h3>Direct mentions</h3>
      <ul className="file-list">
        {sources.map((source) => {
          const people = sourcePeople(research, source.id)
          return (
            <li key={source.id} className="file-item">
              <Open target={{ kind: 'record', id: source.id }}>{sourceTitle(source, index)}</Open>
              {source.source_classification && (
                <span className="file-tag">{statusLabel(String(source.source_classification))}</span>
              )}
              <Prose text={source.citation} index={index} />
              {people.length > 0 && (
                <p className="chips">
                  {people.map(({ personId, confidence }) => {
                    const name = index.persons.get(personId)?.name
                    if (!name) return null
                    return (
                      <span key={personId} className="chip">
                        <Open target={{ kind: 'person', id: personId }}>{name}</Open>
                        <span className="chip-strength">{statusLabel(confidence)}</span>
                      </span>
                    )
                  })}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function LocalityItem({ locality }: { locality: Locality }) {
  const { index } = useFile()
  const jurisdictions = list(locality.jurisdictions).map((j) => [j.name, j.date_range].filter(Boolean).join(' '))
  const starts = list(locality.registration_start).map((r) => `${statusLabel(String(r.event))} registered by the ${statusLabel(String(r.level))} from ${r.year}`)
  const volumes = locality.volume_summary
  return (
    <li className="file-item">
      <strong>{[locality.place, locality.time_period].filter(Boolean).join(', ')}</strong>
      {jurisdictions.length > 0 && <p>Jurisdictions: {jurisdictions.join('; ')}</p>}
      {starts.length > 0 && <p>{starts.join('. ')}.</p>}
      {volumes && (
        <p>
          {volumes.total_volumes} image volumes
          {volumes.start_year ? `, ${volumes.start_year}–${volumes.end_year ?? ''}` : ''}
          {volumes.complete ? '' : ' (not all counted)'}.
        </p>
      )}
      {list(locality.collections).length > 0 && (
        <p>Collections: {list(locality.collections).map((c) => [c.title, c.date_range].filter(Boolean).join(' ')).join('; ')}</p>
      )}
      {list(locality.quirks).map((quirk, i) => (
        <Prose key={i} text={quirk} index={index} />
      ))}
      {locality.guide_markdown && <Prose text={locality.guide_markdown} index={index} />}
    </li>
  )
}

function Background() {
  const { research, collections } = useFile()
  const localities = list(research.localities)
  const places = (collections as { places?: Record<string, { rows?: CollectionRow[]; too_large?: boolean }> } | null)?.places ?? {}
  const rows = Object.values(places).flatMap((p) => list(p.rows))
  if (localities.length === 0 && rows.length === 0) return null
  return (
    <section>
      <h3>Background</h3>
      <ul className="file-list">
        {localities.map((locality) => (
          <LocalityItem key={locality.id} locality={locality} />
        ))}
        {rows.map((row, i) => (
          <li key={`c${i}`} className="file-item">
            {row.url && /^https:\/\//.test(row.url) ? <a href={row.url}>{row.link_text ?? 'A collection'}</a> : row.link_text}
            <p>
              {[row.place, list(row.record_types as unknown as object[]).length ? (row.record_types ?? []).join(', ') : '', [row.start_year, row.end_year].filter(Boolean).join('–')]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function SourcesPage() {
  return (
    <div className="file-page">
      <h2>Sources</h2>
      <DirectMentions />
      <Background />
    </div>
  )
}
