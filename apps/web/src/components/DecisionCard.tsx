import React, { useState } from 'react'
import { recommendedOption, stripRecommendedMarker, type AskOption } from './recommendedOption'

export interface DecisionQuestion {
  question: string
  header?: string
  options: AskOption[]
}

/**
 * The card a turn that ended `decision` shows.
 *
 * Before this, such a turn rendered one line — "Waiting on you — see the question
 * above" — and the question itself was a chip summary truncated to 160 characters.
 * The options are now carried structured on the event, which is what makes a card
 * possible at all.
 *
 * Candidates sit side by side with what the agent would do if each is chosen, the way
 * the Source Linker compares them, plus the two escapes the parent plan names:
 * *not sure* and *something else*.
 *
 * **R9: *not sure* answers with the RECOMMENDED option**, never the weaker one. The
 * researcher is deferring to the agent's judgement, and the agent has already weighed
 * the evidence — continuing on anything else discards the reasoning the card exists
 * to show.
 *
 * `AskUserQuestion` carries 1-4 `questions`, not always 1 — a call that asks two
 * things at once rendered only `questions[0]` and silently dropped the rest. Each
 * question gets its own block and its own *not sure*; the run resumes on ONE message,
 * so answering the last pending question joins every answer into it. *Something
 * else* stays a single escape for the whole card — bailing out to free text is one
 * decision, not one per question.
 *
 * **"Something else" does not answer anything.** It used to send the literal text
 * `'Something else — I will explain'` the instant it was clicked — before the
 * researcher had written a word of the explanation the button promised. That spent
 * the turn on a sentence with no content, and the real explanation then had to wait
 * behind it. `onSomethingElse`, when given, only dismisses the card so the always-
 * present composer is what the researcher types their explanation into; nothing is
 * sent until they do.
 */
export function DecisionCard({
  questions,
  onAnswer,
  onSomethingElse
}: {
  questions: DecisionQuestion[]
  onAnswer: (answer: string) => void
  onSomethingElse?: () => void
}): React.JSX.Element | null {
  // Keyed by question index. A question with no options can never be answered by a
  // click, so it must not block the others from completing — it is excluded from
  // both the readiness check and the joined text below.
  const [answers, setAnswers] = useState<Record<number, string>>({})
  if (!questions || questions.length === 0) return null

  const hasOptions = (i: number): boolean => (questions[i].options ?? []).length > 0

  const choose = (index: number, label: string): void => {
    // The single-question case — overwhelmingly the common one — answers on the
    // first click, exactly as before: no joined text, no second render showing a
    // picked state nobody will see.
    if (questions.length === 1) {
      onAnswer(label)
      return
    }
    const next = { ...answers, [index]: label }
    setAnswers(next)
    if (questions.every((_, i) => next[i] != null || !hasOptions(i))) {
      const parts = questions
        .map((qq, i) => (next[i] != null ? `${qq.header ?? qq.question}: ${next[i]}` : null))
        .filter((p): p is string => p != null)
      onAnswer(parts.join('\n'))
    }
  }

  return (
    <div className="decisionCard">
      {questions.map((q, qi) => {
        const options = q.options ?? []
        const recommended = recommendedOption(options)
        const picked = answers[qi]
        return (
          <div className="decisionQuestionBlock" key={qi}>
            <div className="decisionQuestion">{q.question}</div>
            {picked != null ? (
              <div className="decisionAnswered">Answered: {picked}</div>
            ) : (
              <div className="decisionOptions">
                {options.map((o, i) => {
                  const label = stripRecommendedMarker(o.label)
                  const isRec = recommended != null && o.label === recommended.label
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`decisionOption ${isRec ? 'decisionRecommended' : ''}`}
                      onClick={() => choose(qi, label)}
                    >
                      <span className="decisionLabel">{label}</span>
                      {isRec && <span className="decisionBadge">Recommended</span>}
                      {o.description && <span className="decisionWhy">{o.description}</span>}
                    </button>
                  )
                })}
              </div>
            )}
            {/* Hidden once there is nothing to recommend: a "not sure" that cannot
                name an option would send an answer meaning nothing. */}
            {recommended && picked == null && (
              <div className="decisionEscapes">
                <button
                  type="button"
                  className="decisionEscape"
                  title={`Carry on with ${stripRecommendedMarker(recommended.label)}`}
                  onClick={() => choose(qi, stripRecommendedMarker(recommended.label))}
                >
                  I&rsquo;m not sure — use your judgement
                </button>
              </div>
            )}
          </div>
        )
      })}
      {questions.some((_, i) => hasOptions(i)) && (
        <div className="decisionEscapes">
          <button
            type="button"
            className="decisionEscape"
            onClick={() => (onSomethingElse ? onSomethingElse() : onAnswer('Something else — I will explain'))}
          >
            Something else
          </button>
        </div>
      )}
    </div>
  )
}
