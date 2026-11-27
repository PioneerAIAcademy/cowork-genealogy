import type { Question, Timeline } from '@genealogy/schema'
import { readDate } from '../file/compare-read'
import { timelineOf } from '../file/person-model'
import { Prose } from '../rules/Prose'
import { Shell, type Point } from './kit/Shell'
import { isResolved, list, strings } from './kit/view'
import { nextStepWords, plural } from './kit/words'
import type { CardProps } from './registry'

const WAITING_NAMED = 2

/** high first, then medium, then low; document order within a tie. */
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

/** The project's unresolved questions other than this one, most urgent first. */
function waitingQuestions(questions: Question[], current: Question | null): Question[] {
  // `sort` is stable (ES2019), so ties keep document order with no index to carry.
  return questions
    .filter((q) => typeof q.id === 'string' && q.id !== current?.id && !isResolved(q))
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? PRIORITY_RANK.low) - (PRIORITY_RANK[b.priority] ?? PRIORITY_RANK.low))
}

/** The first and last year the timeline's events can mean, or null when none reads as a year. */
function spanOf(timeline: Timeline): { from: number; to: number } | null {
  const read = list(timeline.events)
    .map((event) => readDate(event.date, event.date_certainty))
    .filter((date): date is NonNullable<typeof date> => date !== null)
  if (read.length === 0) return null
  // A single event can span years of its own ("1850-1855"), so the last year
  // the timeline can mean is the latest `to`, never the latest `from`.
  return { from: Math.min(...read.map((d) => d.from)), to: Math.max(...read.map((d) => d.to)) }
}

/**
 * The stop after question-selection: which question is being worked, why, and
 * what else is waiting.
 *
 * The timeline point names the timeline's own label as well as its count. The
 * issue's reason for showing the count — that the case-file person page shows
 * the same timeline, so the two agree — does not hold: `file/Panes.tsx` builds
 * that page's event list from `lifeOf`, which never reads `research.timelines`.
 * `file/parity.ts` says where a timeline DOES reach the page — "its gaps and
 * notes from the timeline" — and that is the whole of it: no page shows the
 * events as a list or a count, so there is nothing for a count to agree with.
 *
 * That mattered beyond wording, because it was also the only reason given for
 * including hypothesis timelines, and the committed ones are hypothesis
 * timelines ("… assuming Thomas Flynn parentage"). A bare count would report
 * events that hold only under an unproven parentage as settled fact, so a
 * timeline that cannot be qualified is left off the card entirely.
 */
export function QuestionCard({ view, heightLimit, actions = [] }: CardProps) {
  const { research, index, question, status } = view
  if (!question) {
    return (
      <Shell
        title="No question chosen yet"
        points={[{ label: 'The question', body: 'The research has not framed a question yet.' }]}
        actions={actions}
        heightLimit={heightLimit}
      />
    )
  }

  const points: Point[] = [{ label: 'The question', body: <Prose text={question.question} index={index} /> }]
  if (typeof question.rationale === 'string' && question.rationale.trim()) {
    points.push({ label: 'Why this one', body: <Prose text={question.rationale} index={index} /> })
  }

  const waiting = waitingQuestions(list(research.questions), question)
  if (waiting.length > 0) {
    const more = waiting.length - WAITING_NAMED
    points.push({
      label: 'What else is waiting',
      body: (
        <>
          <p>{plural(waiting.length, 'other question', 'other questions')} waiting.</p>
          <ul className="waiting">
            {waiting.slice(0, WAITING_NAMED).map((q) => (
              <li key={q.id}>
                <Prose text={q.question} index={index} />
              </li>
            ))}
          </ul>
          {more > 0 && <p>And {plural(more, 'more', 'more')}.</p>}
        </>
      )
    })
  }

  const subjectIds = strings(research.project?.subject_person_ids)
  const timeline = subjectIds.map((id) => timelineOf(research, id)).find((t): t is Timeline => t !== null) ?? null
  const span = timeline ? spanOf(timeline) : null
  const label = typeof timeline?.label === 'string' && timeline.label.trim() ? timeline.label : null
  // A hypothesis timeline with no label cannot be qualified, and the count alone
  // would read as settled fact — so the point is dropped rather than shown bare.
  const qualified = label !== null || !timeline?.hypothesis_id
  if (timeline && span && qualified) {
    points.push({
      label: 'Timeline',
      body: (
        <>
          <p>
            {plural(list(timeline.events).length, 'event', 'events')}, {span.from}
            {span.to !== span.from && `–${span.to}`}.
          </p>
          {label !== null && <Prose text={label} index={index} />}
        </>
      )
    })
  }

  const next = nextStepWords(status?.nextStep)
  if (next) points.push({ label: 'Next', body: next })
  return <Shell title="Choosing the question" points={points} actions={actions} heightLimit={heightLimit} />
}
