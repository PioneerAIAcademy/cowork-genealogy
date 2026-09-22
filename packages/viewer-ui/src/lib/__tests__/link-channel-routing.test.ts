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
    // MIDDLE-click fires `auxclick`, not `click`, so an onClick handler never
    // runs and the href is followed unchecked. (Ctrl+click does fire `click`;
    // preventDefault stops that one.) Only bites when `ark` holds an https://
    // value — the poisoned case, and what the shipped fixtures contain.
    expect(read('shared/PersonCard.tsx')).not.toMatch(/href=\{person\.ark\}/)
  })
})

/**
 * Strip single-line (`// …`) and multi-line (`/* … *​/`) comments so that
 * prose *about* anchors does not trip the anchor-element guard.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

function hasAnchorElement(src: string): boolean {
  return /<a[\s>]/.test(stripComments(src))
}

describe('PersonCard — no anchor element (#2661)', () => {
  const src = read('shared/PersonCard.tsx')

  it('does not contain an anchor element in the source', () => {
    expect(hasAnchorElement(src)).toBe(false)
  })

  it('fires on an anchor, however it is spelled', () => {
    expect(hasAnchorElement('<a href={person.ark}>x</a>')).toBe(true)
    expect(hasAnchorElement('<a\n  href="#"\n>x</a>')).toBe(true)
    expect(hasAnchorElement('<a>x</a>')).toBe(true)
  })

  it('accepts legitimate neighbours', () => {
    expect(hasAnchorElement('<aside>x</aside>')).toBe(false)
    expect(hasAnchorElement('<article>x</article>')).toBe(false)
  })

  it('ignores comments that mention anchors', () => {
    expect(hasAnchorElement('// Do not turn this into an <a href> element')).toBe(false)
    expect(hasAnchorElement('{/* A <button>, not an <a href>. */}')).toBe(false)
  })
})
