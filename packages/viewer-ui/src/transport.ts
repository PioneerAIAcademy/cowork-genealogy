// ResearchTransport — the seam that lets the SAME viewer (App, the 11
// sections, ResearchDataProvider) run in both the Electron app (IPC transport)
// and the hosted web client (WebSocket / pub-sub transport). The provider
// talks only to this interface; it never reaches for window.api or a socket
// directly.
import type { ResearchData, GedcomxData } from '@genealogy/schema'

export interface FeedbackPayload {
  includeMedia: boolean
  includeSessionLog: boolean
  email: string
  userPrompt: string
  agentDid: string
  agentShouldHave: string
  notes?: string
}

export interface FeedbackResult {
  ok: true
  filename?: string
}

/** A file the feedback bundle would include (drives the dialog's preview). */
export interface FeedbackFile {
  relativePath: string
  sizeBytes: number
  isMedia: boolean
  isText: boolean
}

export interface FeedbackContext {
  files: FeedbackFile[]
  sessionLogSize: number
  hasSessionLog: boolean
}

export interface ProjectStateSnapshot {
  research: ResearchData | null
  gedcomx: GedcomxData | null
  /**
   * A human label for the open project. In Electron this is the folder path;
   * in the web client it is the session/project title. `null` means "no
   * project open", which gates the welcome screen.
   */
  label: string | null
}

export interface SidecarRead {
  raw: string
  mtime: number
}

export interface SubscriptionHandlers {
  onResearch: (data: ResearchData) => void
  onGedcomx: (data: GedcomxData) => void
  onSidecar: (event: { logId: string; mtime: number }) => void
  onError: (message: string) => void
}

export interface ResearchTransport {
  /** Latest known project state (hydration on mount / after reconnect). */
  getProjectState(): Promise<ProjectStateSnapshot>

  /** Live updates. Returns an unsubscribe function. */
  subscribe(handlers: SubscriptionHandlers): () => void

  /** Read one results sidecar by log id. `null` when it does not exist. */
  readSidecar(logId: string): Promise<SidecarRead | null>

  /** Open a URL outside the app (Electron: shell.openExternal; web: window.open). */
  openExternal(url: string): void

  /** Submit a feedback bundle. */
  submitFeedback(payload: FeedbackPayload): Promise<FeedbackResult>

  /**
   * Electron-only: pick a project folder. Resolves to the chosen path (or
   * null if cancelled). Absent in the web client, where the project is chosen
   * server-side, so callers must treat it as optional.
   */
  selectFolder?(): Promise<string | null>

  /**
   * What the feedback bundle would contain — used to render the dialog's
   * file-list preview. Optional: when absent the dialog hides the preview.
   */
  getFeedbackContext?(): Promise<FeedbackContext>

  /**
   * Read a saved source page-scan (`images/<key>.jpg`) as a `data:` URL for
   * display beside its transcription. `null` when the file is absent. Optional —
   * the web client may not expose the project filesystem, so callers must treat
   * it as optional (no scan shown when absent).
   */
  getSourceImage?(filename: string): Promise<string | null>
}
