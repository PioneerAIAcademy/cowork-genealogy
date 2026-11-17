import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectDocument } from '../contract'
import { leftoverIds } from '../rules/id-check'
import { cardView } from './kit/view'
import { CARDS, cardKind } from './registry'
import { COMPOUND_DOC, FLYNN_DOC, FLYNN_PARENT_CONFLICT, FLYNN_WITH_STATED_CONFLICT, MCANDREW_DOC, status } from './test-views'

afterEach(cleanup)

function drawn(document: ProjectDocument, input: Record<string, unknown>, heightLimit?: number) {
  const view = cardView(document, input)
  const Card = CARDS[cardKind(input.show, view)]
  const { container } = render(<Card view={view} heightLimit={heightLimit} />)
  const text = (container.textContent ?? '').replace(/\s+/g, ' ').trim()
  return {
    title: container.querySelector('h1')?.textContent,
    text,
    links: [...container.querySelectorAll('a')].map((a) => ({ label: a.textContent, href: a.getAttribute('href') })),
    container
  }
}

describe('the conclusion card', () => {
  it('McAndrew: the conclusion line and the rating in words, with no id in it', () => {
    const card = drawn(MCANDREW_DOC(), { show: 'conclusion' })
    expect(card.title).toBe('The conclusion')
    expect(card.text).toContain('The evidence proves that exactly one additional child')
    expect(card.text).toContain('well established')
    expect(leftoverIds(card.text)).toEqual([])
  })

  it("the compound proof: the reviewer's verdict is its own point, and the shortfall a doubt", () => {
    const card = drawn(COMPOUND_DOC(), { show: 'conclusion' })
    expect(card.text).toContain("A reviewer's verdict: looks solid.")
    expect(card.text).toContain('Held back by: evidence missing.')
  })

  it('Flynn: a craft read shows no verdict', () => {
    const card = drawn(FLYNN_DOC(), { show: 'conclusion', questionId: 'q_001' })
    expect(card.text).not.toContain('verdict')
  })

  it('shows three doubts in a fixed order and counts the rest', () => {
    const doc = COMPOUND_DOC()
    doc.derived!.questions = [
      status('q_001', 'critiqued', {
        openConflictIds: ['c_001', 'c_002'],
        unregisteredDisagreements: [
          { personId: 'I1', fact: 'birth place', assertionIds: ['a_001', 'a_002'] },
          { personId: 'I2', fact: 'death year', assertionIds: ['a_003', 'a_004'] }
        ]
      })
    ]
    const card = drawn(doc, { show: 'conclusion' })
    const doubts = [...card.container.querySelectorAll('.doubts li')].map((li) => li.textContent)
    expect(doubts).toEqual([
      '2 conflicts in the evidence are not settled.',
      "The records disagree on Elizabeth Mariah Turnbow's birth place, and no conflict records it.",
      "The records disagree on Jonathan Barker's death year, and no conflict records it."
    ])
    expect(card.text).toContain('1 more in the case file.')
    expect(card.text).toContain("A reviewer's verdict: looks solid.")
  })

  it('a question with no proof says so', () => {
    const doc = FLYNN_DOC()
    const card = drawn(doc, { show: 'conclusion', questionId: 'q_002' })
    expect(card.title).toBe('No conclusion yet')
    expect(card.text).toContain('evidence gathered')
  })
})

