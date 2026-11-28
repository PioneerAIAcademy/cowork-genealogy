import { describe, expect, it } from 'vitest'
import type { ProofSummary, Question } from '@genealogy/schema'
import { COMPOUND_DOC, FLYNN_DOC, MCANDREW_DOC, status } from '../test-views'
import { conclusionLine, reviewer } from './conclusion'
import { cardView, currentQuestion, latestKind } from './view'
import { nextStepWords } from './words'
import { firstSentence, questionSearches } from './searches'
import { linksByPerson, questionLinks, ruledOut } from './links'
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

describe("the question's links", () => {
  it('one per record and person, the strongest (the compound proof)', () => {
    const links = questionLinks(COMPOUND_DOC().research!, 'q_001')
    expect(new Set(links.map((l) => l.sourceId)).size).toBe(8)
    expect(links).toHaveLength(16)
    // src_006 ties I1 by one `probable` link only; src_005 by `confident` ones.
    expect(links.find((l) => l.sourceId === 'src_006' && l.personId === 'I1')?.confidence).toBe('probable')
    expect(links.find((l) => l.sourceId === 'src_005' && l.personId === 'I1')?.confidence).toBe('confident')
  })

  it("another question's links, and a retired link, are not the question's", () => {
    const research = FLYNN_DOC().research!
    expect(questionLinks(research, 'q_002').map((l) => l.personId)).toEqual(['I1'])
    research.person_evidence![0].superseded_by = 'pe_099'
    expect(questionLinks(research, 'q_002')).toEqual([])
  })

  it('per person: the subject first, then the most records, strongest strength first', () => {
    const links = [
      { sourceId: 's1', personId: 'A', confidence: 'probable' },
      { sourceId: 's2', personId: 'A', confidence: 'probable' },
      { sourceId: 's1', personId: 'S', confidence: 'speculative' },
      { sourceId: 's2', personId: 'S', confidence: 'confident' }
    ]
    expect(linksByPerson(links, 'S')).toEqual([
      { personId: 'S', records: 2, strengths: [['confident', 1], ['speculative', 1]] },
      { personId: 'A', records: 2, strengths: [['probable', 2]] }
    ])
    expect(linksByPerson(links, null).map((p) => p.personId)).toEqual(['A', 'S'])
  })

  it("ruled out: rejections on the question's assertions, and namesakes by its searches or people", () => {
    const research = FLYNN_DOC().research!
    const onQuestion = research.person_evidence!.find((pe) => pe.id === 'pe_001')!.assertion_id
    const offQuestion = research.person_evidence!.find((pe) => pe.id === 'pe_002')!.assertion_id
    const rejected = (assertion_id: string, person_id: string) => ({ id: `rl_${person_id}`, assertion_id, person_id, created: '2026-11-16' })
    const namesake = (person_id: string, log_entry_ids: string[] = []) => ({
      id: `ns_${person_id}`, person_id, name: 'Patrick Flynn', place: 'Cork', record_ids: [], log_entry_ids, created: '2026-11-16'
    })
    // I9 has no live link on q_002: matching on linked people alone would find nothing.
    research.rejected_links = [rejected(onQuestion, 'I9'), rejected(offQuestion, 'I8')]
    research.namesakes = [namesake('I9'), namesake('I7')]
    expect(ruledOut(research, 'q_002', questionLinks(research, 'q_002'))).toEqual({ rejected: 1, namesakes: 1 })
  })
})

describe('latest', () => {
  it.each([
    ['framed', 'question'],
    ['planned', 'setup'],
    ['searching', 'search'],
    ['evidence-gathered', 'link'],
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
    ['locality-guide, then research-plan', 'Plan the searches.'],
    ['person-evidence — none of this question\'s 4 assertions is linked', 'Link what the records say to the people they are about.'],
    ['hypothesis-tracking — competing parent sets: I3', 'Weigh the competing sets of parents.'],
    ['hypothesis-tracking — unlinked kin: I2, I3', 'Set out how these people might be related before relying on it.']
  ])('%j', (nextStep, words) => {
    expect(nextStepWords(nextStep)).toBe(words)
  })

  it('an unknown step says nothing', () => {
    expect(nextStepWords('something-new — q_001')).toBeNull()
    expect(nextStepWords(null)).toBeNull()
  })
})
