import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PROJECT_META_KEY, READ_PROJECT_VIEW, type ProjectDocument } from '../contract'
import { leftoverIds } from '../rules/id-check'
import { FakeApp, sessionOn } from '../test/fake-app'
import { Viewer } from '../ui/Viewer'
import { COMPARE_DOCUMENT, STARTING_TREE } from './compare-fixture'

afterEach(cleanup)

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ')

async function open(document: ProjectDocument, input: Record<string, unknown>) {
  const app = new FakeApp()
  app.callServerTool.mockImplementation(async ({ name }) => {
    if (name !== READ_PROJECT_VIEW) throw new Error('unexpected tool')
    return { content: [], structuredContent: document as Record<string, unknown> }
  })
  const session = sessionOn(app)
  render(<Viewer session={session} />)
  await act(() => session.start())
  await act(async () => {
    app.sendInput({ projectPath: '/proj_00000000000000aa', ...input })
    app.sendResult({ content: [], _meta: { [PROJECT_META_KEY]: document } })
  })
  return { app, session }
}

const doc = (): ProjectDocument => structuredClone(COMPARE_DOCUMENT)
const main = () => document.querySelector('.file-main')
const pane = () => screen.getByRole('complementary', { name: 'Details' })

describe('Compare with FamilySearch', () => {
  it('opens on the date the tree was read, with the counts, and holds no id', async () => {
    await open(doc(), { show: 'file', page: 'compare' })
    const nav = screen.getByRole('navigation', { name: 'Pages' })
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['The case', 'Compare with FamilySearch', 'People', 'Sources'])
    expect(text(main())).toContain('Against FamilySearch as it stood on 1 November 2026.')
    expect(text(main())).toContain('1 new relative, 3 people with new findings, 1 possible relative.')
    expect(text(main())).toContain('Added by this research, confident')
    expect(text(main())).toContain('Not on FamilySearch')
    expect(text(main())).toContain('FamilySearch: 1850, Illinois, United States')
    expect(leftoverIds(text(document.body))).toEqual([])
  })

  it("links each record to its own page on FamilySearch, and opens it in the pane", async () => {
    await open(doc(), { show: 'file', page: 'compare' })
    const links = [...main()!.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(links).toContain('https://www.familysearch.org/ark:/61903/1:1:AAAA-111')
    await act(async () => {
      fireEvent.click(within(main() as HTMLElement).getAllByRole('button', { name: 'Open' })[0])
    })
    expect(pane()).toBeTruthy()
  })
})

describe('People', () => {
  it('draws the family around the subject, each with their relation, the added ones marked', async () => {
    await open(doc(), { show: 'file', page: 'people' })
    const page = text(main())
    expect(page).toContain("Patrick Flynn Mary's father")
    expect(page).toContain("Bridget Flynn Mary's mother")
    expect(page).toContain("Kate Kelly Mary's daughter")
    expect(page).toContain("Thomas Flynn Mary's brother")
    const kate = [...main()!.querySelectorAll('.person')].find((p) => p.textContent?.includes('Kate'))
    expect(text(kate ?? null)).toContain('Added by this research')
    const patrick = [...main()!.querySelectorAll('.person')].find((p) => p.textContent?.includes('Patrick'))
    expect(text(patrick ?? null)).not.toContain('Added by this research')
  })
})

describe('the person page', () => {
  it('reads their life in time order with its records, the gaps, the namesakes and what was ruled out', async () => {
    await open(doc(), { show: 'file', page: 'people', personId: 'I1' })
    const page = text(pane())
    expect(page).toContain('The subject of this research')
    expect(page).toContain('Their life in time order')
    expect(page).toMatch(/Birth: 1850, Illinois, United States · Marriage record, confident/)
    expect(page).toContain('From the records')
    expect(page).toContain('1851 to 1879: no census')
    expect(page).toContain('No census found for 1860 or 1870.')
    expect(page).toContain('The census puts her in Chicago, the tree in St Paul.')
    expect(page).toContain('Not the same person as')
    expect(page).toContain('Another Mary Flynn, born in Cork')
    expect(page).toContain('Ruled out')
    expect(page).toContain('That is her brother, not her.')
    expect(page).not.toContain('1700')
    expect(page).not.toContain('1 January 1849')
    expect(leftoverIds(page)).toEqual([])
  })

  it("an added person's page says so, with their strength", async () => {
    await open(doc(), { show: 'file', page: 'people', personId: 'I4' })
    expect(text(pane())).toContain("Mary's daughter")
    expect(text(pane())).toContain('Added by this research, confident')
  })
})

const SEARCHING = (): ProjectDocument => {
  const d = doc()
  const r = d.research as Record<string, unknown>
  r.questions = [{ id: 'q_001', question: 'Who were Mary’s parents?', status: 'in_progress' }]
  r.plans = [{ id: 'pl_001', question_id: 'q_001', status: 'active', items: [{ id: 'pli_001' }] }]
  r.log = [
    { id: 'log_001', tool: 'record_search', plan_item_id: 'pli_001', performed: '2026-11-02T00:00:00Z', query: { surname: 'Flynn' }, outcome: 'positive', results_examined: 3, results_ref: 'results/log_001.json' }
  ]
  d.derived = {
    ...d.derived,
    questions: [{ id: 'q_001', state: 'evidence-gathered', nextStep: null, openConflictIds: [], storedStatus: 'in_progress', unregisteredDisagreements: [], competingParentSets: [] }]
  }
  return d
}

const LINE = "This research found 1 new relative and 8 new facts that aren't on FamilySearch yet"

describe("the card's Compare line", () => {
  it('shows under the conclusion card and opens the file on Compare', async () => {
    const { session } = await open(doc(), { show: 'conclusion' })
    const line = screen.getByRole('button', { name: LINE })
    await act(async () => {
      fireEvent.click(line)
    })
    expect(session.getState().filePage).toBe('compare')
    expect(main()?.querySelector('h2')?.textContent).toBe('Compare with FamilySearch')
  })

  it('shows under latest even when its card already has two buttons', async () => {
    await open(SEARCHING(), { show: 'latest' })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Searching')
    expect(screen.getByRole('button', { name: 'See the results' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open the case file' })).toBeTruthy()
    expect(screen.getByRole('button', { name: LINE })).toBeTruthy()
  })

  it('is absent on another card, with no starting tree, and when nothing is new', async () => {
    await open(doc(), { show: 'setup' })
    expect(screen.queryByRole('button', { name: LINE })).toBeNull()
    cleanup()
    const none = doc()
    delete none.startingTree
    await open(none, { show: 'conclusion' })
    expect(document.querySelector('.card-line')).toBeNull()
    cleanup()
    const same = doc()
    same.tree = STARTING_TREE
    ;(same.research as Record<string, unknown>).person_evidence = []
    await open(same, { show: 'conclusion' })
    expect(document.querySelector('.card-line')).toBeNull()
  })
})
