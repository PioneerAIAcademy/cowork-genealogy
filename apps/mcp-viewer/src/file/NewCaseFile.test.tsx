import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { COMPOUND_DOC } from '../cards/test-views'
import { PROJECT_META_KEY, READ_PROJECT_VIEW, type ProjectDocument } from '../contract'
import { leftoverIds } from '../rules/id-check'
import { installLinkOpener } from '../rules/links'
import { FakeApp, sessionOn } from '../test/fake-app'
import { Viewer } from '../ui/Viewer'

const RESULTS_002 = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../eval/fixtures/scenarios/compound-objective-fully-covered/results/log_002.json'), 'utf-8')
)
const IMAGE_URL = 'https://example.test/img?t=signed'

let uninstall: () => void = () => {}
afterEach(() => {
  uninstall()
  cleanup()
})

type Reads = { results?: 'ok' | 'gone' | 'fail' }

async function fileOn(document: ProjectDocument, input: Record<string, unknown>, reads: Reads = {}) {
  const app = new FakeApp()
  app.callServerTool.mockImplementation(async ({ name, arguments: args }) => {
    if (name !== READ_PROJECT_VIEW) throw new Error('unexpected tool')
    if (args?.part === 'results') {
      if (reads.results === 'fail') throw new Error('Store down.')
      return { content: [], structuredContent: reads.results === 'gone' ? { found: false } : { found: true, results: RESULTS_002 } }
    }
    if (args?.part === 'image') return { content: [], structuredContent: { url: IMAGE_URL, expiresAt: 1 } }
    return { content: [], structuredContent: document as Record<string, unknown> }
  })
  const session = sessionOn(app)
  uninstall = installLinkOpener(document_(), (url) => app.openLink({ url }))
  render(<Viewer session={session} />)
  await act(() => session.start())
  await act(async () => {
    app.sendInput({ show: 'file', projectPath: '/proj_0123456789abcdef', ...input })
    app.sendResult({ content: [], _meta: { [PROJECT_META_KEY]: document } })
  })
  return { app, session }
}

function document_() {
  return globalThis.document
}

const pane = () => screen.getByRole('complementary', { name: 'Details' })
const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ')

describe('the new case file', () => {
  it('shows only the pages with content, opens the one asked for, and holds no id', async () => {
    await fileOn(COMPOUND_DOC(), { page: 'log' })
    const nav = screen.getByRole('navigation', { name: 'Pages' })
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Sources', 'Log'])
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Log')
    expect(leftoverIds(text(document_().body))).toEqual([])
    fireEvent.click(within(nav).getByRole('button', { name: 'Sources' }))
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Sources')
    expect(leftoverIds(text(document_().body))).toEqual([])
  })

  it('a source chip carries each person and their link strength', async () => {
    await fileOn(COMPOUND_DOC(), { page: 'sources' })
    const chips = [...document_().querySelectorAll('.chip')].map(text)
    expect(chips.length).toBeGreaterThan(0)
    expect(chips.every((c) => /(well established|likely|tentative|confident|speculative)/i.test(c))).toBe(true)
  })

  it('sourceId opens the record: page image beside the transcription, then its findings in words', async () => {
    const doc = COMPOUND_DOC()
    const source = doc.research!.sources![0] as unknown as Record<string, unknown>
    source.image_filename = 'images/page-1.jpg'
    source.transcription = 'Elizabeth Barker, born Alabama.'
    const { app } = await fileOn(doc, { page: 'sources', sourceId: source.id })
    await waitFor(() => expect(pane().querySelector(`img[src="${IMAGE_URL}"]`)).not.toBeNull())
    expect(text(pane())).toContain('Elizabeth Barker, born Alabama.')
    expect(text(pane())).toContain('What it says')
    expect(leftoverIds(text(pane()))).toEqual([])
    expect(app.reads()).toContainEqual({ part: 'image', id: 'images/page-1.jpg', projectPath: '/proj_0123456789abcdef' })
    const onFamilySearch = within(pane()).getByRole('link', { name: 'On FamilySearch' })
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    onFamilySearch.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    await waitFor(() => expect(app.openLink).toHaveBeenCalledTimes(1))
  })

  it("logId opens the search with its results; a missing file says so; a failed read offers Try again", async () => {
    await fileOn(COMPOUND_DOC(), { page: 'log', logId: 'log_002' })
    await waitFor(() => expect(text(pane())).toContain('What it found'))
    await waitFor(() => expect(pane().querySelectorAll('.file-item').length).toBeGreaterThan(0))
    expect(leftoverIds(text(pane()))).toEqual([])
    cleanup()
    await fileOn(COMPOUND_DOC(), { page: 'log', logId: 'log_002' }, { results: 'gone' })
    await waitFor(() => expect(text(pane())).toContain('These results were not kept.'))
    cleanup()
    await fileOn(COMPOUND_DOC(), { page: 'log', logId: 'log_002' }, { results: 'fail' })
    await waitFor(() => expect(within(pane()).getByRole('button', { name: 'Try again' })).toBeTruthy())
  })

  it('personId opens the person, with the records that name them; a retired link names nothing', async () => {
    const doc = COMPOUND_DOC()
    for (const link of doc.research!.person_evidence!) if (link.person_id === 'I2') link.superseded_by = 'pe_999'
    await fileOn(doc, { page: 'sources', personId: 'I1' })
    expect(text(pane())).toContain('Elizabeth Mariah Turnbow')
    expect(text(pane())).toContain('Records that name them')
    cleanup()
    await fileOn(doc, { page: 'sources', personId: 'I2' })
    expect(text(pane())).not.toContain('Records that name them')
  })

  it('opening an item tells the model what the researcher is looking at, and posts nothing', async () => {
    const { app } = await fileOn(COMPOUND_DOC(), { page: 'sources' })
    fireEvent.click(document_().querySelector('.chip .open-link') as Element)
    await waitFor(() => expect(app.updateModelContext).toHaveBeenCalledTimes(1))
    expect(app.updateModelContext.mock.calls[0][0].content[0].text).toMatch(/^In the case file, the researcher is looking at /)
  })

  it('the search box finds a person and opens them', async () => {
    await fileOn(COMPOUND_DOC(), { page: 'sources' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the case file' }), { target: { value: 'Turnbow' } })
    fireEvent.click(screen.getAllByRole('button', { name: /Turnbow/ }).find((b) => b.closest('.file-search-hits'))!)
    expect(text(pane())).toContain('Elizabeth Mariah Turnbow')
  })

  it('show: file with no page still opens the case file of today', async () => {
    await fileOn(COMPOUND_DOC(), {})
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull()
    await waitFor(() => expect(screen.getByText('Research Viewer')).toBeTruthy())
  })
})
