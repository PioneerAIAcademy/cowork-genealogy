import { useResearchData } from '../../contexts/ResearchDataContext'
import Card from '../shared/Card'
import StatusBadge from '../shared/StatusBadge'
import CrossLink from '../shared/CrossLink'
import type { Question, NotReachedEntry, StopCriteria } from '../../lib/schema'
import styles from './QuestionsSection.module.css'

const STOP_GATE_VALUES = new Set(['question_answered', 'record_exhausted', 'nothing_further_reachable'])

function stoppedBecauseLabel(value: string): string {
  const labels: Record<string, string> = {
    question_answered: 'Question Answered',
    record_exhausted: 'Records Exhausted',
    nothing_further_reachable: 'Nothing Further Reachable',
    resources_spent: 'Resources Spent',
    blocked_by_conflict: 'Blocked by Conflict',
  }
  return labels[value] ?? value.replace(/_/g, ' ')
}

function QuestionCard({ question }: { question: Question }): React.JSX.Element {
  // New shape: search_stop (issue #2539). Legacy shape: exhaustive_declaration.
  const search_stop = question.search_stop
  const legacy = (question as Record<string, unknown>).exhaustive_declaration as
    | { declared?: boolean; stop_criteria?: StopCriteria }
    | undefined

  const stopped_because = search_stop?.stopped_because ?? null
  const stop_criteria: StopCriteria | null = search_stop?.stop_criteria ?? legacy?.stop_criteria ?? null
  const not_reached: NotReachedEntry[] = search_stop?.not_reached ?? []
  const legacyDeclared = !stopped_because && legacy?.declared === true

  const dependsOn = question.depends_on ?? []
  const unblocks = question.unblocks ?? []
  const resolutionAssertionIds = question.resolution_assertion_ids ?? []

  return (
    <Card
      id={question.id}
      title={question.question}
      badges={
        <>
          <StatusBadge value={question.status} />
          <StatusBadge value={question.priority} />
          {(legacyDeclared || (stopped_because && STOP_GATE_VALUES.has(stopped_because))) &&
            question.status !== 'exhaustive_declared' && (
              <StatusBadge value="exhaustive_declared" />
            )}
        </>
      }
      summary={question.rationale}
      footer={
        <>
          <span>Created {question.created}</span>
          {question.resolved && <span>Resolved {question.resolved}</span>}
        </>
      }
      rawData={question}
    >
      <div className={styles.field}>
        <div className={styles.fieldLabel}>Selection Basis</div>
        <div className={styles.fieldValue}>{question.selection_basis.replace(/_/g, ' ')}</div>
      </div>

      {stopped_because && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Stopped Because</div>
          <div className={styles.fieldValue}>{stoppedBecauseLabel(stopped_because)}</div>
        </div>
      )}

      {dependsOn.length > 0 && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Depends On</div>
          <div className={styles.linkList}>
            {dependsOn.map((id) => (
              <CrossLink key={id} id={id} />
            ))}
          </div>
        </div>
      )}

      {unblocks.length > 0 && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Unblocks</div>
          <div className={styles.linkList}>
            {unblocks.map((id) => (
              <CrossLink key={id} id={id} />
            ))}
          </div>
        </div>
      )}

      {resolutionAssertionIds.length > 0 && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Resolution Assertions</div>
          <div className={styles.linkList}>
            {resolutionAssertionIds.map((id) => (
              <CrossLink key={id} id={id} />
            ))}
          </div>
        </div>
      )}

      {stop_criteria && (
        <dl className={styles.stopCriteria}>
          {Object.entries(stop_criteria).map(([key, value]) => (
            <div key={key}>
              <dt>{key.replace(/_/g, ' ')}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {not_reached.length > 0 && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Not Reached</div>
          <ul className={styles.notReachedList}>
            {not_reached.map((entry, i) => (
              <li key={i}>
                <span className={styles.notReachedKind}>{entry.kind.replace(/_/g, ' ')}</span>
                {': '}
                <span>{entry.description}</span>
                {entry.wiki_title && (
                  <span className={styles.notReachedWiki}> ({entry.wiki_title})</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

export default function QuestionsSection(): React.JSX.Element {
  const { research } = useResearchData()
  const questions = research?.questions ?? []

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Questions</h2>
      {questions.length === 0 ? (
        <p className={styles.empty}>
          No questions defined yet. The research questions that drive the
          project are chosen during the question-selection step.
        </p>
      ) : (
        questions.map((q) => <QuestionCard key={q.id} question={q} />)
      )}
    </div>
  )
}
