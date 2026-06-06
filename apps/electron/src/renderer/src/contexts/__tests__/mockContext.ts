import { vi } from 'vitest'
import type { ResearchData, GedcomxData } from '../../lib/schema'
import type { ResearchDataState, SidecarState } from '../ResearchDataContext'
import { patrickFlynnResearch, patrickFlynnGedcomx } from '../../lib/__fixtures__/patrick-flynn'

// Standard mock builder for useResearchData. Tests pass overrides for the
// fields they care about; everything else defaults to a usable shape.
export function buildMockContext(
  overrides: {
    research?: ResearchData | null
    gedcomx?: GedcomxData | null
    sidecar?: SidecarState
    openSidecar?: ResearchDataState['openSidecar']
    closeSidecar?: ResearchDataState['closeSidecar']
    clearFocusPersona?: ResearchDataState['clearFocusPersona']
    setActiveSection?: ResearchDataState['setActiveSection']
    activeSection?: string
    getById?: ResearchDataState['getById']
  } = {}
): ResearchDataState {
  return {
    research: overrides.research === undefined ? patrickFlynnResearch : overrides.research,
    gedcomx: overrides.gedcomx === undefined ? patrickFlynnGedcomx : overrides.gedcomx,
    error: null,
    clearError: () => {},
    lastUpdated: null,
    folderPath: null,
    devMode: false,
    setDevMode: () => {},
    getById: overrides.getById ?? (() => null),
    selectFolder: async () => {},
    activeSection: overrides.activeSection ?? 'project_overview',
    setActiveSection: overrides.setActiveSection ?? vi.fn(),
    sidecar: overrides.sidecar ?? { status: 'closed' },
    openSidecar: overrides.openSidecar ?? vi.fn(),
    closeSidecar: overrides.closeSidecar ?? vi.fn(),
    clearFocusPersona: overrides.clearFocusPersona ?? vi.fn()
  }
}
