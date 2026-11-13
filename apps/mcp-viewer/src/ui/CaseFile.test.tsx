import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COMPOUND_DOC } from '../cards/test-views'
import { PROJECT_META_KEY, READ_PROJECT_VIEW, type ProjectDocument } from '../contract'
import { installLinkOpener } from '../rules/links'
import { FakeApp, sessionOn } from '../test/fake-app'
import { Viewer } from './Viewer'

const RESULTS_002 = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../eval/fixtures/scenarios/compound-objective-fully-covered/results/log_002.json'), 'utf-8')
)
const IMAGE_URL = 'https://example.test/img?t=signed'

let uninstall: () => void = () => {}

afterEach(() => {
  uninstall()
  cleanup()
})

/** A card on snapshot A, with a host whose current document is B. */
async function cardOn(snapshot: ProjectDocument, current: ProjectDocument, input: Record<string, unknown> = { show: 'search' }) {
  const app = new FakeApp()
  app.callServerTool.mockImplementation(async ({ name, arguments: args }) => {
    if (name !== READ_PROJECT_VIEW) throw new Error('unexpected tool')
    if (args?.part === 'document') return { content: [], structuredContent: current as Record<string, unknown> }
    if (args?.part === 'results') {
      const found = args.id === 'log_002'
      return { content: [], structuredContent: found ? { found, results: RESULTS_002 } : { found } }
    }
    return { content: [], structuredContent: { url: IMAGE_URL, expiresAt: 1 } }
  })
  const session = sessionOn(app)
  uninstall = installLinkOpener(document, (url) => app.openLink({ url }))
  render(<Viewer session={session} />)
  await act(() => session.start())
  act(() => {
    app.sendInput({ ...input, projectPath: '/proj_0123456789abcdef' })
    app.sendResult({ content: [], _meta: { [PROJECT_META_KEY]: snapshot } })
  })
  return { app, session }
}

async function openFile(name = 'Open the case file') {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

const opened = (app: FakeApp) => app.openLink.mock.calls.map(([params]) => params.url)

describe('the case file', () => {
  let current: ProjectDocument

  beforeEach(() => {
    current = COMPOUND_DOC()
    current.research!.project!.objective = 'Document B objective'
  })

  it("opens on today's document, with no Export GEDCOM, Print or Send Feedback", async () => {
    const { app } = await cardOn(COMPOUND_DOC(), current)
    await openFile()
    await waitFor(() => expect(screen.getByText('Document B objective')).toBeTruthy())
    expect(app.reads().filter((r) => r?.part === 'document')).toHaveLength(1)
    for (const name of ['Export GEDCOM', 'Print', 'Send Feedback']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('carries its styles only while open', async () => {
    await cardOn(COMPOUND_DOC(), current)
    expect(document.querySelector('style[data-case-file]')).toBeNull()
    await openFile()
    expect(document.querySelector('style[data-case-file]')).not.toBeNull()
    await openFile('Back to the card')
    await waitFor(() => expect(document.querySelector('style[data-case-file]')).toBeNull())
  })

  it("See the results opens the side panel on that search's results, and Open in FamilySearch opens once", async () => {
    const { app } = await cardOn(COMPOUND_DOC(), current, { show: 'search', logId: 'log_002' })
    await openFile('See the results')
    const panel = await screen.findByRole('dialog')
    expect(app.reads()).toContainEqual({ part: 'results', id: 'log_002', projectPath: '/proj_0123456789abcdef' })
    const open = await within(panel).findAllByRole('button', { name: /Open in FamilySearch/ })
    fireEvent.click(open[0])
    await waitFor(() => expect(opened(app)).toHaveLength(1))
    expect(opened(app)[0]).toMatch(/^https:\/\/www\.familysearch\.org\//)
  })

  it('Sources shows the signed page image and the transcription', async () => {
    const source = current.research!.sources![0] as unknown as Record<string, unknown>
    source.image_filename = 'images/page-1.jpg'
    source.transcription = 'Elizabeth Barker, born Alabama.'
    const { app } = await cardOn(COMPOUND_DOC(), current)
    await openFile()
    fireEvent.click(await screen.findByRole('button', { name: /^Sources/ }))
    fireEvent.click(document.getElementById(source.id as string)!.firstElementChild!)
    await waitFor(() => expect(document.querySelector(`img[src="${IMAGE_URL}"]`)).not.toBeNull())
    expect(screen.getByText('Elizabeth Barker, born Alabama.')).toBeTruthy()
    expect(app.reads()).toContainEqual({ part: 'image', id: 'images/page-1.jpg', projectPath: '/proj_0123456789abcdef' })
  })

  it('every link opens once through the host and none moves the frame; an http source opens nothing', async () => {
    const research = current.research!
    research.proof_summaries![0].narrative_markdown += '\n\nSee [x](https://evil.example) and https://example.com/page.'
    research.log![0].notes = 'Captured at https://example.org/note.'
    const source = research.sources![0] as unknown as Record<string, unknown>
    source.url = 'http://insecure.example/record'
    const { app } = await cardOn(COMPOUND_DOC(), current)
    await openFile()

    fireEvent.click(await screen.findByRole('button', { name: /^Findings/ }))
    fireEvent.click(document.getElementById(research.proof_summaries![0].id)!.firstElementChild!)
    for (const href of ['https://evil.example', 'https://example.com/page']) {
      const anchor = await waitFor(() => document.querySelector(`a[href="${href}"]`) as HTMLAnchorElement)
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      anchor.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }

    fireEvent.click(screen.getByRole('button', { name: /^Research Log/ }))
    fireEvent.click(document.getElementById(research.log![0].id)!.firstElementChild!)
    const note = await waitFor(() => document.querySelector('a[href="https://example.org/note"]') as HTMLAnchorElement)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    note.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /^Sources/ }))
    fireEvent.click(document.getElementById(source.id as string)!.firstElementChild!)
    fireEvent.click(await screen.findByRole('button', { name: 'http://insecure.example/record' }))

    await waitFor(() => expect(opened(app)).toHaveLength(3))
    expect(opened(app)).toEqual(['https://evil.example/', 'https://example.com/page', 'https://example.org/note'])
  })

  it('a failed read keeps the snapshot', async () => {
    const { app } = await cardOn(COMPOUND_DOC(), current)
    app.callServerTool.mockRejectedValue(new Error('Store down.'))
    await openFile()
    await waitFor(() => expect(screen.getAllByText(/Elizabeth Mariah/).length).toBeGreaterThan(0))
    expect(screen.queryByText('Document B objective')).toBeNull()
  })
})
