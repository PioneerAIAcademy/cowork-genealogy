import type { Assertion } from '@genealogy/schema'
import type { ResearchDocument } from '../../contract'
import { CONFIDENCE_RANK } from '../../file/model'
import { questionSearches } from './searches'
import { isLive, list, strings } from './view'

/** One record tied to one person, at the strongest of the links between them. */
export interface QuestionLink {
  sourceId: string
  personId: string
  confidence: string
}

/** The live assertions extracted for this question. */
export function questionAssertions(research: ResearchDocument, questionId: string | undefined): Map<string, Assertion> {
  if (!questionId) return new Map()
  return new Map(
    list(research.assertions)
      .filter((a) => isLive(a) && strings(a.extracted_for_question_ids).includes(questionId))
      .map((a) => [a.id, a])
  )
}

/** The question's links: live person_evidence on its live assertions, one per record and person, the strongest. */
export function questionLinks(research: ResearchDocument, questionId: string | undefined): QuestionLink[] {
  const assertions = questionAssertions(research, questionId)
  const best = new Map<string, QuestionLink>()
  for (const link of list(research.person_evidence)) {
    if (!isLive(link) || typeof link.person_id !== 'string') continue
    const assertion = assertions.get(link.assertion_id)
    if (!assertion || typeof assertion.source_id !== 'string') continue
    const key = `${assertion.source_id}\u0000${link.person_id}`
    const now = best.get(key)
    if (!now || (CONFIDENCE_RANK[link.confidence] ?? 0) > (CONFIDENCE_RANK[now.confidence] ?? 0)) {
      best.set(key, { sourceId: assertion.source_id, personId: link.person_id, confidence: link.confidence })
    }
  }
  return [...best.values()]
}

export interface PersonLinks {
  personId: string
  records: number
  /** How many of their records are linked at each strength, strongest first. */
  strengths: Array<[string, number]>
}

/** The question's links per person: the subject first, then the most records. */
export function linksByPerson(links: QuestionLink[], subjectId: string | null): PersonLinks[] {
  const people = new Map<string, Map<string, number>>()
  for (const link of links) {
    const strengths = people.get(link.personId) ?? new Map<string, number>()
    strengths.set(link.confidence, (strengths.get(link.confidence) ?? 0) + 1)
    people.set(link.personId, strengths)
  }
  const rows = [...people].map(([personId, strengths]) => ({
    personId,
    records: [...strengths.values()].reduce((sum, n) => sum + n, 0),
    strengths: [...strengths].sort((a, b) => (CONFIDENCE_RANK[b[0]] ?? 0) - (CONFIDENCE_RANK[a[0]] ?? 0))
  }))
  return rows
    .map((row, order) => ({ row, order }))
    .sort((a, b) => {
      const subject = Number(b.row.personId === subjectId) - Number(a.row.personId === subjectId)
      return subject || b.row.records - a.row.records || a.order - b.order
    })
    .map(({ row }) => row)
}

/** The conflicts stated on the question's live speculative links, each distinct sentence once, in written order. */
export function statedConflicts(research: ResearchDocument, questionId: string | undefined): string[] {
  const assertions = questionAssertions(research, questionId)
  const out = new Set<string>()
  for (const link of list(research.person_evidence)) {
    if (!isLive(link) || link.confidence !== 'speculative' || !assertions.has(link.assertion_id)) continue
    const sentence = typeof link.core_identifier_conflict === 'string' ? link.core_identifier_conflict.trim() : ''
    if (sentence) out.add(sentence)
  }
  return [...out]
}

export interface RuledOut {
  rejected: number
  namesakes: number
}

/** Links the researcher rejected on the question's assertions, and the namesakes its searches or people turned up. */
export function ruledOut(research: ResearchDocument, questionId: string | undefined, links: QuestionLink[]): RuledOut {
  const assertions = questionAssertions(research, questionId)
  const rejected = list(research.rejected_links).filter((row) => assertions.has(row.assertion_id))
  const people = new Set([...links.map((l) => l.personId), ...rejected.map((r) => r.person_id)])
  const searches = new Set(questionSearches(research, questionId).map((entry) => entry.id))
  const namesakes = list(research.namesakes).filter(
    (row) => people.has(row.person_id) || strings(row.log_entry_ids).some((id) => searches.has(id))
  )
  return { rejected: rejected.length, namesakes: namesakes.length }
}
