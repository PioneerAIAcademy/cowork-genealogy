import { resolveFieldId } from '../rules/field-id'
import { Prose } from '../rules/Prose'
import { FieldName } from './kit/FieldName'
import { Shell, type Point } from './kit/Shell'
import { nextStepWords, stateWords } from './kit/words'
import type { CardProps } from './registry'

export function SetupCard({ view, heightLimit, actions }: CardProps) {
  const { research, index, question, status } = view
  const subjectIds = (Array.isArray(research.project?.subject_person_ids) ? research.project.subject_person_ids : []).filter(
    (id) => resolveFieldId(id, index) !== null
  )
  const points: Point[] = []
  if (research.project?.objective) {
    points.push({ label: 'Goal', body: <Prose text={research.project.objective} index={index} /> })
  }
  if (subjectIds.length > 0) {
    points.push({
      label: 'Who',
      body: subjectIds.map((id, i) => (
        <span key={id}>
          {i > 0 && ', '}
          <FieldName id={id} index={index} />
        </span>
      ))
    })
  }
  if (question) points.push({ label: 'The question', body: <Prose text={question.question} index={index} /> })
  const next = nextStepWords(status?.nextStep)
  const state = stateWords(status?.state)
  if (next) points.push({ label: 'Next', body: next })
  else if (state) points.push({ label: 'Where it stands', body: state })
  return <Shell title="The research is set up" points={points} actions={actions} heightLimit={heightLimit} />
}
