import type { ReactNode } from 'react'
import { Prose } from '../rules/Prose'
import { conclusionLine, reviewer } from './kit/conclusion'
import { Shell, type Point } from './kit/Shell'
import { list } from './kit/view'
import { inWords, moreInFile, stateWords } from './kit/words'
import type { CardProps, CardView } from './registry'

/** How many doubts the card shows before "N more in the case file". */
export const DOUBTS_SHOWN = 3

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many.replace('{n}', String(n))
}

/** Decision 6's recorded doubt, in a fixed order, each only when present. The
 *  reviewer's verdict is its own point, so no doubt can push it off the card. */
export function doubts(view: CardView): ReactNode[] {
  const { index, question, status, proof } = view
  const out: ReactNode[] = []
  const open = status?.openConflictIds.length ?? 0
  if (open > 0) out.push(plural(open, 'One conflict in the evidence is not settled.', '{n} conflicts in the evidence are not settled.'))
  for (const d of status?.unregisteredDisagreements ?? []) {
    const name = index.persons.get(d.personId)?.name ?? 'One person'
    out.push(`The records disagree on ${name}'s ${d.fact}, and no conflict records it.`)
  }
  const shortfall = proof?.shortfall && proof.shortfall !== 'none' ? inWords(proof.shortfall) : null
  if (shortfall) out.push(`Held back by: ${shortfall}.`)
  const notReached = list(question?.search_stop?.not_reached).length
  if (notReached > 0) out.push(plural(notReached, 'One source could not be reached.', '{n} sources could not be reached.'))
  return out
}

export function ConclusionCard({ view, heightLimit, actions }: CardProps) {
  const { research, derived, index, question, status, proof } = view
  if (!proof) {
    const points: Point[] = []
    if (question) points.push({ label: 'The question', body: <Prose text={question.question} index={index} /> })
    const state = stateWords(status?.state)
    if (state) points.push({ label: 'Where it stands', body: state })
    return <Shell title="No conclusion yet" points={points} actions={actions} heightLimit={heightLimit} />
  }

  const points: Point[] = []
  const line = conclusionLine(proof, question)
  if (line) points.push({ label: 'Conclusion', body: <Prose text={line} index={index} /> })
  const claims = list(proof.claims)
  points.push({
    label: 'How sure',
    body:
      claims.length === 0 ? (
        inWords(proof.tier)
      ) : (
        <ul className="claims">
          {claims.map((claim, i) => (
            <li key={i}>
              <Prose text={claim.claim} index={index} /> <span className="tier">{inWords(claim.proof_tier)}</span>
            </li>
          ))}
        </ul>
      )
  })
  const review = reviewer(research, derived, proof, question)
  if (review) points.push({ label: 'Reviewer', body: `A reviewer's verdict: ${review.verdict}.` })
  const all = doubts(view)
  const shown = all.slice(0, DOUBTS_SHOWN)
  if (shown.length > 0) {
    points.push({
      label: 'Doubts on record',
      body: (
        <ul className="doubts">
          {shown.map((doubt, i) => (
            <li key={i}>{doubt}</li>
          ))}
        </ul>
      )
    })
  }
  return (
    <Shell
      title="The conclusion"
      points={points}
      footer={moreInFile(all.length - shown.length)}
      actions={actions}
      heightLimit={heightLimit}
    />
  )
}
