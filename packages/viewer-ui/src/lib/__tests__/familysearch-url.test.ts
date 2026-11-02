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

  it('accepts a tree-person id in both 4-3 and 4-4, in either case', () => {
    // Widened back to `{3,4}` and case-insensitive, matching the PRODUCER:
    // `ark.ts`'s `treePidOfArk` uses `[A-Za-z0-9]{4}-[A-Za-z0-9]{3,4}`.
    // The #2049 review narrowed this to 4-3 uppercase on the premise that
    // "`ark.ts` ... spells this 4-hyphen-3" — which that file never did.
    // `record_search`'s `parseTreePersonId` applies no grammar at all, so the
    // narrow pattern silently dropped the link on any id it did not predict.
    for (const pid of ['KW7C-X9P', 'KW7C-X9PZ', 'kw7c-x9p']) {
      expect(resolveFamilySearchTarget(`https://www.familysearch.org/tree/person/${pid}`), pid)
        .not.toBeNull()
    }
    // Still anchored: the grammar is what rejects, not the host.
    for (const pid of ['KW7-X9P', 'KW7C-X9PZQ', 'KW7C_X9P', 'KW7C-X9P/extra']) {
      expect(resolveFamilySearchTarget(`https://www.familysearch.org/tree/person/${pid}`), pid)
        .toBeNull()
    }
  })

  it('resolves a BARE tree-person id, which is all `treeMatches` carries', () => {
    // record_search emits `treeMatches[].treePersonId` and nothing else — no
    // ark, no URL. Without this branch the sidecar row has no link at all.
    expect(resolveFamilySearchTarget('KW7C-X9P')).toBe(`${FS}tree/person/KW7C-X9P`)
    expect(resolveFamilySearchTarget('KW7C-X9PZ')).toBe(`${FS}tree/person/KW7C-X9PZ`)
    // The host is still rebuilt from FS_BASE, never taken from the input.
    expect(resolveFamilySearchTarget('evil.com/KW7C-X9P')).toBeNull()
    expect(resolveFamilySearchTarget('KW7C-X9P/../../evil')).toBeNull()
  })
  it('refuses a path or query appended to an otherwise valid id', () => {
    // The `$` half of the grammar. Every other rejection here attacks the host
    // (`^`, the trailing slash, prefix/suffix confusion); nothing attacked the
    // tail, and both BARE branches build the URL from FS_BASE, so a suffix that
    // survives the match rides along into the opened URL. That is the invariant
    // the module header names — an open redirect on familysearch.org would
    // otherwise be reachable as a hop (#2049 review).
    expect(resolveFamilySearchTarget('ark:/61903/1:1:MXYZ?to=https://evil.example')).toBeNull()
    expect(resolveFamilySearchTarget('ark:/61903/1:1:MXYZ/../../en/tree')).toBeNull()
    expect(resolveFamilySearchTarget('1:1:MXYZ/../../redirect?to=https://evil.example')).toBeNull()
    expect(resolveFamilySearchTarget('1:1:MXYZ#frag')).toBeNull()
  })
})
