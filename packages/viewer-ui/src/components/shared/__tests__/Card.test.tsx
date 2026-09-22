import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Card from '../Card'
import { buildMockContext } from '../../../contexts/__tests__/mockContext'

vi.mock('../../../contexts/ResearchDataContext', async () => {
  const actual = await vi.importActual<typeof import('../../../contexts/ResearchDataContext')>(
    '../../../contexts/ResearchDataContext'
  )
  return {
    ...actual,
    useResearchData: vi.fn()
  }
})

import { useResearchData } from '../../../contexts/ResearchDataContext'

function renderCard() {
  const ctx = buildMockContext({ research: null, gedcomx: null })
  vi.mocked(useResearchData).mockReturnValue(ctx)
  return render(
    <Card id="test-card" title="Known Information title text">
      <p>body content</p>
    </Card>
  )
}

function nearestUserSelect(el: Element | null): string {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const v = getComputedStyle(e).userSelect
    if (v) return v
  }
  return 'auto'
}

describe('Card', () => {
  it('title text is selectable (no user-select: none in its ancestor chain)', () => {
    renderCard()
    const title = screen.getByText('Known Information title text')
    expect(nearestUserSelect(title)).not.toBe('none')
  })

  it('a plain click on the header still toggles expanded', async () => {
    renderCard()
    expect(screen.queryByText('body content')).not.toBeInTheDocument()
    const header = screen.getByText('Known Information title text').parentElement!
    await userEvent.click(header)
    expect(screen.getByText('body content')).toBeInTheDocument()
  })

  it('a drag across the header does not toggle expanded', () => {
    renderCard()
    expect(screen.queryByText('body content')).not.toBeInTheDocument()
    const header = screen.getByText('Known Information title text').parentElement!
    fireEvent.mouseDown(header, { clientX: 10, clientY: 10 })
    fireEvent.mouseUp(header, { clientX: 220, clientY: 12 })
    fireEvent.click(header, { clientX: 220, clientY: 12 })
    expect(screen.queryByText('body content')).not.toBeInTheDocument()
  })
})
