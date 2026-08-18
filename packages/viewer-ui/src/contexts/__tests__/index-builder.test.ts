import { describe, it, expect, vi } from 'vitest'
import { buildIndex } from '../ResearchDataContext'
import {
  patrickFlynnResearch,
  patrickFlynnGedcomx,
  emptyResearch
} from '../../lib/__fixtures__/patrick-flynn'

describe('buildIndex', () => {
  it('indexes all research.json items by their prefixed IDs', () => {
    const index = buildIndex(patrickFlynnResearch, patrickFlynnGedcomx)

    // Questions
    expect(index.get('q_001')).toBeDefined()
    expect(index.get('q_001')!.section).toBe('questions')

    // Plans
    expect(index.get('pl_001')).toBeDefined()
    expect(index.get('pl_001')!.section).toBe('plans')

    // Plan items (nested)
    expect(index.get('pli_001')).toBeDefined()
    expect(index.get('pli_001')!.section).toBe('plan_items')

    // Log entries
    expect(index.get('log_001')).toBeDefined()
    expect(index.get('log_001')!.section).toBe('log')

    // Sources
    expect(index.get('src_001')).toBeDefined()
    expect(index.get('src_001')!.section).toBe('sources')

    // Assertions
    expect(index.get('a_001')).toBeDefined()
    expect(index.get('a_001')!.section).toBe('assertions')

    // Person evidence
    expect(index.get('pe_001')).toBeDefined()
    expect(index.get('pe_001')!.section).toBe('person_evidence')

    // Conflicts
    expect(index.get('c_001')).toBeDefined()
    expect(index.get('c_001')!.section).toBe('conflicts')

    // Hypotheses
    expect(index.get('h_001')).toBeDefined()
    expect(index.get('h_001')!.section).toBe('hypotheses')

    // Timelines
    expect(index.get('t_001')).toBeDefined()
    expect(index.get('t_001')!.section).toBe('timelines')

    // Proof summaries
    expect(index.get('ps_001')).toBeDefined()
    expect(index.get('ps_001')!.section).toBe('proof_summaries')

    // Project
    expect(index.get('rp_001')).toBeDefined()
    expect(index.get('rp_001')!.section).toBe('project')
  })

  it('indexes GedcomX entities', () => {
    const index = buildIndex(patrickFlynnResearch, patrickFlynnGedcomx)

    // Persons
    expect(index.get('I1')).toBeDefined()
    expect(index.get('I1')!.section).toBe('gedcomx_persons')
    expect(index.get('I2')).toBeDefined()

    // Relationships
    expect(index.get('R1')).toBeDefined()
    expect(index.get('R1')!.section).toBe('gedcomx_relationships')
    // Indexed regardless of whether the relationship has subtype/notes
    expect(index.get('R2')).toBeDefined()
    expect(index.get('R2')!.section).toBe('gedcomx_relationships')

    // Sources
    expect(index.get('S1')).toBeDefined()
    expect(index.get('S1')!.section).toBe('gedcomx_sources')
  })

  it('does not index researcher_profile (no IDs to look up)', () => {
    const index = buildIndex(patrickFlynnResearch, patrickFlynnGedcomx)
    // researcher_profile is metadata on the project, not a section with referenceable items
    expect(patrickFlynnResearch.researcher_profile).toBeDefined()
    // Nothing in the index should map to the profile or its fields
    expect(index.get('researcher_profile')).toBeUndefined()
    expect(index.get('intermediate')).toBeUndefined()
  })

  it('returns null for missing IDs (broken foreign key)', () => {
    const index = buildIndex(patrickFlynnResearch, patrickFlynnGedcomx)
    expect(index.get('nonexistent_id')).toBeUndefined()
  })

  it('handles null research data', () => {
    const index = buildIndex(null, null)
    expect(index.size).toBe(0)
  })

  it('handles research with no GedcomX', () => {
    const index = buildIndex(patrickFlynnResearch, null)
    expect(index.get('q_001')).toBeDefined()
    expect(index.get('I1')).toBeUndefined() // no GedcomX
  })

  it('handles empty research (all empty arrays)', () => {
    const index = buildIndex(emptyResearch, null)
    // Only the project should be indexed
    expect(index.get('rp_001')).toBeDefined()
    expect(index.size).toBe(1)
  })

  it('does not throw on a partial research.json missing whole sections', () => {
    // buildIndex runs in the provider's useMemo, ABOVE the section error
    // boundary, so a throw here blanks the entire viewer with nothing to catch
    // it. An older/partial research.json missing sections must index cleanly
    // (issue #1317).
    const partial = { project: { id: 'rp_x' } } as unknown as Parameters<typeof buildIndex>[0]
    let index: ReturnType<typeof buildIndex> | undefined
    expect(() => {
      index = buildIndex(partial, null)
    }).not.toThrow()
    expect(index?.get('rp_x')).toBeDefined()
  })

  it('getById logs warning for missing references', () => {
    // This tests the context's getById behavior, but we can verify
    // the index lookup pattern here
    const index = buildIndex(patrickFlynnResearch, patrickFlynnGedcomx)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const entry = index.get('does_not_exist')
    expect(entry).toBeUndefined()

    // The actual warning happens in the context's getById, not in buildIndex
    warnSpy.mockRestore()
  })

  // A partial write is not only a MISSING section (covered above). It is also a
  // half-written entry, or a section that is not an array yet. buildIndex runs
  // above the ErrorBoundary, so any of these throwing blanks the whole viewer —
  // the exact failure #1317 is about. Each shape below threw before the
  // asArray/`?.id` guards.
  it.each([
    ['a null item in a section', { conflicts: [null] }],
    ['a section that is not an array yet', { conflicts: {} }],
    ['a null plan', { plans: [null] }],
    ['plan.items not an array yet', { plans: [{ items: {} }] }],
    ['a null item in another section', { questions: [null] }]
  ])('does not throw on %s', (_label, research) => {
    expect(() => buildIndex(research as never, null)).not.toThrow()
  })

  it.each([
    ['gedcomx missing its persons array', {}],
    ['a null gedcomx person', { persons: [null], relationships: [], sources: [] }]
  ])('does not throw on %s', (_label, gedcomx) => {
    expect(() => buildIndex({} as never, gedcomx as never)).not.toThrow()
  })

  it('still indexes the good entries alongside a malformed sibling', () => {
    const index = buildIndex(
      { conflicts: [null, { id: 'c_001' }], questions: {} } as never,
      null
    )
    expect(index.get('c_001')).toEqual({ item: { id: 'c_001' }, section: 'conflicts' })
  })
})
