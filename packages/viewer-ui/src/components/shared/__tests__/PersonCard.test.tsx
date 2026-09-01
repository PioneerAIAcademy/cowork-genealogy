import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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
