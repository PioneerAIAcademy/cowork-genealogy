/**
 * Destination policy for FamilySearch links, web copy (#1018).
 *
 * The authoritative copy is `apps/electron/src/main/external-link.ts`, which
 * enforces in the MAIN process where the privilege lives. This one runs in the
 * renderer and is therefore **weaker**: page script could call `window.open`
 * directly and bypass it. It is here because `viewer-ui` is shared, and the
 * hosted viewer has no main process to enforce in — leaving the web path
 * unconstrained while calling the feature "enforced" would be a claim the code
 * does not support.
 *
 * Duplicated rather than imported: the Electron main process cannot import a
 * renderer package without pulling React into the main bundle. Same reasoning as
 * the engine's `utils/ark.ts`, which this grammar also mirrors. Change one, change
 * the others.
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

/** A tree person id as it appears in `/tree/person/<pid>` (e.g. `KW7C-X9P`).
 *  4-hyphen-3 per `ark.ts` and `check-warnings/SKILL.md`; see the Electron copy. */
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
