import { describe, it, expect } from 'vitest'
import { recommendedOption, stripRecommendedMarker } from '../recommendedOption'

// R9: *not sure* continues on the option the agent RECOMMENDED, never "the weaker
// choice". The ruling was sound and unimplementable as written -- AskUserQuestion
// carries no recommendation field, and measured over the committed unit corpus, all
// 15 unprompted calls mark nothing at all.
//
// The convention already exists in the tool's own contract: "make that the first
// option in the list and add '(Recommended)' at the end of the label". So the reader
// takes the marker when present and the FIRST option when it is not -- which is the
// same place the contract says a recommendation goes, so the two agree by
// construction rather than by luck.

const opt = (label: string, description = ''): { label: string; description: string } => ({
  label, description
})

describe('recommendedOption', () => {
  it('takes the option the agent marked', () => {
    const options = [opt('Search Ohio'), opt('Search Indiana (Recommended)'), opt('Stop')]
    expect(recommendedOption(options)?.label).toBe('Search Indiana (Recommended)')
  })

  it('falls back to the FIRST option when nothing is marked', () => {
    // Not a guess: the tool's contract puts a recommendation first, so first is the
    // best available reading when the marker is absent.
    const options = [opt('Search Ohio'), opt('Search Indiana')]
    expect(recommendedOption(options)?.label).toBe('Search Ohio')
  })

  it('is not fooled by the word appearing in a description', () => {
    const options = [opt('Search Ohio', 'recommended by the county archive'), opt('Search Indiana (Recommended)')]
    expect(recommendedOption(options)?.label).toBe('Search Indiana (Recommended)')
  })

  it('matches the marker case-insensitively and with loose spacing', () => {
    for (const label of ['Do it (recommended)', 'Do it  (Recommended)', 'Do it (RECOMMENDED)']) {
      expect(recommendedOption([opt('Other'), opt(label)])?.label).toBe(label)
    }
  })

  it('takes the first marked option when two are marked', () => {
    const options = [opt('A (Recommended)'), opt('B (Recommended)')]
    expect(recommendedOption(options)?.label).toBe('A (Recommended)')
  })

  it('returns null for no options rather than inventing one', () => {
    expect(recommendedOption([])).toBeNull()
  })
})

describe('stripRecommendedMarker', () => {
  it('removes the marker so the card does not shout it twice', () => {
    // The card shows the recommendation as a badge; leaving the suffix in the label
    // renders "Search Indiana (Recommended) — Recommended".
    expect(stripRecommendedMarker('Search Indiana (Recommended)')).toBe('Search Indiana')
  })

  it('leaves an unmarked label exactly as it is', () => {
    expect(stripRecommendedMarker('Search Indiana')).toBe('Search Indiana')
  })

  it('does not eat a legitimate trailing parenthesis', () => {
    expect(stripRecommendedMarker('Search Indiana (1880)')).toBe('Search Indiana (1880)')
  })
})
