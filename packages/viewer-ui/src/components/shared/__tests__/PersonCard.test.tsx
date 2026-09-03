import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setOpenExternal, setOpenFamilySearch } from '../../../lib/external'
import PersonCard from '../PersonCard'
import type { GedcomxPerson } from '../../../lib/schema'

/**
 * Link visibility (#1018 review).
 *
 * The regression this pins is not a wrong destination — it is a DEAD BUTTON.
 * `tree_edit` stores `input.ark` unvalidated and `toArk` returns its input
 * unchanged on no match, so a person can carry a non-FamilySearch URL. Under the
 * old scheme-only check that opened; under the destination policy it is refused,
 * and a button labelled "View on FamilySearch" that does nothing is worse than
 * no button.
 *
 * Reverting the gate the way anyone actually would — dropping the condition AND
 * the now-dead variable — left all 451 tests and typecheck green. The unused
 * variable error is not a guard, because it disappears with the line.
 *
 * Nothing else in this repo asserts what a dead control does, which is why the
 * regression survived four review passes.
 */

const person = (ark?: string): GedcomxPerson =>
  ({
    id: 'p1',
    gender: 'Male',
    names: [],
    facts: [],
    ...(ark ? { ark } : {})
  }) as unknown as GedcomxPerson

describe('PersonCard — FamilySearch link visibility', () => {
  it('shows the link when the ark resolves', () => {
    render(<PersonCard person={person('1:1:QPRC-WPBZ')} />)
    expect(screen.queryByRole('button', { name: /FamilySearch/i })).not.toBeNull()
  })

  it('hides the link when the ark is a non-FamilySearch URL', () => {
    // The reachable case: an agent-written value the policy refuses.
    render(<PersonCard person={person('https://example.com/p1-ark')} />)
    expect(screen.queryByRole('button', { name: /FamilySearch/i })).toBeNull()
  })

  it('shows no link at all when the person has no ark', () => {
    render(<PersonCard person={person()} />)
    expect(screen.queryByRole('button', { name: /FamilySearch/i })).toBeNull()
  })
})

/**
 * WHICH channel the click reaches (#2049 review).
 *
 * `link-channel-routing.test.ts` reads the component source and counts
 * `openFamilySearch(` occurrences. That is a spelling, and one aliased import
 * satisfies it while routing everything to the unconstrained channel:
 *
 *     import { openExternal as openFamilySearch } from '../../lib/external'
 *
 * Applied to both constrained components, all 313 tests stayed green and
 * typecheck was clean. This asserts the behaviour instead: the constrained
 * implementation fires and the generic one does not.
 */
describe('PersonCard — link channel', () => {
  const fs = vi.fn()
  const generic = vi.fn()

  beforeEach(() => {
    fs.mockClear()
    generic.mockClear()
    setOpenFamilySearch(fs)
    setOpenExternal(generic)
  })

  it('routes the FamilySearch link through the constrained channel', async () => {
    render(<PersonCard person={person('ark:/61903/1:1:MXYZ-9QP')} />)
    await userEvent.click(screen.getByRole('button', { name: /FamilySearch/i }))
    expect(fs).toHaveBeenCalledTimes(1)
    expect(generic).not.toHaveBeenCalled()
  })
})
