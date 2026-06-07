export interface ProjectFile {
  relativePath: string
  sizeBytes: number
  isMedia: boolean
  isText: boolean
}

export interface AppAPI {
  openFile: () => Promise<{ filePath: string; content: string; ext: string } | null>
  openExternal: (url: string) => Promise<void>
  getVersion: () => Promise<string>
  onResearchUpdated: (callback: (data: unknown) => void) => void
  onGedcomxUpdated: (callback: (data: unknown) => void) => void
  onWatchError: (callback: (error: string) => void) => void
  onSidecarUpdated: (callback: (event: { logId: string; mtime: number }) => void) => void
  removeAllWatchListeners: () => void
  getSessionLog: () => Promise<{ entries: unknown[]; sizeBytes: number }>
  selectFolder: () => Promise<string | null>
  getState: () => Promise<{ folderPath: string | null; research: unknown; gedcomx: unknown }>
  listProjectFiles: () => Promise<ProjectFile[]>
  submitFeedback: (payload: {
    includeMedia: boolean
    includeSessionLog: boolean
    email: string
    userPrompt: string
    agentDid: string
    agentShouldHave: string
    notes?: string
  }) => Promise<{ ok: true; filename?: string }>
  readSidecar: (logId: string) => Promise<{ raw: string; mtime: number } | null>
}

declare global {
  interface Window {
    api: AppAPI
  }
}
