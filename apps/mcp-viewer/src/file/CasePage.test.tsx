import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { COMPOUND_DOC, FLYNN_DOC, MCANDREW_DOC } from '../cards/test-views'
import { PROJECT_META_KEY, READ_PROJECT_VIEW, type ProjectDocument } from '../contract'
import { leftoverIds } from '../rules/id-check'
import { FakeApp, sessionOn } from '../test/fake-app'
import { Viewer } from '../ui/Viewer'

afterEach(cleanup)

async function caseOn(document: ProjectDocument, input: Record<string, unknown> = {}, recordSearch: string | null = null) {
  const app = new FakeApp()
  app.callServerTool.mockImplementation(async ({ name, arguments: args }) => {
    if (name !== READ_PROJECT_VIEW) throw new Error('unexpected tool')
    if (args?.part === 'recordSearch') return { content: [], structuredContent: recordSearch ? { found: true, logId: recordSearch } : { found: false } }
    if (args?.part === 'results') return { content: [], structuredContent: { found: false } }
    return { content: [], structuredContent: document as Record<string, unknown> }
  })
  const session = sessionOn(app)
  render(<Viewer session={session} />)
  await act(() => session.start())
  await act(async () => {
    app.sendInput({ show: 'file', page: 'case', projectPath: '/proj_0123456789abcdef', ...input })
    app.sendResult({ content: [], _meta: { [PROJECT_META_KEY]: document } })
  })
  return { app }
}

const body = () => (document.body.textContent ?? '').replace(/\s+/g, ' ')

