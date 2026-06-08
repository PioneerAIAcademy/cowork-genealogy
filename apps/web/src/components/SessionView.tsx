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
  const [conn, setConn] = useState<SessionConnection | null>(null)
  const [logs, setLogs] = useState<{ ws: string; agent: string } | null>(null)

  const transport = useMemo(
    () => (conn ? new WsResearchTransport(sessionId, conn) : null),
    [conn, sessionId]
  )

  useEffect(() => {
    let cancelled = false
    let live: SessionConnection | null = null

    void api.resumeSession(sessionId).then(setSession)
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

  const viewLogs = async (): Promise<void> => {
    try {
      setLogs(await api.sessionLogs(sessionId))
    } catch (e) {
      setLogs({ ws: `(failed to fetch logs: ${String(e)})`, agent: '' })
    }
  }

  return (
    <div className="sessionShell">
      <aside className="chatPane">
        <header className="chatHeader">
          <button className="btnGhost" onClick={onBack}>
            ← Sessions
          </button>
          <span className="chatTitle">{session?.title ?? 'Loading…'}</span>
          <button className="btnGhost" onClick={() => void viewLogs()} title="Sandbox WS + agent logs">
            Logs
          </button>
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
      {logs && (
        <div
          onClick={() => setLogs(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', width: '80%', maxWidth: 920, maxHeight: '82vh',
              overflow: 'auto', borderRadius: 8, padding: 16
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong>Sandbox logs</strong>
              <span style={{ display: 'flex', gap: 8 }}>
                <button className="btnGhost" onClick={() => void viewLogs()}>Refresh</button>
                <button className="btnGhost" onClick={() => setLogs(null)}>Close</button>
              </span>
            </div>
            <h4 style={{ margin: '8px 0 4px' }}>Activity — server + agent timeline (/tmp/ws.log)</h4>
            <pre style={preStyle}>{logs.ws || '(empty)'}</pre>
            <h4 style={{ margin: '8px 0 4px' }}>Agent errors — stderr (/tmp/agent.log)</h4>
            <pre style={preStyle}>{logs.agent || '(no errors)'}</pre>
          </div>
        </div>
      )}
    </div>
  )
}

const preStyle: React.CSSProperties = {
  background: '#0b0b0b', color: '#7CFC7C', padding: 10, borderRadius: 4, fontSize: 12,
  whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '30vh', overflow: 'auto'
}
