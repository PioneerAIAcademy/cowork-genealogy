import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The preload's channel mapping (#1018) — the last hop with no coverage.
 *
 * `openFamilySearch` invokes a channel name written as a string literal. Change
 * that one string to `'open-external'` and every constrained link goes back down
 * the unconstrained channel with the whole suite and typecheck green: the
 * handler test proves the MAIN side registers `open-familysearch`, and nothing
 * proved the PRELOAD side calls it.
 *
 * So this asserts the PAIRING rather than each side separately. Testing them
 * independently is what let the two drift apart in the first place — each half
 * can be individually correct while the pair is broken.
 *
 * Fifth instance in this PR of the same shape: the logic covered, the thing that
 * calls it not.
 */

const invoke = vi.fn()
const exposed: Record<string, unknown> = {}

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_k: string, api: Record<string, unknown>) => Object.assign(exposed, api)
  },
  ipcRenderer: {
    invoke: (...a: unknown[]) => invoke(...a),
    on: () => {},
    removeAllListeners: () => {}
  },
  shell: { openExternal: vi.fn() }
}))

await import('../index')
const { registerExternalLinkHandlers } = await import('../../main/external-link')

/** The channel the MAIN process actually registers. */
function registeredChannel(): string {
  const names: string[] = []
  registerExternalLinkHandlers({ handle: (c: string) => names.push(c) } as never)
  expect(names).toHaveLength(1)
  return names[0]
}

describe('preload channel mapping', () => {
  beforeEach(() => invoke.mockClear())

  it('openFamilySearch invokes the SAME channel the main process registers', () => {
    ;(exposed.openFamilySearch as (v: string) => void)('1:1:QPRC-WPBZ')

    expect(invoke).toHaveBeenCalledTimes(1)
    const [channel, value] = invoke.mock.calls[0]
    expect(channel).toBe(registeredChannel())
    expect(value).toBe('1:1:QPRC-WPBZ')
  })

  it('does not send a constrained link down the generic channel', () => {
    ;(exposed.openFamilySearch as (v: string) => void)('1:1:QPRC-WPBZ')
    expect(invoke.mock.calls[0][0]).not.toBe('open-external')
  })

  it('openExternal still uses the generic channel', () => {
    // The split is the whole point: narrowing this one by accident would break
    // the sites that legitimately show their own URL.
    ;(exposed.openExternal as (v: string) => void)('https://example.org/x')
    expect(invoke).toHaveBeenCalledWith('open-external', 'https://example.org/x')
  })
})
