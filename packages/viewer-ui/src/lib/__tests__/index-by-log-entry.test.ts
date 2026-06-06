import { describe, it, expect } from 'vitest'
import { indexByLogEntry } from '../index-by-log-entry'
import { patrickFlynnResearch } from '../__fixtures__/patrick-flynn'

// REGRESSION TESTS for Bucket A of schema-sync-2026-05-25:
// LogEntry.captured_source_ids and LogEntry.produced_assertion_ids were
// removed in favor of reverse lookup via item.log_entry_id. These tests
// ensure that the reverse lookup yields the same per-log groupings the
// removed fields used to give us.

describe('indexByLogEntry', () => {
  it('returns an empty map when given an empty array', () => {
    expect(indexByLogEntry([]).size).toBe(0)
  })

  it('skips items with no log_entry_id', () => {
    const items = [
      { id: 'x', log_entry_id: null },
      { id: 'y', log_entry_id: undefined },
      { id: 'z' } // missing entirely
    ]
    expect(indexByLogEntry(items).size).toBe(0)
  })

  it('groups multiple items under the same log_entry_id, preserving order', () => {
    const items = [
      { id: 'a', log_entry_id: 'log_001' },
      { id: 'b', log_entry_id: 'log_002' },
      { id: 'c', log_entry_id: 'log_001' },
      { id: 'd', log_entry_id: 'log_001' }
    ]
    const index = indexByLogEntry(items)
    expect(index.get('log_001')?.map((i) => i.id)).toEqual(['a', 'c', 'd'])
    expect(index.get('log_002')?.map((i) => i.id)).toEqual(['b'])
  })

  it('regression: patrick-flynn fixture sources index per log_entry_id', () => {
    // Bucket A behavioral check: the per-log Sources cell counts must come
    // from the reverse lookup, not from a now-removed field. Patrick Flynn
    // fixture captures one source per non-nil log entry.
    const index = indexByLogEntry(patrickFlynnResearch.sources)

    expect(index.get('log_001')?.map((s) => s.id)).toEqual(['src_001'])
    expect(index.get('log_002')?.map((s) => s.id)).toEqual(['src_002'])
    expect(index.get('log_005')?.map((s) => s.id)).toEqual(['src_004'])
  })

  it('regression: patrick-flynn fixture assertions index per log_entry_id', () => {
    // Same regression: the Assertions cell count derives from the reverse
    // lookup. Fixture has a_001/a_002/a_004 tied to log_001 and
    // a_012/a_013 tied to log_005; a_010 has log_entry_id=null (orphan).
    const index = indexByLogEntry(patrickFlynnResearch.assertions)

    const log001 = index.get('log_001')?.map((a) => a.id) ?? []
    expect(log001).toContain('a_001')
    expect(log001).toContain('a_002')
    expect(log001).toContain('a_004')

    const log005 = index.get('log_005')?.map((a) => a.id) ?? []
    expect(log005).toContain('a_012')
    expect(log005).toContain('a_013')

    // a_010 has log_entry_id: null -- must NOT appear under any key
    const allAssertionIds = Array.from(index.values()).flatMap((arr) => arr.map((a) => a.id))
    expect(allAssertionIds).not.toContain('a_010')
  })

  it('regression: every captured source in the fixture is reachable via the index', () => {
    // Belt-and-suspenders: if any source has a log_entry_id we should be
    // able to find it via that key. Mirrors what the deleted
    // LogEntry.captured_source_ids field used to guarantee.
    const index = indexByLogEntry(patrickFlynnResearch.sources)
    for (const source of patrickFlynnResearch.sources) {
      if (!source.log_entry_id) continue
      const list = index.get(source.log_entry_id)
      expect(list, `source ${source.id} unreachable via index`).toBeDefined()
      expect(list!.some((s) => s.id === source.id)).toBe(true)
    }
  })
})
