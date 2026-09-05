import { useResearchData } from '../../contexts/ResearchDataContext'
import Card from '../shared/Card'
import StatusBadge from '../shared/StatusBadge'
import CrossLink from '../shared/CrossLink'
import styles from './EvaluationsSection.module.css'

/**
 * The gps-mentor's verdicts (issue #1223).
 *
 * The mentor gate is mandatory to invoke and record — `/research` will not let
 * a question be considered done until every `ps_id` it references carries a
 * `focus: "proof-critique"` entry here. Until this section existed the system
 * required the critique and then showed the researcher none of it: an
 * `address_first` verdict, the mentor saying a proof needs work before it
 * stands, was recorded and invisible.
 *
 * **Verdict, not critique text.** `evaluation_entry` has no notes field. The
 * mentor's prose lives at `file_path`, a host-side artifact the viewer cannot
 * read, so what is renderable is the verdict, what it judged, when, and whether
 * a later pass superseded it. That is the decision itself, which is the part
 * that changes what a researcher does next.
 */

const FOCUS_LABELS: Record<string, string> = {
  'pre-exhaustiveness': 'Before declaring exhaustive',
  'conclusion-readiness': 'Before concluding',
  'proof-critique': 'Proof critique',
  'on-demand': 'On demand'
}

const TARGET_LABELS: Record<string, string> = {
  question: 'question',
  proof_summary: 'proof summary',
  project: 'project'
}

export default function EvaluationsSection(): React.JSX.Element {
  const { research } = useResearchData()
  const items = research?.evaluations ?? []

  if (items.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Mentor Evaluations</h2>
        <p className={styles.empty}>
          No mentor evaluations recorded. These are added when the GPS mentor
          reviews the research against the Genealogical Proof Standard.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Mentor Evaluations</h2>
      {items.map((ev) => (
        <Card
          key={ev.id}
          id={ev.id}
          title={FOCUS_LABELS[ev.focus] ?? ev.focus}
          badges={
            <>
              <StatusBadge value={ev.verdict} />
              {ev.superseded_by && <StatusBadge value="superseded" />}
            </>
          }
          rawData={ev}
        >
          <div className={styles.body}>
            <div className={styles.row}>
              <span className={styles.label}>Reviewed</span>
              <span className={styles.value}>
                {/* The `project` target has no card to link to — the whole
                    project is the subject — so only link what is linkable. */}
                {ev.target_type === 'project' ? (
                  <span className={styles.plainTarget}>
                    {TARGET_LABELS[ev.target_type] ?? ev.target_type}
                  </span>
                ) : (
                  <>
                    <span className={styles.targetKind}>
                      {TARGET_LABELS[ev.target_type] ?? ev.target_type}
                    </span>{' '}
                    <CrossLink id={ev.target_id} />
                  </>
                )}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>When</span>
              <span className={styles.value}>{ev.timestamp}</span>
            </div>
            {ev.superseded_by && (
              <div className={styles.row}>
                <span className={styles.label}>Superseded by</span>
                <span className={styles.value}>
                  <CrossLink id={ev.superseded_by} />
                </span>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  )
}
