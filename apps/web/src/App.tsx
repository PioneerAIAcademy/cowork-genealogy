import { useState } from 'react'
import { useAuth } from './auth'
import LoginScreen from './components/LoginScreen'
import SessionList from './components/SessionList'
import SessionView from './components/SessionView'

export default function App(): React.JSX.Element {
  const { user, loading } = useAuth()
  const [open, setOpen] = useState<{ id: string; isNew: boolean } | null>(null)

  if (loading) {
    return <div className="centerScreen">Loading…</div>
  }
  if (!user) {
    return <LoginScreen />
  }
  if (open) {
    return (
      <SessionView
        key={open.id}
        sessionId={open.id}
        isNew={open.isNew}
        onBack={() => setOpen(null)}
      />
    )
  }
  return <SessionList onOpen={(id, isNew) => setOpen({ id, isNew: Boolean(isNew) })} />
}
