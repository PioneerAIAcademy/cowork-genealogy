import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The HANDLER, not the policy (#1018).
 *
 * `external-link.test.ts` covers `resolveFamilySearchTarget`. Nothing covered
 * the function that wires it to the IPC channel — so a handler that ignored the
 * policy and passed its argument straight to `shell.openExternal` would have
 * left every test green.
 *
 * That is the third instance in this PR of the same shape: the logic tested, the
 * consumer of the logic not. The first two (the web policy copy, then the web
 * transport that calls it) were both found by review.
 *
 * `vi.mock('electron')` is new here — no such mock existed repo-wide, which is
 * part of why this was never reachable.
 */

const openExternal = vi.fn()
vi.mock('electron', () => ({
  shell: { openExternal: (...a: unknown[]) => openExternal(...a) }
}))

const { registerExternalLinkHandlers } = await import('../external-link')

/** Captures what `registerExternalLinkHandlers` registers, so it can be invoked. */
function fakeIpc(): {
  handlers: Record<string, (e: unknown, v: unknown) => Promise<unknown>>
  handle: (c: string, h: (e: unknown, v: unknown) => Promise<unknown>) => void
} {
  const handlers: Record<string, (e: unknown, v: unknown) => Promise<unknown>> = {}
  return { handlers, handle: (c, h) => void (handlers[c] = h) }
}

describe('registerExternalLinkHandlers', () => {
  beforeEach(() => openExternal.mockClear())

  it('registers exactly the open-familysearch channel', () => {
    const ipc = fakeIpc()
    registerExternalLinkHandlers(ipc as never)
    // The security-invariants skill treats a preload channel absent from its
    // table as unauthorized; the inverse matters too — this module must not
    // quietly register anything else.
    expect(Object.keys(ipc.handlers)).toEqual(['open-familysearch'])
  })

  it('opens a resolvable value as the REBUILT url, not the input', async () => {
    const ipc = fakeIpc()
    registerExternalLinkHandlers(ipc as never)
    await ipc.handlers['open-familysearch']({}, '1:1:QPRC-WPBZ')
    expect(openExternal).toHaveBeenCalledWith(
      'https://www.familysearch.org/ark:/61903/1:1:QPRC-WPBZ'
    )
  })

  it('opens nothing for a foreign host', async () => {
    const ipc = fakeIpc()
    registerExternalLinkHandlers(ipc as never)
    await ipc.handlers['open-familysearch']({}, 'https://evil.example/ark:/61903/1:1:MXYZ')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('does not reject when the OS cannot open the URL', async () => {
    // The renderer calls this with `void`, so a rejection here is an unhandled
    // promise rejection on every click — e.g. no default browser on a minimal
    // Linux. The sibling `open-external` handler has always had this catch;
    // removing mine left the whole suite green.
    openExternal.mockRejectedValueOnce(new Error('no default browser'))
    const ipc = fakeIpc()
    registerExternalLinkHandlers(ipc as never)
    await expect(ipc.handlers['open-familysearch']({}, '1:1:QPRC-WPBZ')).resolves.toBeUndefined()
  })

  it('opens nothing for a non-string, and does not throw', async () => {
    const ipc = fakeIpc()
    registerExternalLinkHandlers(ipc as never)
    await expect(ipc.handlers['open-familysearch']({}, undefined)).resolves.toBeUndefined()
    await expect(
      ipc.handlers['open-familysearch']({}, { toString: () => 'x' })
    ).resolves.toBeUndefined()
    expect(openExternal).not.toHaveBeenCalled()
  })
})
