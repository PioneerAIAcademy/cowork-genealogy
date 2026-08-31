import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Which channel each call site uses (#1018).
 *
 * A policy test cannot prove a component calls the constrained channel — that is
 * the lesson from #2000, where two sinks had no test and the PR body said they
 * did. These assert the routing decision itself.
 *
 * Source-text assertions rather than rendered ones: the decision under test IS
 * which function the component names, and pinning it here catches a site being
 * flipped back without anyone having to construct the component's props.
 */

const COMPONENTS = path.resolve(__dirname, '../../components')
const read = (rel: string): string => fs.readFileSync(path.join(COMPONENTS, rel), 'utf8')

/** Advertise FamilySearch behind a fixed label: the reader cannot see the destination. */
const CONSTRAINED = [
  ['shared/PersonCard.tsx', 1],
  ['shared/SidecarResultCard.tsx', 3]
] as const

/** Render the URL as its own visible text: the reader can see the destination. */
const GENERIC = [
  'shared/Linkify.tsx',
  'sections/SourcesSection.tsx',
  'sections/ResearchLogSection.tsx'
] as const

describe('outbound link channel routing', () => {
  it.each(CONSTRAINED)('%s routes all %i sink(s) through openFamilySearch', (file, count) => {
    const src = read(file)
    expect(src.match(/openFamilySearch\(/g) ?? []).toHaveLength(count)
    expect(
      src.includes('openExternal('),
      `${file} advertises FamilySearch, so it must not use the unconstrained channel`
    ).toBe(false)
  })

  it.each(GENERIC)('%s keeps the generic openExternal channel', (file) => {
    const src = read(file)
    expect(src).toContain('openExternal(')
    // Constraining these would break external-site search and the archived-copy
    // links, and buys nothing — the user can already read the destination.
    expect(src.includes('openFamilySearch(')).toBe(false)
  })

  it('PersonCard does not carry a raw href that bypasses the handler', () => {
    // ctrl/middle-click follows an href WITHOUT firing onClick, so the policy
    // would be skipped entirely. Only bites when `ark` holds an https:// value —
    // which is the poisoned case, and what the shipped fixtures contain.
    expect(read('shared/PersonCard.tsx')).not.toMatch(/href=\{person\.ark\}/)
  })
})
