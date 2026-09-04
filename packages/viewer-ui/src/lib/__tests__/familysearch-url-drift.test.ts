import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The two policy copies must not drift (#2049 review).
 *
 * `apps/electron/src/main/external-link.ts` enforces in the main process, where
 * the privilege is. `packages/viewer-ui/src/lib/familysearch-url.ts` is the web
 * copy, for the hosted viewer, which has no main process. Neither can import the
 * other: the main process would pull React in from a renderer package.
 *
 * Both reviewers filed the drift risk as non-blocking, twice. It stopped being
 * hypothetical while mutation-testing the tree-id pattern: one copy was restored
 * and the other missed, leaving the two genuinely out of step inside a single
 * command. Each copy now has its own tests, which is most of the protection —
 * this closes the rest.
 *
 * Compares the POLICY REGION only, not whole files. The headers legitimately
 * differ (the web one says why it is weaker and why it exists) and the Electron
 * copy carries the IPC handler the web copy has no use for. What must stay
 * byte-identical is the grammar and the resolver — the part where a divergence
 * means one platform accepts something the other refuses.
 */

const REPO = path.resolve(__dirname, '../../../../..')
const ELECTRON = path.join(REPO, 'apps/electron/src/main/external-link.ts')
const WEB = path.join(REPO, 'packages/viewer-ui/src/lib/familysearch-url.ts')

/** From the first constant through the end of the resolver. */
function policyRegion(file: string): string {
  const src = fs.readFileSync(file, 'utf8')
  const start = src.indexOf('/** Every outbound URL this module produces starts here.')
  expect(start, `${path.basename(file)}: policy region start marker missing`).toBeGreaterThan(-1)
  const end = src.indexOf('\n}', src.indexOf('export function resolveFamilySearchTarget'))
  expect(end, `${path.basename(file)}: resolver end not found`).toBeGreaterThan(start)
  return src.slice(start, end + 2)
}

describe('the two FamilySearch policy copies', () => {
  it('share a byte-identical policy region', () => {
    const electron = policyRegion(ELECTRON)
    const web = policyRegion(WEB)
    expect(
      web,
      'The web and Electron policies have diverged. Both must accept and refuse ' +
        'exactly the same values — a difference means one platform opens what the ' +
        'other refuses. Neither can import the other (the main process would pull ' +
        'React in from a renderer package), so they are kept in step by hand.'
    ).toBe(electron)
  })

  it('the region it compares actually contains the grammar', () => {
    // A comparison of two empty strings passes. Pin that the slice is the real
    // thing, so a marker rename cannot quietly turn this into a no-op.
    const region = policyRegion(ELECTRON)
    for (const token of ['ARK_RE', 'BARE_PREFIXED_RE', 'FS_URL_PREFIX_RE', 'TREE_PERSON_PATH_RE']) {
      expect(region, `policy region should contain ${token}`).toContain(token)
    }
    expect(region.length).toBeGreaterThan(500)
  })
})
