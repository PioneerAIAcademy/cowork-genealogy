import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type SessionSummary } from '../api'
import { useAuth } from '../auth'
import ThemeToggle from './ThemeToggle'

const MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 — fast & economical' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8 — most capable (~5× cost)' }
]

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

export default function SessionList({
  onOpen
}: {
  onOpen: (id: string, isNew?: boolean) => void
}): React.JSX.Element {
  const { user, logout } = useAuth()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [model, setModel] = useState(MODELS[0].id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setSessions(await api.listSessions())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async (sample: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      // The user-given name is for their own research sessions; the sample
      // project keeps its seeded title. Empty falls back to the server default.
      const named = !sample && title.trim() ? title.trim() : undefined
      const s = await api.createSession({ sample, model, title: named })
      // A fresh (non-sample) session auto-starts the init-project onboarding.
      onOpen(s.id, !sample)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create session')
      setBusy(false)
    }
  }

  const remove = async (id: string, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (!confirm('Delete this session and its sandbox? This cannot be undone.')) return
    await api.deleteSession(id)
    void load()
  }

  return (
    <div className="appShell">
      <header className="topBar">
        <div className="brand">
          <span className="brandOrnament">Pioneer Academy</span>
          <span className="brandTitle">Genealogy Workbench</span>
        </div>
        <div className="topBarRight">
          <ThemeToggle />
          <span className="userEmail">{user?.email}</span>
          <button className="btnGhost" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="listMain">
        <section className="newSessionBar">
          <div className="newSessionMain">
            <div className="newSessionField newSessionFieldGrow">
              <label className="fieldLabel" htmlFor="title">
                Project name
              </label>
              <input
                id="title"
                className="textInput"
                type="text"
                placeholder="e.g. Find Mary Sullivan's parents  (optional — you can rename later)"
                value={title}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !busy) void create(false)
                }}
              />
            </div>
            <div className="newSessionField">
              <label className="fieldLabel" htmlFor="model">
                Model
              </label>
              <select
                id="model"
                className="select"
                value={model}
                disabled={busy}
                onChange={(e) => setModel(e.target.value)}
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="newSessionActions">
            <button className="btnPrimary" disabled={busy} onClick={() => void create(false)}>
              + New research session
            </button>
            <button className="btnSecondary" disabled={busy} onClick={() => void create(true)}>
              Open a sample project
            </button>
          </div>
        </section>

        {error && <div className="bannerError">{error}</div>}

        <h2 className="sectionHeading">Your sessions</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : sessions.length === 0 ? (
          <div className="emptyState">
            <p>No sessions yet.</p>
            <p className="muted">
              Start a new research session — the agent will interview you and seed your tree —
              or open a sample project to explore the viewer.
            </p>
          </div>
        ) : (
          <ul className="sessionGrid">
            {sessions.map((s) => (
              <li key={s.id} className="sessionCard" onClick={() => onOpen(s.id)}>
                <div className="sessionCardTitle">{s.title}</div>
                <div className="sessionCardMeta">
                  <span className="pill">{s.model.replace('claude-', '')}</span>
                  <span className="muted">active {relativeTime(s.last_active)}</span>
                </div>
                <button
                  className="cardDelete"
                  title="Delete session"
                  onClick={(e) => void remove(s.id, e)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
