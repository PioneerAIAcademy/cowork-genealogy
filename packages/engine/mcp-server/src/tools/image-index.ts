// image_index: the records FamilySearch has indexed on ONE page image, with the
// persona arks and names on each. Contract: docs/specs/image-index-tool-spec.md.
//
// Two FamilySearch routes, both measured from the beta's host (issue #4632):
// the image's record list (`/platform/records/images/{id}/records`), which
// carries record links and no names, then one read per listed record through
// that list's own `links.record.href`. Not `record_read`: it refuses a `1:2:`
// record ark and reads a different service.

import type { Principal } from "../auth/principal.js";
import { rejectedTokenMessage } from "../auth/config.js";
import { BROWSER_USER_AGENT, TOOL_RESULT_CHAR_BUDGET } from "../constants.js";
import { IMAGE_ID_PATTERN, isDocumentImageArk, toArk } from "../utils/ark.js";
import { fsFetch } from "../utils/fs-fetch.js";
import { DEFAULT_FETCH_TIMEOUT_MS, describeFetchError } from "../utils/http.js";
import { mapWithConcurrency } from "../utils/place-resolver.js";
import { personaIndexFields } from "../utils/record-index-fields.js";
import type {
  ImageIndexEntry,
  ImageIndexInput,
  ImageIndexPersona,
  ImageIndexResult,
} from "../types/image-index.js";

/** Records read per call. The spec's rule, `min(30, 6 x floor(25 s / p95 read
 *  latency))`, gives 360 at the one measured read (0.41 s), so the spend
 *  ceiling binds: one call never asks FamilySearch more than 1 + 30 times. */
export const IMAGE_INDEX_CAP = 30;
/** Record reads in flight at once. */
export const IMAGE_INDEX_CONCURRENCY = 6;
/** The whole call's budget, anchored at entry, under the Cowork bridge's ~60 s
 *  abort (the same figure and shape as catalog_search's). */
export const IMAGE_INDEX_BUDGET_MS = 50_000;

const FS_ORIGIN = "https://www.familysearch.org";
const FS_HOST = "www.familysearch.org";
const RECORD_PATH_RE = /^\/platform\/records\/records\/([A-Za-z0-9-]+)$/;
const RECORD_TYPE = "http://gedcomx.org/Record";
const PERSISTENT = "http://gedcomx.org/Persistent";
const NOT_A_RECORD_LINK = "not a FamilySearch record link";
const UNREADABLE_RECORD = "unreadable record body";

// The three headers the issue measured both routes with.
const HEADERS = {
  Accept: "application/x-gedcomx-v1+json",
  "User-Agent": BROWSER_USER_AGENT,
};

// ─── MCP schema ────────────────────────────────────────────────────────────

export const imageIndexSchema = {
  name: "image_index",
  description:
    "List the records FamilySearch has indexed on ONE page image, with the persona " +
    "arks and names on each record. Pass the page's document-image ARK " +
    '(e.g. "ark:/61903/3:1:33SQ-GYY1-B2G", or the image viewer URL, whose cc= is ' +
    "used as collectionId). Each entry carries its `index` in FamilySearch's list, " +
    "the record's 1:2: `recordArk`, and `personas` (personaArk, name, principal, and " +
    "role, relationshipToHead and sortKey when indexed). The entries are UNORDERED " +
    "(`ordered` is false): neither `index` nor `sortKey` is verified as the line " +
    "order on the page, so never read either as a line number. One call reads a " +
    "capped number of records; when `nextOffset` is present, call again with " +
    "`offset` set to it. An entry with `hydrated: false` was not read and its " +
    "`error` says why; retry it with `offset` set to its `index`. " +
    "`hydrationTimedOut` means the call ran out of time before reading every " +
    "record in its window. Use record_read on a personaArk for the full record.",
  inputSchema: {
    type: "object",
    properties: {
      imageId: {
        type: "string",
        description:
          "The page's document-image ARK (3:1:), in any form: ark:/61903/3:1:..., " +
          "3:1:..., or a FamilySearch URL containing it.",
      },
      collectionId: {
        type: "string",
        description:
          "FamilySearch's collection id (digits), the viewer URL's cc= value. " +
          "Optional; pass it when an image's list is not found without it.",
      },
      offset: {
        type: "integer",
        minimum: 0,
        description: "Where to start in FamilySearch's record list for the image: a previous answer's nextOffset. Default 0.",
      },
    },
    required: ["imageId"],
  },
};

