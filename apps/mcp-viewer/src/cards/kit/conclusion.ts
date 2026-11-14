import type { EvaluationEntry, ProofSummary, Question } from '@genealogy/schema'
import type { Derived, ResearchDocument } from '../../contract'
import { liveEvaluations } from './view'
import { inWords } from './words'

const OPENER = /^(?:#{1,6}\s+(.*)|\*\*([^*\n]+)\*\*[:.]?\s*(.*))$/

/** The paragraph under the narrative's first heading, or first line opening with a
 *  bold run, whose text says "conclusion"; else the question with the tier in words. */
export function conclusionLine(proof: ProofSummary | null, question: Question | null): string | null {
  const narrative = typeof proof?.narrative_markdown === 'string' ? proof.narrative_markdown : ''
  const lines = narrative.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const match = OPENER.exec(lines[i].trim())
    if (!match) continue
    const heading = match[1] ?? match[2] ?? ''
    if (!/conclusion/i.test(heading)) continue
    const rest = match[3]?.trim()
    if (rest) return rest
    const paragraph: string[] = []
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].trim()
      if (line === '') {
        if (paragraph.length > 0) break
        continue
      }
      if (OPENER.test(line) && paragraph.length === 0 && /^#/.test(line)) break
      paragraph.push(line)
    }
    if (paragraph.length > 0) return paragraph.join(' ')
  }
  const text = typeof question?.question === 'string' ? question.question.trim() : ''
  const tier = inWords(proof?.tier)
  if (!text) return null
  return tier ? `${text} — ${tier}.` : text
}

export interface Reviewer {
  entry: EvaluationEntry
  verdict: string
}

function newest(entries: EvaluationEntry[]): EvaluationEntry | null {
  return [...entries].sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? ''))).at(-1) ?? null
}

/** The newest live, non-refused, non-craft review of the proof; else the newest such
 *  on-demand one on the question, written after the proof's `updated` when it has one. */
export function reviewer(
  research: ResearchDocument,
  derived: Derived,
  proof: ProofSummary | null,
  question: Question | null
): Reviewer | null {
  if (!proof) return null
  const usable = liveEvaluations(research).filter(
    (e) => e.verdict !== 'refused' && derived.evaluations?.[e.id] !== undefined && !derived.evaluations[e.id].craft
  )
  const onProof = newest(usable.filter((e) => e.target_id === proof.id))
  const after = typeof proof.updated === 'string' ? proof.updated : null
  const entry =
    onProof ??
    newest(
      usable.filter(
        (e) =>
          e.focus === 'on-demand' &&
          question !== null &&
          e.target_id === question.id &&
          (after === null || String(e.timestamp ?? '') > after)
      )
    )
  if (!entry) return null
  return { entry, verdict: inWords(entry.verdict) ?? 'reviewed' }
}
