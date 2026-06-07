// Public surface of the shared viewer. An app mounts <App transport={...} />
// with a platform ResearchTransport (Electron: IPC; web: WebSocket/pub-sub).
export { default as App } from './App'

export { ResearchDataProvider } from './contexts/ResearchDataProvider'
export type { ResearchDataProviderProps } from './contexts/ResearchDataProvider'
export {
  useResearchData,
  ResearchDataContext,
  buildIndex
} from './contexts/ResearchDataContext'
export type {
  ResearchDataState,
  SidecarState,
  IndexEntry
} from './contexts/ResearchDataContext'

export { setOpenExternal, openExternal } from './lib/external'

export type {
  ResearchTransport,
  SubscriptionHandlers,
  ProjectStateSnapshot,
  SidecarRead,
  FeedbackPayload,
  FeedbackResult,
  FeedbackContext,
  FeedbackFile
} from './transport'

// Re-export the shared schema types for convenience so app code can import
// everything viewer-related from one place.
export type {
  ResearchData,
  GedcomxData,
  SidecarFile
} from '@genealogy/schema'
