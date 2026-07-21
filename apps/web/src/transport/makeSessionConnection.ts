import { api } from '../api'
import { type SessionConnection, WsSessionConnection } from './SessionConnection'

// Ask the control plane how to reach this session, then open ONE WSS directly to
// its in-sandbox WS server (control plane out of the streaming path). Same path
// for E2B (wss://…e2b.app) and local dev (ws://127.0.0.1:port).
//
// The /connect call is handed over as a thunk rather than awaited here, so every
// reconnect re-mints its handshake token instead of replaying the one minted at
// page load. See WsSessionConnection's constructor for why that matters.
export async function makeSessionConnection(sessionId: string): Promise<SessionConnection> {
  return new WsSessionConnection(async () => {
    const r = await api.connectSession(sessionId)
    return { wssUrl: r.wssUrl, token: r.token }
  })
}
