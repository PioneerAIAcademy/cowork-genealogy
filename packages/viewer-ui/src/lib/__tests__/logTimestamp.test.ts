import { describe, it, expect } from 'vitest'
import { splitLogTimestamp } from '../logTimestamp'

describe('splitLogTimestamp', () => {
  it('splits a stored UTC instant into date and time of day', () => {
    expect(splitLogTimestamp('2026-05-01T10:15:00Z')).toEqual({ date: '2026-05-01', time: '10:15' })
  })

  it('does not shift the date into the viewer’s local zone', () => {
    // THE reason this is string-slicing and not `new Date()`. An instant late in the UTC
    // day renders as the NEXT day west of UTC and the same day east of it, so a research
    // log would read differently depending on who opened it. The date is evidence.
    expect(splitLogTimestamp('2026-05-01T23:50:00Z').date).toBe('2026-05-01')
    expect(splitLogTimestamp('2026-05-01T00:10:00Z').date).toBe('2026-05-01')
  })

  it('accepts a date with no time', () => {
    expect(splitLogTimestamp('2026-05-01')).toEqual({ date: '2026-05-01', time: '' })
  })

  it('accepts a space separator as well as T', () => {
    expect(splitLogTimestamp('2026-05-01 10:15:00')).toEqual({ date: '2026-05-01', time: '10:15' })
  })

  it('shows an unrecognised value rather than hiding it', () => {
    // Blanking the cell would lose data the reader can still act on.
    expect(splitLogTimestamp('circa 1850')).toEqual({ date: 'circa 1850', time: '' })
  })

  it('is blank for nothing at all', () => {
    for (const empty of [undefined, null, '', 42, {}]) {
      expect(splitLogTimestamp(empty)).toEqual({ date: '', time: '' })
    }
  })
})
