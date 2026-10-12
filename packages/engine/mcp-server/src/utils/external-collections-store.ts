/**
 * `external-collections.json` — FamilySearch's curated external collections per
 * place, kept at the project root so skills read real collection ids instead of
 * recalling them (issue #2995; external-links-search-tool-spec.md, "Stored list").
 *
 * Host-written only: `external_links_search` writes it, `research_query` and
 * `project_context` read it, and the raw-write deny protects it. It is not a
 * `research.json` section and is not schema-validated — the rows are API data.
 *
 * Shape (snake_case: a persisted document):
 *
 *     { "places": { "<place>": { "rows": [StoredCollectionRow, ...] } } }
 *
 * Entries are keyed by each link's OWN `place`, so a county fetch that returns
 * its state's whole list updates the state entry once rather than storing a
 * second copy under the county. Everything is sorted and nothing is time-stamped,
 * so fetching the same place twice — in any API order — writes the same bytes.
 */
import { getProjectStore } from "../store/project-store.js";
import {
  classifyProjectPath,
  fileExists,
  InvalidProjectJsonError,
  readProjectJson,
  withProjectLock,
} from "./project-io.js";

export const EXTERNAL_COLLECTIONS_FILE = "external-collections.json";

export interface StoredCollectionRow {
  key: string;
  url: string;
  link_text: string;
  record_types: string[];
  place: string;
  cost: string;
  content_type: string;
  start_year: string;
  end_year: string;
}

export interface ExternalCollectionsDoc {
  places: Record<string, { rows: StoredCollectionRow[] }>;
}

/** One API row, as `external_links_search` reads it. */
export interface RawCollectionRow {
  url: string;
  linkText?: string;
  place?: string;
  record_type?: string;
  cost?: string;
  content_type?: string;
  startYear?: string;
  endYear?: string;
}

