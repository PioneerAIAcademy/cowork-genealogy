import type { Principal } from "../auth/principal.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { coerceJsonArg } from "../utils/coerce-json-arg.js";
import { fsFetch } from "../utils/fs-fetch.js";
import { describeFetchError } from "../utils/http.js";
import { mapWithConcurrency } from "../utils/place-resolver.js";
import type {
  ImageSearchInput,
  ImageSearchResult,
  ChildrenNamesResponse,
} from "../types/image-search.js";

const GROUP_SERVICE_BASE =
  "https://sg30p0.familysearch.org/service/records/rms/group-service";
const ARTIFACT_BASE =
  "https://sg30p0.familysearch.org/service/records/rms";

const FS_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent": BROWSER_USER_AGENT,
  "FS-User-Agent-Chain": "chesworth",
};

/** Per-request fetch limits: the timeout of each attempt and the retry budget. */
interface Timing {
  timeoutMs?: number;
  budgetMs?: number;
}

/** The limits a caller's `timeoutMs` has always meant here: both capped at it. */
function timingFor(timeoutMs: number | undefined): Timing {
  return timeoutMs === undefined ? {} : { timeoutMs, budgetMs: timeoutMs };
}

async function fsGet(url: string, principal: Principal, timing: Timing): Promise<Response> {
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

async function fetchApid(
  imageGroupNumber: string,
  principal: Principal,
  timing: Timing,
): Promise<string> {
  const response = await fsGet(
    `${GROUP_SERVICE_BASE}/group/${encodeURIComponent(imageGroupNumber)}/apid`,
    principal,
    timing,
  );
  if (!response.ok) {
    throw new Error(
      `Could not resolve image group number ${imageGroupNumber} to an image group.`
    );
  }
  return (await response.text()).trim();
}

/** The item a bare film resolved to: its position, images and label. */
interface ResolvedItem {
  groupId: string;
  imageIds: string[];
  /** Entries the item's list lost to a defective response, after the retry. */
  dropped: number;
  imageGroupNumber: string;
  imageGroupNumberFrom: "name" | "position";
  place: string | null;
}

async function resolveGroupId(
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

async function fetchChildren(
  groupId: string,
  principal: Principal,
  timing: Timing,
): Promise<ChildrenNamesResponse> {
  const response = await fsGet(
    `${ARTIFACT_BASE}/artifact/group/${encodeURIComponent(groupId)}/children/names`,
    principal,
    timing,
  );

  if (response.status === 401) {
    throw new Error(
      "FamilySearch session not accepted; call the login tool to re-authenticate."
    );
  }
  if (response.status === 403) {
    throw new Error("FamilySearch image search API error: 403 Forbidden.");
  }
  if (!response.ok) {
    throw new Error(
      `FamilySearch image search API error: ${response.status} ${response.statusText}.`
    );
  }

  return (await response.json()) as ChildrenNamesResponse;
}

/**
 * Keep only the values that are actually image IDs.
 *
 * `ChildrenNamesResponse` is asserted from `response.json()`, not checked, and
 * the endpoint does not always honour it: observed live 2026-08-25 on group
 * `M9SW-1CG` returning its full 164 keys with `null` as the value of one of
 * them (image `004514823_00672`). Unfiltered, that null reached the caller as
 * an image ID *and* took the real image off the list, so the page could not be
 * browsed at all. `dropped` is what tells the caller the response was defective
 * — it is the retry trigger below, since a defective value is not recoverable
 * from the response itself.
 */
function usableImageIds(data: ChildrenNamesResponse): {
  imageIds: string[];
  dropped: number;
} {
  const values = Object.values(data as Record<string, unknown>);
  const imageIds = values.filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  return { imageIds, dropped: values.length - imageIds.length };
}

/**
 * One group's image list, with one re-request when the response was
 * defective. The same group returned a complete set on every other call, so a
 * retry is what recovers the lost image rather than silently serving a list
 * one page short. Bounded to a single extra call, and it can only ever improve
 * the result: a retry that is defective too, or that fails outright with a
 * 500/401/timeout, leaves the first list standing rather than failing a browse
 * the caller can still mostly use. Usable IDs are the primary comparison and
 * `dropped` only breaks a tie, so a clean-but-shorter retry can never displace
 * a longer one.
 */
async function fetchImageIds(
  groupId: string,
  principal: Principal,
  timing: () => Timing,
): Promise<{ imageIds: string[]; dropped: number }> {
  let best = usableImageIds(await fetchChildren(groupId, principal, timing()));
  if (best.dropped > 0) {
    try {
      const retry = usableImageIds(await fetchChildren(groupId, principal, timing()));
      if (
        retry.imageIds.length > best.imageIds.length ||
        (retry.imageIds.length === best.imageIds.length &&
          retry.dropped < best.dropped)
      ) {
        best = retry;
      }
    } catch {
      // Keep `best` — a failed retry must not lose a usable browse list.
    }
  }
  return { imageIds: best.imageIds.sort(), dropped: best.dropped };
}

// ─── Within-item addressing (spec § Within-item addressing) ─────────────────

const ADDRESS_KEYS = new Set(["imageGroupNumber", "item", "itemImage"]);
/** Cowork's call ceiling is ~60s (volume-bisect-tool-spec.md §8). */
const ITEM_DEADLINE_MS = 45_000;
const ITEM_LIST_CONCURRENCY = 6;
const PER_REQUEST_TIMEOUT_MS = 30_000;
/** A request started with less than this left would only report a timeout. */
const MIN_REQUEST_MS = 1_000;

/**
 * Nothing validates input against the schema (server.ts passes arguments
 * straight through), so a misspelled address would otherwise be ignored and
 * the whole film served. A key that is not ours throws when its name looks like
 * an address or its value is a number; across 118 recorded calls the only
 * other key ever sent was `lookingFor`, a string, which still passes.
 */
function rejectUnknownAddressKeys(input: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(input)) {
    if (ADDRESS_KEYS.has(key)) continue;
    const numeric =
      typeof value === "number" || (typeof value === "string" && /^\s*\d+\s*$/.test(value));
    if (/item|image/i.test(key) || numeric) {
      throw new Error(
        `image_search has no parameter \`${key}\`; to address one item use \`item\` / \`itemImage\`.`,
      );
    }
  }
}

function readPositiveInteger(name: string, raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = coerceJsonArg(raw);
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(
      `image_search: \`${name}\` must be an integer of 1 or more; got ${JSON.stringify(raw)}.`,
    );
  }
  return value;
}

