import { useEffect, useMemo, useState } from 'react'
import { App as ViewerApp } from '@genealogy/viewer-ui'
import { api, type SessionSummary } from '../api'
import { makeSessionConnection } from '../transport/makeSessionConnection'
import type { SessionConnection } from '../transport/SessionConnection'
import { WsResearchTransport } from '../transport/WsResearchTransport'
import ChatPane from './ChatPane'

// Two-pane: chat (left) + the shared viewer (right). The realtime backend
// (local_ws WebSocket or Ably) is chosen by the server's minted token via
// makeSessionConnection — this component is backend-agnostic.
export default function SessionView({
  sessionId,
  isNew,
  onBack
}: {
  sessionId: string
  isNew: boolean
  onBack: () => void
}): React.JSX.Element {
  const [session, setSession] = useState<SessionSummary | null>(null)
  const [fsConnected, setFsConnected] = useState(false)
  const [conn, setConn] = useState<SessionConnection | null>(null)

  const transport = useMemo(
    () => (conn ? new WsResearchTransport(sessionId, conn) : null),
    [conn, sessionId]
  )

  useEffect(() => {
    let cancelled = false
    let live: SessionConnection | null = null

    void api.resumeSession(sessionId).then(setSession)
    void api.fsStatus(sessionId).then((s) => setFsConnected(s.connected)).catch(() => {})
    void makeSessionConnection(sessionId).then((c) => {
      if (cancelled) {
        c.close()
        return
      }
      c.connect()
      live = c
      setConn(c)
    })

    return () => {
      cancelled = true
      live?.close()
    }
  }, [sessionId])

  const connectFs = async (): Promise<void> => {
    const s = await api.fsDevConnect(sessionId)
    setFsConnected(s.connected)
  }

  return (
    <div className="sessionShell">
      <aside className="chatPane">
        <header className="chatHeader">
          <button className="btnGhost" onClick={onBack}>
            ← Sessions
          </button>
          <span className="chatTitle">{session?.title ?? 'Loading…'}</span>
          {fsConnected ? (
            <span className="fsBadge fsConnected" title="FamilySearch connected (mock)">
              ✓ FamilySearch
            </span>
          ) : (
            <button className="fsBadge fsConnect" onClick={() => void connectFs()}>
              Connect FamilySearch
            </button>
          )}
        </header>
        {conn ? (
          <ChatPane conn={conn} isNew={isNew} />
        ) : (
          <div className="chatBody">
            <div className="chatPlaceholder muted">Connecting…</div>
          </div>
        )}
      </aside>
      <section className="viewerPane">
        {transport && <ViewerApp transport={transport} />}
      </section>
    </div>
  )
}
