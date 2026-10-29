import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../contexts/ResearchDataContext', async () => {
  const actual = await vi.importActual<
    typeof import('../../../contexts/ResearchDataContext')
  >('../../../contexts/ResearchDataContext')
  return { ...actual, useResearchData: vi.fn() }
})

import { useResearchData } from '../../../contexts/ResearchDataContext'
import { buildMockContext } from '../../../contexts/__tests__/mockContext'
import Sidebar from '../Sidebar'

function throwingStorage(): void {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    },
    setItem: () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

// A private window with site data blocked throws on every localStorage access.
// getInitialTheme() runs inside useState, so an unguarded read takes the whole
// component tree down rather than losing one remembered preference.
describe('Sidebar survives unavailable storage', () => {
  it('renders and defaults to light when reading theme throws', () => {
    vi.mocked(useResearchData).mockReturnValue(buildMockContext())
    throwingStorage()

    render(<Sidebar />)

    expect(screen.getByTitle('Switch to dark mode')).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('still applies the theme when writing it throws', async () => {
    vi.mocked(useResearchData).mockReturnValue(buildMockContext())
    throwingStorage()
    const user = userEvent.setup()

    render(<Sidebar />)
    await user.click(screen.getByTitle('Switch to dark mode'))

    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('Sidebar Collections entry', () => {
  it('counts every stored collection row across places', () => {
    const row = {
      key: 'k',
      url: 'https://example.com/',
      link_text: 'A',
      record_types: ['Census', 'Tax'],
      place: 'P',
      cost: '',
      content_type: '',
      start_year: '',
      end_year: ''
    }
    vi.mocked(useResearchData).mockReturnValue(
      buildMockContext({
        collections: {
          places: { A: { rows: [row, { ...row, key: 'k2' }] }, B: { rows: [{ ...row, key: 'k3' }] } }
        }
      })
    )

    render(<Sidebar />)

    const entry = screen.getByRole('button', { name: /Collections/ })
    expect(entry).toHaveTextContent('Collections3')
  })
})
