import type { ResearchData } from '@genealogy/schema'

// Names and shapes shared with the viewer server in
// packages/engine/mcp-server/viewer/. The two sides must match exactly.

export const SHOW_PROJECT = 'show_project'
export const READ_PROJECT_VIEW = 'read_project_view'
export const PROJECT_META_KEY = 'genealogy/project'
export const CONNECTOR_NAME = 'Genealogy Viewer'

export const SHOW_VALUES = [
  'setup',
  'plan',
  'search',
  'link',
  'conflict',
  'hypothesis',
  'assess',
  'conclusion',
  'latest',
  'file'
] as const

export type Show = (typeof SHOW_VALUES)[number]

export type ToolName = typeof SHOW_PROJECT | typeof READ_PROJECT_VIEW

export type ToolInput = Record<string, unknown>

/** research.json as stored: older projects lack fields, so every field may be absent. */
export type ResearchDocument = Partial<ResearchData>

export type QuestionState = 'framed' | 'planned' | 'searching' | 'evidence-gathered' | 'concluded' | 'critiqued'

/** One question's state as the engine reads it (`questionStatus`). */
export interface DerivedQuestion {
  id: string
  state: QuestionState
  nextStep: string | null
  openConflictIds: string[]
  storedStatus: string | null
  unregisteredDisagreements: Array<{ personId: string; fact: string; assertionIds: string[] }>
  competingParentSets: Array<{ personId: string; parentIds: string[] }>
}

/** What only the engine computes (`deriveProject`). A stub server may send only `folderName`. */
export interface Derived {
  folderName?: string
  questions?: DerivedQuestion[] | null
  awaitingUser?: unknown[] | null
  treeChanges?: unknown
  evaluations?: Record<string, { body: unknown; craft: boolean }>
}

/** A tool result's `_meta` entry, or `read_project_view`'s `document` part. */
export interface ProjectDocument {
  research?: ResearchDocument
  tree?: unknown
  startingTree?: unknown
  collections?: unknown
  derived?: Derived
  echo?: ToolInput
  canary?: string
  pad?: string
}

export interface ImageLink {
  url: string
  expiresAt: number
}
