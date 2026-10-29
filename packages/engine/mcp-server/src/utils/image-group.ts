// FamilySearch's image-group service, shared by image_search and
// image_transcribe: a group number resolved to its group id, a group's
// metadata (its name and coverage places), and the coverage place of the group
// an image belongs to.

import type { Principal } from "../auth/principal.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { fsFetch } from "./fs-fetch.js";
import { describeFetchError } from "./http.js";
import {
  arkToUrl,
  dgsImageId,
  findDocumentImageArk,
  toArk,
  IMAGE_ID_PATTERN,
  UNPREFIXED_IMAGE_ID_RE,
} from "./ark.js";
import { placeSegments } from "./place-resolver.js";

export const GROUP_SERVICE_BASE =
  "https://sg30p0.familysearch.org/service/records/rms/group-service";

const FS_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent": BROWSER_USER_AGENT,
  "FS-User-Agent-Chain": "chesworth",
};

/** Per-request fetch limits: the timeout of each attempt and the retry budget. */
export interface Timing {
  timeoutMs?: number;
  budgetMs?: number;
}

/** The limits a caller's `timeoutMs` has always meant here: both capped at it. */
export function timingFor(timeoutMs: number | undefined): Timing {
  return timeoutMs === undefined ? {} : { timeoutMs, budgetMs: timeoutMs };
}

export async function fsGet(url: string, principal: Principal, timing: Timing): Promise<Response> {
  try {
    return await fsFetch(
      principal,
      url,
      { headers: FS_HEADERS },
      timing.timeoutMs,
      // Cap the RETRY budget too, not just the per-request timeout. `fsFetch`
      // delegates to `fetchWithRetry`, whose default budget is 10s across 3
      // attempts, so a lowered `timeoutMs` bounded each request while the call
      // still ran to 10s. Measured 2026-09-30 with a hanging `fetch`:
      // timeoutMs=6000 alone took 10,001ms over 2 requests; with the budget
      // capped it takes 6,001ms over 1. `volume_bisect` sizes its three-leg
      // budget on this leg costing `timeoutMs` (volume-bisect-tool-spec §8).
      // Undefined leaves the default callers on the default budget.
      timing.budgetMs === undefined ? undefined : { budgetMs: timing.budgetMs },
    );
  } catch (error) {
    throw new Error(
      `Could not reach FamilySearch image search API: ${describeFetchError(error)}.`
    );
  }
}

/** A film number's group id, or null with the status when the service refuses
 *  it. */
async function lookUpApid(
  imageGroupNumber: string,
  principal: Principal,
  timing: Timing,
): Promise<{ status: number; apid: string | null }> {
  const response = await fsGet(
    `${GROUP_SERVICE_BASE}/group/${encodeURIComponent(imageGroupNumber)}/apid`,
    principal,
    timing,
  );
  if (!response.ok) return { status: response.status, apid: null };
  return { status: response.status, apid: (await response.text()).trim() };
}

export async function fetchApid(
  imageGroupNumber: string,
  principal: Principal,
  timing: Timing,
): Promise<string> {
  const { apid } = await lookUpApid(imageGroupNumber, principal, timing);
  if (apid === null) {
    throw new Error(
      `Could not resolve image group number ${imageGroupNumber} to an image group.`
    );
  }
  return apid;
}

/** A split Natural Group name ("007621224_005_M99P-2TQ") carries its group id
 *  as its last segment; a bare film number is looked up. */
export async function resolveGroupId(
  imageGroupNumber: string,
  principal: Principal,
  timing: Timing,
): Promise<string> {
  if (imageGroupNumber.includes("_")) {
    const parts = imageGroupNumber.split("_");
    return parts[parts.length - 1];
  }
  return fetchApid(imageGroupNumber, principal, timing);
}

export interface GroupMetadata {
  groupName?: unknown;
  coverages?: { place?: unknown }[];
}

/** A group's metadata, or null with the status when the service refuses it:
 *  a restricted group answers 403 while still serving its image list. */
export async function fetchGroupMetadata(
  groupId: string,
  principal: Principal,
  timing: Timing,
): Promise<{ status: number; meta: GroupMetadata | null }> {
  const response = await fsGet(
    `${GROUP_SERVICE_BASE}/group/${encodeURIComponent(groupId)}`,
    principal,
    timing,
  );
  if (!response.ok) return { status: response.status, meta: null };
  return { status: response.status, meta: (await response.json()) as GroupMetadata };
}

// ─── The coverage place of an image's group (image_transcribe) ─────────────

