import { createContext, useContext } from 'react'
import type { ResearchData, GedcomxData, SidecarFile } from '../lib/schema'

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
  activeSection: string
  setActiveSection: (section: string) => void
  sidecar: SidecarState
  openSidecar: (logId: string, focusPersonaId?: string) => void
  closeSidecar: () => void
  clearFocusPersona: () => void
}

export const ResearchDataContext = createContext<ResearchDataState | null>(null)

export function buildIndex(
  research: ResearchData | null,
  gedcomx: GedcomxData | null
): Map<string, IndexEntry> {
  const map = new Map<string, IndexEntry>()
  if (!research) return map

  const sections: [string, unknown[]][] = [
    ['questions', research.questions],
    ['plans', research.plans],
    ['log', research.log],
    ['sources', research.sources],
    ['assertions', research.assertions],
    ['person_evidence', research.person_evidence],
    ['conflicts', research.conflicts],
    ['hypotheses', research.hypotheses],
    ['timelines', research.timelines],
    ['proof_summaries', research.proof_summaries]
  ]

  for (const [section, items] of sections) {
    for (const item of items) {
      const id = (item as { id?: string }).id
      if (id) map.set(id, { item, section })
    }
  }

  // Also index plan items (nested inside plans)
  for (const plan of research.plans) {
    for (const planItem of plan.items) {
      map.set(planItem.id, { item: planItem, section: 'plan_items' })
    }
  }

  // Index project
  if (research.project?.id) {
    map.set(research.project.id, { item: research.project, section: 'project' })
  }

  // Index GedcomX entities
  if (gedcomx) {
    for (const person of gedcomx.persons) {
      map.set(person.id, { item: person, section: 'gedcomx_persons' })
    }
    for (const rel of gedcomx.relationships) {
      map.set(rel.id, { item: rel, section: 'gedcomx_relationships' })
    }
    for (const src of gedcomx.sources) {
      map.set(src.id, { item: src, section: 'gedcomx_sources' })
    }
  }

  return map
}

export function useResearchData(): ResearchDataState {
  const ctx = useContext(ResearchDataContext)
  if (!ctx) throw new Error('useResearchData must be used within ResearchDataProvider')
  return ctx
}
