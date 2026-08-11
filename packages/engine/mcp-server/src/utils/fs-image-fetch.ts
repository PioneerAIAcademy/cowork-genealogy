// Shared resolve + authenticated fetch for FamilySearch distribution
// page-scans. Lifted from image-read.ts so both `image_read` (which returns
// the bytes as inline base64) and `image_transcribe` (which OCRs them
// host-side and returns text) build on one resolver + fetcher instead of
// duplicating the token/UA/content-type plumbing.

import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { fetchWithTimeout } from "./http.js";
import { toArk, arkToUrl } from "./ark.js";

// fetchWithTimeout's budget covers headers and body together, and a full-size
// page scan at typical throughput needs more than the 30s default to finish
// streaming. A measured download of one takes ~7s, so 90s is deliberate
// headroom — this is the download leg only, and it is budgeted separately
// from the OCR call it feeds (image-transcribe.ts's OCR_TIMEOUT_MS).
const IMAGE_FETCH_TIMEOUT_MS = 90_000;

// An imageId is a digitized-image identifier of the form NUMBER_NUMBER
// (an image group number, an underscore, and an image sequence number,
// e.g. "004884748_02613").
const IMAGE_ID_PATTERN = /^\d+_\d+$/;

// `ark` accepts either an already-resolved distribution URL (the pre-#267
// input shapes, for callers that already have one) or a FamilySearch
// document-image ARK (3:1:/3:2:, e.g. fulltext_search's `id`), which has no
// other resolver in this codebase. Verified live (2026-07-07): fetching a
// 3:1:/3:2: ARK's resolver URL redirects straight to the image bytes. A 1:2:
// record ARK (e.g. record_search's `recordArk`) does not — its resolver
// returns an HTML shell, not an image — so that shape is deliberately not
// accepted here; only 3:1:/3:2: are.
const ARK_PATTERN = /^https:\/\/sg30p0\.familysearch\.org\/.+\/\$dist$/;
const DGS_URL_PATTERN =
  /^https:\/\/(www\.)?familysearch\.org\/das\/v2\/dgs:[^/]+\/dist\.jpg$/;
const DOCUMENT_IMAGE_ARK_PATTERN = /^ark:\/61903\/3:[12]:[A-Za-z0-9.-]+$/;

// A `3:1:`/`3:2:` ARK is not always self-sufficient: some are waypoints into
// a multi-image film/register, and the bare resolver redirect can land on an
// arbitrary image within that group rather than the one the caller means.
// FamilySearch's own browser viewer disambiguates with query params — e.g.
// .../ark:/61903/3:1:XXXX-XXX?lang=en&i=112&cc=1858355&groupId=1858355 — so
// when the caller passes a full URL carrying these, forward them rather than
// discarding them the way toArk()'s bare-ARK extraction otherwise would.
// Observed live (2026-08-03): the bare ARK for a multi-image entry did not
// resolve to any document at all without this context — though a later
// live check on the same ARK (2026-08-05) got a 200. FamilySearch's
// resolver behavior here isn't fully understood/may not be stable, which is
// exactly why fetchFsImageBytes retries the bare URL as a fallback (below)
// rather than assuming forwarding these params is always correct.
const IMAGE_CONTEXT_PARAMS = ["i", "cc", "groupId"] as const;

