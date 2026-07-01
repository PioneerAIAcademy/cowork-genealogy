import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SidecarPanel from '../SidecarPanel'
import { patrickFlynnSidecar } from '../../../lib/__fixtures__/patrick-flynn-sidecar'
import type { SidecarState } from '../../../contexts/ResearchDataContext'
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

function mountWithState(
  sidecar: SidecarState,
  extras: Partial<Parameters<typeof buildMockContext>[0]> = {}
): {
  openSidecar: ReturnType<typeof vi.fn>
  closeSidecar: ReturnType<typeof vi.fn>
  clearFocusPersona: ReturnType<typeof vi.fn>
} {
  const openSidecar = vi.fn()
  const closeSidecar = vi.fn()
  const clearFocusPersona = vi.fn()
  vi.mocked(useResearchData).mockReturnValue(
    buildMockContext({
      sidecar,
      openSidecar,
      closeSidecar,
      clearFocusPersona,
      ...extras
    })
  )
  return { openSidecar, closeSidecar, clearFocusPersona }
}

describe('SidecarPanel — status branches', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders nothing when status is closed', () => {
    mountWithState({ status: 'closed' })
    const { container } = render(<SidecarPanel />)
    expect(container.firstChild).toBeNull()
  })

  it('renders header + loading message when status is loading', () => {
    mountWithState({ status: 'loading', logId: 'log_042' })
    render(<SidecarPanel />)
    expect(screen.getByText('Record Search Results')).toBeInTheDocument()
    expect(screen.getByText('log_042')).toBeInTheDocument()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders missing-file copy when status is missing', () => {
    mountWithState({ status: 'missing', logId: 'log_042' })
    render(<SidecarPanel />)
    expect(screen.getByText('Results file not found')).toBeInTheDocument()
    expect(screen.getByText(/results\/log_042\.json/)).toBeInTheDocument()
  })

  it('renders error block + Try again button when status is error', async () => {
    const { openSidecar, closeSidecar } = mountWithState({
      status: 'error',
      logId: 'log_042',
      error: 'Sidecar exceeds 10MB cap'
    })
    render(<SidecarPanel />)
    expect(screen.getByText("Couldn't load results")).toBeInTheDocument()
    expect(screen.getByText('Sidecar exceeds 10MB cap')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(openSidecar).toHaveBeenCalledWith('log_042')

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(closeSidecar).toHaveBeenCalled()
  })

  it('renders the result card body when status is loaded', () => {
    mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      lastMtime: 1
    })
    render(<SidecarPanel />)
    // Header
    expect(screen.getByText('Record Search Results')).toBeInTheDocument()
    expect(screen.getByText('log_001')).toBeInTheDocument()
    // Summary strip
    expect(screen.getByText(/TOOL\s+record_search/)).toBeInTheDocument()
    // The first card title (from the fixture)
    expect(screen.getByText('New York State Census, 1865')).toBeInTheDocument()
    // PRIMARY pill renders because Patrick (P1) is the primary
    expect(screen.getByText('PRIMARY')).toBeInTheDocument()
    // Persons subview shows household members in order
    expect(screen.getByText('Patrick Flynn')).toBeInTheDocument()
    expect(screen.getByText('Mary Flynn')).toBeInTheDocument()
    expect(screen.getByText('Thomas Flynn')).toBeInTheDocument()
    expect(screen.getByText('Bridget Flynn')).toBeInTheDocument()
    // Relationship labels render as the raw word (CSS uppercases visually)
    expect(screen.getByText('Wife')).toBeInTheDocument()
    expect(screen.getByText('Father')).toBeInTheDocument()
    expect(screen.getByText('Mother')).toBeInTheDocument()
  })

  it('renders the MATCHED pill on the focused person', () => {
    mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      focusPersonaId: 'P2', // Mary
      lastMtime: 1
    })
    render(<SidecarPanel />)
    expect(screen.getByText('MATCHED')).toBeInTheDocument()
  })

  it('renders the empty-results message when payload has no results', () => {
    mountWithState({
      status: 'loaded',
      logId: 'log_999',
      payload: { ...patrickFlynnSidecar, payload: { results: [] }, returned_count: 0 },
      lastMtime: 1
    })
    render(<SidecarPanel />)
    expect(screen.getByText('This search returned no results.')).toBeInTheDocument()
  })

  it('renders treeMatches when present and non-empty', () => {
    mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      lastMtime: 1
    })
    render(<SidecarPanel />)
    expect(screen.getByText('Tree matches')).toBeInTheDocument()
    expect(screen.getByText('Patrick Flynn (Schuylkill County)')).toBeInTheDocument()
    expect(screen.getByText('Patrick J. Flynn')).toBeInTheDocument()
  })
})

describe('SidecarPanel — dismiss affordances', () => {
  beforeEach(() => vi.clearAllMocks())

  it('clicking the X button calls closeSidecar', async () => {
    const { closeSidecar } = mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      lastMtime: 1
    })
    render(<SidecarPanel />)
    await userEvent.click(screen.getByRole('button', { name: 'Close sidecar' }))
    expect(closeSidecar).toHaveBeenCalled()
  })

  it('clicking the backdrop calls closeSidecar', async () => {
    const { closeSidecar } = mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      lastMtime: 1
    })
    render(<SidecarPanel />)
    await userEvent.click(screen.getByTestId('sidecar-backdrop'))
    expect(closeSidecar).toHaveBeenCalled()
  })

  it('pressing Escape calls closeSidecar', async () => {
    const { closeSidecar } = mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      lastMtime: 1
    })
    render(<SidecarPanel />)
    await userEvent.keyboard('{Escape}')
    expect(closeSidecar).toHaveBeenCalled()
  })
})

describe('SidecarPanel — clearFocusPersona', () => {
  beforeEach(() => vi.clearAllMocks())

  it('clicking inside the drawer body clears focusPersonaId', async () => {
    const { clearFocusPersona } = mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      focusPersonaId: 'P2',
      lastMtime: 1
    })
    render(<SidecarPanel />)
    // Click the drawer dialog itself (not the close button, not the backdrop)
    await userEvent.click(screen.getByRole('dialog'))
    expect(clearFocusPersona).toHaveBeenCalled()
  })

  it('does not call clearFocusPersona when focusPersonaId is already absent', async () => {
    const { clearFocusPersona } = mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      lastMtime: 1
    })
    render(<SidecarPanel />)
    await userEvent.click(screen.getByRole('dialog'))
    expect(clearFocusPersona).not.toHaveBeenCalled()
  })
})
