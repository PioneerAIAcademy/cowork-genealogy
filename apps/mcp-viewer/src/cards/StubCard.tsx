import { Prose } from '../rules/Prose'
import { Shell, type Point } from './kit/Shell'
import { stateWords } from './kit/words'
import type { CardProps } from './registry'

/** A step whose card is not built yet: the question and where it stands. */
export function StubCard({ view, heightLimit, actions }: CardProps) {
  const { index, question, status } = view
  const points: Point[] = []
  if (question) points.push({ label: 'The question', body: <Prose text={question.question} index={index} /> })
  const state = stateWords(status?.state)
  if (state) points.push({ label: 'Where it stands', body: state })
  return <Shell title="This step's card is coming" points={points} actions={actions} heightLimit={heightLimit} />
}
