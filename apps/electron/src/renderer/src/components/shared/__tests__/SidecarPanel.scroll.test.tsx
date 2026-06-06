import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
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

function setSidecar(sidecar: SidecarState): void {
  vi.mocked(useResearchData).mockReturnValue(buildMockContext({ sidecar }))
}

// Scroll preservation across watcher refresh works for free because the
// provider transitions loaded(v1) -> loaded(v2) WITHOUT flashing through
// loading. React reconciliation reuses the same body <div>, and scrollTop
// is a DOM property the browser persists across re-renders.
//
// This test asserts the underlying mechanism: across a loaded -> loaded
// transition the body <div> DOM node identity is preserved (which means
// scrollTop on it is preserved by definition).

describe('SidecarPanel — scroll preservation across watcher refresh', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps the same drawer DOM node across loaded -> loaded payload swap', () => {
    setSidecar({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      lastMtime: 1
    })
    const { rerender, container } = render(<SidecarPanel />)
    const firstDrawer = container.querySelector('[role="dialog"]')
    expect(firstDrawer).not.toBeNull()

    // Simulate the watcher firing and the payload getting refreshed with a
    // new mtime + an appended result. The provider transitions
    // loaded(mtime=1) -> loaded(mtime=2) without going through loading.
    const refreshedPayload = {
      ...patrickFlynnSidecar,
      returned_count: 2,
      payload: {
        results: [
          ...(patrickFlynnSidecar.payload.results ?? []),
          {
            primaryId: 'P9',
            recordTitle: 'Newly Added Census Record',
            score: 0.5
          }
        ]
      }
    }
    setSidecar({
      status: 'loaded',
      logId: 'log_001',
      payload: refreshedPayload,
      lastMtime: 2
    })
    rerender(<SidecarPanel />)
    const secondDrawer = container.querySelector('[role="dialog"]')

    // React's reconciler should reuse the same DOM node since the dialog's
    // position in the tree and element type are stable. If this fails,
    // scroll position will reset on every watcher refresh.
    expect(secondDrawer).toBe(firstDrawer)
  })

  it('preserves scrollTop on the drawer body across loaded -> loaded transitions', () => {
    setSidecar({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      lastMtime: 1
    })
    const { rerender, container } = render(<SidecarPanel />)
    const dialog = container.querySelector('[role="dialog"]')
    // jsdom doesn't actually scroll, but we can write the property and
    // confirm the same DOM node still holds it after rerender.
    const body = dialog?.querySelector('[class*="body"]') as HTMLElement
    expect(body).toBeTruthy()
    body.scrollTop = 250

    setSidecar({
      status: 'loaded',
      logId: 'log_001',
      payload: { ...patrickFlynnSidecar, returned_count: 1 },
      lastMtime: 2
    })
    rerender(<SidecarPanel />)

    const bodyAfter = container.querySelector('[role="dialog"] [class*="body"]') as HTMLElement
    expect(bodyAfter).toBe(body)
    // jsdom does not implement scroll layout, but the property persists on
    // the same node — which is what would carry the user's scroll position
    // in a real browser.
    expect(bodyAfter.scrollTop).toBe(250)
  })
})