describe('the setup card', () => {
  it('the goal, the subject as a named link, and the question', () => {
    const card = drawn(COMPOUND_DOC(), { show: 'setup' })
    expect(card.title).toBe('The research is set up')
    expect(card.text).toContain('Determine the true birthplace')
    expect(card.links).toContainEqual({
      label: 'Elizabeth Mariah Turnbow',
      href: 'https://www.familysearch.org/tree/person/details/KWJ6-RPH'
    })
    expect(leftoverIds(card.text)).toEqual([])
  })

  it('names the next step in words, never the router text', () => {
    const doc = FLYNN_DOC()
    doc.derived!.questions = [status('q_001', 'searching', { nextStep: 'search-external-sites — pli_007 (Ancestry)' })]
    const card = drawn(doc, { show: 'setup', questionId: 'q_001' })
    expect(card.text).toContain('Search another website.')
    expect(card.text).not.toContain('pli_007')
  })

  it('with nothing next, says where the question stands instead', () => {
    const card = drawn(COMPOUND_DOC(), { show: 'setup' })
    expect(card.text).toContain('Where it stands')
    expect(card.text).not.toContain('Next')
  })
})

describe('the search card', () => {
  it("counts the question's searches, names the latest in words, and the records kept", () => {
    const card = drawn(COMPOUND_DOC(), { show: 'search' })
    expect(card.title).toBe('Searching')
    expect(card.text).toContain('8 searches: 4 found something, 4 found nothing.')
    expect(card.text).toContain('The latest search')
    expect(card.text).toContain('It found nothing.')
    expect(card.text).toContain('8 records kept')
    expect(card.text).toContain('6 more in the case file.')
    const named = [...card.container.querySelectorAll('.records li')].map((li) => li.textContent)
    expect(named).toHaveLength(2)
    expect(new Set(named).size).toBe(2)
    expect(leftoverIds(card.text)).toEqual([])
  })

  it('a logId input picks that search, and offers its results only when it has them', () => {
    const seen: string[] = []
    const view = cardView(COMPOUND_DOC(), { show: 'search', logId: 'log_002' })
    const { container, rerender } = render(<CARDS.search view={view} onSeeResults={(id) => seen.push(id)} />)
    expect(container.textContent).toContain('This search')
    expect(container.textContent).toContain('It found something.')
    ;(container.querySelector('button') as HTMLButtonElement).click()
    expect(seen).toEqual(['log_002'])
    rerender(<CARDS.search view={cardView(COMPOUND_DOC(), { logId: 'log_001' })} onSeeResults={() => {}} />)
    expect(container.querySelector('button')).toBeNull()
  })

  it('a question with no searches says so', () => {
    const doc = COMPOUND_DOC()
    doc.research!.log = []
    expect(drawn(doc, { show: 'search' }).text).toContain('No searches yet.')
  })
})

