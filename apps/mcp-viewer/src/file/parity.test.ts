import { sectionComponents } from '@genealogy/viewer-ui'
import { describe, expect, it } from 'vitest'
import { SECTION_HOMES } from './parity'

describe("today's sections in the new case file", () => {
  it('every section has a row naming where its content lives', () => {
    expect(Object.keys(SECTION_HOMES).sort()).toEqual(Object.keys(sectionComponents).sort())
  })

  it('no section is pending', () => {
    expect(Object.entries(SECTION_HOMES).filter(([, home]) => /pending/i.test(home))).toEqual([])
  })

  it('M3-1 houses the sections it owns', () => {
    for (const key of ['localities', 'external_collections', 'log', 'sources', 'assertions', 'person_evidence']) {
      expect(SECTION_HOMES[key]).not.toMatch(/^pending/)
    }
  })
})
