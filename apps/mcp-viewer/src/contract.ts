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

/** The parts of research.json the M0 card reads. */
export interface ResearchDocument {
  project?: { title?: unknown }
  sources?: Array<{ image_filename?: unknown }>
  questions?: unknown[]
}

/** A tool result's `_meta` entry, or `read_project_view`'s `document` part. */
export interface ProjectDocument {
  research?: ResearchDocument
  tree?: unknown
  startingTree?: unknown
  collections?: unknown
  derived?: { folderName?: string }
  echo?: ToolInput
  canary?: string
  pad?: string
}

export interface ImageLink {
  url: string
  expiresAt: number
}
