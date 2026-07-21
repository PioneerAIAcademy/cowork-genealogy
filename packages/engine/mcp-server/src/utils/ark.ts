// Normalization helpers for FamilySearch ARK identifiers.
//
// Per the agreed ID standard, record personas (1:1:), record sources (1:2:),
// and document images (3:1:/3:2:) are surfaced to the LLM as bare ARKs of the
// form `ark:/61903/<type>:<id>`. Upstream FamilySearch payloads carry these as
// full resolver URLs (https://[www.]familysearch.org/ark:/61903/...). These
// helpers convert between the two forms. Tree-person IDs (4:1:) are handled as
// bare IDs elsewhere and are not the concern of these helpers, though `toArk`
// will normalize a 4:1: URL too (used by the GedcomX converter's `ark` field).

// A full `ark:/61903/<n:n>:<id>` token. The id segment allows the hyphenated,
// multi-part forms used by document images (e.g. `3Q9M-CSNL-S98H-M`).
const ARK_CORE_RE = /ark:\/61903\/\d:\d:[A-Za-z0-9.-]+/;

// A bare, type-prefixed id with no `ark:/61903/` (e.g. `1:1:QPRC-WPBZ`).
const BARE_PREFIXED_RE = /^\d:\d:[A-Za-z0-9.-]+$/;

const FS_URL_PREFIX_RE = /^https?:\/\/(?:www\.)?familysearch\.org\//i;

// A canonical document-image ARK (`3:1:`/`3:2:`), the class `image_read` owns
// and `record_read` (which owns `1:1:`/`1:2:` record personas) must reject.
// Test the output of `toArk(value)`, never a raw input, so a bare `3:1:…`/`3:2:…`
// id is normalized to the full form before matching. Anchored and narrowed to
// `3:[12]` — do NOT reuse the broader `ARK_CORE_RE`/`BARE_PREFIXED_RE` for this
// boundary check (they also match `1:1:` personas).
export const DOCUMENT_IMAGE_ARK_PATTERN =
  /^ark:\/61903\/3:[12]:[A-Za-z0-9.-]+$/;

/**
 * Normalize any form of a FamilySearch ARK to the canonical `ark:/61903/...`
 * form: a resolver URL, an already-bare ARK, or a type-prefixed id like
 * `1:1:QPRC-WPBZ`. Returns the input unchanged when no ARK can be derived
 * (defensive — never throws).
 */
export function toArk(value: string): string {
  if (typeof value !== "string" || value.length === 0) return value;
  const trimmed = value.trim();
  const match = trimmed.match(ARK_CORE_RE);
  if (match) return match[0];
  if (BARE_PREFIXED_RE.test(trimmed)) return `ark:/61903/${trimmed}`;
  return trimmed;
}

/**
 * Reduce any ARK form to the bare 8-character persona/tree id (the
 * `XXXX-XXX` tail) — the part after the last colon. FamilySearch's
 * matchTwoExamples API wants persons' Persistent identifiers in this bare
 * form. Handles resolver URLs, bare ARKs, type-prefixed ids, and an
 * already-bare id (returned unchanged). Never throws.
 *
 *   "ark:/61903/4:1:KGS8-LY1"                         -> "KGS8-LY1"
 *   "https://familysearch.org/ark:/61903/1:1:QPRC-WPBZ" -> "QPRC-WPBZ"
 *   "KGS8-LY1"                                         -> "KGS8-LY1"
 */
export function arkToBareId(value: string): string {
  if (typeof value !== "string" || value.length === 0) return value;
  const trimmed = value.trim();
  // Normalize to `ark:/61903/n:n:<id>` first, then take the id segment. Only
  // strips genuine ARKs — a non-ARK value (some other URL, an already-bare id)
  // is returned unchanged rather than naively split on its last colon.
  const m = toArk(trimmed).match(/^ark:\/61903\/\d:\d:(.+)$/);
  return m ? m[1] : trimmed;
}

/**
 * Expand a canonical `ark:/61903/...` to a full FamilySearch resolver URL.
 * Used when handing an ARK back to a FamilySearch API that expects the URL
 * form (e.g. matchTwoExamples, the attachments API). Passes through values
 * that are already URLs or are not ARKs (defensive — never throws).
 */
export function arkToUrl(value: string): string {
  if (typeof value !== "string" || value.length === 0) return value;
  const trimmed = value.trim();
  if (FS_URL_PREFIX_RE.test(trimmed)) return trimmed;
  if (trimmed.startsWith("ark:/")) {
    return `https://www.familysearch.org/${trimmed}`;
  }
  return trimmed;
}
