import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { ResearchDataProvider } from '../ResearchDataProvider'
import { useResearchData, type ResearchDataState } from '../ResearchDataContext'
import type { SidecarFile } from '../../lib/schema'

// ============================================================
// Test harness
// ============================================================

// Capture the context value so each test can inspect / drive it.
function makeHarness(): {
  ctx: () => ResearchDataState
  render: () => void
} {
  let latest: ResearchDataState | null = null
  function Probe(): null {
    latest = useResearchData()
    return null
  }
  return {
    ctx: () => {
      if (!latest) throw new Error('Provider not rendered yet')
      return latest
    },
    render: () => {
      render(
        <ResearchDataProvider>
          <Probe />
        </ResearchDataProvider>
      )
    }
  }
}

// Capture the onSidecarUpdated callback so tests can fire fake events.
let sidecarUpdatedHandler: ((e: { logId: string; mtime: number }) => void) | null = null

function installApiMock(readSidecar: ReturnType<typeof vi.fn>): void {
  sidecarUpdatedHandler = null
  ;(window as unknown as { api: unknown }).api = {
    openExternal: vi.fn(),
    openFile: vi.fn(() => Promise.resolve(null)),
    getVersion: vi.fn(() => Promise.resolve('test')),
    submitFeedback: vi.fn(() => Promise.resolve({ ok: true })),
    getSessionLog: vi.fn(() => Promise.resolve({ entries: [], sizeBytes: 0 })),
    getState: vi.fn(() => Promise.resolve({ folderPath: null, research: null, gedcomx: null })),
    selectFolder: vi.fn(() => Promise.resolve(null)),
    onResearchUpdated: vi.fn(),
    onGedcomxUpdated: vi.fn(),
    onWatchError: vi.fn(),
    onSidecarUpdated: vi.fn((cb: (e: { logId: string; mtime: number }) => void) => {
      sidecarUpdatedHandler = cb
    }),
    removeAllWatchListeners: vi.fn(),
    readSidecar
  }
}

const samplePayload: SidecarFile = {
  log_id: 'log_001',
  tool: 'record_search',
  retrieved: '2026-05-04T10:00:00Z',
  returned_count: 1,
  payload: { results: [] }
}

// ============================================================
// State machine transitions (D9)
// ============================================================

describe('ResearchDataProvider — SidecarState transitions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in status=closed', () => {
    installApiMock(vi.fn())
    const h = makeHarness()
    h.render()
    expect(h.ctx().sidecar).toEqual({ status: 'closed' })
  })

  it('closed + openSidecar -> loading -> loaded', async () => {
    const readSidecar = vi.fn(() =>
      Promise.resolve({ raw: JSON.stringify(samplePayload), mtime: 100 })
    )
    installApiMock(readSidecar)
    const h = makeHarness()
    h.render()

    await act(async () => {
      h.ctx().openSidecar('log_001')
    })

    await waitFor(() => {
      expect(h.ctx().sidecar.status).toBe('loaded')
    })
    const sc = h.ctx().sidecar
    expect(sc.status === 'loaded' && sc.payload.log_id).toBe('log_001')
    expect(sc.status === 'loaded' && sc.lastMtime).toBe(100)
    expect(readSidecar).toHaveBeenCalledWith('log_001')
    expect(readSidecar).toHaveBeenCalledTimes(1)
  })

  it('loading + fetch returns null -> missing', async () => {
    installApiMock(vi.fn(() => Promise.resolve(null)))
    const h = makeHarness()
    h.render()

    await act(async () => {
      h.ctx().openSidecar('log_404')
    })

    await waitFor(() => {
      expect(h.ctx().sidecar.status).toBe('missing')
    })
    const sc = h.ctx().sidecar
    expect(sc.status === 'missing' && sc.logId).toBe('log_404')
  })

  it('loading + fetch throws -> error', async () => {
    installApiMock(vi.fn(() => Promise.reject(new Error('Sidecar exceeds 10MB cap'))))
    const h = makeHarness()
    h.render()

    await act(async () => {
      h.ctx().openSidecar('log_big')
    })

    await waitFor(() => {
      expect(h.ctx().sidecar.status).toBe('error')
    })
    const sc = h.ctx().sidecar
    expect(sc.status === 'error' && sc.error).toMatch(/10MB cap/)
  })

  it('loaded + closeSidecar -> closed', async () => {
    installApiMock(vi.fn(() => Promise.resolve({ raw: JSON.stringify(samplePayload), mtime: 1 })))
    const h = makeHarness()
    h.render()

    await act(async () => h.ctx().openSidecar('log_001'))
    await waitFor(() => expect(h.ctx().sidecar.status).toBe('loaded'))

    act(() => h.ctx().closeSidecar())
    expect(h.ctx().sidecar).toEqual({ status: 'closed' })
  })

  it('loaded + clearFocusPersona drops the focusPersonaId only', async () => {
    installApiMock(vi.fn(() => Promise.resolve({ raw: JSON.stringify(samplePayload), mtime: 1 })))
    const h = makeHarness()
    h.render()

    await act(async () => h.ctx().openSidecar('log_001', 'P2'))
    await waitFor(() => expect(h.ctx().sidecar.status).toBe('loaded'))

    act(() => h.ctx().clearFocusPersona())
    const sc = h.ctx().sidecar
    expect(sc.status).toBe('loaded')
    expect(sc.status === 'loaded' && sc.focusPersonaId).toBeUndefined()
    expect(sc.status === 'loaded' && sc.payload.log_id).toBe('log_001')
  })

  it('openSidecar with same logId is idempotent (no re-fetch)', async () => {
    const readSidecar = vi.fn(() =>
      Promise.resolve({ raw: JSON.stringify(samplePayload), mtime: 1 })
    )
    installApiMock(readSidecar)
    const h = makeHarness()
    h.render()

    await act(async () => h.ctx().openSidecar('log_001'))
    await waitFor(() => expect(h.ctx().sidecar.status).toBe('loaded'))
    expect(readSidecar).toHaveBeenCalledTimes(1)

    // Re-open with a different focusPersonaId — should NOT re-fetch,
    // only update focusPersonaId.
    act(() => h.ctx().openSidecar('log_001', 'P5'))
    expect(readSidecar).toHaveBeenCalledTimes(1)
    const sc = h.ctx().sidecar
    expect(sc.status === 'loaded' && sc.focusPersonaId).toBe('P5')
  })

  it('openSidecar with a different logId triggers a new fetch', async () => {
    const readSidecar = vi
      .fn()
      .mockResolvedValueOnce({ raw: JSON.stringify(samplePayload), mtime: 1 })
      .mockResolvedValueOnce({
        raw: JSON.stringify({ ...samplePayload, log_id: 'log_002' }),
        mtime: 2
      })
    installApiMock(readSidecar)
    const h = makeHarness()
    h.render()

    await act(async () => h.ctx().openSidecar('log_001'))
    await waitFor(() => expect(h.ctx().sidecar.status).toBe('loaded'))

    await act(async () => h.ctx().openSidecar('log_002'))
    await waitFor(() => {
      const sc = h.ctx().sidecar
      expect(sc.status === 'loaded' && sc.logId).toBe('log_002')
    })
    expect(readSidecar).toHaveBeenCalledTimes(2)
  })
})

