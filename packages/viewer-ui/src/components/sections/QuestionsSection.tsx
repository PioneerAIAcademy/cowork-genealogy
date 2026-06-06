import { useResearchData } from '../../contexts/ResearchDataContext'
import Card from '../shared/Card'
import StatusBadge from '../shared/StatusBadge'
import CrossLink from '../shared/CrossLink'
import type { Question } from '../../lib/schema'
import styles from './QuestionsSection.module.css'

function QuestionCard({ question }: { question: Question }): React.JSX.Element {
  const { exhaustive_declaration } = question

  return (
    <Card
      id={question.id}
      title={question.question}
      badges={
        <>
          <StatusBadge value={question.status} />
          <StatusBadge value={question.priority} />
          {exhaustive_declaration.declared && <StatusBadge value="exhaustive" color="blue" />}
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

      {question.depends_on.length > 0 && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Depends On</div>
          <div className={styles.linkList}>
            {question.depends_on.map((id) => (
              <CrossLink key={id} id={id} />
            ))}
          </div>
        </div>
      )}

      {question.unblocks.length > 0 && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Unblocks</div>
          <div className={styles.linkList}>
            {question.unblocks.map((id) => (
              <CrossLink key={id} id={id} />
            ))}
          </div>
        </div>
      )}

      {question.resolution_assertion_ids.length > 0 && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Resolution Assertions</div>
          <div className={styles.linkList}>
            {question.resolution_assertion_ids.map((id) => (
              <CrossLink key={id} id={id} />
            ))}
          </div>
        </div>
      )}

      {exhaustive_declaration.declared && exhaustive_declaration.stop_criteria && (
        <dl className={styles.stopCriteria}>
          {Object.entries(exhaustive_declaration.stop_criteria).map(([key, value]) => (
            <div key={key}>
              <dt>{key.replace(/_/g, ' ')}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
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
        <p className={styles.empty}>No questions defined yet.</p>
      ) : (
        questions.map((q) => <QuestionCard key={q.id} question={q} />)
      )}
    </div>
  )
}
