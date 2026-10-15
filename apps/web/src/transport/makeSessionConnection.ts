import { api } from '../api'
import { type SessionConnection, WsSessionConnection } from './SessionConnection'
import { SseSessionConnection } from './SseSessionConnection'
import { sameOriginLoopback, devSandboxTunnel } from './sameOriginLoopback'

// Two transports, chosen at build time:
//
// VITE_SESSION_TRANSPORT=sse — the search-agent prototype (apps/server/proto/web):
// one EventSource on this origin, REST for the two client messages, no /connect and
// no handshake token. The tier has no FamilySearch grant to report, so the banner
// callback is told 'none' once. `make web-proto` sets this.
//
// Otherwise (the hosted alpha): ask the control plane how to reach this session,
// then open ONE WSS directly to its in-sandbox WS server (control plane out of the
// streaming path). Same path for E2B (wss://…e2b.app) and local dev
// (ws://127.0.0.1:port).
//
// The /connect call is handed over as a thunk rather than awaited here, so every
// reconnect re-mints its handshake token instead of replaying the one minted at
// page load. See WsSessionConnection's constructor for why that matters.
//
// `onFsState` is invoked with the FamilySearch grant state on every /connect —
// including reconnects — so a grant that expires while the tab sits open (FS
// caps it at 24h, far short of the 30-day app cookie) surfaces its banner at the
// next reconnect, not only at page load.
// The prototype tier has no sandbox, so no logs: its /logs route answers 501 and the
// session header hides the button on that transport.
export const sessionLogsAvailable = (): boolean =>
  import.meta.env.VITE_SESSION_TRANSPORT !== 'sse'

export async function makeSessionConnection(
  sessionId: string,
  onFsState?: (state: 'ok' | 'expired' | 'none' | undefined) => void
): Promise<SessionConnection> {
  if (import.meta.env.VITE_SESSION_TRANSPORT === 'sse') {
    onFsState?.('none')
    return new SseSessionConnection(sessionId)
  }
  return new WsSessionConnection(async () => {
    const r = await api.connectSession(sessionId)
    onFsState?.(r.familysearch)
    // A local sandbox is issued as `ws://127.0.0.1:<port>`. If the page is served from
    // `localhost` that is a CROSS-ORIGIN socket, and some browsers refuse it -- while
    // every HTTP call still succeeds through the dev proxy, so the app looks broken
    // and the backend looks healthy. Real deployment hosts are left untouched.
      // Two rewrites, both no-ops outside local dev. The first fixes the HOST
      // (127.0.0.1 and localhost are different origins to a browser); the second routes
      // the socket through this dev server's own port, because some browsers block a
      // direct ws:// to a different local port while proxied HTTP sails through.
      const sameHost = sameOriginLoopback(r.wssUrl, window.location.hostname)
      const tunnelled = devSandboxTunnel(sameHost, import.meta.env.DEV, window.location.origin)
      return { wssUrl: tunnelled, token: r.token }
  })
}
