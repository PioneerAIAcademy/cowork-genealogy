/**
 * Probe: can "DGS 004528134, Item 5, Image 10" be resolved to an image id with
 * no place in hand? (issue #2982, the probe half of issue #2933).
 *
 * Genealogists cite a DGS image by item and by image counted within the item.
 * `image_search` takes only a film-wide group, and `volume_search`, which does
 * return split Natural Group names like `004528134_005_M92M-53P`, requires a
 * `standardPlace`. This script asks three questions of the live service and
 * records the answers below. It proposes no tool surface.
 *
 *   SECTION A, Q1. Which endpoint lists a DGS's split Natural Groups (items)
 *     with NO place filter? Section A prints its search and listing requests
 *     with their exact bodies. The script's own group-service and Catalog
 *     requests go through `send`, which runs `assertNoPlace` first: it throws
 *     on a place field in the URL or anywhere in the body. Two calls into shipped
 *     tools do not go through it: `volume_search` discovery (labelled, never
 *     a Q1 answer) and `image_search` in section C, whose bare-DGS path makes
 *     its own `group/{dgs}/apid` call with no place.
 *   SECTION S, split-film sweep. Children-list position against the `_NNN_`
 *     segment, across split films from three discovery places, taken in turn.
 *   SECTION B, Q2. Is `_NNN_` the Catalog's "Item N"? RMS groups set beside
 *     Catalog `film_note` entries, then beside the film's own item cards.
 *   SECTION C, Q3. Is "Image K" the K-th entry of the item's sorted image
 *     list? Throws unless DGS 004528134 Item 5 Image 10 is `004528134_00632`
 *     and unless 004528112's groups open on its ITEM start cards. A group's
 *     image list is re-requested once when defective. A list that is refused,
 *     or all null, makes positions unreliable: S keeps that film out of its
 *     position counts, B skips it and its start cards, and C reports Q3 as not
 *     checkable if it falls before group 14 of 004528112. A list still partly
 *     null shifts only that group's own images, and C's tiling skips the film.
 *
 * RESULTS (measured 2026-09-29 against the live service; a full run takes about 3 minutes).
 *
 * VANTAGE POINT. Measured from OUTSIDE the church network (a home connection,
 * WSL2), on an ordinary FamilySearch account, under BROWSER_USER_AGENT. Nothing
 * here tests auth or user-agent behaviour, so nothing depends on Imperva's
 * in-network clearance. Account standing DOES matter here, unlike
 * `probe-catalog.ts` section A: some groups and images are access-restricted
 * (below), and a more privileged account may read names this one cannot.
 *
 * GROUND TRUTH USED. Two sources, neither produced by the group service:
 *   - The Catalog: every hit of `q.filmNumber={dgs}`, each item's
 *     `film_note.items` ("Item 5", "Items 1-3") and its subjects (the place).
 *   - The film's own target cards, read by eye with `image_read` (free, no
 *     OCR). The camera operator filmed a start card ("ITEM 5") and an END OF
 *     ITEM card at each boundary. They are listed at FILM_ITEM_START_CARDS.
 *   The FamilySearch web film viewer was NOT used.
 *
 * Q1: YES, by position. One endpoint lists a film's groups with no place:
 *
 *      GET group-service/group/{dgs}/apid          -> the film's apid
 *      GET group-service/group/{apid}/children     -> child group ids, in order
 *
 *   For 004528134 it returns 20 ids. The first 11 carry images and are the
 *   film's RMS groups in film order (M92M-53P is 5th). The last 9 (`MMXT-*`)
 *   serve an empty image list and answer 403 on their metadata. On all four
 *   films section B checks, the count of such image-less children equals the
 *   count of the film's Catalog `film_note` rows (9/9, 3/3, 14/14, 2/2), so
 *   they look like one group per Catalog record. Their names are unreadable to
 *   this account; a more privileged one might read them, and that is the
 *   Catalog-numbered route this probe could not open.
 *
 *   A child's `_NNN_` NAME is not always readable place-free:
 *   `GET group-service/group/{id}` answers 403 "Not authorized to view GROUP
 *   resource" on restricted groups, while the children list and the image list
 *   are still served. `volume_search` discovery did not surface any of them
 *   either. So place-free, N has to be the POSITION among image-bearing
 *   children. The sweep is what makes that safe:
 *
 *   SWEEP (S): 15 split films, 177 image-bearing children, 162 with a readable
 *   name. On all 162 the `_NNN_` segment equals the child's position among
 *   image-bearing children; on all 15 films every image-less child comes after
 *   every image-bearing one, and every image list was served. No film with
 *   segments other than 001, 002, 003... was found in the 15 checked:
 *   004528134, 007621224, 004528112, 004608569, 007651588, 005852351,
 *   004608568, 007651660, 005852349, 004609454, 007638045, 004608543,
 *   005855593, 005176108, 004609990 (Zuid-Holland civil and church registers,
 *   and Blount County, Alabama). The 15 unreadable names are 1 on 004528134,
 *   4 on 007621224, 1 on 007651660 and 9 on 007638045. This does not show the
 *   numbering is always sequential.
 *
 *   What does NOT work, and why a 200 there is a trap:
 *   - `PUT group-service/group/search` (volume_search's endpoint) with
 *     `groupName`, `groupNames` or `groupNamePrefix` and no coverage answers 200
 *     and IGNORES the field: each returns exactly the page a control request
 *     with no name field returns, first hit `004002697` (a Mexican parish film).
 *   - The Catalog lists the film's catalog items by number, but yields no
 *     group id.
 *
 * Q2: NO. `_NNN_` is the RMS group's position among the film's groups, and it
 *   is not always the Catalog's or the film's "Item N".
 *
 *   004528134. The Catalog lists 9 items, all "Huwelijken 1913-1922"
 *   (marriages): 1 Strijen, 2 Tienhoven, 3 Nieuwe Tonge, 4 Oude Tonge,
 *   5 Vianen, 6 Vierpolders, 7 Vlaardingen, 8 Vlaardinger-Ambacht, 9 Vlist.
 *   The film's cards agree with the Catalog: ITEM 4 (Oude Tonge marriages)
 *   starts at 00538 and its END OF ITEM card is 00700; ITEM 5 (Vianen) starts
 *   at 00701. RMS has THREE groups inside that ITEM 4 span: 00538-00622,
 *   00623-00644 (M92M-53P, restricted: its name and image contents answer
 *   403, though its image list is served) and
 *   00645-00700. From there the segment runs two ahead: film Items 5-9 are
 *   RMS `_007_`-`_011_`. Section B: 4 same town, 6 different. Whether the
 *   middle group is part of the marriages or other material filmed inside the
 *   span cannot be seen from this account; issue #2933's triage calls it
 *   Oude Tonge births.
 *
 *   Creation dates. The readable groups at positions 4 and 6 were created
 *   2024-09-09; positions 1-3 and 7-11 were created 2023-03-16 (position 5 is
 *   unreadable). `_007_` (M9DT-SHL) dates from 2023 and still carries `_007_`,
 *   so if names are set at creation, positions 7-11 have not moved since then.
 *   Whether any position's meaning changed is not visible from this account:
 *   every group shows a 2026-08 modification, so names may have been
 *   rewritten. Among groups whose metadata is readable, it was the only one of
 *   the 15 swept films with groups created on more than one date.
 *
 *   004528112. 14 RMS groups, 14 Catalog items, same town at every N; the
 *   ITEM 2 and ITEM 14 start cards open RMS `_002_` and `_014_`.
 *
 *   005852351. 8 and 8, but the Catalog files Oude Tonge as Items 1-5 and
 *   Valkenburg as Items 6-8, while RMS has six Oude Tonge groups: `_006_`
 *   opens on the card "Oude Tonge, alph. index on names of death 1733-1811,
 *   volume 5" (00253) and `_007_` on "Valkenburg ... volume 1" (00329). This
 *   1948 filming carries volume cards with no item numbers, so the film cannot
 *   say which count is right.
 *
 *   007621224. Not decidable here: four of five group names are 403, and every
 *   item is Blount County, so a town comparison could not separate them.
 *
 *   The tester's citation. Issue #2933's triage reports the tester's
 *   "Item 5, Image 10" (a 1919 birth) was found as act 34 on 004528134_00632,
 *   the 10th image of the 5th group, which the triage names
 *   `004528134_005_M92M-53P` (this account cannot read that name). That image
 *   lies inside the film's ITEM 4 span, not the film's ITEM 5 (Vianen
 *   marriages). So if the triage is right, the tester counted RMS groups, not
 *   the film's or the Catalog's items. NOT re-verified here: 00623-00644
 *   answer 403 to this account.
 *
 *   Consequence for issue #2933: "Item N" names two numberings that agree on
 *   most films and diverge wherever RMS holds more than one group per item.
 *   A resolver that takes N
 *   must say which one it counts. That is the lead's call, not this probe's.
 *
 * Q3: YES, for the RMS numbering. "Image K" of RMS group N is index K-1 of the
 *   group's sorted image list, and image 1 is the item's start card:
 *   - The 5th group of 004528134 (M92M-53P): index 9 is 004528134_00632, the
 *     issue's worked example (the script throws otherwise).
 *   - Film 004528112, the film other than 004528134: image 1 of RMS `_002_` is
 *     00724, the ITEM 2 start card, and image 1 of `_014_` is 02364, the
 *     ITEM 14 start card; the last image of `_001_` (00723) is the END OF ITEM
 *     card for ITEM 1 (the script throws unless the first two hold).
 *   - All 15 swept films: the groups start at the film's first image, end at
 *     its last (as `image_search` lists the whole film on the bare DGS), hold
 *     every image once, and follow each other with no gap or overlap.
 *   Counting within a FILM item that spans several RMS groups (004528134's
 *   ITEM 4) is not the same thing: it would need those groups concatenated.
 *
 * Usage:
 *   cd packages/engine/mcp-server && npx tsx dev/probe-dgs-items.ts
 *   cd packages/engine/mcp-server && npx tsx dev/probe-dgs-items.ts --section C
 */