describe('The case', () => {
  it('the compound proof: its conclusion line, its rating, the reviewer and their narrative, and no id', async () => {
    const doc = COMPOUND_DOC()
    doc.derived!.evaluations = { ev_001: { body: { verdict: 'looks_solid', narrative_for_user: 'The birthplace argument holds.' }, craft: false } }
    await caseOn(doc)
    expect(body()).toContain('Elizabeth, wife of the English-born blacksmith')
    expect(body()).toContain('likely')
    expect(body()).toContain('Verdict: looks solid')
    expect(body()).toContain('The birthplace argument holds.')
    expect(body()).toContain('The whole argument')
    expect(leftoverIds(body())).toEqual([])
  })

  it('a review whose notes cannot be read shows its verdict alone; a craft read shows none', async () => {
    await caseOn(COMPOUND_DOC())
    expect(body()).toContain('Verdict: looks solid')
    expect(document.querySelector('#case-reviewer .prose')).toBeNull()
    cleanup()
    await caseOn(FLYNN_DOC(), { questionId: 'q_001' })
    expect(body()).not.toContain('Verdict:')
  })

  it("the conflict's resolution, a planted identity conflict's question, and a hypothesis's claim", async () => {
    const doc = COMPOUND_DOC()
    const research = doc.research!
    research.conflicts!.push({
      ...research.conflicts![0],
      id: 'c_009',
      conflict_type: 'identity',
      identity_question: 'Is the Elizabeth of 1850 the Elizabeth of 1880?',
      resolution_rationale: undefined as never
    })
    research.hypotheses = [
      { id: 'h_001', claim: 'She was born in Alabama.', status: 'supported', related_question_ids: ['q_001'], supporting_assertion_ids: [], contradicting_assertion_ids: [], ruled_out: false, ruled_out_reason: null, notes: '' } as never
    ]
    await caseOn(doc)
    const c001 = research.conflicts![0].resolution_rationale as string
    expect(body()).toContain(c001.slice(0, 40))
    expect(body()).toContain('Is the Elizabeth of 1850 the Elizabeth of 1880?')
    expect(body()).toContain('She was born in Alabama.')
  })

  it('What was searched: each item, what it found, and planItemId marks its item', async () => {
    await caseOn(COMPOUND_DOC(), { planItemId: 'pli_003' })
    const marked = document.querySelector('.marked')
    expect(marked?.id).toBe('case-pli_003')
    expect(document.querySelectorAll('#case-searched .found').length).toBeGreaterThan(0)
  })

  it('a project with no proof shows So far; the question switch picks another question', async () => {
    await caseOn(FLYNN_DOC(), { questionId: 'q_002' })
    expect(body()).toContain('So far')
    fireEvent.change(screen.getByRole('combobox', { name: /Question/ }), { target: { value: 'q_001' } })
    expect(body()).toContain('The conclusion')
  })

  it("a record's pane says which search found it: its own entry, else the record search that holds it", async () => {
    const doc = COMPOUND_DOC()
    const { app } = await caseOn(doc, { sourceId: 'src_002' })
    await waitFor(() => expect(document.querySelector('.file-pane')?.textContent).toContain('Found by'))
    expect(app.reads().some((r) => r?.part === 'recordSearch')).toBe(false)
    cleanup()
    const other = COMPOUND_DOC()
    const source = other.research!.sources!.find((s) => s.id === 'src_002')!
    source.log_entry_id = 'log_004'
    const second = await caseOn(other, { sourceId: 'src_002' }, 'log_008')
    await waitFor(() => expect(document.querySelector('.file-pane')?.textContent).toContain('Found by'))
    expect(second.app.reads()).toContainEqual({ part: 'recordSearch', id: expect.stringMatching(/^ark:\/61903\/1:1:/), projectPath: '/proj_0123456789abcdef' })
  })

  it('a retired assertion appears nowhere on the page', async () => {
    const doc = COMPOUND_DOC()
    const research = doc.research!
    const retired = research.proof_summaries![0].supporting_assertion_ids[0]
    const value = research.assertions!.find((a) => a.id === retired)!
    value.superseded_by = 'a_999'
    value.value = 'PLANTED RETIRED VALUE'
    await caseOn(doc)
    expect(body()).not.toContain('PLANTED RETIRED VALUE')
  })

  it("McAndrew's locality shows its quirks and guide under Sources' Background", async () => {
    await caseOn(MCANDREW_DOC(), { page: 'sources' })
    const locality = MCANDREW_DOC().research!.localities![0]
    expect(body()).toContain(locality.place)
    expect(document.querySelector('section h3')?.textContent).toBeTruthy()
    expect([...document.querySelectorAll('h3')].map((h) => h.textContent)).not.toContain('Other websites')
    expect(leftoverIds(body())).toEqual([])
  })

  it('outside collections sit in a closed Other websites group per place, after Background and out of Direct mentions', async () => {
    const doc = MCANDREW_DOC()
    const row = (place: string, n: number, url = `https://www.ancestry.com/search/collections/${n}/`) => ({
      key: `ancestry:${n}`,
      url,
      link_text: `Planted collection ${n}`,
      record_types: ['Census'],
      place,
      cost: 'paid',
      content_type: 'index',
      start_year: '1900',
      end_year: '1940'
    })
    const outer = 'Mississippi, United States'
    const inner = 'Scott, Mississippi, United States'
    const partial = 'Hinds, Mississippi, United States'
    const places: Record<string, { rows: ReturnType<typeof row>[]; too_large?: true }> = {
      [inner]: { rows: [row(inner, 3)] },
      'Leake, Mississippi, United States': { rows: [] },
      'Alabama, United States': { rows: [], too_large: true },
      [outer]: { rows: [row(outer, 1), row(outer, 2, 'http://example.org/2')] },
      [partial]: { rows: [row(partial, 5)], too_large: true }
    }
    doc.collections = { places }
    await caseOn(doc, { page: 'sources' })
    const summaryFor = (place: string, count: string) =>
      `Other websites with records for ${place} (${count}). FamilySearch’s list, for planning: being listed here does not mean a site was searched or paid for.`
    const section = (title: string) => [...document.querySelectorAll('section')].find((s) => s.querySelector('h3')?.textContent === title)
    const mentions = section('Direct mentions')
    const background = section('Background')
    const other = section('Other websites')
    expect(mentions).toBeDefined()
    expect(background).toBeDefined()
    expect(other).toBeDefined()
    expect(background!.compareDocumentPosition(other!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const [place, { rows, too_large }] of Object.entries(places)) {
      for (const { link_text, url } of rows) {
        expect(mentions!.textContent).not.toContain(link_text)
        expect(background!.textContent).not.toContain(link_text)
        const items = [...document.querySelectorAll('li')].filter((li) => li.textContent?.startsWith(link_text))
        expect(items).toHaveLength(1)
        expect(mentions!.contains(items[0])).toBe(false)
        expect(background!.contains(items[0])).toBe(false)
        expect(items[0].querySelector('a')?.getAttribute('href') ?? null).toBe(url.startsWith('https://') ? url : null)
        expect(items[0].textContent).toBe(`${link_text}Census · 1900–1940`)
        const details = items[0].closest('details')
        expect(details).not.toBeNull()
        expect(details!.hasAttribute('open')).toBe(false)
        expect(details!.querySelector('summary')?.textContent).toBe(summaryFor(place, too_large ? `${rows.length} of a longer list` : `${rows.length}`))
        expect(details!.querySelector('summary')?.textContent).toContain('searched')
      }
    }
    expect([...other!.querySelectorAll('details > summary')].map((s) => s.textContent)).toEqual([
      summaryFor(partial, '1 of a longer list'),
      summaryFor(outer, '2'),
      summaryFor(inner, '1')
    ])
    expect(leftoverIds(body())).toEqual([])
  })

  it('a malformed collections file draws only its good rows, and Background is absent with no locality', async () => {
    const doc = MCANDREW_DOC()
    doc.research!.localities = []
    doc.collections = {
      places: {
        'Null Entry Place': null,
        'String Entry Place': 'not a place',
        'Leake, Mississippi, United States': {
          rows: [
            { link_text: '', url: 'https://example.org/4' },
            { link_text: '', url: 'http://example.org/7' },
            { link_text: { text: 'Object Link Text' }, url: 'http://example.org/5' },
            'String Row'
          ]
        }
      }
    }
    await caseOn(doc, { page: 'sources' })
    expect(body()).toContain('Other websites with records for Leake, Mississippi, United States (2).')
    expect(document.querySelector('a[href="https://example.org/4"]')?.textContent).toBe('A collection')
    expect(document.querySelector('a[href="https://example.org/4"]')?.closest('li')?.querySelector('p')).toBeNull()
    expect([...document.querySelectorAll('li')].map((li) => li.textContent)).toContain('http://example.org/7')
    expect(document.querySelector('a[href="http://example.org/7"]')).toBeNull()
    expect(body()).not.toContain('Null Entry Place')
    expect(body()).not.toContain('String Entry Place')
    expect(body()).not.toContain('String Row')
    expect([...document.querySelectorAll('h3')].map((h) => h.textContent)).not.toContain('Background')
    cleanup()
    const listed = MCANDREW_DOC()
    listed.collections = { places: [{ rows: [{ link_text: 'Planted collection 6', url: 'https://example.org/6' }] }] }
    await caseOn(listed, { page: 'sources' })
    expect(body()).not.toContain('Planted collection 6')
    expect(document.querySelectorAll('details > summary').length).toBe(0)
  })
})
