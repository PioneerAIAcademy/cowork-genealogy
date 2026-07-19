// Shared resolve + authenticated fetch for FamilySearch distribution
// page-scans. Lifted from image-read.ts so both `image_read` (which returns
// the bytes as inline base64) and `image_transcribe` (which OCRs them
// host-side and returns text) build on one resolver + fetcher instead of
// duplicating the token/UA/content-type plumbing.

import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { toArk, arkToUrl } from "./ark.js";

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

function arkToImageUrl(ark: string): string {
  if (ARK_PATTERN.test(ark) || DGS_URL_PATTERN.test(ark)) {
    return ark;
  }
  const canonical = toArk(ark);
  if (DOCUMENT_IMAGE_ARK_PATTERN.test(canonical)) {
    return arkToUrl(canonical);
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
 */
export function resolveFsImageInput(
  input: FsImageInput,
  caller: string
): { url: string; label: string } {
  if (input.imageId !== undefined && input.ark !== undefined) {
    throw new Error("Provide either imageId or ark, not both.");
  }
  if (input.imageId !== undefined) {
    return { url: imageIdToUrl(input.imageId), label: input.imageId };
  }
  if (input.ark !== undefined) {
    return { url: arkToImageUrl(input.ark), label: input.ark };
  }
  throw new Error(`${caller} requires either imageId or ark.`);
}

export interface FetchedFsImage {
  bytes: Uint8Array;
  /** Normalized MIME type, e.g. "image/jpeg" (charset stripped). */
  contentType: string;
  sizeBytes: number;
}

/**
 * Fetch the raw bytes of a FamilySearch distribution image, authenticated.
 * Reuses getValidToken() + BROWSER_USER_AGENT. Throws on non-2xx or a
 * non-image content-type. Imposes no size cap — callers decide what to do
 * with the bytes (image_read refuses oversize inline; image_transcribe
 * streams them to OCR host-side, where no transport cap applies).
 */
export async function fetchFsImageBytes(url: string): Promise<FetchedFsImage> {
  const token = await getValidToken();

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "image/*,*/*",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(
      `FamilySearch image fetch failed: ${response.status} ${response.statusText}`
    );
  }

  const rawContentType = response.headers.get("content-type") ?? "image/jpeg";
  if (!rawContentType.startsWith("image/")) {
    throw new Error(
      `Expected an image response but got content-type: ${rawContentType}`
    );
  }

  const buffer = await response.arrayBuffer();
  return {
    bytes: new Uint8Array(buffer),
    contentType: rawContentType.split(";")[0].trim(),
    sizeBytes: buffer.byteLength,
  };
}
