import React from 'react'
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
 */
export function DecisionCard({
  questions,
  onAnswer
}: {
  questions: DecisionQuestion[]
  onAnswer: (answer: string) => void
}): React.JSX.Element | null {
  if (!questions || questions.length === 0) return null
  const q = questions[0]
  const options = q.options ?? []
  const recommended = recommendedOption(options)

  return (
    <div className="decisionCard">
      <div className="decisionQuestion">{q.question}</div>
      <div className="decisionOptions">
        {options.map((o, i) => {
          const isRec = recommended != null && o.label === recommended.label
          return (
            <button
              key={i}
              type="button"
              className={`decisionOption ${isRec ? 'decisionRecommended' : ''}`}
              onClick={() => onAnswer(stripRecommendedMarker(o.label))}
            >
              <span className="decisionLabel">{stripRecommendedMarker(o.label)}</span>
              {isRec && <span className="decisionBadge">Recommended</span>}
              {o.description && <span className="decisionWhy">{o.description}</span>}
            </button>
          )
        })}
      </div>
      {/* Both escapes are hidden when there is nothing to recommend: a "not sure"
          that cannot name an option would send an answer meaning nothing. */}
      {recommended && (
        <div className="decisionEscapes">
          <button
            type="button"
            className="decisionEscape"
            title={`Carry on with ${stripRecommendedMarker(recommended.label)}`}
            onClick={() => onAnswer(stripRecommendedMarker(recommended.label))}
          >
            I&rsquo;m not sure — use your judgement
          </button>
          <button
            type="button"
            className="decisionEscape"
            onClick={() => onAnswer('Something else — I will explain')}
          >
            Something else
          </button>
        </div>
      )}
    </div>
  )
}
