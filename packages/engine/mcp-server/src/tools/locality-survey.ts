import type { Principal } from "../auth/principal.js";
import { getWikiApiUrl } from "../auth/config.js";
import { TOOL_RESULT_CHAR_BUDGET } from "../constants.js";
import { populationTool } from "./place-population.js";
import { collectionsSearchTool } from "./collections-search.js";
import { volumeSearchTool } from "./volume-search.js";
import { catalogSearchTool } from "./catalog-search.js";
import { externalLinkRows } from "./external-links-search.js";
import { findPlacePage, placeTypeOf, topicPageNamesOtherPlace } from "./wiki-place-page.js";
import { collectionNoticesFor, fetchPage, FS_WIKI_BASE } from "../utils/wiki-page-fetch.js";
import { stripWikiSidebar } from "../utils/wiki-sidebar.js";
import { recordExternalCollections, yearNum, type StoredCollectionRow } from "../utils/external-collections-store.js";
import { stageSearchResults } from "../utils/results-staging.js";
import type { CatalogHit } from "../types/catalog-search.js";
import type { VolumeGroup, VolumeRollup } from "../types/volume-search.js";
import type { WikiCollectionNotice, WikiPageSection } from "../types/wikiPage.js";
import type { LocalitySurveyInput, SurveyCall, SurveyDeps, SurveyPage } from "../types/locality-survey.js";

/** The survey answers inside the Cowork bridge's 60 s abort. */
export const SURVEY_DEADLINE_MS = 50_000;
/** Collection-notice lookups stop this long before the survey's deadline. */
const NOTICE_MARGIN_MS = 5_000;

/** The data parts' share of the inline answer, in stringified characters. */
const DATA_SHARES = { collections: 3_000, volumes: 3_500, catalog: 3_000, externalLinks: 2_500 } as const;
/** The vital-records page goes in first, up to this much. */
const VITAL_RECORDS_SHARE = 8_000;
/** How long the survey waits for the place's type before it decides on the parent level. */
const TYPE_LOOKUP_MS = 8_000;
/** Places API types at county level or larger: the survey does not also search their parent.
 *  `Parish` is Louisiana's county; an Irish or English `Civil Parish` is not. */
const COUNTY_OR_LARGER =
  /^(county|parish|borough|census area|state|province|territory|country|nation|kingdom|commonwealth|region|department|district|governorate|oblast|canton)$/i;
/** Below this, a section is left out rather than cut. */
const MIN_CUT = 600;

const SECTION_PAGES: WikiPageSection[] = ["getting_started", "online_records", "research_tips"];
const PAGE_SECTIONS: WikiPageSection[] = ["home", ...SECTION_PAGES];
const VITAL_SUFFIXES = ["Vital_Records", "Civil_Registration"];

/** Headings the saved guides never drew on (28% of wiki text over 112 pages from 17 places). */
const SKIP_HEADING =
  /\b(references?|sources?|footnotes?|notes|see also|contents|navigation|categories|populated places|cities and towns|towns and villages|communities|how to (research|use|find|search)|research strategy|wiki articles|help us|contributors?)\b/i;
/** Headings that name a record type of the guide's template. */
const RECORD_HEADING =
  /\b(vital|civil registration|births?|marriages?|deaths?|church|parish|religio|census|probate|wills?|court|land|propert|deeds?|military|cemeter|burial|newspaper|obituar|immigra|emigra|naturali|passenger|tax|record|archive|librar|online|getting started|research tips|jurisdiction|boundar|history)\b/i;

// ---------- place names ----------

/** The delegated string without a trailing ` (Type)`. */
export function placeName(standardPlace: string): string {
  return standardPlace.trim().replace(/\s*\([^()]*\)\s*$/, "").trim();
}

function partsOf(name: string): string[] {
  return name.split(",").map((p) => p.trim()).filter(Boolean);
}

/** Every enclosing place of `name`, nearest first: "A, B, C" → ["B, C", "C"]. */
function ancestors(name: string): string[] {
  const parts = partsOf(name);
  return parts.slice(1).map((_, i) => parts.slice(i + 1).join(", "));
}

