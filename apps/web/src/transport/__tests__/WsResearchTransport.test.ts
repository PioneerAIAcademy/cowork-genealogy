import { describe, it, expect, afterEach, vi } from 'vitest'
import { assertTransportContract } from '@genealogy/viewer-ui/contract'
import { WsResearchTransport } from '../WsResearchTransport'
import type { SessionConnection } from '../SessionConnection'

/**
 * The web half of "both transports run the SAME contract assertion".
 *
 * `packages/viewer-ui/src/contract.test.ts` has claimed since it was written
 * that "the Electron IPC adapter and the web WS adapter run the SAME assertion
 * against their live instances". The Electron one does; this file is what makes
 * the web half of that sentence true rather than aspirational (issue #1899).
 *
 * `environment: 'node'` here (apps/web/vitest.config.ts) — no DOM, so `fetch`
 * is stubbed rather than mocked through jsdom, and the WS side is a fake
 * `SessionConnection`. Deliberately not adding jsdom for this.
 */

function fakeConn(): SessionConnection {
  return {
    connect: () => {},
    on: () => () => {},
    send: () => {},
    close: () => {}
  }
}

/**
 * Route by URL: the contract exercises `getProjectState` AND `readSidecar`, and
 * the two want different shapes — a 404 on the sidecar is a legitimate `null`,
 * whereas any other !ok makes it throw. A single blanket response fails the
 * contract for the wrong reason.
 */
function stubFetch(stateBody: unknown, stateOk = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/sidecar/')) {
        return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
      }
      return {
        ok: stateOk,
        status: stateOk ? 200 : 500,
        json: async () => stateBody
      } as unknown as Response
    })
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('WsResearchTransport — shared transport contract', () => {
  it('satisfies the contract when the control plane returns a state', async () => {
    stubFetch({ research: null, gedcomx: null, label: 'Some session' })
    await assertTransportContract(new WsResearchTransport('s1', fakeConn()))
  })

  it('satisfies the contract when the state request fails', async () => {
    stubFetch({}, false)
    await assertTransportContract(new WsResearchTransport('s1', fakeConn()))
  })
})

describe('WsResearchTransport — notice is always null on the hosted path', () => {
  // Not an oversight and settled rather than deferred: the hosted path pins the
  // project to /project, so no folder notice is ever fired there and the control
  // plane has none to serve. The field is required on ProjectStateSnapshot so
  // every transport has to answer; this is the web answer (issue #1899).
  it('returns notice: null even if the control plane sends one', async () => {
    stubFetch({ research: null, gedcomx: null, label: 'x', notice: 'ignore me' })
    const state = await new WsResearchTransport('s1', fakeConn()).getProjectState()
    expect(state.notice).toBeNull()
  })

  it('returns notice: null on a failed state request', async () => {
    stubFetch({}, false)
    const state = await new WsResearchTransport('s1', fakeConn()).getProjectState()
    expect(state.notice).toBeNull()
  })
})

describe('WsResearchTransport — constrained FamilySearch channel', () => {
  // The policy has its own suite; this pins the CALLER. `apps/web` is the only
  // consumer of the web policy copy, and replacing this method's body with a
  // bare `window.open(value, …)` left all 8 turbo tasks and all 440 tests green
  // — the same hole as the previous round, moved one file up.
  // `link-channel-routing.test.ts` cannot see it: that one reads
  // `src/components` and never looks at a transport.
  it('openFamilySearch constrains the destination', () => {
    const open = vi.fn()
    vi.stubGlobal('window', { open })
    const t = new WsResearchTransport('s1', fakeConn())

    t.openFamilySearch('https://evil.example/ark:/61903/1:1:MXYZ')
    expect(open).not.toHaveBeenCalled()

    t.openFamilySearch('1:1:QPRC-WPBZ')
    expect(open).toHaveBeenCalledWith(
      'https://www.familysearch.org/ark:/61903/1:1:QPRC-WPBZ',
      '_blank',
      'noopener,noreferrer'
    )
  })
})
