import { describe, it, expect, vi } from 'vitest'

// `../external-link` does `import { shell } from 'electron'` at module scope, so
// importing it for a PURE-function test pulls in the electron runtime and throws
// "Electron failed to install correctly" wherever the binary was not downloaded.
// CI happens to have it, which is the only reason this file passed there while
// failing locally. The sibling external-link-handler.test.ts already mocks it;
// this one did not.
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))

const { resolveFamilySearchTarget } = await import('../external-link')

const FS = 'https://www.familysearch.org/'

describe('resolveFamilySearchTarget — accepts what project data actually contains', () => {
  // Every shape below was read out of a committed fixture, not invented. The
  // same `ark` field carries all of them, which is why an ARK-only rule was
  // rejected: it breaks two of the four.
  it('accepts a bare ARK', () => {
    expect(resolveFamilySearchTarget('ark:/61903/4:1:KGS8-LY1')).toBe(
      `${FS}ark:/61903/4:1:KGS8-LY1`
    )
  })

  it('accepts a bare type-prefixed id, adding the resolver prefix', () => {
    expect(resolveFamilySearchTarget('1:1:QPRC-WPBZ')).toBe(`${FS}ark:/61903/1:1:QPRC-WPBZ`)
  })

  it('accepts an ARK resolver URL with www', () => {
    expect(resolveFamilySearchTarget('https://www.familysearch.org/ark:/61903/1:1:MXYZ')).toBe(
      `${FS}ark:/61903/1:1:MXYZ`
    )
  })

  it('accepts an ARK resolver URL WITHOUT www', () => {
    // patrick-flynn.ts:553 — an ARK-only-with-www rule would drop this.
    expect(resolveFamilySearchTarget('https://familysearch.org/ark:/61903/4:1:KGS8-LY1')).toBe(
      `${FS}ark:/61903/4:1:KGS8-LY1`
    )
  })

  it('accepts a /tree/person/ URL, which is not an ARK at all', () => {
    // patrick-flynn-sidecar.ts:72 — the ONLY fixture for the tree-match sink.
    expect(resolveFamilySearchTarget('https://www.familysearch.org/tree/person/KW7C-X9P')).toBe(
      `${FS}tree/person/KW7C-X9P`
    )
  })

  it('accepts an image ARK with a hyphenated multi-part id', () => {
    expect(resolveFamilySearchTarget('ark:/61903/3:1:3Q9M-CSNL-S98H-M')).toBe(
      `${FS}ark:/61903/3:1:3Q9M-CSNL-S98H-M`
    )
  })
})

describe('resolveFamilySearchTarget — refuses everything else', () => {
  it('refuses a foreign https host', () => {
    // The case this whole task exists for: a poisoned value behind a button
    // labelled "Open in FamilySearch".
    expect(resolveFamilySearchTarget('https://evil.example/ark:/61903/1:1:MXYZ')).toBeNull()
  })

  it('refuses suffix confusion', () => {
    // The trailing slash in FS_URL_PREFIX_RE is what rejects this.
    expect(
      resolveFamilySearchTarget('https://familysearch.org.evil.com/ark:/61903/1:1:MXYZ')
    ).toBeNull()
  })

  it('refuses prefix confusion', () => {
    // The `^` anchor is what rejects this.
    expect(resolveFamilySearchTarget('https://notfamilysearch.org/ark:/61903/1:1:MXYZ')).toBeNull()
  })

  it('refuses a protocol-relative URL', () => {
    // What rejects this is the `^` anchoring on ARK_RE / TREE_PERSON_PATH_RE —
    // `//evil.example/x` matches none of the three patterns, so it never reaches
    // a return site at all.
    //
    // NOT the concatenation, which an earlier version of this comment claimed.
    // That claim also came with an assertion on `new URL(...).origin`, which
    // tested the platform rather than this module and so could never fail. The
    // concatenation is still the right call — see the module header — but the
    // evidence for it is the `new URL` mutation reddening the ACCEPT tests
    // below, not this one.
    expect(resolveFamilySearchTarget('//evil.example/x')).toBeNull()
    expect(resolveFamilySearchTarget('//www.familysearch.org/ark:/61903/1:1:M')).toBeNull()
  })

  it('refuses a non-https scheme on an otherwise valid host', () => {
    expect(resolveFamilySearchTarget('javascript:alert(1)')).toBeNull()
    expect(resolveFamilySearchTarget('file:///etc/passwd')).toBeNull()
  })

  it('refuses an FS URL whose path is neither an ARK nor a tree person', () => {
    // Being on the right host is not enough — an open redirect on
    // familysearch.org would otherwise be usable as a hop.
    expect(
      resolveFamilySearchTarget('https://www.familysearch.org/redirect?to=https://evil.example')
    ).toBeNull()
  })

  it('refuses a traversal that climbs out of the resolver path', () => {
    expect(
      resolveFamilySearchTarget('https://www.familysearch.org/ark:/61903/../../evil')
    ).toBeNull()
  })

  it('refuses non-strings, empty and whitespace', () => {
    expect(resolveFamilySearchTarget(undefined)).toBeNull()
    expect(resolveFamilySearchTarget(null)).toBeNull()
    expect(resolveFamilySearchTarget(42)).toBeNull()
    expect(resolveFamilySearchTarget({ toString: () => 'ark:/61903/1:1:X' })).toBeNull()
    expect(resolveFamilySearchTarget('')).toBeNull()
    expect(resolveFamilySearchTarget('   ')).toBeNull()
  })

  it('never returns a URL outside the FamilySearch base', () => {
    // The invariant behind the design: whatever comes in, what goes out is
    // FS_BASE + something, or nothing at all.
    const ACCEPTED = [
      'ark:/61903/1:1:MXYZ',
      '1:1:MXYZ',
      'https://familysearch.org/ark:/61903/1:1:MXYZ',
      'https://www.familysearch.org/tree/person/KW7C-X9P'
    ]
    const REJECTED = [
      'https://evil.example/x',
      '//evil.example/x',
      'https://familysearch.org.evil.com/ark:/61903/1:1:M'
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
