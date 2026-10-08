import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { splitOffPlan } from '../offPlan'

// "Work with no plan item goes in an explicit off-plan group — the unlogged side
// searches." Measured on the captured session: 3 of 52 log entries (6%) carry no
// plan_item_id. Without a group they are invisible, and the plan reads as if it
// covered everything that happened.

const entry = (id: string, planItemId?: string): Record<string, unknown> => ({
  id, ...(planItemId ? { plan_item_id: planItemId } : {})
})

describe('splitOffPlan', () => {
  it('separates entries with no plan item from those that have one', () => {
    const { onPlan, offPlan } = splitOffPlan([entry('log_001', 'pli_001'), entry('log_002')])
    expect(onPlan.map((e) => e.id)).toEqual(['log_001'])
    expect(offPlan.map((e) => e.id)).toEqual(['log_002'])
  })

  it('treats an entry naming a plan item that does not exist as OFF plan', () => {
    // A dangling reference is not coverage. Counting it as on-plan would let the
    // plan claim work it never planned.
    const { onPlan, offPlan } = splitOffPlan([entry('log_001', 'pli_999')], new Set(['pli_001']))
    expect(onPlan).toEqual([])
    expect(offPlan.map((e) => e.id)).toEqual(['log_001'])
  })

  it('keeps every entry — none may be dropped by the split', () => {
    const entries = [entry('a', 'pli_001'), entry('b'), entry('c', 'pli_002')]
    const { onPlan, offPlan } = splitOffPlan(entries)
    expect(onPlan.length + offPlan.length).toBe(3)
  })

  it('preserves order within each group', () => {
    const { offPlan } = splitOffPlan([entry('x'), entry('y', 'pli_1'), entry('z')])
    expect(offPlan.map((e) => e.id)).toEqual(['x', 'z'])
  })

  it('handles an empty log', () => {
    expect(splitOffPlan([])).toEqual({ onPlan: [], offPlan: [] })
  })
})

// Replayed over the captured session's real log.
describe('splitOffPlan over the captured log', () => {
  const { log, itemIds } = JSON.parse(
    readFileSync(join(__dirname, 'captured-log.json'), 'utf8')
  ) as { log: Record<string, unknown>[]; itemIds: string[] }

  it('has a corpus — a zero-length scan proves nothing', () => {
    expect(log.length).toBe(52)
    expect(itemIds.length).toBe(15)
  })

  it('finds the 3 real off-plan searches and loses nothing', () => {
    const { onPlan, offPlan } = splitOffPlan(log, new Set(itemIds))
    expect(offPlan.length).toBe(3)
    expect(onPlan.length + offPlan.length).toBe(52)
  })
})