import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { imageSearchTool } from "../src/tools/image-search.js";
import { volumeSearchTool } from "../src/tools/volume-search.js";
import { fsFetch } from "../src/utils/fs-fetch.js";

const GROUP_SERVICE_BASE =
  "https://sg30p0.familysearch.org/service/records/rms/group-service";
const ARTIFACT_BASE = "https://sg30p0.familysearch.org/service/records/rms";
const CATALOG_SEARCH_URL =
  "https://www.familysearch.org/service/search/catalog/v3/search";
const CATALOG_ITEM_URL =
  "https://www.familysearch.org/service/search/catalog/item";

// Issue #2933's worked example: the tester's citation and the image the triage
// found it on. Necessary for Q3, but it proves nothing new on its own.
const FILM = "004528134";
const ITEM_5_GROUP = "004528134_005_M92M-53P";
const ITEM_5_NATURAL_ID = "M92M-53P";
const ITEM_5_IMAGE_10 = "004528134_00632";
const BLOUNT_FILM = "007621224";

// Target cards the camera operator filmed at item boundaries, read by eye with
// image_read. They are printed on the film itself, so they are ground truth
// that neither the Catalog nor the group service produced.
//   004528134_00538  start card, ITEM 4, Oude Tonge, Huwelijken 1913-1922
//   004528134_00700  END OF ITEM card, ITEM 4 (Oude Tonge)
//   004528134_00701  start card, ITEM 5, Vianen, Huwelijken 1913-1922
//   004528112_00723  END OF ITEM card, ITEM 1, Vlaardingen, Overlijden 1933-1942
//   004528112_00724  start card, ITEM 2, Vlaardinger-Ambacht, Overlijden
//   004528112_02364  start card, ITEM 14, Zwyndrecht (as filmed), Overlijden
const CARD_FILM = "004528112";
const FILM_ITEM_START_CARDS: { dgs: string; filmItem: number; imageId: string }[] = [
  { dgs: FILM, filmItem: 4, imageId: "004528134_00538" },
  { dgs: FILM, filmItem: 5, imageId: "004528134_00701" },
  { dgs: CARD_FILM, filmItem: 2, imageId: "004528112_00724" },
  { dgs: CARD_FILM, filmItem: 14, imageId: "004528112_02364" },
];

