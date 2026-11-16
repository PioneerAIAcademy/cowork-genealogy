import type { Question } from '@genealogy/schema'
import { statusLabel } from '@genealogy/viewer-ui/status-label'
import { useEffect, useState } from 'react'
import { conclusionLine, reviewer } from '../cards/kit/conclusion'
import { questionSearches, recordsKept } from '../cards/kit/searches'
import { currentQuestion, list, proofFor, strings } from '../cards/kit/view'
import { inWords, nextStepWords, stateWords } from '../cards/kit/words'
import { plainProse, Prose } from '../rules/Prose'
import {
  conflictsOf,
  evidenceGrid,
  hypothesesOf,
  leadKindWords,
  leadsOf,
  needsResearcher,
  overturnRisk,
  planItemsOf,
  reviewerNotes,
  stopCriteria,
  whatItChanged
} from './case-model'
import { useFile } from './FileContext'
import { LogLine } from './LogPage'
import { besideValue, sourceTitle } from './model'
import { Open } from './Open'

function Project() {
  const { research, index } = useFile()
  const project = research.project
  const subjects = strings(project?.subject_person_ids).filter((id) => index.persons.get(id)?.name)
  if (!project?.objective && subjects.length === 0) return null
  return (
    <section>
      {project?.objective && <Prose text={project.objective} index={index} />}
      {subjects.length > 0 && (
        <p>
          About{' '}
          {subjects.map((id, i) => (
            <span key={id}>
              {i > 0 && ', '}
              <Open target={{ kind: 'person', id }}>{index.persons.get(id)!.name}</Open>
            </span>
          ))}
        </p>
      )}
    </section>
  )
}

