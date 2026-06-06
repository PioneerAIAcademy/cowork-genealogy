import { useEffect, useMemo, useRef, useState } from 'react'
import { App as ViewerApp } from '@genealogy/viewer-ui'
import { api, type SessionSummary } from '../api'
import { SessionConnection } from '../transport/SessionConnection'
import { WsResearchTransport } from '../transport/WsResearchTransport'
import ChatPane from './ChatPane'

// Two-pane: chat (left) + the shared viewer (right, live over WebSocket).
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

  // One WebSocket for this session, shared by viewer + (M4) chat.
  const connRef = useRef<SessionConnection | null>(null)
  if (connRef.current === null) connRef.current = new SessionConnection(sessionId)
  const transport = useMemo(
    () => new WsResearchTransport(sessionId, connRef.current!),
    [sessionId]
  )

  useEffect(() => {
    void api.resumeSession(sessionId).then(setSession)
    void api.fsStatus(sessionId).then((s) => setFsConnected(s.connected)).catch(() => {})
    const conn = connRef.current!
    conn.connect()
    return () => conn.close()
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
        <ChatPane conn={connRef.current!} isNew={isNew} />
      </aside>
      <section className="viewerPane">
        <ViewerApp transport={transport} />
      </section>
    </div>
  )
}
