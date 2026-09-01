import { describe, it, expect } from 'vitest'
import { resolveFamilySearchTarget } from '../familysearch-url'

/**
 * The WEB copy of the destination policy (#1018).
 *
 * Its Electron twin has its own suite. This one shipped with none, and the gap
 * was silent in exactly the direction that matters: replacing this body with a
 * pass-through left all eight turbo tasks green and typecheck clean, while
 * `apps/web` — which imports *this* copy, not the Electron one — would have
 * handed `https://evil.example/…` straight to `window.open` behind an "Open in
 * FamilySearch" label. CI also lints only `@genealogy/electron`, so nothing
 * lints this package either.
 *
 * The two copies are identical today and nothing holds them that way. These
 * assertions are what makes drift loud.
 */

const FS = 'https://www.familysearch.org/'

describe('resolveFamilySearchTarget — web copy', () => {
  it('accepts the four shapes project data actually contains', () => {
    expect(resolveFamilySearchTarget('ark:/61903/4:1:KGS8-LY1')).toBe(
      `${FS}ark:/61903/4:1:KGS8-LY1`
    )
    expect(resolveFamilySearchTarget('1:1:QPRC-WPBZ')).toBe(`${FS}ark:/61903/1:1:QPRC-WPBZ`)
    expect(resolveFamilySearchTarget('https://familysearch.org/ark:/61903/4:1:KGS8-LY1')).toBe(
      `${FS}ark:/61903/4:1:KGS8-LY1`
    )
    expect(resolveFamilySearchTarget('https://www.familysearch.org/tree/person/KW7C-X9P')).toBe(
      `${FS}tree/person/KW7C-X9P`
    )
  })

  it('refuses a foreign host, suffix and prefix confusion, and protocol-relative', () => {
    expect(resolveFamilySearchTarget('https://evil.example/ark:/61903/1:1:MXYZ')).toBeNull()
    expect(resolveFamilySearchTarget('https://familysearch.org.evil.com/ark:/61903/1:1:M')).toBeNull()
    expect(resolveFamilySearchTarget('https://notfamilysearch.org/ark:/61903/1:1:M')).toBeNull()
    expect(resolveFamilySearchTarget('//evil.example/x')).toBeNull()
    expect(resolveFamilySearchTarget('javascript:alert(1)')).toBeNull()
  })

  it('never returns a URL outside the FamilySearch base', () => {
    const ACCEPTED = [
      'ark:/61903/1:1:MXYZ',
    ]
    const REJECTED = [
      'https://evil.example/x',
      '//evil.example/x',
      'https://familysearch.org.evil.com/ark:/61903/1:1:M',
      'https://www.familysearch.org/redirect?to=https://evil.example',
    ]
    // Split accept/reject explicitly. The previous form looped both through
    // `if (out !== null) expect(...)` — so for every REJECT input the assertion
    // was silently skipped and the loop asserted nothing about them at all.
    for (const input of ACCEPTED) {
      const out = resolveFamilySearchTarget(input)
      expect(out, input).not.toBeNull()
      expect(out!.startsWith(FS), input).toBe(true)
    }
    for (const input of REJECTED) {
      expect(resolveFamilySearchTarget(input), input).toBeNull()
    }
  })

  it('refuses a tree-person id that is not 4-3', () => {
    // Every reference in the repo spells this 4-hyphen-3 — `ark.ts`,
    // `check-warnings/SKILL.md`, and all ten `tree/person/` ids in the corpus.
    // The pattern accepted 4-4 until the #2049 review; loosening it back is
    // otherwise silent, and must stay in step with the Electron copy.
    expect(
      resolveFamilySearchTarget('https://www.familysearch.org/tree/person/KW7C-X9PZ')
    ).toBeNull()
    expect(
      resolveFamilySearchTarget('https://www.familysearch.org/tree/person/KW7C-X9P')
    ).not.toBeNull()
  })
})
