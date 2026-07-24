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
export class IpcResearchTransport implements ResearchTransport {
  async getProjectState(): Promise<ProjectStateSnapshot> {
    const state = await window.api.getState()
    return {
      research: (state.research as ResearchData | null) ?? null,
      gedcomx: (state.gedcomx as GedcomxData | null) ?? null,
      label: state.folderPath
    }
  }

  subscribe(handlers: SubscriptionHandlers): () => void {
    window.api.onResearchUpdated((data) => handlers.onResearch(data as ResearchData))
    window.api.onGedcomxUpdated((data) => handlers.onGedcomx(data as GedcomxData))
    window.api.onWatchError((err) => handlers.onError(err))
    window.api.onSidecarUpdated((event) => handlers.onSidecar(event))
    return () => window.api.removeAllWatchListeners()
  }

  readSidecar(logId: string): Promise<SidecarRead | null> {
    return window.api.readSidecar(logId)
  }

  openExternal(url: string): void {
    void window.api.openExternal(url)
  }

  submitFeedback(payload: FeedbackPayload): Promise<FeedbackResult> {
    return window.api.submitFeedback(payload)
  }

  selectFolder(): Promise<string | null> {
    return window.api.selectFolder()
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
