import { describe, it, expect, vi } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, act } from '@testing-library/react'
import { ResearchDataProvider } from '../../../contexts/ResearchDataProvider'
import { useResearchData, type ResearchDataState } from '../../../contexts/ResearchDataContext'
import SidecarPanel from '../SidecarPanel'
import type { ResearchTransport } from '../../../transport'
import type { SidecarFile } from '../../../lib/schema'

// Regression for the focus-trap-react + React StrictMode "flash-close": when the
// drawer mounts, StrictMode (dev) simulates an unmount, which fires the trap's
// componentWillUnmount -> onDeactivate. If onDeactivate is wired to closeSidecar,
// the just-opened drawer slams shut. This test drives the REAL provider (so
// openSidecar/closeSidecar actually mutate state) under <StrictMode> and asserts
// the drawer survives the open.

const payload: SidecarFile = {
  log_id: 'log_001',
  tool: 'record_search',
  retrieved: '2026-05-04T10:00:00Z',
  returned_count: 0,
  payload: { results: [] }
}

function makeTransport(): ResearchTransport {
  return {
    getProjectState: async () => ({ research: null, gedcomx: null, label: null }),
    subscribe: () => () => {},
    readSidecar: async () => ({ raw: JSON.stringify(payload), mtime: 100 }),
    openExternal: () => {},
    submitFeedback: async () => ({ ok: true })
  }
}

describe('SidecarPanel — survives StrictMode open (focus-trap onDeactivate flash-close)', () => {
  it('stays open after openSidecar under StrictMode', async () => {
    vi.clearAllMocks()
    let ctx: ResearchDataState | null = null
    function Probe(): null {
      ctx = useResearchData()
      return null
    }

    render(
      <StrictMode>
        <ResearchDataProvider transport={makeTransport()}>
          <Probe />
          <SidecarPanel />
        </ResearchDataProvider>
      </StrictMode>
    )

    // Open the drawer and let the StrictMode mount/unmount/remount + the async
    // readSidecar settle.
    await act(async () => {
      ctx!.openSidecar('log_001')
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(ctx!.sidecar.status).not.toBe('closed')
    expect(screen.queryByRole('dialog')).toBeInTheDocument()
  })
})