// Places used ONLY to discover split films (and, as a fallback, names the
// group service will not serve directly; in the recorded run it supplied none).
// Never used to answer Q1.
const DISCOVERY_PLACES = [
  "Oude Tonge, South Holland, Netherlands",
  "Vianen, South Holland, Netherlands",
  "Blount, Alabama, United States",
];

// Each swept film costs two requests per child, and a Dutch civil-registration
// film can have 150 children, so the sweep stops here.
const MAX_SWEEP_FILMS = 15;

// Compared lower-cased, so `PlaceRepIds` or `Q.PLACEID` cannot slip past.
const PLACE_KEYS = new Set(
  [
    "place",
    "placeId",
    "placeRepId",
    "placeRepIds",
    "standardPlace",
    "q.place",
    "q.placeId",
    "q.place.exact",
  ].map((k) => k.toLowerCase()),
);

/**
 * Throw if a request carries any place filter: a place-keyed URL query
 * parameter, or a place key at any depth of the JSON body. Q1 is answered only
 * by a request with none, since adding one rebuilds `volume_search`.
 */
function assertNoPlace(url: string, body?: unknown): void {
  for (const key of new URL(url).searchParams.keys()) {
    if (PLACE_KEYS.has(key.toLowerCase())) {
      throw new Error(`place filter "${key}" in URL ${url}`);
    }
  }
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (node !== null && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        const at = path ? `${path}.${k}` : k;
        if (PLACE_KEYS.has(k.toLowerCase())) {
          throw new Error(`place filter "${at}" in request body`);
        }
        walk(v, at);
      }
    }
  };
  walk(body, "");
}

// fsFetch sets the bearer itself (and re-reads tokens.json once on a 401).
function headers(withBody: boolean): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": BROWSER_USER_AGENT,
    "FS-User-Agent-Chain": "chesworth",
    ...(withBody ? { "Content-Type": "application/json" } : {}),
  };
}

