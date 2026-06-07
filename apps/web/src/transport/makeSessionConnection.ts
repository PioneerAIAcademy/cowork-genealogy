import { api } from '../api'
import { type SessionConnection, WsSessionConnection } from './SessionConnection'

// Ask the control plane how to reach this session (POST /api/sessions/{id}/connect).
// With E2B it returns { wssUrl, token } → connect ONE WSS directly to the
// in-sandbox WS server (control plane out of the streaming path). With the
// local_ws dev backend it returns { ok: true } → connect to the CP relay at
// /ws/sessions/{id}. Same WsSessionConnection class either way.
export async function makeSessionConnection(sessionId: string): Promise<SessionConnection> {
  try {
    const r = await api.connectSession(sessionId)
    if (r.wssUrl && r.token) {
      return new WsSessionConnection(sessionId, { wssUrl: r.wssUrl, token: r.token })
    }
  } catch {
    // fall through to the relay path (it surfaces its own errors)
  }
  return new WsSessionConnection(sessionId)
}
