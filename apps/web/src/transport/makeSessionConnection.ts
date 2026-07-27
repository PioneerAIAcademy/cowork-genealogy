import { api } from '../api'
import { type SessionConnection, WsSessionConnection } from './SessionConnection'

// Ask the control plane how to reach this session, then open ONE WSS directly to
// its in-sandbox WS server (control plane out of the streaming path). Same path
// for E2B (wss://…e2b.app) and local dev (ws://127.0.0.1:port).
//
// The /connect call is handed over as a thunk rather than awaited here, so every
// reconnect re-mints its handshake token instead of replaying the one minted at
// page load. See WsSessionConnection's constructor for why that matters.
//
// `onFsState` is invoked with the FamilySearch grant state on every /connect —
// including reconnects — so a grant that expires while the tab sits open (FS
// caps it at 24h, far short of the 30-day app cookie) surfaces its banner at the
// next reconnect, not only at page load.
export async function makeSessionConnection(
  sessionId: string,
  onFsState?: (state: 'ok' | 'expired' | 'none' | undefined) => void
): Promise<SessionConnection> {
  return new WsSessionConnection(async () => {
    const r = await api.connectSession(sessionId)
    onFsState?.(r.familysearch)
    return { wssUrl: r.wssUrl, token: r.token }
  })
}
