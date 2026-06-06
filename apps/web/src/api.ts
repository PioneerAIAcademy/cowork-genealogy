// REST client for the control plane. Same-origin (Vite proxies to FastAPI in
// dev; the server serves the built app in prod), cookies included.

export interface SessionSummary {
  id: string
  title: string
  model: string
  status: string
  sandbox_id: string
  agent_session_id: string | null
  created: string
  updated: string
  last_active: string
}

export interface AuthUser {
  id: string
  email: string
}

export interface AuthConfig {
  google: boolean
  devLogin: boolean
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail ?? detail
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  authConfig: () => req<AuthConfig>('/auth/config'),
  me: () => req<AuthUser>('/auth/me'),
  devLogin: (email: string) =>
    req<AuthUser>('/auth/dev-login', { method: 'POST', body: JSON.stringify({ email }) }),
  logout: () => req<{ ok: true }>('/auth/logout', { method: 'POST' }),

  listSessions: () => req<SessionSummary[]>('/api/sessions'),
  createSession: (body: { title?: string; model?: string; sample?: boolean }) =>
    req<SessionSummary>('/api/sessions', { method: 'POST', body: JSON.stringify(body) }),
  resumeSession: (id: string) =>
    req<SessionSummary>(`/api/sessions/${id}/resume`, { method: 'POST' }),
  patchSession: (id: string, body: { title?: string; model?: string }) =>
    req<SessionSummary>(`/api/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteSession: (id: string) => req<{ ok: true }>(`/api/sessions/${id}`, { method: 'DELETE' }),

  fsStatus: (sessionId: string) =>
    req<{ connected: boolean; mock: boolean }>(`/familysearch/status?sessionId=${sessionId}`),
  fsDevConnect: (sessionId: string) =>
    req<{ connected: boolean; mock: boolean }>(`/familysearch/dev-connect?sessionId=${sessionId}`, {
      method: 'POST'
    })
}