/** The parent a data part also runs at, or null when there is none or it is a country. */
export function parentLevel(standardPlace: string): string | null {
  const parent = ancestors(placeName(standardPlace))[0];
  return parent && partsOf(parent).length > 1 ? parent : null;
}

/** The two-part state/country level (or the country), then the country, without repeats. */
function sectionLevels(name: string): string[] {
  const parts = partsOf(name);
  const levels = parts.length >= 2 ? [parts.slice(-2).join(", "), parts[parts.length - 1]] : [...parts];
  return [...new Set(levels)];
}

function slug(name: string): string {
  return name.trim().replace(/ /g, "_");
}

/** `{J}_Vital_Records` then `{J}_Civil_Registration`, J the two-part level's leaf then the country. */
function vitalRecordsUrls(name: string): string[] {
  const parts = partsOf(name);
  const leaves = [...new Set([parts.length >= 2 ? parts[parts.length - 2] : null, parts[parts.length - 1]])];
  return leaves
    .filter((l): l is string => !!l)
    .flatMap((leaf) => VITAL_SUFFIXES.map((s) => `${FS_WIKI_BASE}/${slug(leaf)}_${s}`));
}

/** Every call the survey could make for `input`, climbs included. */
export function surveyCallPlan(input: LocalitySurveyInput): SurveyCall[] {
  const { standardPlace, startYear, endYear } = input;
  const name = placeName(standardPlace);
  const years = { ...(startYear != null ? { startYear } : {}), ...(endYear != null ? { endYear } : {}) };
  const parent = parentLevel(standardPlace);
  const levels = [standardPlace, ...(parent ? [parent] : [])];
  const calls: SurveyCall[] = [
    ...[standardPlace, ...ancestors(name)].map(
      (p): SurveyCall => ({ tool: "place_population", args: { standardPlace: p, ...years } }),
    ),
    { tool: "collections_search", args: { standardPlace: name, ...years } },
    ...levels.map((p): SurveyCall => ({ tool: "volume_search", args: { standardPlace: p, ...years, summary: true } })),
    ...[standardPlace, ...ancestors(name).slice(0, 1)].map(
      (p): SurveyCall => ({ tool: "catalog_search", args: { standardPlace: p } }),
    ),
    ...levels.map((p): SurveyCall => ({ tool: "external_links_search", args: { standardPlace: p } })),
    ...[standardPlace, ...ancestors(name)].map(
      (p): SurveyCall => ({ tool: "wiki_place_page", args: { standardPlace: p, section: "home" } }),
    ),
    ...SECTION_PAGES.flatMap((section) =>
      sectionLevels(name).map((p): SurveyCall => ({ tool: "wiki_place_page", args: { standardPlace: p, section } })),
    ),
    ...vitalRecordsUrls(name).map((url): SurveyCall => ({ tool: "wiki_read", args: { url } })),
  ];
  const seen = new Set<string>();
  return calls.filter((c) => {
    const key = JSON.stringify(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------- deadlines ----------

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** `run()` against the survey clock: its value, its thrown error, or "timed out". */
async function settle<T>(run: () => Promise<T>, deadlineAt: number, now: () => number): Promise<Settled<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Settled<T>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: "timed out" }), Math.max(0, deadlineAt - now()));
  });
  const work = (async (): Promise<Settled<T>> => {
    try {
      return { ok: true, value: await run() };
    } catch (e) {
      return { ok: false, error: message(e) };
    }
  })();
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Climb `levels` until `use` accepts an answer. The last error, or "none found". */
async function climb<T>(
  levels: string[],
  fetch: (level: string) => Promise<T>,
  use: (value: T) => boolean,
  deadlineAt: number,
  now: () => number,
): Promise<{ level: string; value: T } | { error: string; missing?: true }> {
  let lastError: string | null = null;
  for (const level of levels) {
    if (now() >= deadlineAt) return { error: "timed out" };
    const got = await settle(() => fetch(level), deadlineAt, now);
    if (!got.ok) {
      if (got.error === "timed out") return { error: "timed out" };
      lastError = got.error;
      continue;
    }
    if (use(got.value)) return { level, value: got.value };
  }
  return lastError ? { error: lastError } : { error: "none found", missing: true };
}

// ---------- sizing ----------

