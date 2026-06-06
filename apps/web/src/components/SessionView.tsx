import { useEffect, useMemo, useRef, useState } from 'react'
import { App as ViewerApp } from '@genealogy/viewer-ui'
import { api, type SessionSummary } from '../api'
import { SessionConnection } from '../transport/SessionConnection'
import { WsResearchTransport } from '../transport/WsResearchTransport'

// Two-pane: chat (left, M4) + the shared viewer (right, live over WebSocket).
export default function SessionView({
  sessionId,
  onBack
}: {
  sessionId: string
  onBack: () => void
}): React.JSX.Element {
  const [session, setSession] = useState<SessionSummary | null>(null)

  // One WebSocket for this session, shared by viewer + (M4) chat.
  const connRef = useRef<SessionConnection | null>(null)
  if (connRef.current === null) connRef.current = new SessionConnection(sessionId)
  const transport = useMemo(
    () => new WsResearchTransport(sessionId, connRef.current!),
    [sessionId]
  )

  useEffect(() => {
    void api.resumeSession(sessionId).then(setSession)
    const conn = connRef.current!
    conn.connect()
    return () => conn.close()
  }, [sessionId])

  return (
    <div className="sessionShell">
      <aside className="chatPane">
        <header className="chatHeader">
          <button className="btnGhost" onClick={onBack}>
            ← Sessions
          </button>
          <span className="chatTitle">{session?.title ?? 'Loading…'}</span>
          {session && <span className="pill">{session.model.replace('claude-', '')}</span>}
        </header>
        <div className="chatBody">
          <div className="chatPlaceholder">
            <p className="muted">Chat arrives in M4.</p>
            <p className="muted small">
              The viewer on the right is live — it mirrors the sandbox&rsquo;s{' '}
              <code>/project</code> over the WebSocket.
            </p>
          </div>
        </div>
      </aside>
      <section className="viewerPane">
        <ViewerApp transport={transport} />
      </section>
    </div>
  )
}
