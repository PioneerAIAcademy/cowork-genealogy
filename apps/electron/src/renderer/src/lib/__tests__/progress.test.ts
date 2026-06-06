import { describe, it, expect } from 'vitest'
import { inferProgress } from '../progress'
import type { StageInfo } from '../progress'
import { patrickFlynnResearch, emptyResearch } from '../__fixtures__/patrick-flynn'
import type { ResearchData } from '../schema'

function statusMap(stages: StageInfo[]): Record<string, string> {
  return Object.fromEntries(stages.map((s) => [s.name, s.status]))
}

describe('inferProgress', () => {
  it('returns all stages pending for empty research (no project)', () => {
    const data = { ...emptyResearch, project: undefined } as unknown as ResearchData
    const result = inferProgress(data)
    const map = statusMap(result)
    expect(map.init).toBe('active') // first stage is active, not pending
    expect(map.question_selection).toBe('pending')
    expect(map.proof_summary).toBe('pending')
  })

  it('returns init completed, question_selection active for empty arrays', () => {
    const result = inferProgress(emptyResearch)
    const map = statusMap(result)
    expect(map.init).toBe('completed')
    expect(map.question_selection).toBe('active')
    expect(map.research_plan).toBe('pending')
    expect(map.search_records).toBe('pending')
    expect(map.extraction).toBe('pending')
    expect(map.analysis).toBe('pending')
    expect(map.proof_summary).toBe('pending')
  })

  it('returns all completed for Patrick Flynn fixture', () => {
    const result = inferProgress(patrickFlynnResearch)
    const map = statusMap(result)
    expect(map.init).toBe('completed')
    expect(map.question_selection).toBe('completed')
    expect(map.research_plan).toBe('completed')
    expect(map.search_records).toBe('completed')
    expect(map.extraction).toBe('completed')
    expect(map.analysis).toBe('completed')
    expect(map.proof_summary).toBe('completed')
  })

  it('shows partial progression (questions + plans, no log yet)', () => {
    const data: ResearchData = {
      ...emptyResearch,
      questions: [patrickFlynnResearch.questions[0]],
      plans: [patrickFlynnResearch.plans[0]]
    }
    const result = inferProgress(data)
    const map = statusMap(result)
    expect(map.init).toBe('completed')
    expect(map.question_selection).toBe('completed')
    expect(map.research_plan).toBe('completed')
    expect(map.search_records).toBe('active')
    expect(map.extraction).toBe('pending')
  })

  it('analysis completed by person_evidence alone (no conflicts or hypotheses)', () => {
    const data: ResearchData = {
      ...emptyResearch,
      questions: [patrickFlynnResearch.questions[0]],
      plans: [patrickFlynnResearch.plans[0]],
      log: [patrickFlynnResearch.log[0]],
      assertions: [patrickFlynnResearch.assertions[0]],
      person_evidence: [patrickFlynnResearch.person_evidence[0]]
    }
    const result = inferProgress(data)
    const map = statusMap(result)
    expect(map.analysis).toBe('completed')
    expect(map.proof_summary).toBe('active')
  })

  it('returns exactly 7 stages', () => {
    const result = inferProgress(emptyResearch)
    expect(result).toHaveLength(7)
  })

  it('stage labels are human-readable', () => {
    const result = inferProgress(emptyResearch)
    expect(result[0].label).toBe('Init')
    expect(result[6].label).toBe('Proof Summary')
  })
})