function size(value: unknown): number {
  return JSON.stringify(value).length;
}

/** The leading rows of `rows` that fit `budget` stringified characters. */
function fitRows<T>(rows: T[], budget: number): { kept: T[]; omitted: number } {
  const kept: T[] = [];
  let used = 2;
  for (const row of rows) {
    const s = size(row) + 1;
    if (used + s > budget) break;
    kept.push(row);
    used += s;
  }
  return { kept, omitted: rows.length - kept.length };
}

// ---------- wiki sections ----------

interface Section {
  page: number;
  order: number;
  heading: string | null;
  text: string;
  start: number;
  rank: number;
}

const HEADING_LINE = /^#{1,3}[ \t]+(\S.*?)[ \t]*$/;

/** A page's text split at its `#`–`###` lines; the text before the first is its opening. */
export function splitSections(text: string, page = 0): Section[] {
  const out: Section[] = [];
  let start = 0;
  let heading: string | null = null;
  let order = 0;
  let pos = 0;
  const push = (end: number) => {
    const body = text.slice(start, end);
    if (body.trim()) {
      const rank = heading === null ? 3 : SKIP_HEADING.test(heading) ? -1 : RECORD_HEADING.test(heading) ? 2 : 1;
      out.push({ page, order: order++, heading, text: body, start, rank });
    }
  };
  for (const line of text.split("\n")) {
    const m = HEADING_LINE.exec(line);
    if (m && pos > 0) {
      push(pos);
      start = pos;
      heading = m[1].replace(/[*_]/g, "").trim();
    } else if (m) {
      heading = m[1].replace(/[*_]/g, "").trim();
      if (/^#[ \t]/.test(line)) heading = null;
    }
    pos += line.length + 1;
  }
  push(text.length);
  return out;
}

/** `text` cut to about `budget` stringified characters at a line end (mid-line when one line is
 *  longer than that). */
function cutText(text: string, budget: number): string {
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (size(text.slice(0, mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  const head = text.slice(0, lo);
  const nl = head.lastIndexOf("\n");
  return nl > lo / 2 ? head.slice(0, nl + 1) : head;
}

interface PageOut {
  url: string | null;
  found: boolean;
  outcome?: "unreachable";
  error?: string;
  totalChars?: number;
  content?: string;
  omitted?: string[];
  collectionNotices?: WikiCollectionNotice[];
}

interface LoadedPage {
  key: string;
  url: string;
  text: string;
  notices: WikiCollectionNotice[];
}

/**
 * The pages' text, kept best-first within `budget`: the vital-records page first up to its
 * share, then every other page's opening, then record-type sections, then the rest; skip-list
 * sections never. Returns each page's content in page order and the headings left out.
 */
function choosePageText(
  pages: LoadedPage[],
  budget: number,
): Map<string, { content: string; omitted: string[] }> {
  const out = new Map<string, { content: string; omitted: string[] }>();
  const kept = new Map<number, { section: Section; text: string; cutNote?: string }[]>();
  const omitted = new Map<number, string[]>();
  let left = budget;
  const all = pages.flatMap((p, i) => splitSections(p.text, i));
  const take = (s: Section, room: number): number => {
    const page = pages[s.page];
    let text = s.text;
    let cutNote: string | undefined;
    if (size(text) > room) {
      if (room < MIN_CUT) return 0;
      text = cutText(text, room - 160);
      const stop = s.start + text.length;
      cutNote = `[cut at offset ${stop} of ${page.url}; wiki_read it with offset ${stop} to read on]`;
    }
    const list = kept.get(s.page) ?? [];
    list.push({ section: s, text, cutNote });
    kept.set(s.page, list);
    return size(text) + (cutNote ? size(cutNote) : 0);
  };
  const vital = pages.findIndex((p) => p.key === "vitalRecords");
  if (vital >= 0) {
    let room = Math.min(VITAL_RECORDS_SHARE, left);
    for (const s of all.filter((x) => x.page === vital && x.rank >= 0)) {
      const used = take(s, room);
      if (!used) break;
      room -= used;
      left -= used;
    }
  }
  const rest = all
    .filter((s) => s.page !== vital && s.rank >= 0)
    .sort((a, b) => b.rank - a.rank || a.page - b.page || a.order - b.order);
  for (const s of rest) {
    if (left < MIN_CUT) break;
    left -= take(s, left);
  }
  for (const s of all) {
    const isKept = (kept.get(s.page) ?? []).some((k) => k.section === s);
    if (!isKept && s.heading) {
      const list = omitted.get(s.page) ?? [];
      list.push(s.heading);
      omitted.set(s.page, list);
    }
  }
  pages.forEach((p, i) => {
    const list = (kept.get(i) ?? []).sort((a, b) => a.section.order - b.section.order);
    const content = list.map((k) => k.text.trimEnd() + (k.cutNote ? `\n${k.cutNote}` : "")).join("\n\n");
    out.set(p.key, { content, omitted: omitted.get(i) ?? [] });
  });
  return out;
}

// ---------- rows ----------

function compactVolume(v: VolumeGroup) {
  return {
    imageGroupNumber: v.imageGroupNumber,
    ...(v.title ? { title: v.title } : {}),
    imageCount: v.imageCount,
    recordSearchablePercent: v.recordSearchablePercent,
    fulltextSearchable: v.fulltextSearchable,
    ...(v.languages.length ? { languages: v.languages } : {}),
    coverages: v.coverages.slice(0, 2),
  };
}

function compactHit(h: CatalogHit) {
  return {
    ...(h.id ? { id: h.id } : {}),
    title: h.title,
    ...(h.creator ? { creator: h.creator } : {}),
    repositoryCalls: h.repositoryCalls,
    ...(h.subjects?.length ? { subjects: h.subjects.slice(0, 2) } : {}),
    ...(h.notes?.length ? { notes: h.notes.slice(0, 1).map((n) => n.slice(0, 300)) } : {}),
    ...(h.filmNotes?.length ? { filmNotes: h.filmNotes.slice(0, 2), filmNotesTotal: h.filmNotes.length } : {}),
  };
}

const LINK_RECORD_TYPE =
  /vital|birth|marriage|death|church|parish|census|probate|will|court|land|property|military|cemetery|burial|newspaper|obituar|immigra|emigra|naturali|passenger|tax/i;

function overlaps(row: StoredCollectionRow, startYear?: number, endYear?: number): boolean {
  const s = yearNum(row.start_year);
  const e = yearNum(row.end_year);
  if (s === null && e === null) return true;
  const lo = s ?? (e as number);
  const hi = e ?? (s as number);
  return lo <= (endYear ?? Infinity) && hi >= (startYear ?? -Infinity);
}

/** Links matching a template record type and the period first, then the most specific place. */
function rankLinks(rows: StoredCollectionRow[], startYear?: number, endYear?: number): StoredCollectionRow[] {
  const score = (r: StoredCollectionRow) =>
    (r.record_types.some((t) => LINK_RECORD_TYPE.test(t)) || LINK_RECORD_TYPE.test(r.link_text) ? 2 : 0) +
    (overlaps(r, startYear, endYear) ? 1 : 0);
  return rows
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        score(b.r) - score(a.r) || partsOf(b.r.place).length - partsOf(a.r.place).length || a.i - b.i,
    )
    .map((x) => x.r);
}

function compactLink(r: StoredCollectionRow) {
  const s = yearNum(r.start_year);
  const e = yearNum(r.end_year);
  return {
    url: r.url,
    linkText: r.link_text,
    ...(r.record_types.length ? { recordTypes: r.record_types } : {}),
    place: r.place,
    ...(s !== null || e !== null ? { years: `${s ?? e}-${e ?? s}` } : {}),
  };
}

function snakeSummary(s: VolumeRollup, startYear?: number, endYear?: number) {
  return {
    ...(startYear != null ? { start_year: startYear } : {}),
    ...(endYear != null ? { end_year: endYear } : {}),
    total_volumes: s.totalVolumes,
    complete: s.complete,
    by_record_type: s.byRecordType.map((b) => ({
      group: b.group,
      volumes: b.volumes,
      browse_only: b.browseOnly,
      fulltext_only: b.fulltextOnly,
    })),
    untyped: { volumes: s.untyped.volumes, browse_only: s.untyped.browseOnly, fulltext_only: s.untyped.fulltextOnly },
  };
}

// ---------- the survey ----------

/**
 * Runs the locality-guide Step-3 survey for one place: population, collections, volumes (the
 * place and its parent), catalog (climbing once on no hits), curated external links (the place
 * and its parent), the four wiki place pages and the vital-records page, all against one 50 s
 * clock. Returns an answer under the tool-result budget; with `projectPath` the whole answer is
 * staged and its ref returned. docs/specs/locality-survey-tool-spec.md.
 */
export async function runLocalitySurvey(
  input: LocalitySurveyInput,
  deps: SurveyDeps,
): Promise<Record<string, unknown>> {
  const standardPlace = typeof input.standardPlace === "string" ? input.standardPlace.trim() : "";
  if (!standardPlace) {
    throw new Error("standardPlace is required: pass the standardPlace from place_search.");
  }
  const startYear = input.startYear != null ? Number(input.startYear) : undefined;
  const endYear = input.endYear != null ? Number(input.endYear) : undefined;
  if ((startYear != null && !Number.isInteger(startYear)) || (endYear != null && !Number.isInteger(endYear))) {
    throw new Error("startYear and endYear must be whole years.");
  }
  if (startYear != null && endYear != null && endYear < startYear) {
    throw new Error("endYear must be greater than or equal to startYear.");
  }
  const now = deps.now ?? Date.now;
  const deadlineAt = now() + (deps.deadlineMs ?? SURVEY_DEADLINE_MS);
  const noticesBy = deadlineAt - Math.min(NOTICE_MARGIN_MS, (deps.deadlineMs ?? SURVEY_DEADLINE_MS) / 10);
  const name = placeName(standardPlace);
  const years = { ...(startYear != null ? { startYear } : {}), ...(endYear != null ? { endYear } : {}) };
  const parentCandidate = parentLevel(standardPlace);

  const population = climb(
    [standardPlace, ...ancestors(name)],
    (p) => deps.population({ standardPlace: p, ...years }),
    (r) => Object.values(r.population ?? {}).some((src) => (src.data ?? []).length > 0),
    deadlineAt,
    now,
  );
  const collections = settle(() => deps.collections({ standardPlace: name, ...years }), deadlineAt, now);
  const levels = [standardPlace];
  if (parentCandidate) {
    const type = deps.placeType
      ? await settle(() => deps.placeType!(standardPlace), Math.min(deadlineAt, now() + TYPE_LOOKUP_MS), now)
      : null;
    if (!(type?.ok && type.value && COUNTY_OR_LARGER.test(type.value.trim()))) levels.push(parentCandidate);
  }
  const volumes = Promise.all(
    levels.map((p) => settle(() => deps.volumes({ standardPlace: p, ...years, summary: true }), deadlineAt, now)),
  );
  const catalog = (async () => {
    const first = await settle(() => deps.catalog({ standardPlace }), deadlineAt, now);
    const out = [{ place: standardPlace, got: first }];
    const up = ancestors(name)[0];
    if (first.ok && first.value.totalHits === 0 && up) {
      out.push({ place: up, got: await settle(() => deps.catalog({ standardPlace: up }), deadlineAt, now) });
    }
    return out;
  })();
  const links = Promise.all(levels.map((p) => settle(() => deps.linkRows(p), deadlineAt, now)));
  const home = climb(
    [standardPlace, ...ancestors(name)],
    async (p) => deps.placePage(p, "home", noticesBy),
    (page) => page !== null,
    deadlineAt,
    now,
  );
  const sections = Promise.all(
    SECTION_PAGES.map((section) =>
      climb(sectionLevels(name), async (p) => deps.placePage(p, section, noticesBy), (page) => page !== null, deadlineAt, now),
    ),
  );
  const vital = climb(
    vitalRecordsUrls(name),
    async (url) => deps.page(url, noticesBy),
    (page) => page !== null && !topicPageNamesOtherPlace(page.content, name),
    deadlineAt,
    now,
  );

  const [popR, colR, volR, catR, linkR, homeR, secR, vitalR] = await Promise.all([
    population, collections, volumes, catalog, links, home, sections, vital,
  ]);

  // External links: each level stored with its own rows, only when it settled in time.
  if (deps.recordLinks) {
    for (const [i, got] of linkR.entries()) {
      if (!got.ok) continue;
      try {
        if ("tooLarge" in got.value) await deps.recordLinks(levels[i], [], true);
        else await deps.recordLinks(levels[i], got.value.rows, false);
      } catch {
        // A failed store never fails the survey; the inline answer still carries the links.
      }
    }
  }

  // ----- full answer (staged) and inline parts -----
  const errorOf = (e: string) => e.replace(/ Pass one of these exactly as listed[\s\S]*$/, "").replace(/ Use place_search[\s\S]*$/, "");

  const populationPart =
    "error" in popR
      ? { error: popR.error }
      : {
          place: popR.level,
          figures: Object.values(popR.value.population ?? {})
            .flatMap((s) => s.data ?? [])
            .map((d) => ({ year: d.year, population: d.population }))
            .sort((a, b) => a.year - b.year),
        };

  const collectionsFull = colR.ok ? colR.value : null;
  const collectionRows = collectionsFull ? [...collectionsFull.results].sort((a, b) => b.personCount - a.personCount) : [];

  const seenGroups = new Set<string>();
  const volumeLevels = volR.map((got, i) => {
    if (!got.ok) return { place: levels[i], error: errorOf(got.error) };
    const v = got.value;
    const results = v.results.filter((g) => {
      if (seenGroups.has(g.imageGroupNumber)) return false;
      seenGroups.add(g.imageGroupNumber);
      return true;
    });
    return {
      place: levels[i],
      totalResults: v.totalResults,
      ...(v.summary ? { summary: v.summary } : {}),
      ...(v.summaryError ? { summaryError: v.summaryError } : {}),
      results,
    };
  });
  const own = volR[0];
  const volumeSummary = own.ok && own.value.summary ? snakeSummary(own.value.summary, startYear, endYear) : null;

  const catalogLevels = catR.map(({ place, got }) =>
    got.ok ? { place, totalHits: got.value.totalHits, hits: got.value.hits } : { place, error: errorOf(got.error) },
  );

  const seenUrls = new Set<string>();
  const linkRows: StoredCollectionRow[] = [];
  const linkLevels = linkR.map((got, i) => {
    if (!got.ok) return { place: levels[i], error: errorOf(got.error) };
    if ("tooLarge" in got.value) {
      return { place: levels[i], error: `${got.value.tooLarge} curated links, too many to list` };
    }
    for (const r of got.value.rows) {
      if (seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);
      linkRows.push(r);
    }
    return { place: levels[i], total: got.value.rows.length };
  });
  const rankedLinks = rankLinks(linkRows, startYear, endYear);

  const loaded: LoadedPage[] = [];
  const pageMeta = new Map<string, PageOut>();
  const addPage = (key: string, r: { level: string; value: SurveyPage | null } | { error: string; missing?: true }) => {
    if ("error" in r) {
      pageMeta.set(key, r.missing ? { url: null, found: false } : { url: null, found: false, outcome: "unreachable", error: r.error });
      return;
    }
    const page = r.value as SurveyPage;
    const text = stripWikiSidebar(page.content);
    loaded.push({ key, url: page.url, text, notices: page.collectionNotices ?? [] });
    pageMeta.set(key, { url: page.url, found: true, totalChars: text.length });
  };
  addPage("vitalRecords", vitalR);
  addPage("home", homeR);
  SECTION_PAGES.forEach((s, i) => addPage(s, secR[i]));

  const pagesRead = PAGE_SECTIONS.map((section) => {
    const m = pageMeta.get(section) as PageOut;
    return { section, url: m.url, found: m.found, ...(m.outcome ? { outcome: m.outcome } : {}) };
  });

  const notices: WikiCollectionNotice[] = [];
  const noticeUrls = new Set<string>();
  for (const p of loaded) {
    for (const n of p.notices) {
      if (noticeUrls.has(n.url)) continue;
      noticeUrls.add(n.url);
      notices.push(n);
    }
  }

  const full: Record<string, unknown> = {
    place: standardPlace,
    ...(startYear != null || endYear != null ? { period: years } : {}),
    population: populationPart,
    collections: collectionsFull
      ? { collectionUrl: collectionsFull.collectionUrl, scope: collectionsFull.scope, totalForPlace: collectionsFull.totalForPlace, results: collectionRows }
      : { error: errorOf((colR as { error: string }).error) },
    volumes: { levels: volumeLevels },
    catalog: { levels: catalogLevels },
    externalLinks: { levels: linkLevels, results: rankedLinks.map(compactLink) },
    wikiPages: Object.fromEntries(
      ["home", ...SECTION_PAGES].map((k) => {
        const p = loaded.find((x) => x.key === k);
        return [k, { ...pageMeta.get(k), ...(p ? { content: p.text } : {}) }];
      }),
    ),
    vitalRecords: { ...pageMeta.get("vitalRecords"), ...(loaded.find((x) => x.key === "vitalRecords") ? { content: loaded.find((x) => x.key === "vitalRecords")!.text } : {}) },
    collectionNotices: notices,
    pagesRead,
    volumeSummary,
  };

  // ----- inline answer -----
  const colFit = fitRows(collectionRows, DATA_SHARES.collections);
  const perLevel = Math.floor(DATA_SHARES.volumes / Math.max(1, volumeLevels.length));
  const volInline = volumeLevels.map((l) => {
    if (!("results" in l)) return l;
    const fit = fitRows(l.results.map(compactVolume), perLevel);
    return { ...l, results: fit.kept, ...(fit.omitted ? { omitted: fit.omitted } : {}) };
  });
  const perCat = Math.floor(DATA_SHARES.catalog / Math.max(1, catalogLevels.length));
  const catInline = catalogLevels.map((l) => {
    if (!("hits" in l)) return l;
    const fit = fitRows((l.hits ?? []).map(compactHit), perCat);
    return { ...l, hits: fit.kept, ...(fit.omitted ? { omitted: fit.omitted } : {}) };
  });
  const linkFit = fitRows(rankedLinks.map(compactLink), DATA_SHARES.externalLinks);

  const inline: Record<string, any> = {
    place: standardPlace,
    ...(startYear != null || endYear != null ? { period: years } : {}),
    population: populationPart,
    collections: collectionsFull
      ? {
          collectionUrl: collectionsFull.collectionUrl,
          scope: collectionsFull.scope,
          totalForPlace: collectionsFull.totalForPlace,
          results: colFit.kept,
          ...(colFit.omitted ? { omitted: colFit.omitted } : {}),
        }
      : full.collections,
    volumes: { levels: volInline },
    catalog: { levels: catInline },
    externalLinks: { levels: linkLevels, results: linkFit.kept, ...(linkFit.omitted ? { omitted: linkFit.omitted } : {}) },
    wikiPages: Object.fromEntries(["home", ...SECTION_PAGES].map((k) => [k, { ...pageMeta.get(k), content: "", omitted: [] as string[] }])),
    vitalRecords: { ...pageMeta.get("vitalRecords"), content: "", omitted: [] as string[] },
    ...(notices.length ? { collectionNotices: notices } : {}),
    pagesRead,
    volumeSummary,
  };

  if (deps.stage) {
    try {
      const ref = await deps.stage(full);
      if (ref) inline.staged = { resultsRef: ref };
    } catch (e) {
      inline.stagingError = message(e);
    }
  }

  const slotOf = (key: string) => (key === "vitalRecords" ? inline.vitalRecords : inline.wikiPages[key]);
  const place = (share: number) => {
    const chosen = choosePageText(loaded, Math.max(0, share));
    for (const key of ["vitalRecords", ...PAGE_SECTIONS]) {
      const slot = slotOf(key);
      const c = chosen.get(key);
      if (!slot.found || !c) {
        delete slot.content;
        delete slot.omitted;
        continue;
      }
      slot.content = c.content;
      if (c.omitted.length) slot.omitted = c.omitted;
      else delete slot.omitted;
    }
  };
  // The headings a page could leave out are counted before its text, so naming them never
  // pushes the answer over.
  const headingReserve = size(loaded.map((p) => splitSections(p.text).flatMap((x) => (x.heading ? [x.heading] : []))));
  let share = TOOL_RESULT_CHAR_BUDGET - size(inline) - headingReserve;
  place(share);
  // Backstop: rank again into a smaller share, then drop the data parts' last rows.
  for (let guard = 0; size(inline) > TOOL_RESULT_CHAR_BUDGET && guard < 50; guard++) {
    const over = size(inline) - TOOL_RESULT_CHAR_BUDGET;
    if (share > 0) {
      share -= over + 200;
      place(share);
      continue;
    }
    const lists = [
      inline.externalLinks.results,
      ...inline.catalog.levels.map((l: any) => l.hits).filter(Boolean),
      ...inline.volumes.levels.map((l: any) => l.results).filter(Boolean),
      inline.collections.results,
    ].filter((l: unknown[] | undefined): l is unknown[] => Array.isArray(l) && l.length > 0);
    if (!lists.length) break;
    lists[0].splice(Math.max(0, lists[0].length - Math.ceil(over / 150)));
  }
  return inline;
}

/** The live dependencies, bound to one principal. */
export function liveSurveyDeps(principal: Principal, projectPath?: string): SurveyDeps {
  const base = () => getWikiApiUrl(principal);
  const withNotices = async (url: string, content: string, noticesBy: number): Promise<SurveyPage> => ({
    url,
    content,
    collectionNotices: await collectionNoticesFor(stripWikiSidebar(content), await base(), noticesBy),
  });
  return {
    population: (args) => populationTool(args, principal),
    collections: (args) => collectionsSearchTool(args, principal),
    volumes: (args) => volumeSearchTool(args, principal),
    catalog: (args) => catalogSearchTool(args, principal),
    linkRows: (place) => externalLinkRows(place),
    placeType: (place) => placeTypeOf(place),
    placePage: async (place, section, noticesBy) => {
      const hit = await findPlacePage(place, section, await base());
      if (!hit || typeof hit.content !== "string") return null;
      return withNotices(hit.url, hit.content, noticesBy);
    },
    page: async (url, noticesBy) => {
      const slugOf = decodeURIComponent(url.slice(FS_WIKI_BASE.length + 1));
      const page = await fetchPage(await base(), slugOf);
      if (!page || typeof page.content !== "string") return null;
      return withNotices(url, page.content, noticesBy);
    },
    ...(projectPath !== undefined
      ? {
          recordLinks: async (place, rows, tooLarge) => {
            await recordExternalCollections(projectPath, place, rows, tooLarge ? { tooLarge: true } : {});
          },
          stage: async (answer) => {
            const handle = await stageSearchResults({
              projectPath,
              tool: "locality_survey",
              response: { query: { standardPlace: answer.place, ...(answer.period ?? {}) }, results: [answer] },
            });
            return handle?.resultsRef ?? null;
          },
        }
      : {}),
  };
}

export async function localitySurveyTool(input: LocalitySurveyInput, principal: Principal) {
  return runLocalitySurvey(input, liveSurveyDeps(principal, input.projectPath));
}

export const localitySurveySchema = {
  name: "locality_survey",
  description:
    "Survey what records exist for one place and period, in one call: population, FamilySearch " +
    "record collections, digitized volumes (the place and its parent), Catalog entries (climbing one " +
    "level when the place has none), curated outside links (the place and its parent), the four " +
    "FamilySearch Wiki place pages (home, getting started, online records, research tips) and the " +
    "vital-records or civil-registration page. Pass the standardPlace from place_search as delegated " +
    "and the years. Each part is its own answer or { error }. Wiki text is chosen for the guide " +
    "(each page's opening, then its record-type sections) and the headings left out are named; " +
    "wiki_read a page's url, with an offset, to read more. `pagesRead` and `volumeSummary` are the " +
    "localities fields. With projectPath the whole answer is staged: pass `staged.resultsRef` to " +
    "research_append as `surveyRef`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      standardPlace: {
        type: "string",
        description: "The standardPlace from place_search, as delegated (a village, town, county, state or country).",
      },
      startYear: { type: "integer", description: "First year of the period." },
      endYear: { type: "integer", description: "Last year of the period." },
      projectPath: {
        type: "string",
        description: "The project folder. Stages the whole answer and stores the outside links. Omit with no project.",
      },
    },
    required: ["standardPlace"],
  },
};