// ─── Input ─────────────────────────────────────────────────────────────────

interface ParsedImage {
  /** `ark:/61903/3:1:<id>`. */
  ark: string;
  /** `3:1:<id>`, the list route's path segment. */
  pathId: string;
  collectionId?: string;
}

const DIGITS = /^\d+$/;

function parseImage(input: ImageIndexInput): ParsedImage {
  const raw = (input as { imageId?: unknown }).imageId;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(
      "image_index needs imageId: the page's document-image ARK, e.g. " +
        '"ark:/61903/3:1:33SQ-GYY1-B2G" or the image viewer URL.',
    );
  }
  const text = raw.trim();
  if (IMAGE_ID_PATTERN.test(text)) {
    throw new Error(
      `imageId "${text}" is a DGS image number, not an ARK. image_index needs the ` +
        "page's 3:1: image ARK (the image viewer's URL holds it, as does record_read's " +
        "imageArk).",
    );
  }
  const ark = toArk(text);
  if (/^ark:\/61903\/1:[12]:/.test(ark)) {
    throw new Error(
      `imageId "${text}" is a 1:1: persona or 1:2: record ARK, not an image. ` +
        "Pass the page's 3:1: image ARK; record_read on the persona returns it as imageArk.",
    );
  }
  if (!isDocumentImageArk(ark)) {
    const film = /\/search\/film\//.test(text)
      ? " A film-viewer URL (/search/film/...) carries no image ARK; open the image and use its ark:/61903/3:1:... URL."
      : "";
    throw new Error(
      `imageId "${text}" is not a document-image ARK (ark:/61903/3:1:...).${film}`,
    );
  }

  const fromUrl = collectionFromUrl(text);
  const given = (input as { collectionId?: unknown }).collectionId;
  if (given !== undefined && (typeof given !== "string" || !DIGITS.test(given))) {
    throw new Error(
      `collectionId must be FamilySearch's collection id as a string of digits (e.g. "1803958"); got ${JSON.stringify(given)}.`,
    );
  }
  if (given !== undefined && fromUrl !== undefined && given !== fromUrl) {
    throw new Error(
      `collectionId "${given}" disagrees with the cc=${fromUrl} in imageId's URL. ` +
        "Pass one, or make them match.",
    );
  }
  const collectionId = (given as string | undefined) ?? fromUrl;
  return {
    ark,
    pathId: ark.slice("ark:/61903/".length),
    ...(collectionId !== undefined ? { collectionId } : {}),
  };
}

/** The `cc=` of a FamilySearch URL, when the input is one and carries it. */
function collectionFromUrl(text: string): string | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  const cc = url.searchParams.get("cc");
  if (cc === null) return undefined;
  if (!DIGITS.test(cc)) {
    throw new Error(
      `imageId's URL carries cc=${cc}, which is not a collection id. Drop it, or pass collectionId.`,
    );
  }
  return cc;
}

function parseOffset(input: ImageIndexInput): number {
  const offset = (input as { offset?: unknown }).offset;
  if (offset === undefined) return 0;
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) {
    throw new Error(
      `offset must be a whole number of 0 or more (a previous answer's nextOffset), or omitted; got ${JSON.stringify(offset)}.`,
    );
  }
  return offset;
}

// ─── The list ──────────────────────────────────────────────────────────────