describe('the link card', () => {
  const people = (container: HTMLElement) => [...container.querySelectorAll('.people li')].map((li) => li.textContent)

  it('the compound proof: how many records to how many people, the subject first, strengths in words', () => {
    const card = drawn(COMPOUND_DOC(), { show: 'link' })
    expect(card.title).toBe('Linking records to people')
    expect(card.text).toContain('8 records linked to 4 people.')
    expect(people(card.container)).toHaveLength(3)
    expect(people(card.container)[0]).toBe('Elizabeth Mariah Turnbow: 8 records, 5 confident, 3 likely')
    expect(card.text).toContain('And 1 more person.')
    expect(leftoverIds(card.text)).toEqual([])
  })

  it('a speculative link reads as speculative, and a retired link shows nowhere', () => {
    const doc = FLYNN_DOC()
    const research = doc.research!
    const pe001 = research.person_evidence!.find((pe) => pe.id === 'pe_001')!
    research.person_evidence!.push(
      { ...pe001, id: 'pe_090', person_id: 'I2', confidence: 'speculative' },
      { ...pe001, id: 'pe_091', person_id: 'I2', confidence: 'confident', superseded_by: 'retracted' }
    )
    const card = drawn(doc, { show: 'link', questionId: 'q_002' })
    expect(card.text).toContain('1 record linked to 2 people.')
    expect(people(card.container)).toEqual(['Patrick Flynn: 1 record, confident', 'Thomas Flynn: 1 record, speculative'])
  })

  it("a speculative link's stated conflict shows its sentence, and asks nothing", () => {
    const card = drawn(FLYNN_WITH_STATED_CONFLICT(), { show: 'link', questionId: 'q_002' })
    expect(people(card.container)).toContain('Thomas Flynn: 1 record, speculative')
    expect(card.text).toContain(`Speculative because${FLYNN_PARENT_CONFLICT}`)
    expect(card.text).not.toMatch(/same person|different person|\?$/)
    expect(leftoverIds(card.text)).toEqual([])
  })

  it('a stated conflict shows once however many rows carry it, never from a retired row, and past two as a count', () => {
    const doc = FLYNN_WITH_STATED_CONFLICT()
    const evidence = doc.research!.person_evidence!
    const planted = evidence.find((pe) => pe.id === 'pe_092')!
    evidence.push({ ...planted, id: 'pe_093' }, { ...planted, id: 'pe_094', core_identifier_conflict: 'A retired claim.', superseded_by: 'pe_093' })
    let card = drawn(doc, { show: 'link', questionId: 'q_002' })
    expect(card.text.split(FLYNN_PARENT_CONFLICT)).toHaveLength(2)
    expect(card.text).not.toContain('A retired claim.')
    expect(card.text).not.toContain('more in the case file')
    evidence.push({ ...planted, id: 'pe_095', core_identifier_conflict: 'Second.' }, { ...planted, id: 'pe_096', core_identifier_conflict: 'Third.' })
    card = drawn(doc, { show: 'link', questionId: 'q_002' })
    expect(card.text).toContain('Second.')
    expect(card.text).not.toContain('Third.')
    expect(card.text).toContain('And 1 more in the case file.')
  })

  it('ruled out counts rejections and namesakes on a person the question has no link to', () => {
    const doc = FLYNN_DOC()
    const research = doc.research!
    const assertion_id = research.person_evidence!.find((pe) => pe.id === 'pe_001')!.assertion_id
    research.rejected_links = [{ id: 'rl_001', assertion_id, person_id: 'I9', created: '2026-11-16' }]
    research.namesakes = [{ id: 'ns_001', person_id: 'I9', name: 'Patrick Flynn', place: 'Cork', record_ids: [], created: '2026-11-16' }]
    const card = drawn(doc, { show: 'link', questionId: 'q_002' })
    expect(card.text).toContain('Ruled out1 link rejected, 1 namesake.')
    expect(drawn(FLYNN_DOC(), { show: 'link', questionId: 'q_002' }).text).not.toContain('Ruled out')
  })

  it('a question with no links says so', () => {
    const doc = COMPOUND_DOC()
    doc.research!.person_evidence = []
    expect(drawn(doc, { show: 'link' }).text).toContain('No records linked yet.')
  })
})

describe('the registry', () => {
  it('latest follows the question: concluded shows the conclusion, evidence gathered the link card', () => {
    expect(drawn(MCANDREW_DOC(), { show: 'latest' }).title).toBe('The conclusion')
    expect(drawn(FLYNN_DOC(), { show: 'latest', questionId: 'q_002' }).title).toBe('Linking records to people')
  })

  it('every step has a card, and a stub names the question', () => {
    for (const show of Object.keys(CARDS)) {
      const card = drawn(COMPOUND_DOC(), { show })
      expect(card.title).toBeTruthy()
      expect(leftoverIds(card.text)).toEqual([])
      cleanup()
    }
    expect(drawn(COMPOUND_DOC(), { show: 'hypothesis' }).text).toContain('Where was Elizabeth Mariah Barker')
  })

  it('a value that is no step, even an inherited name, follows latest', () => {
    expect(drawn(MCANDREW_DOC(), { show: 'toString' }).title).toBe('The conclusion')
  })

  it('the host height limit caps the card', () => {
    const card = drawn(MCANDREW_DOC(), { show: 'conclusion' }, 320)
    expect((card.container.querySelector('.card') as HTMLElement).style.maxHeight).toBe('320px')
  })
})