// ============================================================
// Watcher subscription + coalesce (D4)
// ============================================================

describe('ResearchDataProvider — watcher coalesce', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces a burst of sidecar-updated events for the same logId into 1 refetch', async () => {
    const readSidecar = vi.fn().mockResolvedValue({ raw: JSON.stringify(samplePayload), mtime: 1 })
    installApiMock(readSidecar)
    const h = makeHarness()
    h.render()

    // Initial open — fetch #1
    await act(async () => h.ctx().openSidecar('log_001'))
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(readSidecar).toHaveBeenCalledTimes(1)

    // Fire 50 watcher events in rapid succession (within the debounce window).
    // Each event has a STRICTLY INCREASING mtime so the race guard doesn't
    // drop them as no-ops.
    readSidecar.mockResolvedValue({ raw: JSON.stringify(samplePayload), mtime: 200 })
    act(() => {
      for (let i = 1; i <= 50; i++) {
        sidecarUpdatedHandler?.({ logId: 'log_001', mtime: 100 + i })
      }
    })

    // Advance past the coalesce window
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    // Exactly ONE refetch should fire (in addition to the initial fetch)
    expect(readSidecar).toHaveBeenCalledTimes(2)
  })

  it('ignores sidecar-updated events for a different logId', async () => {
    const readSidecar = vi.fn(() =>
      Promise.resolve({ raw: JSON.stringify(samplePayload), mtime: 1 })
    )
    installApiMock(readSidecar)
    const h = makeHarness()
    h.render()

    await act(async () => h.ctx().openSidecar('log_001'))
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(readSidecar).toHaveBeenCalledTimes(1)

    act(() => {
      sidecarUpdatedHandler?.({ logId: 'log_999', mtime: 500 })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    // No additional fetch — the drawer doesn't care about log_999
    expect(readSidecar).toHaveBeenCalledTimes(1)
  })

  it('ignores sidecar-updated events when the drawer is closed', async () => {
    const readSidecar = vi.fn()
    installApiMock(readSidecar)
    const h = makeHarness()
    h.render()
    expect(h.ctx().sidecar.status).toBe('closed')

    act(() => {
      sidecarUpdatedHandler?.({ logId: 'log_001', mtime: 100 })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(readSidecar).not.toHaveBeenCalled()
  })

  it('race guard: drops events with mtime <= lastMtime', async () => {
    const readSidecar = vi
      .fn()
      .mockResolvedValueOnce({ raw: JSON.stringify(samplePayload), mtime: 500 })
    installApiMock(readSidecar)
    const h = makeHarness()
    h.render()

    await act(async () => h.ctx().openSidecar('log_001'))
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(readSidecar).toHaveBeenCalledTimes(1)
    expect((h.ctx().sidecar as { lastMtime?: number }).lastMtime).toBe(500)

    // mtime equal to lastMtime — drop
    act(() => {
      sidecarUpdatedHandler?.({ logId: 'log_001', mtime: 500 })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(readSidecar).toHaveBeenCalledTimes(1)

    // mtime less than lastMtime — drop
    act(() => {
      sidecarUpdatedHandler?.({ logId: 'log_001', mtime: 400 })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(readSidecar).toHaveBeenCalledTimes(1)
  })
})

// ============================================================
// closeSidecar cancels pending refetches
// ============================================================

describe('ResearchDataProvider — closeSidecar cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  it('cancels a pending coalesce timer when closeSidecar fires', async () => {
    const readSidecar = vi
      .fn()
      .mockResolvedValueOnce({ raw: JSON.stringify(samplePayload), mtime: 1 })
    installApiMock(readSidecar)
    const h = makeHarness()
    h.render()

    await act(async () => h.ctx().openSidecar('log_001'))
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(readSidecar).toHaveBeenCalledTimes(1)

    // Queue a watcher event, then close before the debounce fires.
    act(() => {
      sidecarUpdatedHandler?.({ logId: 'log_001', mtime: 500 })
    })
    act(() => h.ctx().closeSidecar())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    // The pending refetch was cancelled by closeSidecar
    expect(readSidecar).toHaveBeenCalledTimes(1)
    expect(h.ctx().sidecar).toEqual({ status: 'closed' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})
