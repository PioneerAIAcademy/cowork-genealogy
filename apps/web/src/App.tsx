import { useEffect, useState } from 'react'
import { useAuth } from './auth'
import LoginScreen from './components/LoginScreen'
import SessionList from './components/SessionList'
import SessionView from './components/SessionView'

// The open session lives in the URL hash (`#/s/:id`) so a browser refresh —
// or a shared link — restores it instead of dropping back to the list. The
// hash is inert: it never triggers a top-level navigation, so it can't disturb
// the FamilySearch OAuth popup flow (the reason SessionView avoids a router).
function readRoute(): string | null {
  // hash looks like "#/s/<id>" — capture only the id, stopping at a trailing
  // slash, an in-hash query (e.g. an operator appending "?alpha=1"), or another
  // "#". A trailing segment must never get folded into the session id.
  const m = window.location.hash.match(/^#\/s\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

interface OpenSession {
  id: string
  isNew: boolean
}

export default function App(): React.JSX.Element {
  const { user, loading } = useAuth()
  // Seed from the URL on first load. A restored session is never "new" — only
  // the +New button below opens with isNew:true (which auto-sends the opening
  // turn); a refresh must not re-fire that.
  const [open, setOpen] = useState<OpenSession | null>(() => {
    const id = readRoute()
    return id ? { id, isNew: false } : null
  })

  // Track browser back/forward (and the back button below, which clears the hash).
  useEffect(() => {
    const onHashChange = (): void => {
      const id = readRoute()
      setOpen((cur) => (id ? (cur?.id === id ? cur : { id, isNew: false }) : null))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const openSession = (id: string, isNew: boolean): void => {
    window.location.hash = `#/s/${encodeURIComponent(id)}`
    setOpen({ id, isNew })
  }

  const back = (): void => {
    window.location.hash = ''
    setOpen(null)
  }

  if (loading) {
    return <div className="centerScreen">Loading…</div>
  }
  if (!user) {
    return <LoginScreen />
  }
  if (open) {
    return <SessionView key={open.id} sessionId={open.id} isNew={open.isNew} onBack={back} />
  }
  return <SessionList onOpen={(id, isNew) => openSession(id, Boolean(isNew))} />
}