function extractImageContextQuery(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  const params = new URLSearchParams();
  for (const key of IMAGE_CONTEXT_PARAMS) {
    const value = url.searchParams.get(key);
    if (value !== null) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export interface FsImageInput {
  imageId?: string;
  ark?: string;
}

function imageIdToUrl(imageId: string): string {
  if (!IMAGE_ID_PATTERN.test(imageId)) {
    throw new Error(
      "Unrecognized imageId. Expected an Image Group Number of the form " +
        "NUMBER_NUMBER (e.g. 004884748_02613)."
    );
  }
  return `https://familysearch.org/das/v2/dgs:${imageId}/dist.jpg`;
}

function arkToImageUrl(ark: string): { url: string; fallbackUrl?: string } {
  if (ARK_PATTERN.test(ark) || DGS_URL_PATTERN.test(ark)) {
    return { url: ark };
  }
  const canonical = toArk(ark);
  if (DOCUMENT_IMAGE_ARK_PATTERN.test(canonical)) {
    const base = arkToUrl(canonical);
    const query = extractImageContextQuery(ark);
    // Only offer a fallback when we actually appended context params — if
    // there's nothing to strip, primary and fallback would be identical.
    return query ? { url: base + query, fallbackUrl: base } : { url: base };
  }
  throw new Error(
    "Unrecognized ark. Expected a FamilySearch document-image ARK " +
      "(ark:/61903/3:1:... or 3:2:..., a bare 3:1:.../3:2:... id, or a " +
      "resolver URL for one), a DeepZoomCloud ARK URL (ending in /$dist), " +
      "or a DGS distribution URL (dgs:.../dist.jpg)."
  );
}

/**
 * Resolve an imageId/ark input to a distribution-image URL plus a human
 * label. Requires exactly one of imageId / ark. `caller` names the tool for
 * the both-missing error so each tool's message reads naturally.
 *
 * `fallbackUrl`, when present, is the same ARK resolved WITHOUT the
 * i=/cc=/groupId= context params — see fetchFsImageBytes, which retries
 * against it when the context-forwarded URL doesn't return an image (the
 * params are a best-effort disambiguation hint for multi-image ARKs, not
 * something every ARK accepts).
 */
export function resolveFsImageInput(
  input: FsImageInput,
  caller: string
): { url: string; label: string; fallbackUrl?: string } {
  if (input.imageId !== undefined && input.ark !== undefined) {
    throw new Error("Provide either imageId or ark, not both.");
  }
  if (input.imageId !== undefined) {
    return { url: imageIdToUrl(input.imageId), label: input.imageId };
  }
  if (input.ark !== undefined) {
    const { url, fallbackUrl } = arkToImageUrl(input.ark);
    return { url, label: input.ark, fallbackUrl };
  }
  throw new Error(`${caller} requires either imageId or ark.`);
}

export interface FetchedFsImage {
  bytes: Uint8Array;
  /** Normalized MIME type, e.g. "image/jpeg" (charset stripped). */
  contentType: string;
  sizeBytes: number;
  /** Whichever of url/fallbackUrl actually returned the image — so callers
   *  that report the URL back (e.g. image_read's metadata.url) don't cite
   *  a URL that actually failed when the fallback is what worked. */
  resolvedUrl: string;
}

interface FetchAttempt {
  ok: boolean;
  status: number;
  statusText: string;
  contentType?: string;
  bytes?: Uint8Array;
  /** Set only when the response was 2xx but not an image — distinguished from
   *  a plain HTTP failure so the final error message stays specific about
   *  which one happened, per the last attempt made. */
  nonImageContentType?: string;
}

async function attemptFsImageFetch(
  url: string,
  token: string
): Promise<FetchAttempt> {
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "image/*,*/*",
        "User-Agent": BROWSER_USER_AGENT,
      },
    },
    IMAGE_FETCH_TIMEOUT_MS
  );
  if (!response.ok) {
    return { ok: false, status: response.status, statusText: response.statusText };
  }
  const rawContentType = response.headers.get("content-type") ?? "image/jpeg";
  if (!rawContentType.startsWith("image/")) {
    return {
      ok: false,
      status: response.status,
      statusText: response.statusText,
      nonImageContentType: rawContentType,
    };
  }
  // A mid-stream abort is translated by fetchWithTimeout itself — it wraps the
  // body readers, not just the fetch — so this needs no local handling.
  const buffer = await response.arrayBuffer();
  return {
    ok: true,
    status: response.status,
    statusText: response.statusText,
    contentType: rawContentType.split(";")[0].trim(),
    bytes: new Uint8Array(buffer),
  };
}

/**
 * Fetch the raw bytes of a FamilySearch distribution image, authenticated.
 * Reuses getValidToken() + BROWSER_USER_AGENT. Throws on non-2xx or a
 * non-image content-type. Imposes no size cap — callers decide what to do
 * with the bytes (image_read refuses oversize inline; image_transcribe
 * streams them to OCR host-side, where no transport cap applies).
 *
 * `fallbackUrl`, when given, is retried if the primary URL doesn't return an
 * image — this is what makes the i=/cc=/groupId= forwarding in
 * resolveFsImageInput safe: those params disambiguate a multi-image ARK, but
 * an out-of-range `i=` on a single-image ARK makes FamilySearch return an
 * HTML page instead of erroring, so the caller can't tell in advance whether
 * forwarding them will help or hurt. Retrying the bare resolver URL recovers
 * the pre-forwarding behavior instead of failing a document that worked fine
 * before.
 */
export async function fetchFsImageBytes(
  url: string,
  fallbackUrl?: string
): Promise<FetchedFsImage> {
  const token = await getValidToken();

  let attempt = await attemptFsImageFetch(url, token);
  let resolvedUrl = url;
  if (!attempt.ok && fallbackUrl) {
    attempt = await attemptFsImageFetch(fallbackUrl, token);
    resolvedUrl = fallbackUrl;
  }

  if (!attempt.ok || !attempt.bytes || attempt.contentType === undefined) {
    if (attempt.nonImageContentType !== undefined) {
      throw new Error(
        `Expected an image response but got content-type: ${attempt.nonImageContentType}`
      );
    }
    throw new Error(
      `FamilySearch image fetch failed: ${attempt.status} ${attempt.statusText}`
    );
  }

  return {
    bytes: attempt.bytes,
    contentType: attempt.contentType,
    resolvedUrl,
    sizeBytes: attempt.bytes.byteLength,
  };
}
