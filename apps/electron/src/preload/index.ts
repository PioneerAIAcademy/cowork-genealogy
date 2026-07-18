import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('open-file'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  getVersion: () => ipcRenderer.invoke('get-version'),
  onResearchUpdated: (callback: (data: unknown) => void) => {
    ipcRenderer.on('project:research-updated', (_e, data) => callback(data))
  },
  onGedcomxUpdated: (callback: (data: unknown) => void) => {
    ipcRenderer.on('project:gedcomx-updated', (_e, data) => callback(data))
  },
  onWatchError: (callback: (error: string) => void) => {
    ipcRenderer.on('project:watch-error', (_e, error) => callback(error))
  },
  onSidecarUpdated: (callback: (event: { logId: string; mtime: number }) => void) => {
    ipcRenderer.on('project:sidecar-updated', (_e, payload) => callback(payload))
  },
  removeAllWatchListeners: () => {
    ipcRenderer.removeAllListeners('project:research-updated')
    ipcRenderer.removeAllListeners('project:gedcomx-updated')
    ipcRenderer.removeAllListeners('project:watch-error')
    ipcRenderer.removeAllListeners('project:sidecar-updated')
  },
  readSidecar: (logId: string) => ipcRenderer.invoke('project:read-sidecar', logId),
  readImage: (filename: string) => ipcRenderer.invoke('project:read-image', filename),
  getSessionLog: () => ipcRenderer.invoke('session:get-log'),
  selectFolder: () => ipcRenderer.invoke('project:select-folder'),
  getState: () => ipcRenderer.invoke('project:get-state'),
  listProjectFiles: () => ipcRenderer.invoke('project:list-files'),
  submitFeedback: (payload: {
    includeMedia: boolean
    includeSessionLog: boolean
    email: string
    userPrompt: string
    agentDid: string
    agentShouldHave: string
    notes?: string
  }) => ipcRenderer.invoke('feedback:submit', payload)
})