interface ListedRecord {
  /** The validated record link, or undefined when it is not one. */
  link?: { url: string; id: string };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The record link, resolved against FamilySearch's origin and accepted only on
 * FamilySearch's own record path. The bearer goes wherever this points, so a
 * host taken from a response must never be anything but FamilySearch's.
 * Exported for `dev/try-image-index.ts`, which follows the same links.
 */
export function recordLink(href: unknown): { url: string; id: string } | undefined {
  if (typeof href !== "string" || href.trim() === "") return undefined;
  let url: URL;
  try {
    url = new URL(href, FS_ORIGIN);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== FS_HOST ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return undefined;
  }
  const m = RECORD_PATH_RE.exec(url.pathname);
  return m ? { url: url.toString(), id: m[1] } : undefined;
}

async function readList(
  principal: Principal,
  image: ParsedImage,
  deadline: number,
): Promise<ListedRecord[]> {
  const url =
    `${FS_ORIGIN}/platform/records/images/${image.pathId}/records` +
    (image.collectionId !== undefined ? `?cc=${image.collectionId}` : "");
  const timeout = Math.max(1, Math.min(DEFAULT_FETCH_TIMEOUT_MS, deadline - Date.now()));
  const res = await fsFetch(principal, url, { headers: HEADERS }, timeout);

  if (!res.ok) {
    await res.text().catch(() => "");
    if (res.status === 401) throw new Error(await rejectedTokenMessage(principal));
    if (res.status === 403) {
      throw new Error(
        `FamilySearch refused the record list for image ${image.ark} (403): its records ` +
          "are restricted. Tell the user they cannot be listed here.",
      );
    }
    if (res.status === 404) {
      throw new Error(
        `FamilySearch has no record list for image ${image.ark} (404): the page may not be ` +
          "indexed, or the id is wrong." +
          (image.collectionId === undefined
            ? " If the image viewer's URL carries cc=, pass that number as collectionId."
            : ""),
      );
    }
    if (res.status === 429) {
      throw new Error(
        "FamilySearch rate limit reached and did not clear within the retry budget. " +
          "Wait a minute and try again.",
      );
    }
    throw new Error(`FamilySearch record-list error for image ${image.ark}: ${res.status}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const descriptions = isObject(body) ? body.sourceDescriptions : undefined;
  if (!isObject(body) || (descriptions !== undefined && !Array.isArray(descriptions))) {
    throw new Error(
      `FamilySearch's record list for image ${image.ark} could not be read (not the GedcomX it sends). Try again later.`,
    );
  }
  return (Array.isArray(descriptions) ? descriptions : [])
    .filter((d): d is Record<string, unknown> => isObject(d) && d.resourceType === RECORD_TYPE)
    .map((d) => {
      const links = isObject(d.links) ? d.links : undefined;
      const record = links && isObject(links.record) ? links.record : undefined;
      return { link: recordLink(record?.href) };
    });
}

// ─── One record ────────────────────────────────────────────────────────────

function nonBlank(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

function personaName(p: Record<string, unknown>): string | undefined {
  const names = Array.isArray(p.names) ? p.names.filter(isObject) : [];
  const chosen = names.find((n) => n.preferred === true) ?? names[0];
  const forms = chosen && Array.isArray(chosen.nameForms) ? chosen.nameForms.filter(isObject) : [];
  for (const form of forms) {
    const text = nonBlank(form.fullText);
    if (text) return text;
  }
  return nonBlank(isObject(p.display) ? p.display.name : undefined);
}

function personaArk(p: Record<string, unknown>): string | undefined {
  const ids = isObject(p.identifiers) ? p.identifiers[PERSISTENT] : undefined;
  const first = Array.isArray(ids) ? nonBlank(ids[0]) : undefined;
  return first ? toArk(first) : undefined;
}

/** The personas on a record body, or undefined when it is not a record. */
function readPersonas(body: unknown): ImageIndexPersona[] | undefined {
  if (!isObject(body) || !Array.isArray(body.persons)) return undefined;
  return body.persons.filter(isObject).map((p) => {
    const ark = personaArk(p);
    const name = personaName(p);
    const role = nonBlank(isObject(p.display) ? p.display.role : undefined);
    const fields = personaIndexFields(p);
    return {
      ...(ark ? { personaArk: ark } : {}),
      ...(name ? { name } : {}),
      principal: p.principal === true,
      ...(role ? { role } : {}),
      ...(fields?.relationshipToHead ? { relationshipToHead: fields.relationshipToHead } : {}),
      ...(fields?.sortKey ? { sortKey: fields.sortKey } : {}),
    };
  });
}

async function readFailure(status: number, principal: Principal): Promise<string> {
  if (status === 401) return `HTTP 401: ${await rejectedTokenMessage(principal)}`;
  if (status === 403) return "HTTP 403: this record is restricted and cannot be read.";
  if (status === 404) return "HTTP 404: FamilySearch has no record at this link.";
  if (status === 429) {
    return "HTTP 429: FamilySearch rate limit. Wait a minute, then call again with offset set to this entry's index.";
  }
  return `HTTP ${status}: call again with offset set to this entry's index to retry it.`;
}

// ─── The tool ──────────────────────────────────────────────────────────────

export async function imageIndexTool(
  input: ImageIndexInput,
  principal: Principal,
): Promise<ImageIndexResult> {
  if (!isObject(input)) throw new Error("image_index needs an object with imageId.");
  const image = parseImage(input);
  const offset = parseOffset(input);
  const deadline = Date.now() + IMAGE_INDEX_BUDGET_MS;

  const listed = await readList(principal, image, deadline);
  const total = listed.length;
  if (offset > 0 && offset >= total) {
    throw new Error(
      `offset ${offset} is past the end: FamilySearch lists ${total} records for image ` +
        `${image.ark}${total > 0 ? `, so offset runs from 0 to ${total - 1}` : ""}.`,
    );
  }

  const window = listed.slice(offset, offset + IMAGE_INDEX_CAP);
  // A slot is written only when its read finished before the deadline, so an
  // empty slot is an unfinished read, whichever side wins the race below.
  const slots: Array<ImageIndexEntry | undefined> = new Array(window.length).fill(undefined);

  if (window.length > 0) {
    // Every task catches its own error, so `work` cannot reject, and nothing
    // reads its value: losing the race to the deadline loses nothing.
    const work = mapWithConcurrency(window, IMAGE_INDEX_CONCURRENCY, async (item, i) => {
      const index = offset + i;
      if (item.link === undefined) {
        slots[i] = { index, hydrated: false, personas: [], error: NOT_A_RECORD_LINK };
        return;
      }
      const recordArk = `ark:/61903/1:2:${item.link.id}`;
      // REACHABLE, unlike catalog_search's twin: with more records than
      // workers, queued reads start after the race has returned. Such a read
      // makes no request at all (no token read, no hosted budget slot, and no
      // zero timeout, which AbortSignal.timeout would refuse).
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      let entry: ImageIndexEntry;
      try {
        // One attempt: retries would let one call spend past the cap.
        const res = await fsFetch(principal, item.link.url, { headers: HEADERS }, remaining, {
          attempts: 1,
        });
        if (!res.ok) {
          // An unread undici body holds its socket until GC.
          await res.text().catch(() => "");
          entry = { index, recordArk, hydrated: false, personas: [], error: await readFailure(res.status, principal) };
        } else {
          let body: unknown;
          try {
            body = await res.json();
          } catch {
            body = undefined;
          }
          const personas = readPersonas(body);
          entry = personas
            ? { index, recordArk, hydrated: true, personas }
            : { index, recordArk, hydrated: false, personas: [], error: UNREADABLE_RECORD };
        }
      } catch (err) {
        entry = { index, recordArk, hydrated: false, personas: [], error: describeFetchError(err) };
      }
      // Landed at or past the deadline: unfinished, never a late write that
      // makes the same call's answer depend on scheduling.
      if (Date.now() >= deadline) return;
      slots[i] = entry;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
    });
    try {
      await Promise.race([work, expiry]);
    } finally {
      clearTimeout(timer);
    }
  }

  // The answer is the finished prefix: it stops at the first unfinished read,
  // so nextOffset points at it and no record is skipped.
  const snapshot = slots.slice();
  let finished = 0;
  while (finished < snapshot.length && snapshot[finished] !== undefined) finished++;
  const hydrationTimedOut = finished < window.length;
  let entries = snapshot.slice(0, finished) as ImageIndexEntry[];

  const build = (kept: ImageIndexEntry[]): ImageIndexResult => ({
    imageArk: image.ark,
    ...(image.collectionId !== undefined ? { collectionId: image.collectionId } : {}),
    total,
    offset,
    returned: kept.length,
    entries: kept,
    ...(offset + kept.length < total ? { nextOffset: offset + kept.length } : {}),
    ordered: false,
    hydrationTimedOut,
  });
  let result = build(entries);
  // Over the budget, drop trailing entries; nextOffset follows them. One is
  // always kept, so paging always moves.
  while (entries.length > 1 && JSON.stringify(result).length > TOOL_RESULT_CHAR_BUDGET) {
    entries = entries.slice(0, -1);
    result = build(entries);
  }
  return result;
}