const ANCESTRY_ID = /ancestry\.[a-z.]+\/search\/collections\/(\d+)\/?(?:[?#]|$)|[?&]dbid=(\d+)/i;
const MYHERITAGE_COLLECTION = /myheritage\.[a-z.]+\/research\/collection-\d+/i;

/** The identity two curated links share when they name the same collection. */
export function collectionKey(url: string): string {
  const anc = ANCESTRY_ID.exec(url);
  if (anc && /ancestry\./i.test(url)) return `ancestry:${anc[1] ?? anc[2]}`;
  if (MYHERITAGE_COLLECTION.test(url)) return url.split(/[?#]/)[0];
  return url;
}

/** Code-unit order: `localeCompare` would make the stored bytes depend on the host's locale. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function tuple(r: RawCollectionRow): string[] {
  return [r.url, r.linkText ?? "", r.cost ?? "", r.content_type ?? "", r.startYear ?? "", r.endYear ?? "", r.record_type ?? ""];
}

function byTuple(a: RawCollectionRow, b: RawCollectionRow): number {
  const ta = tuple(a);
  const tb = tuple(b);
  for (let i = 0; i < ta.length; i++) {
    const c = cmp(ta[i], tb[i]);
    if (c !== 0) return c;
  }
  return 0;
}

// Tracking and collection-id parameters, including the legacy Ancestry `db.aspx`
// form's `htx`, `o_*` and `geo_*`.
const NON_SCOPING_PARAM = /^(utm_.*|tr_.*|o_.*|geo_.*|htx|s|h|dbid|fbclid|gclid|ref)$/i;

/** A query parameter other than tracking or a collection id: one that narrows the
 *  site's search, e.g. Ancestry's `arrival=_pennsylvania-usa_41`. */
function hasScopingQuery(url: string): boolean {
  const q = url.indexOf("?");
  if (q < 0) return false;
  return url
    .slice(q + 1)
    .split("#")[0]
    .split("&")
    .some((pair) => {
      const name = pair.split("=")[0];
      return name !== "" && !NON_SCOPING_PARAM.test(name);
    });
}

export function yearNum(y: string | undefined): number | null {
  if (!y) return null;
  const n = Number.parseInt(y, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Collapse the API's rows into one row per (place, collection key). The API
 * returns the same URL several times with different link text, cost or years,
 * in a different order on every call, so every choice here is order-independent:
 * candidates are sorted by their full field tuple; the text fields come from the
 * first; the years are the hull of every candidate's range, or undated when any
 * candidate is undated, so a year filter includes the merged row whenever it would
 * have included one of its copies; an `https` URL wins over an `http` one, and
 * among those a URL whose query scopes the search to the place (`?arrival=…`) wins
 * over one without — tracking parameters do not count. A row with no `place` is filed under
 * `fallbackPlace` (the queried place).
 */
export function dedupeCollections(raw: RawCollectionRow[], fallbackPlace = ""): StoredCollectionRow[] {
  const groups = new Map<string, RawCollectionRow[]>();
  for (const r of raw) {
    if (typeof r.url !== "string" || r.url.length === 0) continue;
    const id = `${r.place || fallbackPlace}\0${collectionKey(r.url)}`;
    const g = groups.get(id);
    if (g) g.push(r);
    else groups.set(id, [r]);
  }
  const rows: StoredCollectionRow[] = [];
  for (const [id, group] of groups) {
    group.sort(byTuple);
    const first = group[0];
    const all = [...new Set(group.map((r) => r.url))].sort(cmp);
    const secure = all.filter((u) => /^https:/i.test(u));
    const urls = secure.length > 0 ? secure : all;
    const url = urls.find(hasScopingQuery) ?? urls[0];
    // A copy with no year at all keeps the merged row undated: the year filter then
    // includes it, as it would have included that copy. Otherwise the span is the
    // hull of every copy's range (a one-sided copy counts as that single year), so
    // the merged row is included whenever any copy would have been.
    const anyUndated = group.some((r) => yearNum(r.startYear) === null && yearNum(r.endYear) === null);
    const starts = anyUndated ? [] : group.map((r) => yearNum(r.startYear) ?? (yearNum(r.endYear) as number));
    const ends = anyUndated ? [] : group.map((r) => yearNum(r.endYear) ?? (yearNum(r.startYear) as number));
    rows.push({
      key: id.split("\0")[1],
      url,
      link_text: first.linkText ?? "",
      record_types: [...new Set(group.map((r) => r.record_type ?? "").filter((t) => t !== ""))].sort(cmp),
      place: id.split("\0")[0],
      cost: first.cost ?? "",
      content_type: first.content_type ?? "",
      start_year: starts.length > 0 ? String(Math.min(...starts)) : "",
      end_year: ends.length > 0 ? String(Math.max(...ends)) : "",
    });
  }
  return rows.sort((a, b) => cmp(a.place, b.place) || cmp(a.key, b.key));
}

function isDoc(value: unknown): value is ExternalCollectionsDoc {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) &&
    typeof (value as { places?: unknown }).places === "object" &&
    (value as { places?: unknown }).places !== null &&
    !Array.isArray((value as { places?: unknown }).places)
  );
}

/**
 * The project's stored lists, or `null` when the file is absent. Throws (through
 * `readProjectJson`) on a missing argument, a missing directory, a folder that is
 * not a project (`NoProjectError`) or invalid JSON; throws a plain Error on JSON
 * that is not this file's shape.
 */
export async function readExternalCollections(projectPath: string): Promise<ExternalCollectionsDoc | null> {
  const cls = await classifyProjectPath(projectPath);
  if (cls === "project" && !(await fileExists(projectPath, EXTERNAL_COLLECTIONS_FILE))) return null;
  const doc = await readProjectJson(projectPath, EXTERNAL_COLLECTIONS_FILE);
  if (!isDoc(doc)) {
    throw new Error(`${EXTERNAL_COLLECTIONS_FILE} is not an object with a "places" object`);
  }
  return doc;
}

/**
 * Store one fetch: replace the entry of every place the rows carry, and make sure
 * the queried place has an entry (`rows: []` when no row carries it), so "fetched,
 * nothing specific to this place" differs from "never fetched". Returns `null`
 * without writing unless `projectPath` is a project — the file is never created in
 * another folder; else the places written, sorted. A file that does not parse, or
 * is not this file's shape, is rebuilt from this fetch (it is a cache of API data);
 * any other read failure throws, so a passing store error cannot wipe the other
 * places' lists.
 */
export async function recordExternalCollections(
  projectPath: string,
  queriedPlace: string,
  rows: StoredCollectionRow[],
): Promise<string[] | null> {
  if ((await classifyProjectPath(projectPath)) !== "project") return null;
  return withProjectLock(projectPath, async () => {
    let doc: ExternalCollectionsDoc = { places: {} };
    if (await fileExists(projectPath, EXTERNAL_COLLECTIONS_FILE)) {
      let parsed: unknown;
      try {
        parsed = await readProjectJson(projectPath, EXTERNAL_COLLECTIONS_FILE);
      } catch (e) {
        if (!(e instanceof InvalidProjectJsonError)) throw e;
      }
      if (isDoc(parsed)) doc = parsed;
    }
    const byPlace = new Map<string, StoredCollectionRow[]>();
    for (const r of rows) {
      const list = byPlace.get(r.place);
      if (list) list.push(r);
      else byPlace.set(r.place, [r]);
    }
    if (!byPlace.has(queriedPlace)) byPlace.set(queriedPlace, []);
    const places: ExternalCollectionsDoc["places"] = { ...doc.places };
    for (const [place, list] of byPlace) places[place] = { rows: list };
    const sorted: ExternalCollectionsDoc["places"] = {};
    for (const k of Object.keys(places).sort(cmp)) sorted[k] = places[k];
    await getProjectStore().writeJson(projectPath, EXTERNAL_COLLECTIONS_FILE, { places: sorted });
    return [...byPlace.keys()].sort(cmp);
  });
}
