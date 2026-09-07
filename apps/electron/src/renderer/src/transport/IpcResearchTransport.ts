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

// The Electron adapter: maps the shared ResearchTransport onto the existing
// preload `window.api`. No behavior change vs. the pre-extraction renderer —
// this is just the seam that lets the shared viewer run unchanged in Electron.
// "Error invoking remote method 'project:select-folder': Error: real message"
//   -> "real message". Leaves anything that does not match untouched.
export function unwrapIpcError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '')
}

export class IpcResearchTransport implements ResearchTransport {
  async getProjectState(): Promise<ProjectStateSnapshot> {
    const state = await window.api.getState()
    return {
      research: (state.research as ResearchData | null) ?? null,
      gedcomx: (state.gedcomx as GedcomxData | null) ?? null,
      label: state.folderPath,
      notice: state.notice ?? null
    }
  }

  subscribe(handlers: SubscriptionHandlers): () => void {
    window.api.onResearchUpdated((data) => handlers.onResearch(data as ResearchData))
    window.api.onGedcomxUpdated((data) => handlers.onGedcomx(data as GedcomxData))
    window.api.onWatchError((err) => handlers.onError(err))
    window.api.onFolderNotice((message) => handlers.onNotice(message))
    window.api.onSidecarUpdated((event) => handlers.onSidecar(event))
    return () => window.api.removeAllWatchListeners()
  }

  readSidecar(logId: string): Promise<SidecarRead | null> {
    return window.api.readSidecar(logId)
  }

  openExternal(url: string): void {
    void window.api.openExternal(url)
  }

  openFamilySearch(value: string): void {
    void window.api.openFamilySearch(value)
  }

  submitFeedback(payload: FeedbackPayload): Promise<FeedbackResult> {
    return window.api.submitFeedback(payload)
  }

  async selectFolder(): Promise<string | null> {
    try {
      return await window.api.selectFolder()
    } catch (err) {
      // ipcRenderer.invoke wraps a main-process throw as "Error invoking remote
      // method '<channel>': Error: <message>". The provider puts err.message
      // straight into the error bar, so without this the one sentence the user
      // needs — e.g. "research.json is in a subfolder (…)" — sits behind
      // boilerplate naming an IPC channel they have no concept of. Stripping it
      // belongs here: this is the only layer that knows the transport is
      // Electron IPC (#1722 round-8).
      throw new Error(unwrapIpcError(err))
    }
  }

  async getFeedbackContext(): Promise<FeedbackContext> {
    const [files, sessionLog] = await Promise.all([
      window.api.listProjectFiles(),
      window.api.getSessionLog()
    ])
    return {
      files,
      sessionLogSize: sessionLog.sizeBytes,
      hasSessionLog: sessionLog.entries.length > 0
    }
  }

  getSourceImage(filename: string): Promise<string | null> {
    return window.api.readImage(filename)
  }
}