// The script's own group-service and Catalog requests go through here, so none
// can carry a place. Section A's search and listing requests print in full; the
// rest pass `quiet`. `image_search` and `volume_search` make their own calls.
async function send(
  method: "GET" | "PUT",
  url: string,
  body?: unknown,
  { quiet = false }: { quiet?: boolean } = {},
): Promise<{ status: number; text: string }> {
  assertNoPlace(url, body);
  if (!quiet) {
    console.log(`  >> ${method} ${url}`);
    if (body !== undefined) console.log(`     body ${JSON.stringify(body)}`);
  }
  const res = await fsFetch(LOCAL, url, {
    method,
    headers: headers(body !== undefined),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, text: await res.text() };
}

// ---------- the place-free item listing (Q1's answer) ----------

interface FilmChild {
  position: number;
  id: string;
  metaStatus: number;
  groupName: string | null;
  coveragePlace: string | null;
  coverageType: string | null;
  created: string | null;
  images: string[];
  dropped: number;
  /** Status of the image-list call. A non-200 is NOT "no images": it is unknown. */
  imagesStatus: number;
}

async function apidFor(dgs: string, quiet = false): Promise<string> {
  const r = await send(
    "GET",
    `${GROUP_SERVICE_BASE}/group/${encodeURIComponent(dgs)}/apid`,
    undefined,
    { quiet },
  );
  if (r.status !== 200) throw new Error(`apid for ${dgs}: ${r.status}`);
  return r.text.trim();
}

async function childIds(apid: string, quiet = false): Promise<string[]> {
  const r = await send(
    "GET",
    `${GROUP_SERVICE_BASE}/group/${encodeURIComponent(apid)}/children`,
    undefined,
    { quiet },
  );
  if (r.status !== 200) throw new Error(`children of ${apid}: ${r.status}`);
  return JSON.parse(r.text) as string[];
}

// Mirrors image_search's usableImageIds and its single retry. A null
// value is a defective response that stands in for a real image: filtering it
// keeps the null out of the list, but the real image is still missing, so a
// defective response is re-requested once and the better of the two kept.
async function childImages(
  id: string,
): Promise<{ images: string[]; dropped: number; status: number }> {
  const fetchOnce = async (): Promise<{ images: string[]; dropped: number; status: number }> => {
    const r = await send(
      "GET",
      `${ARTIFACT_BASE}/artifact/group/${encodeURIComponent(id)}/children/names`,
      undefined,
      { quiet: true },
    );
    if (r.status !== 200) return { images: [], dropped: 0, status: r.status };
    const values = Object.values(JSON.parse(r.text) as Record<string, unknown>);
    const images = values
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .sort();
    return { images, dropped: values.length - images.length, status: r.status };
  };
  const first = await fetchOnce();
  if (first.status !== 200 || first.dropped === 0) return first;
  let retry: { images: string[]; dropped: number; status: number };
  try {
    retry = await fetchOnce();
  } catch {
    return first; // as image_search does: a failed retry keeps the first list
  }
  const better =
    retry.status === 200 &&
    (retry.images.length > first.images.length ||
      (retry.images.length === first.images.length && retry.dropped < first.dropped));
  return better ? retry : first;
}

/**
 * Children that make POSITION untrustworthy: a refused list (non-200), or one
 * whose every value was null, so the child looks image-less. Either one drops
 * out of the image-bearing count and shifts every later N.
 */
function positionUnreliable(children: FilmChild[]): FilmChild[] {
  return children.filter(
    (c) => c.imagesStatus !== 200 || (c.images.length === 0 && c.dropped > 0),
  );
}

/**
 * Children with a list still defective after the retry (some values null). N is
 * unaffected, but the child is missing an image, so its own "Image K" indices and
 * the tiling count are off.
 */
function imagesDefective(children: FilmChild[]): FilmChild[] {
  return children.filter((c) => c.dropped > 0 && c.images.length > 0);
}

// Sections S, B and C all walk the same films; one listing per film per run.
const childrenCache = new Map<string, FilmChild[]>();

async function listFilmChildren(dgs: string): Promise<FilmChild[]> {
  const cached = childrenCache.get(dgs);
  if (cached) return cached;
  const ids = await childIds(await apidFor(dgs, true), true);
  const out: FilmChild[] = [];
  for (const [i, id] of ids.entries()) {
    const meta = await send(
      "GET",
      `${GROUP_SERVICE_BASE}/group/${encodeURIComponent(id)}`,
      undefined,
      { quiet: true },
    );
    let groupName: string | null = null;
    let coveragePlace: string | null = null;
    let coverageType: string | null = null;
    let created: string | null = null;
    if (meta.status === 200) {
      const g = JSON.parse(meta.text) as {
        groupName?: string;
        createdDateTime?: string;
        coverages?: { place?: string; recordTypeOrig?: string }[];
      };
      groupName = g.groupName ?? null;
      coveragePlace = g.coverages?.[0]?.place ?? null;
      const types = [
        ...new Set((g.coverages ?? []).map((c) => c.recordTypeOrig).filter(Boolean)),
      ];
      coverageType = types.length > 0 ? types.join(" + ") : null;
      created = g.createdDateTime?.slice(0, 10) ?? null;
    }
    const { images, dropped, status } = await childImages(id);
    out.push({
      position: i + 1,
      id,
      metaStatus: meta.status,
      groupName,
      coveragePlace,
      coverageType,
      created,
      images,
      dropped,
      imagesStatus: status,
    });
  }
  childrenCache.set(dgs, out);
  return out;
}

// ---------- discovery (place-filtered; never a Q1 answer) ----------

interface DiscoveredGroup {
  groupName: string;
  place: string;
}

let discoveryCache: Map<string, DiscoveredGroup[]> | null = null;
// Films in the order each discovery place found them, one list per place, so
// the sweep can take films from every place rather than only the first.
const filmsByPlace: string[][] = [];

/** Split groups, by film prefix, that volume_search returns over DISCOVERY_PLACES. */
async function discover(): Promise<Map<string, DiscoveredGroup[]>> {
  if (discoveryCache) return discoveryCache;
  console.log("\n  DISCOVERY (place-filtered via volume_search; not a Q1 answer)");
  const byFilm = new Map<string, DiscoveredGroup[]>();
  for (const standardPlace of DISCOVERY_PLACES) {
    const found: string[] = [];
    filmsByPlace.push(found);
    let pageToken: string | undefined;
    let pages = 0;
    do {
      const r = await volumeSearchTool(
        { standardPlace, ...(pageToken ? { pageToken } : {}) },
        LOCAL,
      );
      for (const g of r.results) {
        if (!g.imageGroupNumber.includes("_")) continue;
        if (!found.includes(g.imageGroupPrefix)) found.push(g.imageGroupPrefix);
        const list = byFilm.get(g.imageGroupPrefix) ?? [];
        if (!list.some((d) => d.groupName === g.imageGroupNumber)) {
          list.push({
            groupName: g.imageGroupNumber,
            place: g.coverages[0]?.place ?? "",
          });
        }
        byFilm.set(g.imageGroupPrefix, list);
      }
      pageToken = r.nextPageToken;
      pages++;
    } while (pageToken && pages < 10);
    console.log(`    ${standardPlace}: ${pages} page(s)`);
  }
  discoveryCache = byFilm;
  return byFilm;
}

function sweepFilms(): string[] {
  const order = [FILM, BLOUNT_FILM, CARD_FILM];
  for (let i = 0; filmsByPlace.some((f) => i < f.length); i++) {
    for (const f of filmsByPlace) if (i < f.length) order.push(f[i]);
  }
  return [...new Set(order)].slice(0, MAX_SWEEP_FILMS);
}

function segmentOf(groupName: string): number | null {
  const parts = groupName.split("_");
  return parts.length === 3 ? Number(parts[1]) : null;
}

function imageNumber(imageId: string): number {
  return Number(imageId.split("_").pop());
}

// ---------- Catalog ground truth ----------

interface CatalogItem {
  catalogId: string;
  items: string;
  text: string;
  /** Normalized town of every subject: an item is filed under its town and its hamlets. */
  towns: string[];
  subject: string;
}

async function catalogItemsFor(dgs: string, quiet = false): Promise<CatalogItem[]> {
  const film = String(Number(dgs));
  const q = `count=100&offset=0&m.queryRequireDefault=on&q.filmNumber=${film}`;
  const r = await send("GET", `${CATALOG_SEARCH_URL}?${q}`, undefined, { quiet });
  if (r.status !== 200) throw new Error(`catalog search ${dgs}: ${r.status}`);
  const hits =
    (
      JSON.parse(r.text) as {
        searchHits?: { metadataHit: { metadata: { identifier?: { value: string } } } }[];
      }
    ).searchHits ?? [];
  const out: CatalogItem[] = [];
  for (const hit of hits) {
    const catalogId = hit.metadataHit.metadata.identifier?.value.split("/").pop();
    if (!catalogId) continue;
    const item = await send("GET", `${CATALOG_ITEM_URL}/${catalogId}`, undefined, {
      quiet: true,
    });
    if (item.status !== 200) continue;
    const source =
      (
        JSON.parse(item.text) as {
          source?: {
            film_note?: Record<string, string> | Record<string, string>[];
            subject?: { text?: string } | { text?: string }[];
          };
        }
      ).source ?? {};
    const notes = Array.isArray(source.film_note)
      ? source.film_note
      : source.film_note
        ? [source.film_note]
        : [];
    const subjects = Array.isArray(source.subject)
      ? source.subject
      : source.subject
        ? [source.subject]
        : [];
    for (const n of notes) {
      if (String(Number(n.digital_film_no)) !== film) continue;
      out.push({
        catalogId,
        items: n.items ?? "",
        text: n.text ?? "",
        towns: subjects.map((sub) => catalogTown(sub.text ?? "")).filter(Boolean),
        subject: subjects[0]?.text ?? "",
      });
    }
  }
  return out;
}

/** "Item 5" -> [5], "Items 1-3" -> [1, 2, 3], "" -> []. */
function catalogItemNumbers(items: string): number[] {
  const m = /Items?\s+(\d+)(?:\s*-\s*(\d+))?/i.exec(items);
  if (!m) return [];
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

// "Netherlands, Zuid-Holland, Vianen - Civil registration" -> "vianen";
// "Vianen, South Holland, Netherlands" -> "vianen".
function catalogTown(subject: string): string {
  const head = subject.split(" - ")[0].split(",");
  return normTown(head[head.length - 1] ?? "");
}
function rmsTown(place: string): string {
  return normTown(place.split(",")[0] ?? "");
}
function normTown(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

// ---------- sections ----------

async function sectionA(): Promise<void> {
  console.log("\n==== SECTION A - Q1: a place-free item listing ====\n");

  console.log("A.1 group/search filtered by name, no coverage block:");
  const firstNames = (text: string): string[] =>
    ((JSON.parse(text) as { groups?: { groupName: string }[] }).groups ?? []).map(
      (g) => g.groupName,
    );
  const controlBody = { types: ["NATURAL"], active: true, pageSize: 100 };
  const control = await send("PUT", `${GROUP_SERVICE_BASE}/group/search`, controlBody);
  const controlNames = control.status === 200 ? firstNames(control.text) : [];
  console.log(`     -> control (no name field): ${control.status}, first ${controlNames[0] ?? "-"}\n`);
  for (const field of ["groupName", "groupNames", "groupNamePrefix"]) {
    const value = field === "groupNames" ? [FILM] : FILM;
    const body = { [field]: value, types: ["NATURAL"], active: true, pageSize: 100 };
    const r = await send("PUT", `${GROUP_SERVICE_BASE}/group/search`, body);
    const groups =
      r.status === 200
        ? ((JSON.parse(r.text) as { groups?: { groupName: string }[] }).groups ?? [])
        : [];
    const allFilm =
      groups.length > 0 && groups.every((g) => g.groupName.startsWith(`${FILM}_`));
    // M92M-53P is restricted and group/search never returned a restricted
    // group to this account, so its absence is printed but does not decide.
    const hasItem5 = groups.some((g) => g.groupName.endsWith(ITEM_5_NATURAL_ID));
    const sameAsControl =
      groups.length > 0 &&
      JSON.stringify(groups.map((g) => g.groupName)) === JSON.stringify(controlNames);
    const verdict = sameAsControl
      ? "NO (filter ignored: same page as the control)"
      : allFilm
        ? "YES"
        : "NO";
    console.log(
      `     -> ${r.status}, ${groups.length} groups, first ${groups[0]?.groupName ?? "-"}; ` +
        `all start ${FILM}_: ${allFilm}; has ${ITEM_5_NATURAL_ID}: ${hasItem5} => ${verdict}\n`,
    );
  }

  console.log("A.2 the film's apid group, its metadata, and its children:");
  const apid = await apidFor(FILM);
  console.log(`     -> apid ${apid}`);
  const meta = await send("GET", `${GROUP_SERVICE_BASE}/group/${encodeURIComponent(apid)}`);
  const m = meta.status === 200 ? (JSON.parse(meta.text) as Record<string, unknown>) : {};
  console.log(
    `     -> ${meta.status}, groupName ${m.groupName}, types ${JSON.stringify(m.types)}; ` +
      `lists children itself: ${"childIds" in m || "children" in m}`,
  );
  const ids = await childIds(apid);
  const at = ids.indexOf(ITEM_5_NATURAL_ID);
  console.log(`     -> ${ids.length} children: ${ids.join(" ")}`);
  console.log(
    `     has ${ITEM_5_NATURAL_ID}: ${at !== -1} (position ${at + 1}) => ${at !== -1 ? "YES" : "NO"}\n`,
  );

  console.log("A.3 the Catalog, by film number:");
  const items = await catalogItemsFor(FILM);
  for (const it of items) {
    console.log(`     ${it.items.padEnd(10)} ${it.text}  [${it.catalogId}: ${it.subject}]`);
  }
  console.log("     => catalog items only, no group ids: NO\n");
}

async function sectionS(): Promise<void> {
  console.log("\n==== SECTION S - split-film sweep: position vs _NNN_ ====");
  const discovered = await discover();
  const films = sweepFilms();
  let nonSequential = 0;
  let interleaved = 0;
  let unknownImages = 0;
  let multiDate = 0;
  let checked = 0;
  for (const dgs of films) {
    const children = await listFilmChildren(dgs);
    const withImages = children.filter((c) => c.images.length > 0);
    if (withImages.length < 2) continue;
    checked++;
    const known = new Map(
      (discovered.get(dgs) ?? []).map((d) => [d.groupName.split("_").pop(), d]),
    );
    console.log(`\n  ${dgs}: ${children.length} children, ${withImages.length} with images`);
    const segments: (number | null)[] = [];
    withImages.forEach((c, i) => {
      const name = c.groupName ?? known.get(c.id)?.groupName ?? null;
      const seg = name ? segmentOf(name) : null;
      segments.push(seg);
      const src = c.groupName ? "direct" : name ? "discovery" : `unreadable (${c.metaStatus})`;
      const agree = seg === null ? "?" : seg === i + 1 ? "=" : "DIFFERS";
      console.log(
        `    #${String(i + 1).padStart(2)} ${c.id.padEnd(9)} ${String(name ?? "-").padEnd(24)} ` +
          `${src.padEnd(17)} pos ${agree}  ${c.images.length} images ${c.images[0]}..${c.images[c.images.length - 1]}` +
          (c.dropped ? `  dropped ${c.dropped}` : ""),
      );
    });
    const unlisted = positionUnreliable(children);
    if (unlisted.length > 0) {
      unknownImages++;
      console.log(
        `    image list refused or empty-by-nulls for ${unlisted.map((c) => `${c.id} (status ${c.imagesStatus}, dropped ${c.dropped})`).join(", ")}: ` +
          "positions after it are unreliable; this film is left out of the first two counts",
      );
    }
    const defective = imagesDefective(children);
    if (defective.length > 0) {
      console.log(
        `    image list still defective after a retry for ${defective.map((c) => `${c.id} (dropped ${c.dropped})`).join(", ")}: ` +
          "its Image K indices are off; positions are unaffected",
      );
    }
    const created = new Map<string, number[]>();
    withImages.forEach((c, i) => {
      if (c.created) created.set(c.created, [...(created.get(c.created) ?? []), i + 1]);
    });
    if (created.size > 1) {
      multiDate++;
      console.log(
        `    groups created on ${created.size} dates: ` +
          [...created].map(([d, ps]) => `${d} (#${ps.join(",")})`).join("; "),
      );
    }
    const readable = segments.filter((s): s is number => s !== null);
    const sequential = segments.every((s, i) => s === null || s === i + 1);
    if (!sequential && unlisted.length === 0) nonSequential++;
    // Position among imaged children is only the item number if no image-less
    // child sits between two imaged ones.
    const lastImaged = Math.max(...withImages.map((c) => c.position));
    const emptyFirst = children.filter((c) => c.images.length === 0 && c.position < lastImaged);
    if (emptyFirst.length > 0 && unlisted.length === 0) interleaved++;
    console.log(
      `    readable segments ${readable.length}/${segments.length}; sequential by position: ${sequential}; ` +
        `image-less children all after the imaged ones: ${emptyFirst.length === 0}`,
    );
  }
  console.log(
    `\n  => ${checked} split films checked, ${nonSequential} with segments that differ from position, ` +
      `${interleaved} with an image-less child among the imaged ones, ` +
      `${unknownImages} with a refused or all-null image list (left out of the first two counts), ` +
      `${multiDate} with groups created on more than one date`,
  );
}

async function sectionB(): Promise<void> {
  console.log("\n==== SECTION B - Q2: _NNN_ vs the Catalog's Item N ====");
  console.log("  Ground truth: Catalog film_note.items (every q.filmNumber hit).");
  const discovered = await discover();
  let shown = 0;
  let tried = 0;
  for (const dgs of new Set([FILM, BLOUNT_FILM, CARD_FILM, ...discovered.keys()])) {
    // `tried` caps the walk even when every film is skipped.
    if (shown >= 4 || tried >= 8) break;
    tried++;
    const all = await listFilmChildren(dgs);
    const children = all.filter((c) => c.images.length > 0);
    const known = new Map(
      (discovered.get(dgs) ?? []).map((d) => [d.groupName.split("_").pop(), d]),
    );
    const catalog = await catalogItemsFor(dgs, true);
    const imageless = all.filter((c) => c.images.length === 0 && c.imagesStatus === 200).length;
    const byItem = new Map<number, CatalogItem>();
    for (const c of catalog) for (const n of catalogItemNumbers(c.items)) byItem.set(n, c);
    if (byItem.size === 0) {
      console.log(`\n  ${dgs}: no Catalog film_note carries an item number; skipped`);
      continue;
    }
    if (positionUnreliable(all).length > 0) {
      console.log(`\n  ${dgs}: an image list is refused or empty-by-nulls, so positions are unreliable; skipped`);
      continue;
    }
    shown++;
    console.log(
      `\n  ${dgs}: ${children.length} RMS items, ${byItem.size} Catalog item numbers; ` +
        `${imageless} image-less children against ${catalog.length} Catalog film_note rows`,
    );
    let same = 0;
    let differ = 0;
    children.forEach((c, i) => {
      const name = c.groupName ?? known.get(c.id)?.groupName ?? null;
      const seg = name ? segmentOf(name) : null;
      const n = seg ?? i + 1;
      const place = c.coveragePlace ?? known.get(c.id)?.place ?? "";
      const cat = byItem.get(n);
      const town = rmsTown(place);
      const matches = [...byItem].filter(([, it]) => it.towns.includes(town)).map(([k]) => k);
      const verdict = !town || matches.length === 0
        ? "?"
        : matches.includes(n)
          ? "same town"
          : `DIFFERENT (that town is Catalog Item ${matches.join(", ")})`;
      if (verdict === "same town") same++;
      if (verdict.startsWith("DIFFERENT")) differ++;
      console.log(
        `    RMS ${String(n).padStart(3, "0")}${seg === null ? "(pos)" : "     "} ${place.padEnd(40).slice(0, 40)} ` +
          `[${c.coverageType ?? "-"}] | ` +
          `Catalog Item ${n}: ${cat ? `${cat.subject.split(" - ")[0]} / ${cat.text}` : "(none)"}  => ${verdict}`,
      );
    });
    console.log(`    => ${same} same town, ${differ} different`);
  }

  console.log("\n  Second ground truth, the film's own start cards: which RMS group opens on each?");
  for (const card of FILM_ITEM_START_CARDS) {
    const all = await listFilmChildren(card.dgs);
    const children = all.filter((c) => c.images.length > 0);
    const at = children.findIndex((c) => c.images.includes(card.imageId));
    if (at === -1 || positionUnreliable(all).length > 0) {
      console.log(
        `    film ITEM ${String(card.filmItem).padStart(2)} card ${card.imageId} -> ` +
          (at === -1 ? "card not found in any served image list" : "positions unreliable on this film") +
          "; no verdict",
      );
      continue;
    }
    const group = children[at];
    const opens = group.images[0] === card.imageId;
    console.log(
      `    film ITEM ${String(card.filmItem).padStart(2)} card ${card.imageId} -> RMS position ${at + 1} ` +
        `(${group.groupName ?? "name unreadable"}), opens the group: ${opens} => ` +
        `${at + 1 === card.filmItem ? "position = film item" : "position DIFFERS from film item"}`,
    );
  }
}

async function sectionC(): Promise<void> {
  console.log("\n==== SECTION C - Q3: Image K is the K-th sorted child ====\n");
  const { imageIds } = await imageSearchTool({ imageGroupNumber: ITEM_5_GROUP }, LOCAL);
  console.log(
    `  ${ITEM_5_GROUP}: ${imageIds.length} images ${imageIds[0]}..${imageIds[imageIds.length - 1]}`,
  );
  console.log(`  Image 10 (index 9) = ${imageIds[9]}; expected ${ITEM_5_IMAGE_10}`);
  if (imageIds[9] !== ITEM_5_IMAGE_10) {
    throw new Error(`Q3 failed: ${ITEM_5_GROUP} image 10 is ${imageIds[9]}, not ${ITEM_5_IMAGE_10}`);
  }

  // Off the worked example: on a film whose RMS groups each hold one film item,
  // image 1 of group N must be the film's own ITEM N start card.
  console.log(`\n  ${CARD_FILM}: image 1 of each RMS group against the film's start cards:`);
  const cardAll = await listFilmChildren(CARD_FILM);
  // Only children up to the last checked group can move groups 2 and 14; a
  // refused list among the trailing image-less children cannot.
  const lastChecked = Math.max(
    ...FILM_ITEM_START_CARDS.filter((c) => c.dgs === CARD_FILM).map((c) => c.filmItem),
  );
  let imaged = 0;
  const upTo: FilmChild[] = [];
  for (const c of cardAll) {
    if (imaged >= lastChecked) break;
    upTo.push(c);
    if (c.images.length > 0) imaged++;
  }
  const cardUnreliable = positionUnreliable(upTo);
  if (cardUnreliable.length > 0) {
    throw new Error(
      `Q3 not checkable: ${CARD_FILM} image list refused or empty-by-nulls for ` +
        cardUnreliable.map((c) => `${c.id} (status ${c.imagesStatus}, dropped ${c.dropped})`).join(", "),
    );
  }
  const cardChildren = cardAll.filter((c) => c.images.length > 0);
  for (const card of FILM_ITEM_START_CARDS.filter((c) => c.dgs === CARD_FILM)) {
    const group = cardChildren[card.filmItem - 1];
    const first = group?.images[0];
    console.log(
      `    ITEM ${card.filmItem} card ${card.imageId}; RMS ${group?.groupName ?? "-"} image 1 = ${first}`,
    );
    if (first !== card.imageId) {
      throw new Error(`Q3 failed: ${CARD_FILM} RMS group ${card.filmItem} starts at ${first}, not the ITEM ${card.filmItem} card ${card.imageId}`);
    }
  }

  console.log("\n  Items tile each film with no gap or overlap (so K-th child is well defined):");
  await discover();
  for (const dgs of sweepFilms()) {
    const all = await listFilmChildren(dgs);
    const children = all.filter((c) => c.images.length > 0);
    if (children.length < 2) continue;
    if (positionUnreliable(all).length > 0 || imagesDefective(all).length > 0) {
      console.log(`    ${dgs}: an image list is refused or defective; not checked`);
      continue;
    }
    const problems: string[] = [];
    for (let i = 1; i < children.length; i++) {
      const prevLast = imageNumber(children[i - 1].images[children[i - 1].images.length - 1]);
      const first = imageNumber(children[i].images[0]);
      if (first !== prevLast + 1) problems.push(`#${i}->#${i + 1}: ${prevLast} then ${first}`);
    }
    // The groups must also start at the film's first image and end at its last,
    // as image_search lists the whole film on the bare DGS.
    const whole = (await imageSearchTool({ imageGroupNumber: dgs }, LOCAL)).imageIds;
    const firstImage = children[0].images[0];
    const lastGroup = children[children.length - 1];
    const lastImage = lastGroup.images[lastGroup.images.length - 1];
    const covered = children.reduce((sum, c) => sum + c.images.length, 0);
    if (firstImage !== whole[0]) problems.push(`starts at ${firstImage}, film starts at ${whole[0]}`);
    if (lastImage !== whole[whole.length - 1]) problems.push(`ends at ${lastImage}, film ends at ${whole[whole.length - 1]}`);
    if (covered !== whole.length) problems.push(`groups hold ${covered} images, film has ${whole.length}`);
    for (const c of children) {
      const nums = c.images.map(imageNumber);
      if (nums[nums.length - 1] - nums[0] + 1 !== nums.length) {
        problems.push(`#${c.position} not contiguous`);
      }
    }
    console.log(
      `    ${dgs}: ${children.length} items, ${whole.length} film images, ` +
        `${problems.length === 0 ? "contiguous, in film order, first to last image" : problems.join("; ")}`,
    );
    // Boundary pairs to view with image_read: the page content should change
    // between the last image of one item and the first of the next.
    if (dgs === CARD_FILM) {
      for (let i = 1; i < children.length; i++) {
        const prev = children[i - 1];
        const next = children[i];
        console.log(
          `      boundary #${i}->#${i + 1}: ${prev.images[prev.images.length - 1]} | ${next.images[0]}` +
            `  (${prev.coveragePlace ?? "?"} -> ${next.coveragePlace ?? "?"})`,
        );
      }
    }
  }
}

const SECTIONS: Record<string, () => Promise<void>> = {
  A: sectionA,
  S: sectionS,
  B: sectionB,
  C: sectionC,
};

async function main(): Promise<void> {
  // Reject anything that is not exactly `--section <X>`, as probe-catalog.ts
  // does: a near miss must not fall through to the full run.
  const argv = process.argv.slice(2);
  const idx = argv.indexOf("--section");
  const requested = idx === -1 ? null : (argv[idx + 1] ?? "").toUpperCase();
  const extra = argv.filter((_, i) => idx === -1 || (i !== idx && i !== idx + 1));
  if (extra.length > 0 || (requested !== null && !SECTIONS[requested])) {
    console.error(`Usage: probe-dgs-items.ts [--section ${Object.keys(SECTIONS).join("|")}]`);
    process.exit(1);
  }

  // Fail fast with the login instruction before any section starts.
  await getValidToken(LOCAL);
  const run = requested ? [requested] : Object.keys(SECTIONS);
  for (const name of run) await SECTIONS[name]();

  console.log("\n================================================================");
  console.log("DONE");
  console.log("================================================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
