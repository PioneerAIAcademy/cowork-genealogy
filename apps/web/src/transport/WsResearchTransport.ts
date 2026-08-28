import type {
  ResearchTransport,
  SubscriptionHandlers,
  ProjectStateSnapshot,
  SidecarRead,
  FeedbackPayload,
  FeedbackResult,
  FeedbackContext,
  ResearchData,
  GedcomxData
} from '@genealogy/viewer-ui'
import type { SessionConnection } from './SessionConnection'

// The web adapter: viewer deltas arrive over the shared SessionConnection
// (WebSocket); snapshots / sidecars / feedback go over REST. Note there is no
// selectFolder — the project is chosen server-side (the session list), so the
// viewer never shows the Electron "open folder" welcome.
export class WsResearchTransport implements ResearchTransport {
  constructor(
    private sessionId: string,
    private conn: SessionConnection
  ) {}

  async getProjectState(): Promise<ProjectStateSnapshot> {
    const res = await fetch(`/api/sessions/${this.sessionId}/state`, { credentials: 'include' })
    if (!res.ok) return { research: null, gedcomx: null, label: null, notice: null }
    const s = await res.json()
    return {
      research: (s.research as ResearchData | null) ?? null,
      gedcomx: (s.gedcomx as GedcomxData | null) ?? null,
      label: s.label ?? null,
      // Always null: the hosted path pins the project to `/project`, so no
      // folder notice is ever fired and the control plane has none to serve
      // (issue #1899, and the onNotice comment below).
      notice: null
    }
  }

  subscribe(handlers: SubscriptionHandlers): () => void {
    return this.conn.on((msg) => {
      switch (msg.type) {
        case 'research_updated':
          handlers.onResearch(msg.data as ResearchData)
          break
        case 'gedcomx_updated':
          handlers.onGedcomx(msg.data as GedcomxData)
          break
        case 'sidecar_updated':
          handlers.onSidecar({ logId: msg.logId as string, mtime: msg.mtime as number })
          break
        case 'error':
          handlers.onError(msg.message as string)
          break
        // No 'notice' case: the folder-notice (research.json in a subfolder) is
        // an on-computer concern. The hosted path pins the project to /project,
        // so `handlers.onNotice` is never fired here. status / agent_event are
        // consumed by the chat UI, not the viewer.
      }
    })
  }

  async readSidecar(logId: string): Promise<SidecarRead | null> {
    const res = await fetch(
      `/api/sessions/${this.sessionId}/sidecar/${encodeURIComponent(logId)}`,
      { credentials: 'include' }
    )
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Failed to read sidecar (${res.status})`)
    return (await res.json()) as SidecarRead
  }

  openExternal(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async submitFeedback(payload: FeedbackPayload): Promise<FeedbackResult> {
    const res = await fetch(`/api/feedback`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: this.sessionId, ...payload })
    })
    if (!res.ok) throw new Error('Failed to submit feedback')
    return (await res.json()) as FeedbackResult
  }

  async getFeedbackContext(): Promise<FeedbackContext> {
    const res = await fetch(`/api/feedback/context?sessionId=${this.sessionId}`, {
      credentials: 'include'
    })
    // Do NOT resolve empty here: the dialog cannot tell that apart from "the folder
    // is empty", and it would then display "(none found)" while the bundle still
    // carries the media and the session log. Let the caller see the failure.
    if (!res.ok) throw new Error(`Failed to read feedback context (${res.status})`)
    return (await res.json()) as FeedbackContext
  }

  async getSourceImage(filename: string): Promise<string | null> {
    const res = await fetch(
      `/api/sessions/${this.sessionId}/image?filename=${encodeURIComponent(filename)}`,
      { credentials: 'include' }
    )
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Failed to read image (${res.status})`)
    const blob = await res.blob()
    // Return a data: URL so getSourceImage's contract matches the Electron
    // transport (a URL usable directly in <img src>); no object-URL to revoke.
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read image blob'))
      reader.readAsDataURL(blob)
    })
  }
}
