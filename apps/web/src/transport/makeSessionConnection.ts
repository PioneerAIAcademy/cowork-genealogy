import { api } from '../api'
import { type SessionConnection, WsSessionConnection } from './SessionConnection'

// Ask the control plane how to reach this session, then open ONE WSS directly to
// its in-sandbox WS server (control plane out of the streaming path). Same path
// for E2B (wss://…e2b.app) and local dev (ws://127.0.0.1:port).
export async function makeSessionConnection(sessionId: string): Promise<SessionConnection> {
  const r = await api.connectSession(sessionId)
  return new WsSessionConnection({ wssUrl: r.wssUrl, token: r.token })
}
