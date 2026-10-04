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

// The one spelling of "is this a document-image ARK" (3:1: or 3:2:). It lived
// in three hand-maintained copies with three different anchorings —
// fs-image-fetch's DOCUMENT_IMAGE_ARK_PATTERN, its error-message scanner, and
// record-read's extractImageArk — so widening the set (a new type, a new id
// character) meant finding all three. Two functions rather than one flag:
// validating a whole string and finding an ARK inside a URL are different
// questions, and the callers read better for saying which they mean.
const DOCUMENT_IMAGE_ARK_CORE = "ark:\\/61903\\/3:[12]:[A-Za-z0-9.-]+";

export function isDocumentImageArk(value: string): boolean {
  if (typeof value !== "string") return false;
  return new RegExp(`^${DOCUMENT_IMAGE_ARK_CORE}$`).test(value);
}

/** Find a document-image ARK anywhere inside a string (e.g. a resolved URL). */
export function findDocumentImageArk(value: string): string | undefined {
  if (typeof value !== "string") return undefined;
  return new RegExp(DOCUMENT_IMAGE_ARK_CORE).exec(value)?.[0];
}

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

// An imageId is a digitized-image identifier of the form NUMBER_NUMBER
// (an image group number, an underscore, and an image sequence number,
// e.g. "004884748_02613"). Shared by fs-image-fetch.ts (validation) and
// imageViewerUrl (viewer-link construction).
export const IMAGE_ID_PATTERN = /^\d+_\d+$/;

// An image-ARK id with its `3:1:` prefix dropped, as a delegating agent passed
// it in an alpha-feedback run. Only the 4-4-4-1 shape: in the repo, 161 distinct
// prefixed ids of that shape are 3:1: and 1 is 3:2: (a test value), while
// shorter bare ids collide with 1:1: persona ids (XXXX-XXX, XXXX-XXXX) and 4:1:
// tree ids (XXXX-XXX). Shared by fs-image-fetch.ts (fetch resolution) and
// imageViewerUrl (viewer-link construction).
export const UNPREFIXED_IMAGE_ID_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]$/;

// A DGS distribution URL passed as `ark` — extract the embedded imageId to build
// a viewer URL. The fetch side (fs-image-fetch.ts) already accepts this shape;
// imageViewerUrl needs to derive a film-viewer link from it.
const DGS_URL_RE = /^https:\/\/(?:www\.)?familysearch\.org\/das\/v2\/dgs:(\d+_\d+)\/dist\.jpg$/;

/** The `NUMBER_NUMBER` imageId a DGS distribution URL embeds, or undefined. */
export function dgsImageId(url: string): string | undefined {
  return DGS_URL_RE.exec(url)?.[1];
}

/**
 * Build a FamilySearch viewer URL for a tool's image input, so the user can
 * click through and verify what the agent read. Returns `undefined` when no
 * viewer URL can be derived (uploaded file, memory artifact).
 *
 * - **ARK** (3:1:/3:2:, bare or canonical or full URL): the resolver URL,
 *   preserving any `i=`/`cc=`/`groupId=` context params the input carried.
 * - **DGS imageId** (`004528077_00697`): the film-viewer URL. The viewer's
 *   `i=` parameter is **zero-indexed** (verified 2026-10-01: image 00697 of
 *   film 004528077 opens correctly at `i=696`).
 *
 * Called by `image_transcribe`, `image_read`, and `record_read` (issue #2854).
 */
export function imageViewerUrl(
  input: { imageId?: string; ark?: string },
  extractContextQuery?: (raw: string) => string,
): string | undefined {
  if (input.imageId !== undefined) {
    if (!IMAGE_ID_PATTERN.test(input.imageId)) return undefined;
    const [dgsNumber, seq] = input.imageId.split("_");
    const imageNumber = parseInt(seq, 10);
    if (imageNumber < 1) return undefined;
    // The film viewer's `i=` is zero-indexed.
    return `https://www.familysearch.org/search/film/${dgsNumber}?i=${imageNumber - 1}`;
  }
  if (input.ark !== undefined) {
    // DGS distribution URL: extract the embedded imageId and build a film viewer.
    const dgsId = dgsImageId(input.ark);
    if (dgsId) {
      const [dgsNumber, seq] = dgsId.split("_");
      const imageNumber = parseInt(seq, 10);
      if (imageNumber < 1) return undefined;
      return `https://www.familysearch.org/search/film/${dgsNumber}?i=${imageNumber - 1}`;
    }
    // Unprefixed XXXX-XXXX-XXXX-X image id → treat as 3:1: ARK.
    if (UNPREFIXED_IMAGE_ID_RE.test(input.ark.trim())) {
      return arkToUrl(`ark:/61903/3:1:${input.ark.trim()}`);
    }
    const canonical = toArk(input.ark);
    if (!isDocumentImageArk(canonical)) return undefined;
    const base = arkToUrl(canonical);
    const query = extractContextQuery ? extractContextQuery(input.ark) : "";
    return `${base}${query}`;
  }
  return undefined;
}
