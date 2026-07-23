import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as ViewerApp } from '@genealogy/viewer-ui'
import { api, type SessionSummary } from '../api'
import { useAlpha } from '../lib/alpha'
import { useChatWidth } from '../lib/chatWidth'
import { makeSessionConnection } from '../transport/makeSessionConnection'
import type { SessionConnection } from '../transport/SessionConnection'
import { WsResearchTransport } from '../transport/WsResearchTransport'
import ChatPane, { type UsageDelta } from './ChatPane'
import ThemeToggle from './ThemeToggle'

// Two-pane: chat (left) + the shared viewer (right). The viewer is the SAME
// component Electron mounts as its whole UI — everything session-specific that
// can be shared lives there; this file is the web-only chrome around it (chat,
// the cost meter, sandbox logs), none of which Electron has an event source for.
// (FamilySearch is now the app front-door login, #300, so there is no per-session
// connect button here anymore.)
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
  // The user's FamilySearch grant expired (FS caps it at 24h, so a tab left open
  // overnight hits this while the 30-day app session is still valid). /connect
  // reports it on every reconnect, so it clears itself once the user reconnects
  // FamilySearch and the tab re-establishes its socket.
  const [fsExpired, setFsExpired] = useState(false)
  const { alpha, setAlpha } = useAlpha()
  const { width: chatWidth, dragging, dividerProps } = useChatWidth()

  // Running cost for this session connection — operator/sponsor signal during
  // alpha (per-turn usage summed from the agent event stream). Resets on
  // refresh for now; persisting it is a server follow-up (a Project.cost column).
  const [cost, setCost] = useState({ usd: 0, turns: 0, inTok: 0, outTok: 0, estimated: false })
  const onUsage = useCallback((u: UsageDelta) => {
    setCost((c) => ({
      usd: c.usd + u.costUsd,
      turns: c.turns + 1,
      inTok: c.inTok + u.inputTokens,
      outTok: c.outTok + u.outputTokens,
      estimated: c.estimated || u.estimated
    }))
  }, [])

  const transport = useMemo(
    () => (conn ? new WsResearchTransport(sessionId, conn) : null),
    [conn, sessionId]
  )

  // Live session naming: the viewer reports the agent-written project.title;
  // relay it to the control plane ONCE, the moment the agent names a session
  // that's still on the default title (like Claude naming a chat). The /state
  // backfill is the fallback for sessions with no browser relaying.
  const [agentTitle, setAgentTitle] = useState<string | null>(null)
  const titledRef = useRef(false)
  useEffect(() => {
    if (titledRef.current || !agentTitle || !session) return
    titledRef.current = true
    if (session.title === 'New research session') {
      void api
        .patchSession(sessionId, { title: agentTitle })
        .then(setSession)
        .catch(() => {
          titledRef.current = false // let a later research delta retry
        })
    }
  }, [agentTitle, session, sessionId])

  useEffect(() => {
    let cancelled = false
    let live: SessionConnection | null = null

    // A stale/shared `#/s/:id` link can point at a session that no longer
    // exists — fall back to the list rather than hang on "Loading…".
    void api.resumeSession(sessionId).then(setSession).catch(() => onBack())
    void makeSessionConnection(sessionId, (fs) => setFsExpired(fs === 'expired')).then((c) => {
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
  }, [sessionId, onBack])

  const viewLogs = async (): Promise<void> => {
    try {
      setLogs(await api.sessionLogs(sessionId))
    } catch (e) {
      setLogs({ ws: `(failed to fetch logs: ${String(e)})`, agent: '' })
    }
  }

  const costLabel = `${cost.estimated ? '~' : ''}$${cost.usd.toFixed(cost.usd >= 1 ? 2 : 4)}`

  // Return here after reconnecting, not to the session list. The hash is the
  // SPA route (App.readRoute); `#` must be percent-encoded so it survives as a
  // query value rather than being read as the URL fragment.
  const reconnectHref = `/auth/familysearch/login?next=${encodeURIComponent(`#/s/${sessionId}`)}`

  return (
    <div
      className="sessionShell"
      data-dragging={dragging ? 'true' : undefined}
      style={{ '--chat-w': `${chatWidth}px` } as React.CSSProperties}
    >
      {fsExpired && (
        <div className="fsExpiredBanner" role="alert">
          <span>
            Your FamilySearch sign-in has expired. Reconnect to keep searching records —
            your research is safe and stays open.
          </span>
          <a className="btnPrimary" href={reconnectHref}>
            Reconnect FamilySearch
          </a>
        </div>
      )}
      <aside className="chatPane">
        <header className="chatHeader">
          <button className="btnGhost" onClick={onBack} title="Back to sessions" aria-label="Back to sessions">
            ←
          </button>
          <span className="chatTitle">{session?.title ?? 'Loading…'}</span>

          {/* The cost chip is shown to everyone — alpha testers asked to see what
              they are spending. The ALPHA tag and Logs button stay operator-only
              (visit /?alpha=1) and are removable after the alpha test. */}
          <span className="alphaCluster">
            {alpha && (
              <button
                className="alphaTag"
                onClick={() => setAlpha(false)}
                title="Alpha tools are on — click to hide"
              >
                ALPHA
              </button>
            )}
            <span
              className="costChip"
              title={`${cost.turns} turn${cost.turns === 1 ? '' : 's'} · ${cost.inTok.toLocaleString()} in / ${cost.outTok.toLocaleString()} out tokens${cost.estimated ? ' · mock estimate' : ''} · counted since this page loaded`}
            >
              {costLabel}
            </span>
            {alpha && (
              <button className="btnGhost" onClick={() => void viewLogs()} title="Sandbox WS + agent logs">
                Logs
              </button>
            )}
          </span>

          <ThemeToggle />
        </header>
        {conn ? (
          <ChatPane conn={conn} sessionId={sessionId} isNew={isNew} onUsage={onUsage} />
        ) : (
          <div className="chatBody">
            <div className="chatPlaceholder muted">Connecting…</div>
          </div>
        )}
      </aside>
      <div {...dividerProps} />
      <section className="viewerPane">
        {/* The web shell provides its own theme toggle in the chat header, so
            tell the embedded viewer to hide its (redundant) sidebar one.
            Electron passes nothing → keeps its toggle (its only one). */}
        {transport && (
          <ViewerApp transport={transport} showThemeToggle={false} onProjectTitle={setAgentTitle} />
        )}
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
              background: 'var(--bg-card)', color: 'var(--text-primary)', width: '80%',
              maxWidth: 920, maxHeight: '82vh', overflow: 'auto', borderRadius: 8, padding: 16
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
