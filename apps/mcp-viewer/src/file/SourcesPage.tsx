import type { Locality } from '@genealogy/schema'
import { parseExternalCollections } from '@genealogy/viewer-ui/external-collections'
import { statusLabel } from '@genealogy/viewer-ui/status-label'
import { list, strings } from '../cards/kit/view'
import { plainProse, Prose } from '../rules/Prose'
import { overturnRisk } from './case-model'
import { LeadsList } from './CasePage'
import { useFile } from './FileContext'
import { sourcePeople, sourcesNewestFirst, sourceTitle } from './model'
import { Open } from './Open'

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
      {list(locality.record_types).length > 0 && (
        <ul>
          {list(locality.record_types).map((r, i) => (
            <li key={i}>
              {[statusLabel(String(r.type)), r.years, statusLabel(String(r.access)), r.held_at].filter(Boolean).join(', ')}: <Prose text={r.summary} index={index} />
            </li>
          ))}
        </ul>
      )}
      {list(locality.repositories).length > 0 && (
        <p>Repositories: {list(locality.repositories).map((r) => [r.name, r.holds].filter(Boolean).join(', ')).join('; ')}</p>
      )}
      {list(locality.losses).length > 0 && (
        <p>Losses: {list(locality.losses).map((l) => [l.record_set, l.years].filter(Boolean).join(', ')).join('; ')}</p>
      )}
      {list(locality.catalog).length > 0 && (
        <p>Catalog: {list(locality.catalog).map((c) => c.title).join('; ')}</p>
      )}
      {list(locality.collections).length > 0 && (
        <p>Collections: {list(locality.collections).map((c) => [c.title, c.date_range].filter(Boolean).join(' ')).join('; ')}</p>
      )}
      {strings(locality.quirks).map((quirk, i) => (
        <Prose key={i} text={quirk} index={index} />
      ))}
      {locality.guide_markdown && <Prose text={locality.guide_markdown} index={index} />}
    </li>
  )
}

function Background() {
  const { research } = useFile()
  const localities = list(research.localities)
  if (localities.length === 0) return null
  return (
    <section>
      <h3>Background</h3>
      <ul className="file-list">
        {localities.map((locality) => (
          <LocalityItem key={locality.id} locality={locality} />
        ))}
      </ul>
    </section>
  )
}

/** FamilySearch's curated outside collections, one closed list per place: a planning list, not the sources used. */
function OtherWebsites() {
  const { collections } = useFile()
  const places = parseExternalCollections(collections)?.places ?? {}
  const kept = Object.keys(places)
    .sort((a, b) => a.localeCompare(b))
    .map((place) => ({ place, ...places[place] }))
    .filter(({ rows }) => rows.length > 0)
  if (kept.length === 0) return null
  return (
    <section>
      <h3>Other websites</h3>
      {kept.map(({ place, rows, too_large }) => (
        <details key={place}>
          <summary>
            Other websites with records for {place} ({rows.length}
            {too_large ? ' of a longer list' : ''}). FamilySearch’s list, for planning: being listed here does not mean a site was searched
            or paid for.
          </summary>
          <ul className="file-list">
            {rows.map((row, i) => {
              const about = [row.record_types.join(', '), [row.start_year, row.end_year].filter(Boolean).join('–')].filter(Boolean).join(' · ')
              return (
                <li key={i} className="file-item">
                  {/^https:\/\//.test(row.url) ? <a href={row.url}>{row.link_text || 'A collection'}</a> : row.link_text || row.url}
                  {about && <p>{about}</p>}
                </li>
              )
            })}
          </ul>
        </details>
      ))}
    </section>
  )
}

function Leads() {
  const { research, index } = useFile()
  const questions = list(research.questions).filter(
    (q) => list(q.search_stop?.not_reached).length > 0 || overturnRisk(q.search_stop?.justification)
  )
  if (questions.length === 0) return null
  return (
    <section>
      <h3>Leads</h3>
      {questions.map((question) => (
        <div key={question.id}>
          {questions.length > 1 && <p className="file-meta">{plainProse(question.question, index)}</p>}
          <LeadsList question={question} />
        </div>
      ))}
    </section>
  )
}

export function SourcesPage() {
  return (
    <div className="file-page">
      <h2>Sources</h2>
      <DirectMentions />
      <Leads />
      <Background />
      <OtherWebsites />
    </div>
  )
}
