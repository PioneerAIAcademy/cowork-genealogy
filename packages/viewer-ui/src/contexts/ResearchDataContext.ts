import { createContext, useContext } from 'react'
import type { ResearchData, GedcomxData, SidecarFile } from '../lib/schema'
import type { FeedbackContext, FeedbackPayload, FeedbackResult } from '../transport'

export interface IndexEntry {
  item: unknown
  section: string
}

// Discriminated union — one source of truth for the sidecar drawer's
// status. SidecarPanel renders via exhaustive switch; no ambiguous nulls.
export type SidecarState =
  | { status: 'closed' }
  | { status: 'loading'; logId: string; focusPersonaId?: string }
  | {
      status: 'loaded'
      logId: string
      focusPersonaId?: string
      payload: SidecarFile
      lastMtime: number
    }
  | { status: 'missing'; logId: string }
  | { status: 'error'; logId: string; error: string }

export interface ResearchDataState {
  research: ResearchData | null
  gedcomx: GedcomxData | null
  error: string | null
  clearError: () => void
  lastUpdated: Date | null
  folderPath: string | null
  devMode: boolean
  setDevMode: (v: boolean) => void
  getById: (id: string) => IndexEntry | null
  selectFolder: () => Promise<void>
  /** Whether the transport can actually open a folder picker (Electron). False
   *  on the web client, where `folderPath` is a session title, not a filesystem
   *  path, and there is nothing to "open" — so folder-specific copy must not be
   *  shown there (issue #1317 review). */
  canSelectFolder: boolean
  activeSection: string
  setActiveSection: (section: string) => void
  sidecar: SidecarState
  openSidecar: (logId: string, focusPersonaId?: string) => void
  closeSidecar: () => void
  clearFocusPersona: () => void
  // Transport-backed feedback actions, surfaced through context. (External-URL
  // opening goes through the lib/external module helper instead, so deep leaf
  // components like SidecarResultCard stay renderable without a provider.)
  submitFeedback: (payload: FeedbackPayload) => Promise<FeedbackResult>
  /** Present only when the transport can describe the feedback bundle. */
  getFeedbackContext?: () => Promise<FeedbackContext>
  /** Fetch a saved source page-scan as a `data:` URL (Electron). Absent in the
   *  web client, so treat as optional (no scan shown). */
  getSourceImage?: (filename: string) => Promise<string | null>
}

export const ResearchDataContext = createContext<ResearchDataState | null>(null)

/** A section that is missing, null, or not an array yet (a half-written file)
 *  becomes an empty list rather than a `for...of` TypeError. `?? []` is not
 *  enough: it passes a non-array through. */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function buildIndex(
  research: ResearchData | null,
  gedcomx: GedcomxData | null
): Map<string, IndexEntry> {
  const map = new Map<string, IndexEntry>()
  if (!research) return map

  // buildIndex runs in the provider's useMemo, which is ABOVE the section error
  // boundary, so ANYTHING that throws here blanks the whole viewer with nothing
  // to catch it (issue #1317). A partial write is not just a missing section:
  // it is also a half-written entry (`[null]`) or a section that is not an array
  // yet (`{}`), both of which `?? []` lets straight through into `for...of`.
  // `asArray` + the optional `?.id` below cover all three shapes.
  const sections: [string, unknown[]][] = [
    ['known_holdings', asArray(research.known_holdings)],
    ['questions', asArray(research.questions)],
    ['plans', asArray(research.plans)],
    ['log', asArray(research.log)],
    ['sources', asArray(research.sources)],
    ['assertions', asArray(research.assertions)],
    ['person_evidence', asArray(research.person_evidence)],
    ['conflicts', asArray(research.conflicts)],
    ['hypotheses', asArray(research.hypotheses)],
    ['timelines', asArray(research.timelines)],
    ['proof_summaries', asArray(research.proof_summaries)],
    ['evaluations', asArray(research.evaluations)]
  ]

  for (const [section, items] of sections) {
    for (const item of items) {
      const id = (item as { id?: string } | null)?.id
      if (id) map.set(id, { item, section })
    }
  }

  // Also index plan items (nested inside plans)
  for (const plan of asArray(research.plans)) {
    for (const planItem of asArray((plan as { items?: unknown })?.items)) {
      const id = (planItem as { id?: string } | null)?.id
      if (id) map.set(id, { item: planItem, section: 'plan_items' })
    }
  }

  // Index project
  if (research.project?.id) {
    map.set(research.project.id, { item: research.project, section: 'project' })
  }

  // Index GedcomX entities
  if (gedcomx) {
    const gxSections: [string, unknown[]][] = [
      ['gedcomx_persons', asArray(gedcomx.persons)],
      ['gedcomx_relationships', asArray(gedcomx.relationships)],
      ['gedcomx_sources', asArray(gedcomx.sources)]
    ]
    for (const [section, items] of gxSections) {
      for (const item of items) {
        const id = (item as { id?: string } | null)?.id
        if (id) map.set(id, { item, section })
      }
    }
  }

  return map
}

export function useResearchData(): ResearchDataState {
  const ctx = useContext(ResearchDataContext)
  if (!ctx) throw new Error('useResearchData must be used within ResearchDataProvider')
  return ctx
}
