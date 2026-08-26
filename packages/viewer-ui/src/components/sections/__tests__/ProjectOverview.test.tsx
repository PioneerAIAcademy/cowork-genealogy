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

/**
 * The shape the optionality flip exists to admit: the key ABSENT, not present-and-null.
 * 18 of the 25 flipped keys are absent from committed documents tens of thousands of
 * times, and nothing normalizes the wire payload before it is cast to ResearchData.
 *
 * tsc guards the narrowing itself (reverting `== null` to `=== null` here is TS18048),
 * but it cannot see WHAT the component does once someone satisfies the compiler a
 * different way. `!` is forbidden by the ruling; `?? []` compiles clean and takes
 * the same branch, so only a rendering assertion distinguishes a real fix from one
 * that merely silences the compiler. This pins the behaviour, not the compile.
 */
describe('ProjectOverview — a flipped key that is absent, not null', () => {
  beforeEach(() => vi.clearAllMocks())

  it('still renders the subject when there IS one', () => {
    // Without this, `{true ? (` -- always the not-identified branch, never a
    // subject -- leaves the entire viewer-ui suite green. The absent-key case
    // below cannot tell a correct guard from one that always takes its branch.
    mockResearch()
    render(<ProjectOverview />)
    expect(screen.queryByText('Subject not yet identified')).not.toBeInTheDocument()
  })

  it('renders the not-identified message instead of throwing on undefined.length', () => {
    const project = { ...patrickFlynnResearch.project }
    delete (project as Record<string, unknown>).subject_person_ids
    mockResearch({ project } as Partial<ResearchData>)

    expect(() => render(<ProjectOverview />)).not.toThrow()
    expect(screen.getByText('Subject not yet identified')).toBeInTheDocument()
  })
})
