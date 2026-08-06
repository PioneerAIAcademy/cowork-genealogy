import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProjectOverview from '../ProjectOverview'
import type { ResearchData } from '../../../lib/schema'
import { patrickFlynnResearch, patrickFlynnGedcomx } from '../../../lib/__fixtures__/patrick-flynn'

vi.mock('../../../contexts/ResearchDataContext', async () => {
  const actual = await vi.importActual<typeof import('../../../contexts/ResearchDataContext')>(
    '../../../contexts/ResearchDataContext'
  )
  return {
    ...actual,
    useResearchData: vi.fn()
  }
})

import { useResearchData } from '../../../contexts/ResearchDataContext'
import { buildMockContext } from '../../../contexts/__tests__/mockContext'

function mockResearch(overrides: Partial<ResearchData> = {}): void {
  vi.mocked(useResearchData).mockReturnValue(
    buildMockContext({
      research: { ...patrickFlynnResearch, ...overrides },
      gedcomx: patrickFlynnGedcomx,
      activeSection: 'overview'
    })
  )
}

/**
 * `researcher_profile.intended_audience` — the field gps-mentor's narrative-craft
 * checks read to judge audience calibration against a stated audience rather than
 * inferring one from the prose (gps-mentor-agent-spec.md §6.4).
 *
 * It renders here because its three siblings do, and field-render-drift.test.ts
 * flags a field that is an outlier within its own object. That lint catches the
 * absence of the render; these catch it rendering the wrong thing, and that the
 * optional field stays absent rather than showing an empty label.
 */
describe('ProjectOverview — researcher profile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders intended_audience when set', () => {
    mockResearch({
      researcher_profile: {
        experience_level: 'novice',
        intended_audience: 'my cousins, none of them researchers'
      }
    })
    render(<ProjectOverview />)
    expect(screen.getByText(/my cousins, none of them researchers/)).toBeTruthy()
    // Labelled, so it does not read as a continuation of narration_guidance —
    // both share the .profileGuidance styling.
    expect(screen.getByText(/written for/i)).toBeTruthy()
  })

  it('omits the label entirely when intended_audience is absent', () => {
    mockResearch({
      researcher_profile: { experience_level: 'novice', narration_guidance: 'Be concise' }
    })
    render(<ProjectOverview />)
    expect(screen.queryByText(/written for/i)).toBeNull()
    expect(screen.getByText(/Be concise/)).toBeTruthy()
  })

  it('renders it alongside narration_guidance without swallowing either', () => {
    mockResearch({
      researcher_profile: {
        experience_level: 'professional',
        narration_guidance: 'Skip the basics',
        intended_audience: 'submission to NGSQ'
      }
    })
    render(<ProjectOverview />)
    expect(screen.getByText(/Skip the basics/)).toBeTruthy()
    expect(screen.getByText(/submission to NGSQ/)).toBeTruthy()
  })
})
