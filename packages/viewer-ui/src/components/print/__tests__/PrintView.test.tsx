import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, within, cleanup } from '@testing-library/react'
import type { ResearchData } from '../../../lib/schema'
import { sectionComponents } from '../../../sections'
import { SECTION_ORDER } from '../../layout/Sidebar'
import { buildMockContext } from '../../../contexts/__tests__/mockContext'
import {
  patrickFlynnResearch,
  patrickFlynnGedcomx,
  patrickFlynnCollections
} from '../../../lib/__fixtures__/patrick-flynn'

vi.mock('../../../contexts/ResearchDataContext', async () => {
  const actual = await vi.importActual<typeof import('../../../contexts/ResearchDataContext')>(
    '../../../contexts/ResearchDataContext'
  )
  return { ...actual, useResearchData: vi.fn() }
})

import { useResearchData } from '../../../contexts/ResearchDataContext'
import PrintView, { printOrder } from '../PrintView'

const fullContext = (): ReturnType<typeof buildMockContext> =>
  buildMockContext({
    research: patrickFlynnResearch,
    gedcomx: patrickFlynnGedcomx,
    collections: patrickFlynnCollections
  })

/** What each section shows for an empty project: the copy that must NOT appear
 *  when it is printed from the full fixture. */
function emptyStateTexts(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const [key, Component] of Object.entries(sectionComponents)) {
    vi.mocked(useResearchData).mockReturnValue(
      buildMockContext({ research: {} as ResearchData, gedcomx: null, activeSection: key })
    )
    const { container, unmount } = render(<Component />)
    out.set(
      key,
      Array.from(container.querySelectorAll('p'))
        .map((p) => p.textContent?.trim() ?? '')
        .filter(Boolean)
    )
    unmount()
  }
  return out
}

function printRoot(): HTMLElement {
  const root = document.getElementById('print-root')
  if (!root) throw new Error('#print-root is not mounted')
  return root
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('print', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('printOrder', () => {
  it('lists every registered section exactly once', () => {
    const order = printOrder()
    expect([...order].sort()).toEqual(Object.keys(sectionComponents).sort())
    expect(new Set(order).size).toBe(order.length)
  })

  it('the sidebar order names exactly the registered sections', () => {
    expect(SECTION_ORDER.map((s) => s.key).sort()).toEqual(Object.keys(sectionComponents).sort())
  })
})

describe('the fixture covers every section', () => {
  // If a section has no data in the fixture, the PrintView test below would only
  // prove that section prints its empty state. This fails first, naming it.
  for (const [key, Component] of Object.entries(sectionComponents)) {
    it(`${key} has content in the fixture`, () => {
      const empty = emptyStateTexts().get(key) ?? []
      expect(empty.length).toBeGreaterThan(0)
      vi.mocked(useResearchData).mockReturnValue(fullContext())
      const { container } = render(<Component />)
      const text = container.textContent ?? ''
      for (const line of empty) expect(text).not.toContain(line)
    })
  }
})

describe('PrintView', () => {
  it('prints every section, expanded, with no on-screen controls', () => {
    const empty = emptyStateTexts()
    vi.mocked(useResearchData).mockReturnValue(fullContext())
    render(<PrintView onDone={() => {}} />)
    const root = printRoot()
    const text = root.textContent ?? ''

    // Every section printed, and none fell back to its error boundary.
    const printed = Array.from(root.querySelectorAll('[data-print-section]'))
    expect(printed.map((el) => el.getAttribute('data-print-section'))).toEqual(printOrder())
    for (const el of printed) expect(el.querySelector('h2')).not.toBeNull()
    expect(within(root).queryAllByRole('alert')).toHaveLength(0)
    for (const lines of empty.values()) {
      for (const line of lines) expect(text).not.toContain(line)
    }

    // Expanded: a card body, every log detail row, the whole transcription.
    expect(within(root).getByText('His Records')).toBeInTheDocument()
    expect(within(root).getAllByText('Query')).toHaveLength(patrickFlynnResearch.log.length)
    const transcription = patrickFlynnResearch.sources.find((s) => s.transcription)!.transcription!
    expect(transcription.length).toBeGreaterThan(300)
    expect(text).toContain(transcription.slice(-25))

    // Nothing that only works on screen.
    expect(within(root).queryAllByText(/^[▾▸]$/)).toHaveLength(0)
    expect(within(root).queryByText('Show more')).toBeNull()
    expect(within(root).queryByText(/^View \d+ (of \d+ )?results →$/)).toBeNull()
  })

  it('opens the print dialog once, and reports when it closes', async () => {
    vi.mocked(useResearchData).mockReturnValue(fullContext())
    const onDone = vi.fn()
    const { rerender } = render(<PrintView onDone={onDone} />)
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1))

    // A re-render with a fresh callback, as Header gives it, must not print again.
    const onDoneLater = vi.fn()
    rerender(<PrintView onDone={onDoneLater} />)
    await new Promise((r) => setTimeout(r, 50))
    expect(window.print).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event('afterprint'))
    expect(onDoneLater).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('removes #print-root when unmounted', () => {
    vi.mocked(useResearchData).mockReturnValue(fullContext())
    const { unmount } = render(<PrintView onDone={() => {}} />)
    expect(document.getElementById('print-root')).not.toBeNull()
    unmount()
    expect(document.getElementById('print-root')).toBeNull()
  })
})