/**
 * One deadline shared by every request on the item path. A request is not
 * started with under MIN_REQUEST_MS left, and a failure that lands after the
 * deadline is reported as the deadline, not as the request that ran out.
 */
interface Clock {
  timing: () => Timing;
  expired: () => boolean;
}

function deadline(ms: number): Clock {
  const end = Date.now() + ms;
  return {
    timing: () => {
      const remaining = end - Date.now();
      if (remaining < MIN_REQUEST_MS) throw new ItemDeadlineError();
      return { timeoutMs: Math.min(PER_REQUEST_TIMEOUT_MS, remaining), budgetMs: remaining };
    },
    expired: () => end - Date.now() < MIN_REQUEST_MS,
  };
}

class ItemDeadlineError extends Error {
  constructor() {
    super(
      `image_search gave up resolving the item after ${ITEM_DEADLINE_MS / 1000}s; try again.`,
    );
  }
}

type ChildList =
  | { ok: true; imageIds: string[]; dropped: number }
  | { ok: false; deadline: boolean; error: string };

/**
 * The `item`-th image-bearing child of a bare film. Image lists are fetched a
 * batch at a time and read in film order, so the walk stops at the target. A
 * child at or before the target whose list was refused, failed, or came back
 * all-null makes every later position unknown, so it throws rather than being
 * counted out; a child after the target is never read.
 */
