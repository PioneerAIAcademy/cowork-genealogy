import { SolutionError } from "./errors.js";
import { request, type Fetch } from "./http.js";

/**
 * FamilySearch's public endpoints sit behind Imperva, which answers 403 to
 * non-browser user agents. Calls from inside FamilySearch's own network may not
 * need it; it does no harm there.
 */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

/** What every FamilySearch call needs: the signed-in user's token. */
export interface FsDeps {
  fsToken: string;
  /** Defaults to the global fetch. Tests pass a fake. */
  fetch?: Fetch;
}

/** One page scan: either form identifies it. */
export interface ImageRef {
  /** A document-image ARK (`ark:/61903/3:1:...` or `3:2:...`), or a familysearch.org URL containing one. */
  ark?: string;
  /** An Image Group Number with its image index, e.g. `004884748_02613`. */
  imageId?: string;
}

export interface FsImage {
  bytes: Uint8Array;
  contentType: string;
  /** The URL that actually returned the image. */
  url: string;
}

const IMAGE_ID_RE = /^\d+_\d+$/;
const IMAGE_ARK_RE = /(?:ark:\/61903\/)?(3:[12]:[A-Z0-9-]+)/i;
const RECORD_ARK_RE = /(?:ark:\/61903\/)?[12]:[12]:[A-Z0-9-]+/i;

// A multi-image film ARK can resolve to the wrong page without these. Some
// single-image ARKs return an HTML page when given them, so the bare ARK is
// tried second.
const IMAGE_CONTEXT_PARAMS = ["i", "cc", "groupId"];

// A full page scan is several MB; the download measures p50 1.9s, max 8s.
const IMAGE_TIMEOUT_MS = 90_000;

// With this Accept, www.familysearch.org redirects an image ARK straight to a
// pre-signed S3 URL. With `image/*` alone it redirects to ark.familysearch.org
// instead, and fetch drops the token on that cross-host hop, so it answers 401.
export const IMAGE_ACCEPT = "image/*,*/*";

/** The URLs to try, in order, for an image reference. */
export function imageUrls(ref: ImageRef): string[] {
  if ((ref.ark ? 1 : 0) + (ref.imageId ? 1 : 0) !== 1) {
    throw new SolutionError("bad_input", "Give exactly one of ark or imageId.");
  }
  if (ref.imageId) {
    if (!IMAGE_ID_RE.test(ref.imageId.trim())) {
      throw new SolutionError("bad_input", `imageId '${ref.imageId}' is not of the form 004884748_02613.`);
    }
    return [`https://familysearch.org/das/v2/dgs:${ref.imageId.trim()}/dist.jpg`];
  }
  const ark = ref.ark!.trim();
  const match = IMAGE_ARK_RE.exec(ark);
  if (!match) {
    const isRecord = RECORD_ARK_RE.test(ark);
    throw new SolutionError(
      "bad_input",
      isRecord
        ? `'${ark}' is a record or person ARK, not an image. Use the record's image ARK (3:1: or 3:2:).`
        : `'${ark}' is not a FamilySearch document-image ARK (ark:/61903/3:1:... or 3:2:...).`,
    );
  }
  const bare = `https://www.familysearch.org/ark:/61903/${match[1].toUpperCase()}`;
  let params = new URLSearchParams();
  try {
    const given = new URL(ark).searchParams;
    params = new URLSearchParams(
      IMAGE_CONTEXT_PARAMS.flatMap((k) => (given.has(k) ? [[k, given.get(k)!]] : [])),
    );
  } catch {
    // not a URL: a bare ARK carries no context
  }
  return params.size > 0 ? [`${bare}?${params}`, bare] : [bare];
}

/** Download a page scan as the signed-in user. */
export async function fetchFsImage(ref: ImageRef, deps: FsDeps): Promise<FsImage> {
  const fetchImpl = deps.fetch ?? fetch;
  let failure = "";
  let status = 0;
  for (const url of imageUrls(ref)) {
    const res = await request(
      fetchImpl,
      url,
      {
        headers: {
          Authorization: `Bearer ${deps.fsToken}`,
          Accept: IMAGE_ACCEPT,
          "User-Agent": BROWSER_USER_AGENT,
        },
      },
      { timeoutMs: IMAGE_TIMEOUT_MS },
    );
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (res.ok && contentType.startsWith("image/")) {
      return { bytes: new Uint8Array(await res.arrayBuffer()), contentType, url };
    }
    await res.body?.cancel();
    status = res.status;
    failure = res.ok ? `returned ${contentType || "no content type"}, not an image` : `returned ${res.status}`;
  }
  if (status === 401) throw new SolutionError("unauthorized", "The FamilySearch token was rejected (401).");
  if (status === 403) throw new SolutionError("forbidden", "This image is restricted for this user (403).");
  if (status === 404 || status === 400) {
    throw new SolutionError("not_found", `No image at that identifier (FamilySearch ${failure}).`);
  }
  throw new SolutionError("upstream", `FamilySearch image fetch ${failure}.`);
}
