import type { IpcMain } from 'electron'
import { shell } from 'electron'

/**
 * Destination policy for links the UI advertises as going to FamilySearch (#1018).
 *
 * The generic `open-external` channel authorizes on scheme alone, which is right
 * for a link whose visible text IS its URL — the reader can see where they are
 * going. It is wrong for a button labelled "Open in FamilySearch", where the URL
 * comes from agent-authored project data and the label asserts a destination the
 * data does not have to honour. This population signs in to FamilySearch by
 * OAuth, so a look-alike login page is the obvious payload.
 *
 * ## Why this never validates a caller-supplied host
 *
 * The tempting shape is "parse the URL, allow-list the host". Rejected: every
 * one of these sinks carries an *identifier*, not a host, so accepting a host at
 * all invents the risk it then has to test for — suffix confusion
 * (`familysearch.org.evil.com`), prefix confusion (`notfamilysearch.org`), and
 * protocol-relative inputs are all consequences of that one choice.
 *
 * Instead the input is reduced to an identifier and the outbound URL is
 * rebuilt from `FS_BASE`, a compile-time constant. No caller-supplied host ever
 * reaches `shell.openExternal`.
 *
 * **String concatenation, never `new URL(value, FS_BASE)`.** The URL constructor
 * resolves `//evil.example/x` against a base to a *foreign origin* — it would
 * reintroduce the whole bug behind an API that looks like it is being careful.
 *
 * ## The grammar is duplicated on purpose
 *
 * These patterns mirror `packages/engine/mcp-server/src/utils/ark.ts` (ARK_CORE_RE,
 * BARE_PREFIXED_RE, FS_URL_PREFIX_RE). That module cannot be imported: the engine
 * sits outside the pnpm workspace and the web side must never depend on it
 * (CLAUDE.md). Duplicated per CLAUDE.md's "duplicate the structures in both
 * places", and cited here so the two stay findable.
 */

/** Every outbound URL this module produces starts here. Not caller-influenced. */
const FS_BASE = 'https://www.familysearch.org/'

/** A full `ark:/61903/<n>:<n>:<id>` token. Hyphenated multi-part image ids included. */
const ARK_RE = /^ark:\/61903\/\d:\d:[A-Za-z0-9.-]+$/

/** A bare, type-prefixed id with no resolver prefix (e.g. `1:1:QPRC-WPBZ`). */
const BARE_PREFIXED_RE = /^\d:\d:[A-Za-z0-9.-]+$/

/**
 * The resolver prefix. The trailing slash is load-bearing: without it,
 * `familysearch.org.evil.com` matches. The `^` anchor is what rejects
 * `notfamilysearch.org`.
 */
const FS_URL_PREFIX_RE = /^https?:\/\/(?:www\.)?familysearch\.org\//i

/**
 * A tree person id as it appears in `/tree/person/<pid>` (e.g. `KW7C-X9P`).
 *
 * 4-hyphen-3, not `{3,4}`: `ark.ts` calls it "the bare 8-character persona/tree id",
 * `check-warnings/SKILL.md` spells it "four characters, a hyphen, three characters",
 * and every fixture agrees. Not a host bypass either way — the host is rebuilt from
 * `FS_BASE` regardless — but over-permissive against the documented format.
 */
const TREE_PERSON_PATH_RE = /^tree\/person\/[A-Z0-9]{4}-[A-Z0-9]{3}$/

/**
 * The FamilySearch URL this input denotes, or `null` if it denotes none.
 *
 * Accepts the four shapes that actually occur in project data — verified against
 * the committed fixtures, where the same `ark` field carries a bare ARK, an ARK
 * resolver URL with and without `www`, and a `/tree/person/` URL that is not an
 * ARK at all. An ARK-only rule would reject two of the four.
 */
export function resolveFamilySearchTarget(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const value = input.trim()
  if (value === '') return null

  if (ARK_RE.test(value)) return FS_BASE + value
  if (BARE_PREFIXED_RE.test(value)) return `${FS_BASE}ark:/61903/${value}`

  if (FS_URL_PREFIX_RE.test(value)) {
    // Take only the path, and re-validate it. The matched prefix is discarded
    // rather than trusted: what gets opened is built from FS_BASE either way.
    const suffix = value.replace(FS_URL_PREFIX_RE, '')
    if (ARK_RE.test(suffix)) return FS_BASE + suffix
    if (TREE_PERSON_PATH_RE.test(suffix)) return FS_BASE + suffix
  }

  return null
}

/**
 * Register the constrained channel. Split from `index.ts` so the policy above is
 * reachable from a test: `setupIPC` is module-private, `app.whenReady()` runs at
 * module scope, and `index.ts` imports `icon.png?asset`, which the vitest config
 * has no plugin to resolve — so nothing can import that module in a test.
 *
 * `Pick<IpcMain, 'handle'>` documents that this module needs one method and
 * nothing else. It does NOT remove the `as never` casts in the tests, and was
 * kept knowing that: a hand-written fake cannot satisfy Electron's listener
 * signature (`IpcMainInvokeEvent`), so dropping the casts fails with TS2345 —
 * measured, both with this Pick and with a bespoke interface. The narrowing is
 * documentation; the casts stay because the alternative does not compile.
 */
export function registerExternalLinkHandlers(ipc: Pick<IpcMain, 'handle'>): void {
  ipc.handle('open-familysearch', async (_e, value: unknown) => {
    const target = resolveFamilySearchTarget(value)
    // A refused value opens nothing and says nothing: the renderer cannot tell a
    // malformed id from a rejected host, which is the right amount to tell it.
    if (!target) return
    try {
      await shell.openExternal(target)
    } catch {
      // Matches the sibling `open-external` handler. Without this, a rejection
      // (no default browser on a minimal Linux, say) is an unhandled promise
      // rejection on every click, since the renderer calls this with `void`.
    }
  })
}
