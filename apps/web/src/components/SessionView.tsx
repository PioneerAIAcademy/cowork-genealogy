import { useEffect, useState } from 'react'
import { api, type SessionSummary } from '../api'

// M2: a shell that resumes the session and shows its header. The live viewer
// (WebSocket transport + viewer-ui) lands in M3; the chat sidebar in M4.
export default function SessionView({
  sessionId,
  onBack
}: {
  sessionId: string
  onBack: () => void
}): React.JSX.Element {
  const [session, setSession] = useState<SessionSummary | null>(null)

  useEffect(() => {
    void api.resumeSession(sessionId).then(setSession)
  }, [sessionId])

  return (
    <div className="appShell">
      <header className="topBar">
        <div className="brand">
          <button className="btnGhost" onClick={onBack}>
            ← Sessions
          </button>
          <span className="brandTitle">{session?.title ?? 'Loading…'}</span>
        </div>
      </header>
      <main className="sessionShell">
        <div className="viewerPlaceholder">
          <p className="muted">Live viewer loads here (M3).</p>
        </div>
      </main>
    </div>
  )
}
