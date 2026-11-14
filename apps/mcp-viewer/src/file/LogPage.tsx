import type { LogEntry } from '@genealogy/schema'
import { useMemo, useState } from 'react'
import { firstSentence, outcomeWords, questionSearches } from '../cards/kit/searches'
import { list } from '../cards/kit/view'
import { plainProse, Prose } from '../rules/Prose'
import { useFile } from './FileContext'
import { dateOnly, queryWords, toolWords } from './model'
import { Open } from './Open'

const OUTCOMES = ['positive', 'partial', 'negative', 'error'] as const

export function LogLine({ entry }: { entry: LogEntry }) {
  const { index } = useFile()
  const words = queryWords(entry.query, index)
  const note = firstSentence(entry.notes)
  const outcome = outcomeWords(entry.outcome)
  return (
    <>
      <span className="file-date">{dateOnly(entry.performed)}</span>{' '}
      <Open target={{ kind: 'search', id: entry.id }}>{toolWords(entry)}</Open>
      {words.plain.length > 0 && <span>: {words.plain.join(', ')}</span>}
      {outcome && <span className="file-tag">{outcome}</span>}
      {note && <Prose text={note} index={index} />}
    </>
  )
}

export function LogPage() {
  const { research, index } = useFile()
  const [questionId, setQuestionId] = useState('')
  const [outcome, setOutcome] = useState('')
  const questions = list(research.questions).filter((q) => typeof q.id === 'string')
  const entries = useMemo(() => {
    const owned = questionId ? new Set(questionSearches(research, questionId).map((e) => e.id)) : null
    return [...list(research.log)]
      .filter((e) => (!owned || owned.has(e.id)) && (!outcome || e.outcome === outcome))
      .sort((a, b) => String(a.performed ?? '').localeCompare(String(b.performed ?? '')))
  }, [research, questionId, outcome])

  return (
    <div className="file-page">
      <h2>Log</h2>
      <div className="file-filters">
        {questions.length > 1 && (
          <label>
            Question{' '}
            <select value={questionId} onChange={(e) => setQuestionId(e.target.value)}>
              <option value="">Every question</option>
              {questions.map((q) => (
                <option key={q.id} value={q.id}>
                  {plainProse(q.question, index)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Outcome{' '}
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Every outcome</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {outcomeWords(o)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ol className="file-list">
        {entries.map((entry) => (
          <li key={entry.id} className="file-item">
            <LogLine entry={entry} />
          </li>
        ))}
      </ol>
      {entries.length === 0 && <p>No search matches.</p>}
    </div>
  )
}