async function resolveItem(
  imageGroupNumber: string,
  item: number,
  principal: Principal,
  clock: Clock,
): Promise<ResolvedItem> {
  const timing = clock.timing;
  const apid = await fetchApid(imageGroupNumber, principal, timing());
  const response = await fsGet(
    `${GROUP_SERVICE_BASE}/group/${encodeURIComponent(apid)}/children`,
    principal,
    timing(),
  );
  if (!response.ok) {
    throw new Error(
      `Could not list the items of film ${imageGroupNumber}: ${response.status} ${response.statusText}.`,
    );
  }
  const children = (await response.json()) as unknown;
  const childIds = Array.isArray(children)
    ? children.filter((c): c is string => typeof c === "string" && c.length > 0)
    : [];

  const readList = async (groupId: string): Promise<ChildList> => {
    try {
      return { ok: true, ...(await fetchImageIds(groupId, principal, timing)) };
    } catch (error) {
      return {
        ok: false,
        deadline: error instanceof ItemDeadlineError || clock.expired(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  let position = 0;
  for (let start = 0; start < childIds.length; start += ITEM_LIST_CONCURRENCY) {
    const batch = childIds.slice(start, start + ITEM_LIST_CONCURRENCY);
    const lists = await mapWithConcurrency(batch, ITEM_LIST_CONCURRENCY, readList);
    for (const [i, list] of lists.entries()) {
      const childId = batch[i];
      if (!list.ok) {
        if (list.deadline) {
          throw new Error(
            `image_search gave up on film ${imageGroupNumber} after ${ITEM_DEADLINE_MS / 1000}s, ` +
              `having read ${start + i} of its ${childIds.length} groups; try again.`,
          );
        }
        throw new Error(
          `Could not count the items of film ${imageGroupNumber}: group ${childId} ` +
            `(${start + i + 1} of ${childIds.length}) could not be read (${list.error}), so the ` +
            `position of every later item is unknown.`,
        );
      }
      if (list.imageIds.length === 0 && list.dropped > 0) {
        throw new Error(
          `Could not count the items of film ${imageGroupNumber}: group ${childId} ` +
            `(${start + i + 1} of ${childIds.length}) returned a defective image list, so the ` +
            `position of every later item is unknown.`,
        );
      }
      if (list.imageIds.length === 0) continue;
      position += 1;
      if (position === item) {
        return {
          groupId: childId,
          imageIds: list.imageIds,
          dropped: list.dropped,
          ...(await itemLabel(imageGroupNumber, childId, position, principal, timing)),
        };
      }
    }
  }

  if (position === 0) {
    throw new Error(
      `film ${imageGroupNumber} is not split into items; call image_search without item.`,
    );
  }
  throw new Error(
    `film ${imageGroupNumber} has ${position} items with images; item must be 1–${position}.`,
  );
}

/**
 * The item's own name and place when its metadata is readable. Restricted
 * groups answer 403 here while still serving their image list, so the name is
 * then composed from the position: the id comes from the live children list,
 * and `resolveGroupId` reads only the last segment, so it round-trips. A
 * failed lookup never fails the call.
 */
async function itemLabel(
  imageGroupNumber: string,
  groupId: string,
  position: number,
  principal: Principal,
  timing: () => Timing,
): Promise<Pick<ResolvedItem, "imageGroupNumber" | "imageGroupNumberFrom" | "place">> {
  const composed = {
    imageGroupNumber: `${imageGroupNumber}_${String(position).padStart(3, "0")}_${groupId}`,
    imageGroupNumberFrom: "position" as const,
    place: null,
  };
  try {
    const response = await fsGet(
      `${GROUP_SERVICE_BASE}/group/${encodeURIComponent(groupId)}`,
      principal,
      timing(),
    );
    if (!response.ok) return composed;
    const meta = (await response.json()) as {
      groupName?: unknown;
      coverages?: { place?: unknown }[];
    };
    const place = typeof meta.coverages?.[0]?.place === "string" ? meta.coverages[0].place : null;
    const name = meta.groupName;
    if (typeof name === "string" && name.startsWith(`${imageGroupNumber}_`)) {
      return { imageGroupNumber: name, imageGroupNumberFrom: "name", place };
    }
    return { ...composed, place };
  } catch {
    return composed;
  }
}

export async function imageSearchTool(
  input: ImageSearchInput,
  principal: Principal,
  /** Lower the per-attempt fetch budget. The 30s default, doubled by the
   *  defect-retry path, would spend Cowork's whole 60s call ceiling on the
   *  resolve alone (volume-bisect-tool-spec.md §8). */
  opts: { timeoutMs?: number } = {}
): Promise<ImageSearchResult> {
  if (!input.imageGroupNumber) {
    throw new Error("image_search requires an imageGroupNumber.");
  }
  rejectUnknownAddressKeys(input as unknown as Record<string, unknown>);
  const item = readPositiveInteger("item", input.item);
  const itemImage = readPositiveInteger("itemImage", input.itemImage);
  if (itemImage !== undefined && item === undefined) {
    throw new Error("image_search: `itemImage` needs `item` — the image is counted within that item.");
  }

  if (item === undefined) {
    const timing = timingFor(opts.timeoutMs);
    const groupId = await resolveGroupId(input.imageGroupNumber, principal, timing);
    const { imageIds } = await fetchImageIds(groupId, principal, () => timing);
    return { imageIds };
  }

  if (input.imageGroupNumber.includes("_")) {
    throw new Error(
      `image_search: \`item\` needs a bare film number; ${input.imageGroupNumber} is already one item — ` +
        "list it without item.",
    );
  }
  const resolved = await resolveItem(input.imageGroupNumber, item, principal, deadline(ITEM_DEADLINE_MS));
  if (itemImage !== undefined && resolved.dropped > 0) {
    // A list missing an image shifts every image after the gap, so a count
    // within the item cannot be trusted; the browse without itemImage can.
    throw new Error(
      `item ${item} of film ${input.imageGroupNumber} came back with ${resolved.dropped} unreadable ` +
        "image entr" + (resolved.dropped === 1 ? "y" : "ies") + ", so image counts within it are unknown; try again.",
    );
  }
  const result: ImageSearchResult = {
    imageIds: resolved.imageIds,
    imageGroupNumber: resolved.imageGroupNumber,
    imageGroupNumberFrom: resolved.imageGroupNumberFrom,
    place: resolved.place,
  };
  if (itemImage !== undefined) {
    if (itemImage > resolved.imageIds.length) {
      throw new Error(
        `item ${item} has ${resolved.imageIds.length} images; itemImage must be 1–${resolved.imageIds.length}.`,
      );
    }
    result.imageId = resolved.imageIds[itemImage - 1];
  }
  return result;
}

export const imageSearchSchema = {
  name: "image_search",
  description:
    "List the images in a single FamilySearch image group (a digitized " +
    "volume — one microfilm roll or book scan). Provide an imageGroupNumber " +
    "(from volume_search) and get back the sorted list of image IDs in that " +
    "volume, each of the form '004884748_02613'. To view an image, pass its ID " +
    "to image_read. Use volume_search " +
    "first to find which image groups cover a place and year range. " +
    "For a citation like 'DGS 004528134, Item 5, Image 10', pass the bare " +
    "film number with item and itemImage: you get that image's imageId " +
    "(and the item's images, imageGroupNumber and place) without paging " +
    "through the film. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      imageGroupNumber: {
        type: "string",
        description:
          "The image group number to list, from volume_search — either a " +
          "split Natural Group name like '007621224_005_M99P-2TQ' or a bare " +
          "number like '007621224'.",
      },
      item: {
        type: "integer",
        minimum: 1,
        description:
          "Bare film only: the film's Nth item, counted as FamilySearch's image " +
          "groups in film order (1 = the first). This is not always the " +
          "Catalog's item number; check the returned place against the citation.",
      },
      itemImage: {
        type: "integer",
        minimum: 1,
        description:
          "With item: the image counted within that item (1 = the item's first " +
          "image). Returned as imageId, ready for image_read or image_transcribe.",
      },
    },
    required: ["imageGroupNumber"],
  },
};
