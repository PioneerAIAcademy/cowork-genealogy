import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../contexts/ResearchDataContext', async () => {
  const actual = await vi.importActual<typeof import('../contexts/ResearchDataContext')>(
    '../contexts/ResearchDataContext'
  )
  return { ...actual, useResearchData: vi.fn() }
})

import { useResearchData } from '../contexts/ResearchDataContext'
import { buildMockContext } from '../contexts/__tests__/mockContext'
import { FolderNotice } from '../App'

// The banner is the half that was silently broken before #1317's fix — the
// message reached state but never became pixels. These pin that it renders and
// that dismiss clears it, so deleting <FolderNotice /> can't pass green again.
describe('FolderNotice', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the notice message when one is set', () => {
    vi.mocked(useResearchData).mockReturnValue(
      buildMockContext({ notice: 'research.json is in a subfolder — wrong folder level' })
    )
    render(<FolderNotice />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'research.json is in a subfolder — wrong folder level'
    )
  })

  it('renders nothing when there is no notice', () => {
    vi.mocked(useResearchData).mockReturnValue(buildMockContext({ notice: null }))
    const { container } = render(<FolderNotice />)
    expect(container).toBeEmptyDOMElement()
  })

  it('calls clearNotice when the dismiss button is clicked', async () => {
    const clearNotice = vi.fn()
    vi.mocked(useResearchData).mockReturnValue(
      buildMockContext({ notice: 'heads up', clearNotice })
    )
    render(<FolderNotice />)
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(clearNotice).toHaveBeenCalledTimes(1)
  })
})
