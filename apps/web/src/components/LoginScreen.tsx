import { useEffect, useState } from 'react'
import { api, ApiError, type AuthConfig } from '../api'
import { useAuth } from '../auth'

export default function LoginScreen(): React.JSX.Element {
  const { refresh } = useAuth()
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api
      .authConfig()
      .then(setConfig)
      .catch(() => setConfig({ familysearch: false, devLogin: true }))
  }, [])

  const handleDevLogin = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.devLogin(email.trim())
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="centerScreen">
      <div className="loginCard">
        <div className="loginOrnament">Pioneer Academy</div>
        <h1 className="loginTitle">Genealogy Workbench</h1>
        <p className="loginSubtitle">
          GPS-conformant research, in your browser. Chat with an agent while a live
          project viewer follows along.
        </p>

        {config?.familysearch && (
          <a className="btnPrimary block" href="/auth/familysearch/login">
            Sign in with FamilySearch
          </a>
        )}

        {config?.devLogin && (
          <form onSubmit={handleDevLogin} className="loginForm">
            <label className="fieldLabel" htmlFor="email">
              Email (dev sign-in — must be allowlisted)
            </label>
            <input
              id="email"
              type="email"
              className="textInput"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <button className="btnPrimary block" type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Signing in…' : 'Continue'}
            </button>
          </form>
        )}

        {error && <div className="loginError">{error}</div>}
        <p className="loginHint">Access is limited to allowlisted accounts (alpha).</p>
      </div>
    </div>
  )
}
