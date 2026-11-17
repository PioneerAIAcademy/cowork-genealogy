import { statusLabel } from '@genealogy/viewer-ui/status-label'
import { familyOf, subjectOf } from '../file/people-model'
import { Prose } from '../rules/Prose'
import { FieldName } from './kit/FieldName'
import { linksByPerson, questionLinks, ruledOut, statedConflicts, type PersonLinks } from './kit/links'
import { Shell, type Point } from './kit/Shell'
import { nextStepWords } from './kit/words'
import type { CardProps } from './registry'

const PEOPLE_NAMED = 3
const CONFLICTS_SHOWN = 2

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function strengthWords(person: PersonLinks): string {
  if (person.strengths.length === 1) return statusLabel(person.strengths[0][0])
  return person.strengths.map(([confidence, count]) => `${count} ${statusLabel(confidence)}`).join(', ')
}

function ruledOutWords(rejected: number, namesakes: number): string {
  const parts: string[] = []
  if (rejected > 0) parts.push(`${plural(rejected, 'link', 'links')} rejected`)
  if (namesakes > 0) parts.push(plural(namesakes, 'namesake', 'namesakes'))
  return `${parts.join(', ')}.`
}

/** The records person-evidence tied to people on the current question, and how strongly. */
export function LinkCard({ view, heightLimit, actions = [] }: CardProps) {
  const { research, tree, index, question, status } = view
  const links = questionLinks(research, question?.id)
  const points: Point[] = []
  if (question) points.push({ label: 'The question', body: <Prose text={question.question} index={index} /> })
  if (links.length === 0) {
    points.push({ label: 'Linked', body: 'No records linked yet.' })
  } else {
    const people = linksByPerson(links, subjectOf(research, familyOf(tree)))
    const records = new Set(links.map((link) => link.sourceId)).size
    const others = people.length - PEOPLE_NAMED
    points.push({
      label: 'Linked',
      body: (
        <>
          <p>
            {plural(records, 'record', 'records')} linked to {plural(people.length, 'person', 'people')}.
          </p>
          <ul className="people">
            {people.slice(0, PEOPLE_NAMED).map((person) => (
              <li key={person.personId}>
                <FieldName id={person.personId} index={index} />: {plural(person.records, 'record', 'records')},{' '}
                {strengthWords(person)}
              </li>
            ))}
          </ul>
          {others > 0 && <p>And {plural(others, 'more person', 'more people')}.</p>}
        </>
      )
    })
  }
  const conflicts = statedConflicts(research, question?.id)
  if (conflicts.length > 0) {
    const more = conflicts.length - CONFLICTS_SHOWN
    points.push({
      label: 'Speculative because',
      body: (
        <>
          {conflicts.slice(0, CONFLICTS_SHOWN).map((sentence) => (
            <Prose key={sentence} text={sentence} index={index} />
          ))}
          {more > 0 && <p>And {plural(more, 'more', 'more')} in the case file.</p>}
        </>
      )
    })
  }
  const out = ruledOut(research, question?.id, links)
  if (out.rejected + out.namesakes > 0) points.push({ label: 'Ruled out', body: ruledOutWords(out.rejected, out.namesakes) })
  const next = nextStepWords(status?.nextStep)
  if (next) points.push({ label: 'Next', body: next })
  return <Shell title="Linking records to people" points={points} actions={actions} heightLimit={heightLimit} />
}
