import type { Source } from '@genealogy/schema'
import { statusLabel } from '@genealogy/viewer-ui/status-label'
import { useCallback, useEffect, useState } from 'react'
import { outcomeWords } from '../cards/kit/searches'
import { isLive, list, strings } from '../cards/kit/view'
import { resolveFieldId } from '../rules/field-id'
import { Prose } from '../rules/Prose'
import { isPageImageArk, personHref } from '../rules/rule-index'
import { useFile } from './FileContext'
import { LogLine } from './LogPage'
import { dateWords } from './case-model'
import { assertionPerson, besideValue, CONFIDENCE_RANK, labelWords, liveAssertions, resultsView, sourcePeople, sourceTitle, type ResultsView } from './model'
import { Open } from './Open'
import { useCompare } from './ComparePage'
import { usePeople } from './PeoplePage'
import { relationTo } from './people-model'
import { lifeOf, timelineOf } from './person-model'

const FOUND_BY_TOOLS = new Set(['record_search', 'fulltext_search'])

/** The search that found a record: its own log entry when that was a search, else the record search holding it. */
function useFoundBy(source: Source | undefined): string | null {
  const { research, transport } = useFile()
  const entry = source ? list(research.log).find((e) => e.id === source.log_entry_id) : undefined
  const own = entry && FOUND_BY_TOOLS.has(entry.tool) ? entry.id : null
  const ark = source && typeof source.url === 'string' ? /ark:\/61903\/\d:\d:[A-Z0-9-]+/.exec(source.url)?.[0] : undefined
  const [found, setFound] = useState<string | null>(null)
  useEffect(() => {
    setFound(null)
    if (own || !ark || isPageImageArk(ark)) return
    let alive = true
    transport
      .recordSearch(ark)
      .then((logId) => alive && setFound(logId))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [own, ark, transport])
  return own ?? found
}

function RecordPane({ id }: { id: string }) {
  const { research, index, transport } = useFile()
  const source = list(research.sources).find((s) => s.id === id)
  const [image, setImage] = useState<string | null>(null)
  const foundBy = useFoundBy(source)

  useEffect(() => {
    setImage(null)
    const filename = source?.image_filename
    if (!filename) return
    let alive = true
    transport
      .getSourceImage(filename)
      .then((url) => alive && setImage(url))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [source?.image_filename, transport])

  if (!source) return <p>This record is not in the project.</p>
  const link = resolveFieldId(source.id, index)
  const findings = liveAssertions(research, source.id)
  return (
    <div>
      <h2>{sourceTitle(source, index)}</h2>
      {link?.href && (
        <p>
          <a href={link.href}>On FamilySearch</a>
        </p>
      )}
      <Prose text={source.citation} index={index} />
      {foundBy && (
        <p>
          Found by: <Open target={{ kind: 'search', id: foundBy }}>the search that found it</Open>
        </p>
      )}
      <p className="file-meta">
        {[source.source_classification ? statusLabel(String(source.source_classification)) : '', source.repository, source.access_date ? `read ${source.access_date}` : '']
          .filter(Boolean)
          .join(' · ')}
      </p>
      {(image || source.transcription) && (
        <div className="page-and-text">
          {image && <img src={image} alt={`The page: ${sourceTitle(source, index)}`} />}
          {source.transcription && (
            <div>
              <h3>Transcription{source.transcription_truncated ? ' (cut short: the rest of the page was not read)' : ''}</h3>
              <Prose text={source.transcription} index={index} />
            </div>
          )}
        </div>
      )}
      {findings.length > 0 && (
        <>
          <h3>What it says</h3>
          <dl className="findings">
            {findings.map((a) => {
              const link = assertionPerson(research, a.id)
              const name = link ? index.persons.get(link.personId)?.name : null
              return (
                <div key={a.id}>
                  <dt>{labelWords(a.fact_type)}</dt>
                  <dd>
                    <Prose text={a.value} index={index} inline />
                    {besideValue(a.value, dateWords(a.date), a.place)}
                    {name && link && (
                      <span className="file-meta">
                        {' '}
                        · <Open target={{ kind: 'person', id: link.personId }}>{name}</Open>, {statusLabel(link.confidence)}
                      </span>
                    )}
                  </dd>
                </div>
              )
            })}
          </dl>
        </>
      )}
      {source.notes && (
        <>
          <h3>Notes</h3>
          <Prose text={source.notes} index={index} />
        </>
      )}
    </div>
  )
}

type Load = { status: 'loading' } | { status: 'gone' } | { status: 'failed' } | { status: 'ready'; view: ResultsView }

function SearchPane({ id }: { id: string }) {
  const { research, index, transport } = useFile()
  const entry = list(research.log).find((e) => e.id === id)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const hasResults = Boolean(entry?.results_ref)

  const read = useCallback(() => {
    if (!hasResults) return
    setLoad({ status: 'loading' })
    transport
      .readSidecar(id)
      .then((sidecar) => setLoad(sidecar ? { status: 'ready', view: resultsView(JSON.parse(sidecar.raw)) } : { status: 'gone' }))
      .catch(() => setLoad({ status: 'failed' }))
  }, [id, hasResults, transport])

  useEffect(read, [read])

  if (!entry) return <p>This search is not in the project.</p>
  const examined =
    typeof entry.results_examined === 'number'
      ? `Looked at ${entry.results_examined}${typeof entry.results_available === 'number' ? ` of ${entry.results_available}` : ''}.`
      : null
  return (
    <div>
      <h2>The search</h2>
      <div>
        <LogLine entry={entry} />
      </div>
      <p className="file-meta">{[outcomeWords(entry.outcome), examined].filter(Boolean).join(' · ')}</p>
      {entry.notes && <Prose text={entry.notes} index={index} />}
      {hasResults && <h3>What it found</h3>}
      {hasResults && load.status === 'loading' && <p>Reading the results.</p>}
      {hasResults && load.status === 'gone' && <p>These results were not kept.</p>}
      {hasResults && load.status === 'failed' && (
        <p>
          The results could not be read.{' '}
          <button type="button" onClick={read}>
            Try again
          </button>
        </p>
      )}
      {load.status === 'ready' && (
        <>
          {load.view.notShown !== undefined && <p>{load.view.notShown} results; not shown here.</p>}
          <ol className="file-list">
            {load.view.rows.map((row, i) => (
              <li key={i} className="file-item">
                <strong>{row.label}</strong>
                {row.detail.length > 0 && <p>{row.detail.join(' · ')}</p>}
                {row.familySearch && <Prose text={row.familySearch} index={index} />}
                {row.outside && <a href={row.outside}>Open the collection</a>}
                {row.text && <Prose text={row.text} index={index} />}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}

function PersonPane({ id }: { id: string }) {
  const { research, tree, index } = useFile()
  const { family, subjectId, starting } = usePeople()
  const compare = useCompare()
  const person = index.persons.get(id)
  if (!person) return <p>This person is not in the tree.</p>
  // Two sources can name one record (two people on one census page): list it once, at its strongest.
  const byTitle = new Map<string, { source: Source; link: { confidence: string } }>()
  for (const source of list(research.sources)) {
    const link = sourcePeople(research, source.id).find((p) => p.personId === id)
    if (!link) continue
    const title = sourceTitle(source, index)
    const known = byTitle.get(title)
    if (!known || (CONFIDENCE_RANK[link.confidence] ?? 0) > (CONFIDENCE_RANK[known.link.confidence] ?? 0)) {
      byTitle.set(title, { source, link })
    }
  }
  const records = [...byTitle.values()]
  const relation = relationTo(family, subjectId, id)
  const added = starting !== null && !starting.has(id)
  const strength = [...(compare?.people ?? []), ...(compare?.possibleRelatives ?? [])].find((p) => p.personId === id)?.strength
  const life = lifeOf(research, tree, id, index)
  const timeline = timelineOf(research, id)
  const gaps = list(timeline?.gaps)
  const notes = list(timeline?.events).filter((e) => typeof e.conflict_note === 'string' && e.conflict_note.trim())
  const namesakes = list(research.namesakes).filter((n) => n.person_id === id)
  const ruledOut = list(research.rejected_links).filter((r) => r.person_id === id)
  const assertions = new Map(list(research.assertions).filter(isLive).map((a) => [a.id, a]))
  return (
    <div>
      <h2>{person.name ?? 'Someone in the tree'}</h2>
      {relation && <p className="file-meta">{relation}</p>}
      {added && <p className="file-meta">Added by this research{strength ? `, ${strength}` : ''}</p>}
      {person.pid && (
        <p>
          <a href={personHref(person.pid)}>On FamilySearch</a>
        </p>
      )}
      {life.length > 0 && (
        <>
          <h3>Their life in time order</h3>
          <ul className="file-list">
            {life.map((row, i) => (
              <li key={i} className="file-item">
                <strong>{row.label}:</strong> <Prose text={row.text} index={index} inline />
                {row.fromRecords && <span className="file-tag">From the records</span>}
                {row.records.length > 0 && (
                  <span className="file-meta">
                    {' '}
                    ·{' '}
                    {row.records.map((r, j) => (
                      <span key={r.sourceId}>
                        {j > 0 && '; '}
                        <Open target={{ kind: 'record', id: r.sourceId }}>{r.title}</Open>
                        {r.confidence && `, ${statusLabel(r.confidence)}`}
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {gaps.length > 0 && (
        <>
          <h3>Gaps</h3>
          <ul className="file-list">
            {gaps.map((gap, i) => (
              <li key={i} className="file-item">
                {dateWords(gap.start)} to {dateWords(gap.end)}: no {strings(gap.expected_events).map((e) => labelWords(e).toLowerCase()).join(', ') || 'record'}
                <span className="file-tag">{statusLabel(String(gap.severity))}</span>
                {gap.notes && <Prose text={gap.notes} index={index} />}
              </li>
            ))}
          </ul>
        </>
      )}
      {notes.length > 0 && (
        <>
          <h3>Notes from the timeline</h3>
          <ul className="file-list">
            {notes.map((event, i) => (
              <li key={i} className="file-item">
                <Prose text={event.conflict_note!} index={index} />
              </li>
            ))}
          </ul>
        </>
      )}
      {records.length > 0 && (
        <>
          <h3>Records that name them</h3>
          <ul className="file-list">
            {records.map(({ source, link }) => (
              <li key={source.id}>
                <Open target={{ kind: 'record', id: source.id }}>{sourceTitle(source, index)}</Open>{' '}
                <span className="file-meta">{statusLabel(link!.confidence)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {namesakes.length > 0 && (
        <>
          <h3>Not the same person as</h3>
          <ul className="file-list">
            {namesakes.map((n) => (
              <li key={n.id} className="file-item">
                <strong>{n.name}</strong>
                <span className="file-meta">
                  {[n.place, n.time_period ?? (n.birth_year ? `born about ${n.birth_year}` : null)].filter(Boolean).map((v) => `, ${v}`).join('')}
                </span>
                {n.notes && <Prose text={n.notes} index={index} />}
                {strings(n.record_ids).length > 0 && <Prose text={`Records: ${strings(n.record_ids).join(', ')}`} index={index} />}
              </li>
            ))}
          </ul>
        </>
      )}
      {ruledOut.length > 0 && (
        <>
          <h3>Ruled out</h3>
          <ul className="file-list">
            {ruledOut.map((r) => {
              const a = assertions.get(r.assertion_id)
              const words = r.researcher_words ?? r.reason
              return (
                <li key={r.id} className="file-item">
                  {a ? (
                    <>
                      {labelWords(a.fact_type)}: <Prose text={a.value} index={index} inline /> in{' '}
                      <Open target={{ kind: 'record', id: a.source_id }}>{sourceTitle(list(research.sources).find((s) => s.id === a.source_id) ?? ({ id: a.source_id } as Source), index)}</Open>
                    </>
                  ) : (
                    'A finding'
                  )}
                  {words && <Prose text={words} index={index} />}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

export function Pane() {
  const { pane, close } = useFile()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  if (!pane) return null
  return (
    <aside className="file-pane" aria-label="Details">
      <button type="button" className="file-pane-close" onClick={close}>
        Close
      </button>
      {pane.kind === 'record' && <RecordPane id={pane.id} />}
      {pane.kind === 'search' && <SearchPane id={pane.id} />}
      {pane.kind === 'person' && <PersonPane id={pane.id} />}
    </aside>
  )
}
