import type { EvaluationEntry, ProofSummary, Question } from '@genealogy/schema'
import type { Derived, DerivedQuestion, ProjectDocument, ResearchDocument, Show, ToolInput } from '../../contract'
import { buildRuleIndex, type RuleIndex } from '../../rules/rule-index'

/** Everything a card reads, built once per document. */
export interface CardView {
  research: ResearchDocument
  derived: Derived
  index: RuleIndex
  input: ToolInput
  question: Question | null
  status: DerivedQuestion | null
  proof: ProofSummary | null
}

/** A section as a list, whatever an older or half-written document holds there. */
export function list<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'object' && item !== null) : []
}

/** A list of ids or words, whatever an older or half-written document holds there. */
export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function isLive(row: { superseded_by?: unknown }): boolean {
  return row.superseded_by === undefined || row.superseded_by === null
}

function isResolved(question: Question): boolean {
  return question.status === 'resolved' || Boolean(question.resolved)
}

export function proofFor(research: ResearchDocument, questionId: string | undefined): ProofSummary | null {
  if (!questionId) return null
  return list(research.proof_summaries).filter((p) => p.question_id === questionId).at(-1) ?? null
}

/** `questionId` when the project has it; else the last unresolved question; else the last with a proof. */
export function currentQuestion(research: ResearchDocument, questionId: unknown): Question | null {
  const questions = list(research.questions).filter((q) => typeof q.id === 'string')
  const named = typeof questionId === 'string' ? questions.find((q) => q.id === questionId) : undefined
  if (named) return named
  const open = questions.filter((q) => !isResolved(q))
  if (open.length > 0) return open[open.length - 1]
  return questions.filter((q) => proofFor(research, q.id)).at(-1) ?? null
}

export type CardKind = Exclude<Show, 'latest' | 'file'>

/** The card `latest` shows, from the current question's state. Until M2: planned shows setup. */
export function latestKind(status: DerivedQuestion | null): CardKind {
  switch (status?.state) {
    case 'searching':
    case 'evidence-gathered':
      return 'search'
    case 'concluded':
    case 'critiqued':
      return 'conclusion'
    default:
      return 'setup'
  }
}

export function cardView(document: ProjectDocument, input: ToolInput): CardView {
  const research: ResearchDocument = document.research ?? {}
  const derived: Derived = document.derived ?? {}
  const question = currentQuestion(research, input.questionId)
  const status = question ? (list(derived.questions).find((q) => q.id === question.id) ?? null) : null
  return {
    research,
    derived,
    index: buildRuleIndex({ research, tree: document.tree }),
    input,
    question,
    status,
    proof: proofFor(research, question?.id)
  }
}

export function liveEvaluations(research: ResearchDocument): EvaluationEntry[] {
  return list(research.evaluations).filter(isLive)
}
