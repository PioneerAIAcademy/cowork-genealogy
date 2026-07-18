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
  familysearch: boolean // true when real FS web OAuth is configured (front-door sign-in)
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
  sessionLogs: (id: string) => req<{ ws: string; agent: string }>(`/api/sessions/${id}/logs`),

  // Make the session live + get the direct connection to its in-sandbox WS server.
  connectSession: (sessionId: string) =>
    req<{ wssUrl: string; token: string }>(`/api/sessions/${sessionId}/connect`, {
      method: 'POST'
    }),

  // Upload a document/image into <project>/uploads/ so the agent can read it.
  // Not routed through req(): multipart needs the browser to set Content-Type
  // (it carries the boundary), and req() forces application/json.
  uploadSessionFile: async (
    sessionId: string,
    file: File
  ): Promise<{ path: string; sizeBytes: number }> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/sessions/${sessionId}/files`, {
      method: 'POST',
      credentials: 'include',
      body: form
    })
    if (!res.ok) {
      let detail = res.statusText
      try {
        detail = (await res.json()).detail ?? detail
      } catch {
        /* non-JSON error */
      }
      throw new ApiError(res.status, detail)
    }
    return (await res.json()) as { path: string; sizeBytes: number }
  }
}
