import { useState } from 'react'
import { useAuth } from './auth'
import LoginScreen from './components/LoginScreen'
import SessionList from './components/SessionList'
import SessionView from './components/SessionView'

export default function App(): React.JSX.Element {
  const { user, loading } = useAuth()
  const [openId, setOpenId] = useState<string | null>(null)

  if (loading) {
    return <div className="centerScreen">Loading…</div>
  }
  if (!user) {
    return <LoginScreen />
  }
  if (openId) {
    return <SessionView sessionId={openId} onBack={() => setOpenId(null)} />
  }
  return <SessionList onOpen={setOpenId} />
}
