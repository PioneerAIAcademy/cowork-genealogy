import { statusLabel } from '@genealogy/viewer-ui/status-label'
import type { QuestionState } from '../../contract'

/** A stored value as the researcher reads it: a tier, a shortfall, a verdict. */
export function inWords(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? statusLabel(value) : null
}

const STATE_WORDS: Record<QuestionState, string> = {
  framed: 'question set',
  planned: 'searches planned',
  searching: 'searching',
  'evidence-gathered': 'evidence gathered',
  concluded: 'concluded',
  critiqued: 'concluded and reviewed'
}

export function stateWords(state: QuestionState | null | undefined): string | null {
  return state ? STATE_WORDS[state] ?? null : null
}

// The router's step names, as `questionStatus` writes them at the head of `nextStep`.
const STEP_WORDS: Array<[RegExp, string]> = [
  [/^researcher's choice\b/, 'Your choice: plan more searches, or write up the conclusion.'],
  [/^research-exhaustiveness\b/, 'Check the searches were thorough, then write up the conclusion.'],
  [/^proof-conclusion\b/, 'Write up the conclusion.'],
  [/^conflict-resolution\b/, 'Weigh the evidence that disagrees.'],
  [/^extraction\b/, 'Read the records the searches found.'],
  [/^research-plan\b/, 'Plan the searches.'],
  [/^search-hints\b/, "Review FamilySearch's record hints."],
  [/^search-records\b/, "Search FamilySearch's records."],
  [/^search-external-sites\b/, 'Search another website.'],
  [/^person-evidence\b/, 'Link what the records say to the people they are about.'],
  [/^hypothesis-tracking\b/, 'Weigh the competing sets of parents.']
]

/** The next step named in words. Only the step's name is read; the rest of `nextStep` holds ids. */
export function nextStepWords(nextStep: string | null | undefined): string | null {
  if (typeof nextStep !== 'string') return null
  const step = STEP_WORDS.find(([pattern]) => pattern.test(nextStep.trim()))
  return step ? step[1] : null
}

export function moreInFile(count: number): string | null {
  if (count <= 0) return null
  return count === 1 ? '1 more in the case file.' : `${count} more in the case file.`
}