function Head({ question }: { question: Question }) {
  const { research, index, derived } = useFile()
  const proof = proofFor(research, question.id)
  const status = list(derived.questions).find((q) => q.id === question.id) ?? null
  if (!proof) {
    const searches = questionSearches(research, question.id)
    const open = planItemsOf(research, question).filter((i) => i.status === 'planned' || i.status === 'in_progress')
    const kept = recordsKept(research, searches)
    return (
      <section id="case-head">
        <h3>So far</h3>
        <p>
          {searches.length} {searches.length === 1 ? 'search' : 'searches'} done, {open.length} still open.{' '}
          {[stateWords(status?.state), nextStepWords(status?.nextStep)].filter(Boolean).join('. ')}
        </p>
        {kept.length > 0 && (
          <ul className="file-list">
            {kept.map((source) => (
              <li key={source.id}>
                <Open target={{ kind: 'record', id: source.id }}>{sourceTitle(source, index)}</Open>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }
  const changed = whatItChanged(research, proof, derived.treeChanges, index)
  return (
    <section id="case-head">
      <h3>The conclusion</h3>
      <Prose text={conclusionLine(proof, question)} index={index} />
      <p>
        <strong>{inWords(proof.tier)}</strong>
      </p>
      {list(proof.claims).length > 0 && (
        <ul className="claims">
          {list(proof.claims).map((claim, i) => (
            <li key={i}>
              <Prose text={claim.claim} index={index} inline /> <span className="tier">{inWords(claim.proof_tier)}</span>
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary>The whole argument</summary>
        <Prose text={proof.narrative_markdown} index={index} />
        {proof.exhaustive_search_summary && (
          <>
            <h4>How far the search went</h4>
            <Prose text={proof.exhaustive_search_summary} index={index} />
          </>
        )}
      </details>
      {changed && changed.length > 0 && (
        <>
          <h4>What it changed in the tree</h4>
          <ul className="file-list">
            {changed.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function Reviewer({ question }: { question: Question }) {
  const { research, derived, index } = useFile()
  const proof = proofFor(research, question.id)
  const review = reviewer(research, derived, proof, question)
  if (!review) return null
  const notes = reviewerNotes(derived.evaluations?.[review.entry.id]?.body)
  return (
    <section id="case-reviewer">
      <h3>The reviewer</h3>
      <p>
        Verdict: <strong>{review.verdict}</strong>
      </p>
      {notes?.narrative && <Prose text={notes.narrative} index={index} />}
      {notes && notes.items.length > 0 && (
        <ul className="file-list">
          {notes.items.map((item, i) => (
            <li key={i}>
              <Prose text={item} index={index} inline />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function EvidenceGrid({ question }: { question: Question }) {
  const { research, startingTree, index, derived } = useFile()
  const proof = proofFor(research, question.id)
  const status = list(derived.questions).find((q) => q.id === question.id) ?? null
  const grid = evidenceGrid(research, startingTree, index, question, proof, status)
  if (grid.rows.length === 0) return null
  return (
    <section id="case-grid">
      <h3>What each record says</h3>
      <div className="grid-scroll">
        <table className="evidence-grid">
          <thead>
            <tr>
              <th scope="col">Fact</th>
              {grid.hasTree && <th scope="col">The tree before</th>}
              {grid.columns.map((c) => (
                <th key={c.sourceId} scope="col">
                  <Open target={{ kind: 'record', id: c.sourceId }}>{c.title}</Open>
                  <span className="file-meta">
                    {[c.informant ? `told by ${statusLabel(c.informant)}` : '', c.read ?? ''].filter(Boolean).join(' · ')}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {grid.hasTree && <td>{(row.tree ?? []).join('; ')}</td>}
                {grid.columns.map((c) => {
                  const items = row.cells[c.sourceId] ?? []
                  return (
                    <td key={c.sourceId} className={items.some((i) => i.tinted) ? 'tinted' : undefined}>
                      {items.map((item) => (
                        <div key={item.assertionId}>
                          <Prose text={item.value} index={index} inline />
                          {besideValue(item.value, item.date, item.place)}
                        </div>
                      ))}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Conflicts({ question }: { question: Question }) {
  const { research, index } = useFile()
  const conflicts = conflictsOf(research, question)
  const hypotheses = hypothesesOf(research, question)
  if (conflicts.length === 0 && hypotheses.length === 0) return null
  return (
    <section id="case-conflicts">
      <h3>Conflicts and competing identities</h3>
      <div className="side-by-side">
        {conflicts.map((c) => (
          <article key={c.id} id={`case-${c.id}`} className="file-card">
            <p className="file-meta">{statusLabel(String(c.status ?? ''))}</p>
            <Prose text={c.description} index={index} />
            {c.conflict_type === 'identity' && c.identity_question && <Prose text={c.identity_question} index={index} />}
            <Prose text={c.resolution_rationale || c.weighing_analysis} index={index} />
          </article>
        ))}
        {hypotheses.map((h) => (
          <article key={h.id} id={`case-${h.id}`} className="file-card">
            <p className="file-meta">{statusLabel(String(h.status ?? ''))}</p>
            <Prose text={h.claim} index={index} />
            {h.status === 'ruled_out' && h.ruled_out_reason && <Prose text={h.ruled_out_reason} index={index} />}
            {h.notes && <Prose text={h.notes} index={index} />}
          </article>
        ))}
      </div>
    </section>
  )
}

const ITEM_MARK: Record<string, string> = { completed: '✓', skipped: '–', in_progress: '…', planned: '○' }

function Searched({ question, planItemId }: { question: Question; planItemId: string | null }) {
  const { research, index } = useFile()
  const items = planItemsOf(research, question)
  if (items.length === 0) return null
  const log = list(research.log)
  return (
    <section id="case-searched">
      <h3>What was searched</h3>
      <ol className="file-list checklist">
        {items.map((item) => (
          <li key={item.id} id={`case-${item.id}`} className={item.id === planItemId ? 'file-item marked' : 'file-item'}>
            <span aria-hidden="true">{ITEM_MARK[item.status] ?? '○'}</span> <strong>{statusLabel(item.status)}</strong>
            {' · '}
            {[statusLabel(item.record_type), item.jurisdiction, item.date_range, item.repository].filter(Boolean).join(', ')}
            {item.status === 'skipped' && (
              <p>
                {item.skip_category ? statusLabel(item.skip_category) : ''}
                {item.skip_reason && <Prose text={item.skip_reason} index={index} inline />}
              </p>
            )}
            {item.rationale && <Prose text={item.rationale} index={index} />}
            {log
              .filter((e) => e.plan_item_id === item.id)
              .map((e) => (
                <div key={e.id} className="found">
                  <LogLine entry={e} />
                </div>
              ))}
          </li>
        ))}
      </ol>
    </section>
  )
}

export function LeadsList({ question }: { question: Question }) {
  const { index } = useFile()
  const leads = leadsOf(question)
  const risk = overturnRisk(question.search_stop?.justification)
  if (leads.length === 0 && !risk) return null
  return (
    <ul className="file-list">
      {risk?.level === 'high' && (
        <li className="file-item lead-risk">
          <strong>Could change the answer:</strong> <Prose text={risk.text} index={index} inline />
        </li>
      )}
      {risk?.level === 'low' && <li className="file-item">Unlikely to change the answer.</li>}
      {leads.map((lead, i) => (
        <li key={i} id={`case-lead-${question.id}-${i}`} className="file-item">
          <strong>{leadKindWords(lead.kind)}</strong>
          {needsResearcher(lead.kind) && <span className="file-tag">Needs you</span>}
          <Prose text={lead.description} index={index} />
          {lead.wiki_title && <p className="file-meta">FamilySearch Wiki: {lead.wiki_title}</p>}
          {lead.log_entry_id && (
            <p className="file-meta">
              <Open target={{ kind: 'search', id: lead.log_entry_id }}>The search</Open>
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

export function CasePage() {
  const { research, index, focus } = useFile()
  const questions = list(research.questions).filter((q) => typeof q.id === 'string')
  const start = currentQuestion(research, focus?.questionId)
  const [questionId, setQuestionId] = useState<string | null>(start?.id ?? null)
  const question = questions.find((q) => q.id === questionId) ?? start

  useEffect(() => {
    if (focus?.questionId) setQuestionId(focus.questionId)
    if (!focus?.anchor) return
    const id = focus.anchor
    const timer = setTimeout(() => document.getElementById(id)?.scrollIntoView?.({ block: 'center' }), 0)
    return () => clearTimeout(timer)
  }, [focus])

  return (
    <div className="file-page">
      <h2>The case</h2>
      <Project />
      {questions.length > 1 && (
        <label className="file-filters">
          Question{' '}
          <select value={question?.id ?? ''} onChange={(e) => setQuestionId(e.target.value)}>
            {questions.map((q) => (
              <option key={q.id} value={q.id}>
                {plainProse(q.question, index)}
              </option>
            ))}
          </select>
        </label>
      )}
      {question && (
        <>
          <section id="case-question">
            <Prose text={question.question} index={index} />
            {(question.rationale || stopCriteria(question).length > 0) && (
              <details>
                <summary>About this question</summary>
                {question.rationale && <Prose text={question.rationale} index={index} />}
                {stopCriteria(question).length > 0 && (
                  <>
                    <h4>Why the search stopped</h4>
                    <dl className="findings">
                      {stopCriteria(question).map((c) => (
                        <div key={c.label}>
                          <dt>{c.label}</dt>
                          <dd>
                            <Prose text={c.text} index={index} inline />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </>
                )}
              </details>
            )}
          </section>
          <Head question={question} />
          <Reviewer question={question} />
          <EvidenceGrid question={question} />
          <Conflicts question={question} />
          <Searched question={question} planItemId={focus?.planItemId ?? null} />
          {(leadsOf(question).length > 0 || overturnRisk(question.search_stop?.justification)) && (
            <section id="case-leads">
              <h3>Leads</h3>
              <LeadsList question={question} />
            </section>
          )}
        </>
      )}
    </div>
  )
}

