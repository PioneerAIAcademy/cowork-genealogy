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
  const [fsReal, setFsReal] = useState(false)
  const [conn, setConn] = useState<SessionConnection | null>(null)

  const transport = useMemo(
    () => (conn ? new WsResearchTransport(sessionId, conn) : null),
    [conn, sessionId]
  )

  useEffect(() => {
    let cancelled = false
    let live: SessionConnection | null = null

    void api.resumeSession(sessionId).then(setSession)
    void api
      .fsStatus(sessionId)
      .then((s) => {
        setFsConnected(s.connected)
        setFsReal(s.real)
      })
      .catch(() => {})
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
    // Mock path (no real FS configured): in-place dev-connect, no popup.
    if (!fsReal) {
      const s = await api.fsDevConnect(sessionId)
      setFsConnected(s.connected)
      return
    }
    // Real FS: run the OAuth round-trip in a popup so the SPA + its WS + the
    // agent stay alive (App.tsx has no router — a full-page redirect would tear
    // the session down). Refresh status on the popup's postMessage or its close.
    const popup = window.open(
      `/familysearch/login?sessionId=${sessionId}`,
      'fs-oauth',
      'width=600,height=820'
    )
    let timer = 0
    const refresh = (): void => {
      void api.fsStatus(sessionId).then((s) => setFsConnected(s.connected)).catch(() => {})
    }
    const cleanup = (): void => {
      window.clearInterval(timer)
      window.removeEventListener('message', onMsg)
    }
    // Trust only a message from the popup we opened (origin-agnostic: works in
    // dev cross-port and in prod single-origin).
    const onMsg = (e: MessageEvent): void => {
      if (e.source === popup && e.data === 'fs-connected') {
        refresh()
        cleanup()
      }
    }
    window.addEventListener('message', onMsg)
    timer = window.setInterval(() => {
      if (!popup || popup.closed) {
        refresh()
        cleanup()
      }
    }, 800)
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
