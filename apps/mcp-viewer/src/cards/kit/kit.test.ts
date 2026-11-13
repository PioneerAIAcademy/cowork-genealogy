import { describe, expect, it } from 'vitest'
import type { ProofSummary, Question } from '@genealogy/schema'
import { COMPOUND_DOC, FLYNN_DOC, MCANDREW_DOC, status } from '../test-views'
import { conclusionLine, reviewer } from './conclusion'
import { cardView, currentQuestion, latestKind } from './view'
import { nextStepWords } from './words'
import { firstSentence, questionSearches } from './searches'
import type { ResearchDocument } from '../../contract'

describe('the current question', () => {
  it('a named question wins; an unknown name falls back', () => {
    const research = FLYNN_DOC().research!
    expect(currentQuestion(research, 'q_002')?.id).toBe('q_002')
    expect(currentQuestion(research, 'q_999')?.id).toBe('q_001')
  })

  it("is the last question still open by its own status, not by the engine's state (Flynn)", () => {
    expect(currentQuestion(FLYNN_DOC().research!, undefined)?.id).toBe('q_001')
  })

  it('with every question resolved, is the last with a proof (McAndrew)', () => {
    expect(currentQuestion(MCANDREW_DOC().research!, undefined)?.id).toBe('q_001')
  })

  it('a project with no questions has none', () => {
    expect(currentQuestion({}, undefined)).toBeNull()
  })
})

describe('latest', () => {
  it.each([
    ['framed', 'setup'],
    ['planned', 'setup'],
    ['searching', 'search'],
    ['evidence-gathered', 'search'],
    ['concluded', 'conclusion'],
    ['critiqued', 'conclusion']
  ] as const)('%s shows %s', (state, kind) => {
    expect(latestKind(status('q_001', state))).toBe(kind)
  })

  it('no question, or a stub server with no states, shows setup', () => {
    expect(latestKind(null)).toBe('setup')
    expect(cardView({ research: {}, derived: { folderName: 'stub' } }, { show: 'latest' }).status).toBeNull()
  })
})

describe('the conclusion line', () => {
  const question = { question: 'Where was she born?' } as Question
  const proof = (narrative_markdown: string, tier = 'probable') => ({ narrative_markdown, tier }) as ProofSummary

  it('the rest of a bold Conclusion line (the compound proof)', () => {
    const doc = COMPOUND_DOC()
    expect(conclusionLine(doc.research!.proof_summaries![0], question)).toMatch(/^Elizabeth, wife of the English-born/)
  })

  it('the paragraph under a Conclusion heading', () => {
    expect(conclusionLine(proof('# Proof\n\n### Conclusion\n\nShe was born in Ohio.\nIn 1850.\n\nMore.'), question)).toBe(
      'She was born in Ohio. In 1850.'
    )
  })

  it('otherwise the question with the tier in words (Flynn)', () => {
    const doc = FLYNN_DOC()
    const flynn = cardView(doc, { questionId: 'q_001' })
    expect(conclusionLine(flynn.proof, flynn.question)).toBe(`${flynn.question!.question} — likely.`)
  })
})

describe('the reviewer', () => {
  it("is the compound proof's live proof-critique", () => {
    const view = cardView(COMPOUND_DOC(), {})
    expect(reviewer(view.research, view.derived, view.proof, view.question)?.verdict).toBe('looks solid')
  })

  it('is never a craft read (Flynn)', () => {
    const view = cardView(FLYNN_DOC(), { questionId: 'q_001' })
    expect(reviewer(view.research, view.derived, view.proof, view.question)).toBeNull()
  })

  it('is never refused, retired, or one the engine did not report', () => {
    for (const patch of [{ verdict: 'refused' }, { superseded_by: 'ev_002' }, { id: 'ev_009' }]) {
      const doc = COMPOUND_DOC()
      Object.assign(doc.research!.evaluations![0], patch)
      const view = cardView(doc, {})
      expect(reviewer(view.research, view.derived, view.proof, view.question)).toBeNull()
    }
  })

  it('falls back to an on-demand review of the question, after the proof when it has a date', () => {
    const doc = COMPOUND_DOC()
    Object.assign(doc.research!.evaluations![0], { focus: 'on-demand', target_id: 'q_001', timestamp: '2026-10-09T19:12:30Z' })
    let view = cardView(doc, {})
    expect(reviewer(view.research, view.derived, view.proof, view.question)?.verdict).toBe('looks solid')
    doc.research!.proof_summaries![0].updated = '2026-11-01T00:00:00Z'
    view = cardView(doc, {})
    expect(reviewer(view.research, view.derived, view.proof, view.question)).toBeNull()
  })
})

describe("the question's searches", () => {
  const site = (url: string, capture: boolean) => ({ site: 'ancestry', url_generated: url, capture_received: capture })

  it('include the upload that closes one of its website hand-offs, and nothing else', () => {
    const research = {
      plans: [{ id: 'pl_001', question_id: 'q_001', items: [{ id: 'pli_001' }] }],
      log: [
        { id: 'log_001', plan_item_id: 'pli_001', tool: 'external_site', outcome: 'partial', external_site: site('https://a.example/s', false) },
        { id: 'log_002', plan_item_id: null, tool: 'external_site', outcome: 'positive', external_site: site('https://a.example/s', true) },
        { id: 'log_003', plan_item_id: null, tool: 'external_site', outcome: 'partial', external_site: site('https://a.example/s', false) },
        { id: 'log_004', plan_item_id: null, tool: 'external_site', outcome: 'positive', external_site: site('https://b.example/s', true) },
        { id: 'log_005', plan_item_id: 'pli_009', tool: 'record_search', outcome: 'negative', external_site: null }
      ]
    } as unknown as ResearchDocument
    expect(questionSearches(research, 'q_001').map((e) => e.id)).toEqual(['log_001', 'log_002'])
  })

  it('the first sentence of a note, cut at a word when long', () => {
    expect(firstSentence('Found her. Then more.')).toBe('Found her.')
    expect(firstSentence('In St. Louis (MO) she was found.')).toBe('In St. Louis (MO) she was found.')
    expect(firstSentence(`${'word '.repeat(80)}end.`)?.endsWith('…')).toBe(true)
  })
})

describe('the next step in words', () => {
  it.each([
    ['conflict-resolution — unresolved c_001', 'Weigh the evidence that disagrees.'],
    ["researcher's choice: research-plan or proof-conclusion (default proof-conclusion)", 'Your choice: plan more searches, or write up the conclusion.'],
    ['search-external-sites — pli_007 (Ancestry)', 'Search another website.'],
    ['extraction (extraction_append for FamilySearch records, record-structurer for any other source)', 'Read the records the searches found.'],
    ['research-exhaustiveness, then proof-conclusion', 'Check the searches were thorough, then write up the conclusion.'],
    ['proof-conclusion — resolved with no proof summary', 'Write up the conclusion.'],
    ['search-hints — pli_003', "Review FamilySearch's record hints."],
    ['search-records', "Search FamilySearch's records."],
    ['research-plan', 'Plan the searches.'],
    ['person-evidence — none of this question\'s 4 assertions is linked', 'Link what the records say to the people they are about.'],
    ['hypothesis-tracking — competing parent sets: I3', 'Weigh the competing sets of parents.']
  ])('%j', (nextStep, words) => {
    expect(nextStepWords(nextStep)).toBe(words)
  })

  it('an unknown step says nothing', () => {
    expect(nextStepWords('something-new — q_001')).toBeNull()
    expect(nextStepWords(null)).toBeNull()
  })
})