/** Each request of the lookup; it runs beside the page fetch and the OCR. */
const LOOKUP_TIMING: Timing = { timeoutMs: 10_000, budgetMs: 10_000 };

/** A lookup's answer, and whether it is cached rather than asked again next
 *  time. */
interface Outcome {
  value: string | null;
  settled: boolean;
}

/** The refusals cached as no place: a restricted group (403) and an unknown id
 *  (404). Any other status, a 401 for a rejected token among them, is asked
 *  again. */
function settledStatus(status: number): boolean {
  return status === 403 || status === 404;
}

/** Film number → coverage place, and image ARK → film number. */
const groupPlaces = new Map<string, string | null>();
const arkFilms = new Map<string, string | null>();

export function __clearImageGroupCacheForTests(): void {
  groupPlaces.clear();
  arkFilms.clear();
}

async function cached(
  cache: Map<string, string | null>,
  key: string,
  look: () => Promise<Outcome>,
): Promise<string | null> {
  if (cache.has(key)) return cache.get(key)!;
  const { value, settled } = await look();
  if (settled) cache.set(key, value);
  return value;
}

/** The film an image name carries: "004884748_02613" is film 004884748. */
function filmOf(name: unknown): string | null {
  return typeof name === "string" && IMAGE_ID_PATTERN.test(name) ? name.split("_")[0] : null;
}

/**
 * The place every coverage of the group lies in: the trailing segments all of
 * their places share. A film of one parish gives the parish; one of several
 * towns in a province gives the province. Null when the group names no coverage
 * place, or its places share no segment (they lie in different countries).
 */
export function sharedCoveragePlace(meta: GroupMetadata): string | null {
  const places = (Array.isArray(meta.coverages) ? meta.coverages : [])
    .map((c) => (typeof c?.place === "string" ? placeSegments(c.place) : []))
    .filter((segs) => segs.length > 0);
  if (places.length === 0) return null;
  let shared = places[0];
  for (const segs of places.slice(1)) {
    let n = 0;
    while (n < shared.length && n < segs.length && shared[shared.length - 1 - n] === segs[segs.length - 1 - n]) n++;
    shared = shared.slice(shared.length - n);
  }
  return shared.length > 0 ? shared.join(", ") : null;
}

/** An image ARK's film: the ARK's resolver answers JSON naming the image
 *  ("007156564_00250") when asked for it. */
async function lookUpArkFilm(ark: string, principal: Principal): Promise<Outcome> {
  const response = await fsGet(arkToUrl(ark), principal, LOOKUP_TIMING);
  if (!response.ok) return { value: null, settled: settledStatus(response.status) };
  let body: { name?: unknown };
  try {
    body = (await response.json()) as { name?: unknown };
  } catch {
    return { value: null, settled: false };
  }
  return { value: filmOf(body?.name), settled: true };
}

async function lookUpGroupPlace(film: string, principal: Principal): Promise<Outcome> {
  const { status: apidStatus, apid } = await lookUpApid(film, principal, LOOKUP_TIMING);
  if (apid === null) return { value: null, settled: settledStatus(apidStatus) };
  const { status, meta } = await fetchGroupMetadata(apid, principal, LOOKUP_TIMING);
  if (!meta) return { value: null, settled: settledStatus(status) };
  return { value: sharedCoveragePlace(meta), settled: true };
}

/**
 * The coverage place of the FamilySearch image group (the film) an image
 * belongs to, the metadata image_search's `item` reads: an imageId names its
 * film, and an image ARK is asked once for its image's name. Cached per film,
 * and per ARK, for the life of the process: an answer, and a 403 or 404 at any
 * step, which gives no place. Anything else is asked again. Null on any
 * failure: it never throws.
 */
export async function imageGroupPlace(
  image: { imageId?: string; ark?: string },
  principal: Principal,
): Promise<string | null> {
  try {
    let film: string | null = null;
    if (image.imageId !== undefined) {
      film = filmOf(image.imageId);
    } else if (image.ark !== undefined) {
      const given = image.ark.trim();
      const dgs = dgsImageId(given);
      const ark = UNPREFIXED_IMAGE_ID_RE.test(given)
        ? `ark:/61903/3:1:${given}`
        : findDocumentImageArk(toArk(given));
      film = dgs !== undefined
        ? filmOf(dgs)
        : ark !== undefined
          ? await cached(arkFilms, ark, () => lookUpArkFilm(ark, principal))
          : null;
    }
    if (film === null) return null;
    const groupFilm = film;
    return await cached(groupPlaces, groupFilm, () => lookUpGroupPlace(groupFilm, principal));
  } catch {
    return null;
  }
}
