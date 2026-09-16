import { describe, it, expect } from 'vitest'
import {
  EXPERIENCE_CHIPS,
  chipMessage,
  applyChip,
  shouldShowExperienceChips
} from '../experienceChips'

describe('EXPERIENCE_CHIPS', () => {
  it('carries a label for every enum value', () => {
    // The compile-time Record is the real guard; this only pins that no label
    // was left as an empty string, which typechecks fine and renders a blank chip.
    for (const [value, label] of Object.entries(EXPERIENCE_CHIPS)) {
      expect(label.trim(), `${value} has a blank label`).not.toBe('')
    }
  })
})

describe('chipMessage', () => {
  it('inserts the enum value, not the human label', () => {
    // The skill scans this message for a stated level against a closed enum, so
    // the enum spelling is the one it cannot mis-map. Inserting "just starting
    // out" instead would put the burden back on natural-language mapping.
    expect(chipMessage('novice')).toBe('My genealogy experience: novice')
    expect(chipMessage('novice')).not.toContain(EXPERIENCE_CHIPS.novice)
  })
})

describe('applyChip', () => {
  it('inserts into an empty composer', () => {
    expect(applyChip('', null, chipMessage('novice'))).toBe('My genealogy experience: novice')
  })

  it('REPLACES the previous chip rather than appending it — this is single-select', () => {
    // The defect this exists to prevent: clicking three chips leaving three
    // contradictory answers in the composer for the agent to reconcile.
    const first = chipMessage('novice')
    const after = applyChip(first, first, chipMessage('professional'))
    expect(after).toBe('My genealogy experience: professional')
    expect(after).not.toContain('novice')
  })

  it('preserves free text the user typed around the chip', () => {
    const first = chipMessage('novice')
    const composed = `Patrick Flynn, born 1845. ${first} Thanks!`
    const after = applyChip(composed, first, chipMessage('experienced'))
    expect(after).toBe('Patrick Flynn, born 1845. My genealogy experience: experienced Thanks!')
  })

  it('appends when the user has deleted the chip it would have replaced', () => {
    // A chip they deleted stays deleted: with `previous` gone from the composer
    // there is nothing to substitute, so this must not silently resurrect it.
    const after = applyChip('LZNY-BRF', chipMessage('novice'), chipMessage('professional'))
    expect(after).toBe('LZNY-BRF My genealogy experience: professional')
  })

  it('appends with a separating space, and does not double it', () => {
    expect(applyChip('LZNY-BRF', null, 'X')).toBe('LZNY-BRF X')
    expect(applyChip('LZNY-BRF ', null, 'X')).toBe('LZNY-BRF X')
    expect(applyChip('LZNY-BRF\n', null, 'X')).toBe('LZNY-BRF\nX')
  })

  it('replaces only the first occurrence when the user pasted the chip twice', () => {
    const c = chipMessage('novice')
    expect(applyChip(`${c} and ${c}`, c, 'Z')).toBe(`Z and ${c}`)
  })
})

describe('shouldShowExperienceChips', () => {
  const user = { role: 'user' }
  const assistant = { role: 'assistant' }

  it('shows once the assistant has started answering the opening turn', () => {
    expect(shouldShowExperienceChips(true, [user, assistant])).toBe(true)
  })

  it('hides until the assistant has started answering', () => {
    // The window between send(OPENING_TURN) and the first content token, where
    // the chips would otherwise answer a question not yet on screen.
    expect(shouldShowExperienceChips(true, [user])).toBe(false)
  })

  it('hides once the user has answered', () => {
    // The near-miss for the row above: one more user message and the question
    // has been answered, so the chips must go.
    expect(shouldShowExperienceChips(true, [user, assistant, user])).toBe(false)
  })

  it('hides on a resumed session, where isNew is false', () => {
    // App.tsx sets isNew false for a session restored from the URL. Without this
    // arm the chips would reappear mid-project on any session whose transcript
    // happened to hold one user message.
    expect(shouldShowExperienceChips(false, [user])).toBe(false)
  })

  it('hides before the opening turn has been sent', () => {
    expect(shouldShowExperienceChips(true, [])).toBe(false)
  })
})
