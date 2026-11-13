import { resolveFieldId } from '../rules/field-id'
import { Prose } from '../rules/Prose'
import { FieldName } from './kit/FieldName'
import { firstSentence, outcomeWords, questionSearches, recordsKept, searchCounts, thisSearch } from './kit/searches'
import { Shell, type Point } from './kit/Shell'
import { moreInFile, nextStepWords } from './kit/words'
import type { CardProps } from './registry'

const RECORDS_NAMED = 2

function countLine(total: number, found: number, nothing: number, failed: number): string {
  const parts = [`${found} found something`, `${nothing} found nothing`]
  if (failed > 0) parts.push(`${failed} did not run`)
  return `${total} ${total === 1 ? 'search' : 'searches'}: ${parts.join(', ')}.`
}

/** The searches on the current question: how many, the one this card is about, what was kept, what is next. */
export function SearchCard({ view, heightLimit, actions = [], onSeeResults }: CardProps) {
  const { research, index, question, status, input } = view
  const searches = questionSearches(research, question?.id)
  const points: Point[] = []
  if (question) points.push({ label: 'The question', body: <Prose text={question.question} index={index} /> })
  if (searches.length === 0) {
    points.push({ label: 'Searches', body: 'No searches yet.' })
    return <Shell title="Searching" points={points} actions={actions} heightLimit={heightLimit} />
  }

  const counts = searchCounts(searches)
  points.push({ label: 'Searches', body: countLine(counts.total, counts.found, counts.nothing, counts.failed) })
  const search = thisSearch(searches, input.logId)
  if (search) {
    const note = firstSentence(search.notes)
    const outcome = outcomeWords(search.outcome)
    points.push({
      label: input.logId === search.id ? 'This search' : 'The latest search',
      body: (
        <>
          {note && <Prose text={note} index={index} />}
          {outcome && <p className="outcome">It {outcome}.</p>}
        </>
      )
    })
  }
  const kept = recordsKept(research, searches)
  if (kept.length > 0) {
    const named = kept.filter((source) => resolveFieldId(source.id, index) !== null).slice(0, RECORDS_NAMED)
    points.push({
      label: kept.length === 1 ? 'Record kept' : `${kept.length} records kept`,
      body: (
        <ul className="records">
          {named.map((source) => (
            <li key={source.id}>
              <FieldName id={source.id} index={index} />
            </li>
          ))}
        </ul>
      )
    })
  }
  const next = nextStepWords(status?.nextStep)
  if (next) points.push({ label: 'Next', body: next })

  const seeResults =
    search?.results_ref && onSeeResults
      ? [
          <button key="results" type="button" onClick={() => onSeeResults(search.id)}>
            See the results
          </button>
        ]
      : []
  return (
    <Shell
      title="Searching"
      points={points}
      footer={kept.length > RECORDS_NAMED ? moreInFile(kept.length - RECORDS_NAMED) : null}
      actions={[...seeResults, ...actions]}
      heightLimit={heightLimit}
    />
  )
}
