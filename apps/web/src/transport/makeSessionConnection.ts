import { api } from '../api'
import { type SessionConnection, WsSessionConnection } from './SessionConnection'

// Single source of truth for the backend = the server's minted token. A deploy
// flips local_ws <-> ably by config alone, with no web rebuild. The Ably client
// is dynamically imported only for the "ably" backend, so the `ably` SDK is
// code-split out of the local_ws bundle. (ably_mock is a server-side test
// backend with no browser channel → falls back to the WebSocket path.)
export async function makeSessionConnection(sessionId: string): Promise<SessionConnection> {
  try {
    const tok = await api.realtimeToken(sessionId)
    if (tok.backend === 'ably' && tok.token) {
      const { AblySessionConnection } = await import('./AblySessionConnection')
      return new AblySessionConnection(sessionId, tok)
    }
  } catch {
    // fall through to the WS backend
  }
  return new WsSessionConnection(sessionId)
}
