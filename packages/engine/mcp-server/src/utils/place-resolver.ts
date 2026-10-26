/**
 * Shared place resolver — the single home for converting between a
 * `standardPlace` (a fully-qualified standardized place NAME) and the
 * FamilySearch identifiers it maps to (placeRepId, placeId).
 *
 * Above the MCP tool layer everything is a `standardPlace` name; the raw
 * `placeId` / `placeRepId` identifiers live only here, behind a bidirectional
 * in-process cache so repeated lookups don't re-hit FamilySearch.
 *
 * Naming (see docs/plan/standard-place-standardization.md §2): camelCase
 * `standardPlace` is the code-surface spelling (this module, tool inputs, the
 * place_search struct). The snake_case `standard_place` form appears only in
 * the SimplifiedGedcomX / research.json data formats.
 *
 * This module builds on the low-level FamilySearch places fetchers in
 * `./place-api.ts` (`searchPlace`, `getPlaceById`, `getPlaceRepIds`) — a
 * dedicated low-level layer that both this resolver and `tools/place-search.ts`
 * import from, so the raw HTTP lives below the tool layer (no util→tool
 * dependency). All of those endpoints are anonymous (no auth), so the
 * process-wide caches here carry no user-scoped data and are safe to share.
 */
import {
  searchPlace,
  getPlaceById,
  getPlaceRepIds,
  getPlaceCandidateNames,
} from "./place-api.js";
import { stdDate } from "./date-standardize.js";
import { earliestYear, latestYear } from "./date-helpers.js";

// Element types of the existing fetchers, without needing their (unexported)
// interfaces — keeps this module in lockstep with place-search.ts.
type SearchEntry = Awaited<ReturnType<typeof searchPlace>>[number];

interface RepInfo {
  standardPlace: string;
  placeId?: string;
  latitude?: number;
  longitude?: number;
  /** When the representation is valid: FamilySearch's formal range
   *  ("+1830/", "/+1795", "+1815/+1830"); absent when it is valid at every date. */
  dateRange?: string;
}

export interface ResolveOpts {
  /**
   * Higher-level place used to disambiguate (e.g. "Idaho"), matched as a
   * case-insensitive substring of each candidate's full name.
   */
  contextName?: string;
  /**
   * The date of the fact/event. Used by `resolveStandardPlace`: its year is
   * sent as FamilySearch's `+date:+YYYY` query qualifier so scoring is
   * restricted to the place representations that existed then. Jurisdictions
   * move, so an undated query returns the modern rep ("Rochdale, England" ->
   * Greater Manchester, a county created in 1974, rather than Lancashire).
   * Any date string `stdDate` understands; unparseable dates degrade to an
   * undated query. The other resolvers still ignore it (plan §11 step 2,
   * partially wired).
   */
  date?: string;
  /**
   * Other place texts from the same source (the record's other facts). Used
   * only for a bare single-segment input, which carries no context of its own:
   * a sibling place that spells the name out is resolved instead, else the
   * search is confined to the jurisdiction the siblings share. See
   * `resolveBareName`.
   */
  contextPlaces?: string[];
}

// ─── Caches ────────────────────────────────────────────────────────────────
// In-process Maps, no TTL — mirrors place-search.ts's placeSearchCache and
// respects "no cross-session host storage" (CLAUDE.md). The persisted
// standardPlace strings in research.json / tree.gedcomx.json are the real
// cross-session cache.

/** `${originalText}|${year ?? ""}` (normalized) -> standardPlace | null. The
 *  year is part of the key because the same place resolves differently at
 *  different dates. Caches DEFINITIVE 0-candidate negatives only; transient
 *  (retry-exhausted) failures are never cached, so a network blip doesn't
 *  poison the cache. */
const standardizeCache = new Map<string, string | null>();
/** standardPlace name (normalized) -> placeRepId | null. */
const nameToRepIdCache = new Map<string, string | null>();
/** placeRepId -> resolved info (standardPlace, placeId, coords). */
const repInfoCache = new Map<string, RepInfo | null>();
/** placeId -> all placeRepIds for that spot over time. */
const placeIdRepsCache = new Map<string, string[]>();
/** Internal memo of raw search results, so the resolver fns above don't
 *  re-issue the same search. Key: `${name}|${contextName}|${year ?? ""}`
 *  (normalized) — a dated and an undated search of one place are different
 *  queries and must not share an entry. */
const searchEntriesCache = new Map<string, SearchEntry[]>();

/** Test-only: when set, `resolveStandardPlace` answers from this table (keyed
 *  by the place text, normalized) and never reaches the network; a place not in
 *  it resolves to null. The eval harness sets it from the test's own
 *  `place_search` fixtures so a live `project_create` stays offline. */
let placeTableForTests: Map<string, string | null> | null = null;

/** Test-only: install (or, with null, remove) the table above. */
export function __usePlaceTableForTests(table: Record<string, string | null> | null): void {
  placeTableForTests =
    table === null ? null : new Map(Object.entries(table).map(([k, v]) => [normalizeKey(k), v]));
}

/** Test-only: clear every cache so cases don't bleed into each other. */
export function __clearPlaceResolverCachesForTests(): void {
  standardizeCache.clear();
  nameToRepIdCache.clear();
  repInfoCache.clear();
  placeIdRepsCache.clear();
  searchEntriesCache.clear();
}

// ─── Generic helpers ─────────────────────────────────────────────────────────

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** `normalizeKey` with diacritics folded: "Parácuaro" and "Paracuaro" compare
 *  equal. */
function foldPlaceName(s: string): string {
  return normalizeKey(s).normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/** Letters NFD leaves whole, so `\p{Diacritic}` cannot strip them. */
const UNDECOMPOSED_LETTERS: Record<string, string> = {
  "ø": "o", "æ": "ae", "œ": "oe", "ß": "ss", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i",
};

/** Abbreviations spelled out on both sides of `checkFirstPlace`'s compare. */
const NAME_ABBREVIATIONS: Record<string, string> = {
  st: "saint", ste: "sainte", mt: "mount", ft: "fort", pt: "point",
};

/** `foldPlaceName`, looser still, for `checkFirstPlace`'s name compare: "St Louis"
 *  is "St. Louis", "Sondre Land" is "Søndre Land", "Saint Jean" is "Saint-Jean",
 *  "Mt. Vernon" is "Mount Vernon". Measured live 2026-10-21: each was refused
 *  without it. A period is dropped, so "D.C." meets FamilySearch's "Washington
 *  DC"; `withoutTypeWords` is what splits "St.Louis" at the period. */
function placeNameKey(s: string): string {
  return foldPlaceName(s)
    .replace(/[øæœßłđðþı]/g, (c) => UNDECOMPOSED_LETTERS[c])
    .replace(/['\u2019]/g, "")
    .replace(/\./g, "")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => NAME_ABBREVIATIONS[w] ?? w)
    .join(" ");
}

/** The keys `checkFirstPlace` compares a name by: as written, and without type
 *  words (which also splits a word at a period or hyphen). */
function placeNameKeys(name: string): string[] {
  return [placeNameKey(name), placeNameKey(withoutTypeWords(name))];
}

/** Words that name a jurisdiction's TYPE, not the place: "Stagstrup Sogn" is
 *  Stagstrup, "Co. Cork" is Cork, "Landkreis Soltau" is Soltau. Compared as
 *  `placeNameKey` output, so "Co." arrives as "co". */
const JURISDICTION_TYPE_WORDS: ReadonlySet<string> = new Set([
  "parish", "sogn", "prestegjeld", "herred", "amt", "county", "co", "landkreis", "kreis",
  "township", "twp", "municipality", "kommune", "socken", "forsamling", "kirchspiel",
  "pfarrei", "borough", "district",
]);

/** A name with any administrative "X of" prefix and any leading or trailing type
 *  word removed, never down to nothing. Works on the raw words, so the result can
 *  be searched again; a period with no space after it, or a hyphen, ends a word
 *  ("Co.Cork", "Stagstrup-Sogn"). */
function withoutTypeWords(name: string): string {
  let words = name.replace(/\.(?=\S)/g, ". ").trim().split(/[\s-]+/);
  if (words.length > 2 && ADMIN_PREFIX_RE.test(placeNameKey(words.slice(0, 2).join(" ")) + " ")) {
    words = words.slice(2);
  }
  while (words.length > 1 && JURISDICTION_TYPE_WORDS.has(placeNameKey(words[words.length - 1]))) words.pop();
  while (words.length > 1 && JURISDICTION_TYPE_WORDS.has(placeNameKey(words[0]))) words.shift();
  return words.join(" ");
}

/**
 * Census and register answers that stand where a place should but name none:
 * "Same House" (1940 census, residence in 1935), "Do" (ditto). Resolved, they
 * become a real place that happens to share the word ("Same House" -> "Same,
 * Manufahi, Timor-Leste", "Do" -> "Dominican Republic"). Matched against the
 * WHOLE place text only: "Same Place, Wayne, Ohio" still standardizes to Wayne.
 */
const NON_PLACE_PHRASES = new Set([
  "same", "same house", "same place", "same city", "same town", "same township",
  "same county", "same state", "same farm", "same as above", "same as head",
  "do", "ditto", "home", "at home", "farm", "rural", "rural route", "rfd", "r f d",
  "unknown", "not stated", "not given", "none", "n/a", "blank",
  "different place", "other place",
]);

/** The place text is a non-place phrase (NON_PLACE_PHRASES), case, spacing and
 *  periods ignored ("R.F.D.", "Do."). Such a place is never standardized. */
export function isNonPlacePhrase(place: string): boolean {
  return NON_PLACE_PHRASES.has(normalizeKey(place.replace(/\./g, " ")));
}

/** Strip a trailing `(Type)` suffix that `describeCandidates` appends.
 *  The `\)\s*$` anchor forces the LAST parenthesised group to be the type;
 *  the group admits one nested pair because FamilySearch types include `Island(s)`. */
function parseTypeSuffix(
  input: string,
): { bareName: string; type: string } | null {
  const match = /^(.+?)\s*\(((?:[^()]|\([^()]*\))+)\)\s*$/.exec(input);
  if (!match) return null;
  return { bareName: match[1].trim(), type: match[2].trim() };
}

/**
 * Best single year for a free-text fact date, for the `+date:` qualifier.
 * Reuses the existing date pipeline (`stdDate` -> `earliestYear`) rather than
 * re-parsing; returns undefined for anything it cannot read, which makes the
 * query fall back to the undated form.
 *
 * `earliestYear` takes the EARLIEST bound of an imprecise date, which is a
 * deliberate choice for a point query and not an obvious one: "before 1900"
 * queries +date:+1890 and "between 1850 and 1870" queries +date:+1850. The
 * function was written for range sorting. Erring early is the safer direction
 * here, because a jurisdiction named at the earlier bound is the older one and
 * the qualifier exists to stop us returning the modern rendering.
 *
 * FamilySearch accepts 1000..9999 and returns HTTP 400 outside it — verified:
 * +date:+999 and +date:+10000 and +date:+-44 all 400, +date:+1000 returns 204,
 * +date:+9999 returns 200. That range is reachable through the same fudge
 * offsets `earliestYear` applies ("abt 1000" -> 999, "44 BC" -> -44), and a 400
 * would throw inside searchPlace (a 400 is not retried) and leave the place
 * blank and uncached, so the next call throws again. The
 * empty-result fallback in getSearchEntries does not cover a throw. Out-of-range
 * years therefore degrade to an undated query rather than being sent.
 */
const FS_DATE_MIN_YEAR = 1000;
const FS_DATE_MAX_YEAR = 9999;

function yearHint(date: string | undefined): number | undefined {
  if (!date || !date.trim()) return undefined;
  const year = earliestYear(stdDate(date));
  if (year === null || year < FS_DATE_MIN_YEAR || year > FS_DATE_MAX_YEAR) {
    return undefined;
  }
  return year;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an idempotent async call with exponential backoff + jitter. Used around
 * match-engine scoring (rank_search_matches, same_person). Place lookups no
 * longer go through it: their fetchers retry transient failures at the HTTP
 * call (place-api.ts, via fetchWithRetry). Re-throws the last error after
 * `attempts` tries so the caller can decide.
 *
 * NOTE: this retries every thrown error, not just transient ones.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; baseMs?: number },
): Promise<T> {
  const attempts = opts?.attempts ?? 3;
  const baseMs = opts?.baseMs ?? 200;
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts - 1) {
        const backoff = baseMs * 2 ** attempt;
        const jitter = backoff * 0.5 * Math.random();
        await sleep(backoff + jitter);
      }
    }
  }
  throw lastErr;
}

/**
 * Map over items with bounded concurrency (default 8). Order-preserving. Used
 * by the converter's document-level standardization pass so a search result
 * with many places resolves in parallel without flooding FamilySearch.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

// ─── Internal search + selection ─────────────────────────────────────────────

/**
 * Derive a disambiguating context from a comma-qualified place TEXT — the
 * immediate parent locality of the leaf (segment index 1). For
 * "Church of the Annunciation, Shenandoah, Schuylkill County, Pennsylvania"
 * this is "Shenandoah"; for "Bristol, England" it is "England".
 *
 * This is the fix for silent same-name corruption: FamilySearch's place
 * endpoint is a plain name search that returns the top-scored hit, so an input
 * whose leaf name also exists in another county ("Church" in Clarion vs.
 * Shenandoah, "Bristol" in Virginia vs. England) can resolve to the wrong spot.
 * Feeding the parent locality as `contextName` narrows the candidate set by
 * substring first, and `getSearchEntries` keeps the unfiltered set whenever
 * nothing matches (so an unmatched context is a no-op).
 *
 * Strength of the guarantee depends on how the caller then SELECTS:
 * - The `standardPlace`-input fns (standardPlaceToRepId / -ToPlaceId /
 *   -ToCoords) select via `pickExactOrBest` / an exact pool. The exact-fullName
 *   candidate contains the derived token by construction, so it always survives
 *   the filter — these paths are strictly never-worse, only equal or better.
 * - The free-text `resolveStandardPlace` selects with bare `pickBest` (no exact
 *   retention). Filtering there is expected-better but NOT strictly safe: if the
 *   correct top-scored hit lacks the derived token while a wrong hit contains it
 *   (e.g. "Georgetown, Washington, District of Columbia" → context "Washington"
 *   drops the DC place and elevates Washington State), it can resolve worse than
 *   a bare name search. The trade is inherent — a filter that can demote a wrong
 *   top hit can also demote a correct one. See the regression-direction test in
 *   place-resolver.test.ts.
 *
 * Returns undefined for a single-token input (no parent to disambiguate by),
 * leaving behavior unchanged for bare names like "Ky" or "Springfield".
 */
export function deriveContextName(text: string): string | undefined {
  const segs = placeSegments(text);
  if (segs.length < 2) return undefined;
  return segs[1];
}

/**
 * Run (and memoize) a name search. Applies the same context-name filter as
 * place_search: narrow by substring, but keep the unfiltered set if nothing
 * matches (better to return extra candidates than zero). When the caller passes
 * no explicit contextName, one is derived from the input text itself
 * (see deriveContextName) so every resolver path — including the five write
 * paths that persist standard_place — disambiguates same-name places. Each
 * fetch retries transient failures itself (place-api.ts, via fetchWithRetry);
 * a successful empty result IS cached (definitive), a thrown error is not.
 */
async function getSearchEntries(
  name: string,
  contextName?: string,
  year?: number,
): Promise<SearchEntry[]> {
  // Empty / whitespace-only name has nothing to search — short-circuit before
  // any network call. This is the single choke point all resolver fns go
  // through, so every public fn inherits the empty-input guard here.
  if (!normalizeKey(name)) return [];
  const effectiveContext = contextName ?? deriveContextName(name);
  const key = `${normalizeKey(name)}|${normalizeKey(effectiveContext ?? "")}|${year ?? ""}`;
  const cached = searchEntriesCache.get(key);
  if (cached) return cached;

  let entries = await searchPlace(name, { date: year });

  // `+date:` is a hard filter, not a preference: when no place representation
  // records coverage for that year FamilySearch returns nothing at all, even
  // for a place that resolves fine undated (measured: 11/150 of the eval
  // corpus, e.g. "Manger, Hordaland, Norge" 1801 — the SOLE copy of this rate;
  // it is emitted by dev/probe-place-date-disagreement.ts and no test checks
  // it, so do not restate it elsewhere). Falling back to the undated
  // query makes the qualifier strictly additive — it can sharpen an answer but
  // never turns one into a blank. See dev/probe-place-date-disagreement.ts.
  if (year !== undefined && entries.length === 0) {
    entries = await searchPlace(name);
  }

  const context = effectiveContext?.trim().toLowerCase();
  if (context) {
    const filtered = entries.filter((e) =>
      e.fullName.toLowerCase().includes(context),
    );
    if (filtered.length > 0) entries = filtered;
  }

  searchEntriesCache.set(key, entries);
  return entries;
}

// ─── Place/standard_place country-consistency guard ─────────────────────────
// Shared between research_append/extraction_append (assertions) and
// tree_edit/tree_correct (tree facts) — moved here from research-append.ts so
// both write paths use one check instead of two independently-maintained
// copies. Small, conservative alias map: only when the place TEXT's own
// trailing token names a recognized country can a contradiction be declared.

// Keys are compared after `canonicalCountry` folds diacritics, so they are
// written ASCII: "osterreich" matches "Österreich", "espana" matches "España".
//
// Endonyms are included because the input side is a RECORDED place, written in
// whatever language the clerk used, while the standard side comes back in
// English. Without them the guard silently declines to judge every non-English
// place: corpus incidence is norge 109, danmark 69, rakousko 46 (Czech for
// Austria), nederland 37, magyarorszag 33, italia 30.
//
// Still a hand-maintained subset of ~30 countries, and the corpus contains at
// least ten more with real volume (chile 129, bolivia 87, honduras 67,
// philippines 63, croatia 61, brazil 60, slovakia 54, south africa 51). Those
// are NOT added here to keep this PR to one change. The georgia ambiguity
// (US state vs country) is settled — the lead ruled 2026-08-27 that Georgia
// Republic is the country and bare Georgia the state, represent it that way
// if it is easy and otherwise leave georgia out. Coverage is issue #1907.
//
// Note what this map is NOT for: most `unverifiable` verdicts are place strings
// whose trailing token is a US state or an English county (pennsylvania 1285,
// ohio 322, staffordshire 73). Those name no country, and declining to judge
// them is correct behaviour, not a gap.
const COUNTRY_ALIASES: Record<string, string> = {
  "united states": "united states",
  "united states of america": "united states",
  usa: "united states",
  us: "united states",
  america: "united states",
  "united kingdom": "united kingdom",
  uk: "united kingdom",
  "great britain": "united kingdom",
  england: "england",
  scotland: "scotland",
  wales: "wales",
  "northern ireland": "northern ireland",
  ireland: "ireland",
  canada: "canada",
  australia: "australia",
  "new zealand": "new zealand",
  germany: "germany",
  france: "france",
  norway: "norway",
  sweden: "sweden",
  denmark: "denmark",
  netherlands: "netherlands",
  holland: "netherlands",
  belgium: "belgium",
  italy: "italy",
  spain: "spain",
  portugal: "portugal",
  poland: "poland",
  russia: "russia",
  austria: "austria",
  hungary: "hungary",
  switzerland: "switzerland",
  mexico: "mexico",
  // Not genealogy countries — carried because they are where a mis-resolution
  // lands, and the guard can only declare a contradiction against a country it
  // recognises. Dropping either re-opens a catch in
  // eval/tests/e2e/anna-findejsova-daughter/starting-tree.gedcomx.json, and
  // both are pinned by tests. Add a country here only with the landing that
  // needs it: "south korea" was in an earlier revision with no corpus case and
  // no test, which is an entry that reads as coverage while proving nothing.
  cameroon: "cameroon",
  "north korea": "north korea",

  // Endonyms and other-language forms for the countries above.
  deutschland: "germany",
  preussen: "germany",
  // `ß` does not decompose under NFD, so canonicalCountry's diacritic fold
  // leaves "Preußen" as "preußen" and the ASCII key above never matches it.
  // Both spellings appear in the corpus; without this the guard reads one and
  // not the other, which is the same silent half-coverage the fold was added
  // to remove.
  "preußen": "germany",
  norge: "norway",
  noreg: "norway",
  danmark: "denmark",
  sverige: "sweden",
  nederland: "netherlands",
  belgie: "belgium",
  belgique: "belgium",
  osterreich: "austria",
  rakousko: "austria",
  schweiz: "switzerland",
  suisse: "switzerland",
  svizzera: "switzerland",
  italia: "italy",
  espana: "spain",
  polska: "poland",
  magyarorszag: "hungary",
  eire: "ireland",
  frankrike: "france",
};

export const UK_CONSTITUENTS: ReadonlySet<string> = new Set(["england", "scotland", "wales", "northern ireland"]);

export function canonicalCountry(segment: string): string | null {
  // Fold diacritics before the lookup: "México" and "Mexico" are the same
  // country, and without this the guard silently switched itself off on the
  // accented spelling while checking the unaccented one.
  const norm = foldPlaceName(segment).replace(/\./g, "");
  // hasOwn, not `?? null`: `??` only catches null/undefined, so a bare index on
  // a prototype key ("constructor") would return a function from a `string |
  // null` signature.
  return Object.hasOwn(COUNTRY_ALIASES, norm) ? COUNTRY_ALIASES[norm] : null;
}

export function placeSegments(place: string): string[] {
  return place
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Compare the country the place TEXT names (its trailing token, when that token
 * is a recognized country) against the standard_place's segments.
 * - "ok": the input names a country and the standard place is consistent.
 * - "contradiction": the input names a country the standard place plainly lacks.
 * - "unverifiable": cannot compare — either the input text names no recognized
 *   country, or the standard place names none the alias table carries (a
 *   historical polity such as "Bohemia").
 */
export function countryConsistency(place: string, standardPlace: string): "ok" | "contradiction" | "unverifiable" {
  const inputSegs = placeSegments(place);
  if (inputSegs.length === 0) return "unverifiable";
  const inputCountry = canonicalCountry(inputSegs[inputSegs.length - 1]);
  if (!inputCountry) return "unverifiable";

  const stdCountries = placeSegments(standardPlace)
    .map(canonicalCountry)
    .filter((c): c is string => c !== null);
  // The standard place names no country this map recognises — a historical
  // polity ("…, Bohemia", "…, Moravia", "…, Czechoslovakia") or a country the
  // table does not carry. That is "cannot compare", not "plainly lacks", and
  // the difference matters: a Bohemian place recorded as "…, Rakousko"
  // (Czech for Austria) standardises to "…, Bohemia" — the same territory,
  // not a different country — and reporting a contradiction there rejects the
  // whole research_append. Same reason an input naming no country returns
  // unverifiable above.
  if (stdCountries.length === 0) return "unverifiable";
  if (stdCountries.includes(inputCountry)) return "ok";
  // UK constituents: "England" is consistent with a standard place that ends in
  // "United Kingdom" — unless a DIFFERENT constituent is present.
  if (UK_CONSTITUENTS.has(inputCountry)) {
    if (stdCountries.some((c) => UK_CONSTITUENTS.has(c) && c !== inputCountry)) return "contradiction";
    if (stdCountries.includes("united kingdom")) return "ok";
  }
  // Historic Irish records: "Ireland" is consistent with "Northern Ireland".
  if (inputCountry === "ireland" && stdCountries.includes("northern ireland")) return "ok";
  return "contradiction";
}

/** Highest-scoring entry (FamilySearch ranks by relevance), else first. */
function pickBest(entries: SearchEntry[]): SearchEntry | undefined {
  if (entries.length === 0) return undefined;
  return entries.reduce((best, e) =>
    (e.score ?? 0) > (best.score ?? 0) ? e : best,
  );
}

/**
 * When the input IS already a standard fullName, prefer an exact
 * (case-insensitive) fullName match; fall back to best-scored otherwise.
 */
function pickExactOrBest(
  entries: SearchEntry[],
  name: string,
): SearchEntry | undefined {
  const target = normalizeKey(name);
  const exact = entries.filter((e) => normalizeKey(e.fullName) === target);
  return pickBest(exact.length > 0 ? exact : entries);
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Free-text place ("Ky", "Branch Twp., Schuylkill Co., PA") -> the canonical
 * `standardPlace` name, or null if nothing matches. This is the "standardize
 * otherwise" path the converter uses when raw GedcomX carries no normalized
 * value. Definitive 0-candidate results are negative-cached; transient
 * failures are not (they retry on a later call).
 */
export async function resolveStandardPlace(
  originalText: string,
  opts: ResolveOpts = {},
): Promise<string | null> {
  if (isNonPlacePhrase(originalText)) return null;
  if (placeTableForTests) return placeTableForTests.get(normalizeKey(originalText)) ?? null;
  if (!normalizeKey(originalText)) return null;
  if (placeSegments(originalText).length === 1 && !opts.contextName) {
    return resolveBareName(originalText, opts);
  }
  // Only date-qualify a place that names its own context. A bare single-segment
  // input has nothing to anchor the year against, and the qualifier then picks
  // whichever obscure same-named place happens to have coverage for it
  // (measured: "Germany" 1827 -> "Germany, Pruzhany, Grodno, Russian Empire", a
  // village; "Mohol" 1938 -> "Mol, Ada, Serbia"). `countryConsistency` does NOT
  // catch these. It reads the INPUT's TRAILING segment and scans every segment
  // of the standard place, so "Germany" matches the village's own leading
  // "Germany" and returns "ok", while single-token "Mohol" names no recognised
  // country at all and returns "unverifiable". Same threshold
  // `deriveContextName` uses for the same reason: below two segments there is
  // no context to disambiguate with.
  const year =
    placeSegments(originalText).length >= 2 ? yearHint(opts.date) : undefined;
  const key = `${normalizeKey(originalText)}|${year ?? ""}`;
  if (standardizeCache.has(key)) return standardizeCache.get(key) ?? null;

  let entries: SearchEntry[];
  try {
    entries = await getSearchEntries(originalText, opts.contextName, year);
  } catch {
    return null; // transient failure after retries — do not cache
  }

  let standardPlace = pickBest(entries)?.fullName ?? null;

  // A date-qualified answer describes the place as it WAS, so it can legitimately
  // name a different sovereign than the record's own text — "Bavaria, Germany"
  // at 1843 resolves to "Bavaria" (the Kingdom predates the German Empire), and
  // "Quebec, Canada" at 1819 to "British North America".
  //
  // `countryConsistency` cannot confirm either: the historical rendering names
  // no country the alias table recognises, so the verdict is `unverifiable`
  // (`contradiction` where it names a modern one, as "British North America"
  // does not but a mis-resolution to "…, Cameroon" would). Rather than weaken
  // the guard for every caller — it is the only thing standing between a wrong
  // resolution and the file — fall back to the undated answer whenever the
  // dated one is anything but `ok`. Same principle as the empty-result
  // fallback in getSearchEntries: `+date:` may sharpen an answer, never break
  // one.
  //
  // The trigger is `!== "ok"` rather than `=== "contradiction"` deliberately.
  // A historical rendering is far more often unconfirmable than contradictory,
  // so keying on `contradiction` alone would persist the very anachronism-free
  // values the guard cannot vouch for, while looking like it had checked them.
  //
  // The cost is explicit: where the guard cannot confirm, we keep the modern
  // rendering and lose the historical one. That is the conservative side to err
  // on, since the guard cannot tell a sovereignty change from a mis-resolution.
  // Measure it before wiring a date caller: `unverifiable` is the verdict for
  // every place whose text ends in a US state or an English county — 563/2094
  // distinct corpus places, 8004/27028 occurrences — so for those the qualifier
  // costs a second query and then changes nothing.
  if (
    year !== undefined &&
    standardPlace &&
    countryConsistency(originalText, standardPlace) !== "ok"
  ) {
    try {
      const undated = pickBest(
        await getSearchEntries(originalText, opts.contextName),
      )?.fullName;
      if (undated) standardPlace = undated;
    } catch {
      // Undated retry failed; keep the dated answer and let the caller's guard
      // decide. No worse than not having tried.
    }
  }

  standardizeCache.set(key, standardPlace); // definitive (incl. null for 0 hits)
  return standardPlace;
}

export type FirstPlaceStatus = "match" | "mismatch" | "not_found" | "lookup_failed";

export interface FirstPlaceVerdict {
  status: FirstPlaceStatus;
  /** On a match, the entry that matched (from the tied set or the re-search);
   *  otherwise the best entry, whenever the search found one. */
  standardPlace?: string;
}

/**
 * Does FamilySearch's place standard hold the FIRST place a comma list names?
 * `research_append`'s `localities` rule (issue #3696).
 *
 * "Did it resolve?" is the wrong question: "Helvesieck, Schneverdingen, Soltau,
 * Hanover" resolves to "Schneverdingen, Soltau, Hanover, Prussia, Germany",
 * dropping the unknown village and returning its parent. So the first name the
 * caller wrote must equal either the first segment of a top search entry's
 * fullName, or one of that place's names in ANY language. Both are needed:
 * the English-only list is empty for Schneverdingen and lacks "Forfarshire"
 * (measured in issue #3696).
 *
 * Segment 2 filters the entries, as in #3696's search path, so it acts as a parent
 * check and "Helvesiek, Schneverdingen, Hanover"
 * (a real village under the wrong parish) is refused. Widenings, each measured
 * live (2026-10-21) to refuse a real place without it:
 * - the parent named in segment 2 is matched with type words ignored, so
 *   "Schneverdingen Parish" is still Schneverdingen (`underParent`);
 * - every entry tied for the top score is checked, because "Mt. Pleasant, Iowa"
 *   ties the town with a Quaker meeting and the meeting comes first. A tied entry
 *   with no place id is skipped; the best entry having none, a thrown fetch, or
 *   the fetch cap leaving entries unchecked is `lookup_failed`, never a refusal;
 * - type words are ignored ("Stagstrup Sogn", "Co. Cork"), and when that still
 *   misses the stripped text is searched once more ("Ringebu Parish, Oppland").
 *
 * Unlike `resolveStandardPlace`, a failed request is `lookup_failed`, never a
 * miss, and `placeTableForTests` is never consulted.
 */
export async function checkFirstPlace(text: string): Promise<FirstPlaceVerdict> {
  // Parents are searched without their type words: "Schneverdingen Parish" in the
  // query returns no Schneverdingen entry at all (live), so the parent check would
  // have nothing to keep and fall back to every entry.
  const [first = "", ...parents] = placeSegments(text);
  const rest = parents.map(parentWithoutTypeWords);
  const verdict = await checkFirstPlaceOnce([first, ...rest].join(", "), first);
  if (verdict.status !== "mismatch" && verdict.status !== "not_found") return verdict;
  const stripped = withoutTypeWords(first);
  if (placeNameKey(stripped) === placeNameKey(first)) return verdict;
  const retry = await checkFirstPlaceOnce([stripped, ...rest].join(", "), stripped);
  return retry.status === "match" || retry.status === "lookup_failed" ? retry : verdict;
}

/** Name lists fetched per pass. A context that matches many places can tie
 *  hundreds of entries ("Nowhereville, Springfield": 189 live), and every fetch
 *  runs under research_append's project lock. */
const MAX_NAME_FETCHES = 5;

async function checkFirstPlaceOnce(text: string, first: string): Promise<FirstPlaceVerdict> {
  const wanted = new Set(placeNameKeys(first));
  const matches = (name: string) => placeNameKeys(name).some((k) => wanted.has(k));
  let all: SearchEntry[];
  try {
    all = await getSearchEntries(text, "");
  } catch {
    return { status: "lookup_failed" };
  }
  const entries = underParent(all, placeSegments(text)[1]);
  const best = pickBest(entries);
  if (!best) return { status: "not_found" };
  const candidates = topScored(entries);
  const hit = candidates.find((e) => matches(placeSegments(e.fullName)[0] ?? ""));
  if (hit) return { status: "match", standardPlace: hit.fullName };
  if (!best.placeId) return { status: "lookup_failed", standardPlace: best.fullName };
  let unchecked = false;
  const seen = new Set<string>();
  for (const e of candidates) {
    if (!e.placeId || seen.has(e.placeId)) continue;
    if (seen.size >= MAX_NAME_FETCHES) {
      unchecked = true;
      break;
    }
    seen.add(e.placeId);
    let names: string[];
    try {
      names = await getPlaceCandidateNames(e.placeId, {}, { anyLanguage: true });
    } catch {
      unchecked = true;
      continue;
    }
    if (names.some(matches)) return { status: "match", standardPlace: e.fullName };
  }
  return { status: unchecked ? "lookup_failed" : "mismatch", standardPlace: best.fullName };
}

/** A parent's type words dropped, unless it is an "X of Y" name: "District of
 *  Columbia" is a name, and stripping it leaves "Columbia". */
function parentWithoutTypeWords(parent: string): string {
  return /\bof\b/i.test(parent) ? parent : withoutTypeWords(parent);
}

/** The entries under the parent the caller wrote, or all of them when none is.
 *  Same rule as `getSearchEntries`' derived context (fullName contains it), and
 *  also a fullName segment equal to it under `placeNameKeys`, so "Schneverdingen
 *  Parish" or "Hedmark County" still names the parent (measured live 2026-10-21:
 *  without it the check fell back to every entry and passed a wrong parent). */
function underParent(entries: SearchEntry[], parent: string | undefined): SearchEntry[] {
  if (!parent) return entries;
  const raw = parent.trim().toLowerCase();
  const keys = new Set([placeNameKey(parent), placeNameKey(parentWithoutTypeWords(parent))]);
  const kept = entries.filter(
    (e) =>
      e.fullName.toLowerCase().includes(raw) ||
      placeSegments(e.fullName).some((seg) => placeNameKeys(seg).some((k) => keys.has(k))),
  );
  return kept.length > 0 ? kept : entries;
}

/** Every entry sharing the highest score: `pickBest` keeps the first of a tie,
 *  which is arbitrary. */
function topScored(entries: SearchEntry[]): SearchEntry[] {
  if (entries.length === 0) return [];
  const top = Math.max(...entries.map((e) => e.score ?? 0));
  return entries.filter((e) => (e.score ?? 0) === top);
}

/**
 * A bare single-segment place ("Shenandoah", "Logan LDS Temple") names no
 * parent, so the best-scored hit is whichever same-named place ranks highest
 * anywhere, and `countryConsistency` cannot catch it: a one-token input names no
 * country. Measured on PR #3007's trials: "Shenandoah" beside "Borough of
 * Shenandoah, County of Schuylkill" in the same will resolved to New Zealand.
 *
 * In order: a sibling place from the same source that is this name (or this
 * name after "Borough of" and the like) is resolved instead; else a best hit
 * that is a country or state is kept; else the search is confined to the jurisdiction the
 * siblings share, most specific first, and only a candidate inside it counts;
 * else the best match is kept only when it is a jurisdiction (a country, state,
 * territory or county: "Gloucestershire", "Ky" -> Kentucky, "USA"), never a
 * settlement (a city, town, parish or farm), which is where a same-named place
 * abroad wins. Anything else is left unresolved (genealogist ruling 2026-10-06,
 * option C with fallback B′; B′ rather than "only itself at the top", which
 * would have dropped ~70 correct county and abbreviation resolutions in the
 * committed e2e corpus).
 */
async function resolveBareName(name: string, opts: ResolveOpts): Promise<string | null> {
  const bare = normalizeKey(name);
  const siblings = (opts.contextPlaces ?? [])
    .map(placeSegments)
    .filter((segs) => segs.length >= 2);

  const fuller = siblings.find((segs) => {
    const first = normalizeKey(segs[0]);
    return first === bare || first.replace(ADMIN_PREFIX_RE, "") === bare;
  });
  if (fuller) return resolveStandardPlace(fuller.join(", "), { date: opts.date });

  let entries: SearchEntry[];
  try {
    entries = await getSearchEntries(name);
  } catch {
    return null;
  }

  // A bare country or state is itself, whatever the record's own area holds:
  // "Germany" beside Gettysburg is not Germany Township, Adams, Pennsylvania.
  const best = pickBest(entries);
  if (best && isTopLevel(best.type)) return best.fullName;

  const word = firstWord(bare);
  const named = entries.filter((e) => firstWord(normalizeKey(placeSegments(e.fullName)[0] ?? "")) === word);
  for (const level of sharedJurisdiction(siblings)) {
    const inside = named.filter((e) => placeSegments(e.fullName).map(normalizeKey).includes(level));
    if (inside.length > 0) return pickBest(inside)!.fullName;
  }

  return best && isJurisdiction(best.type) ? best.fullName : null;
}

/** "Borough of Shenandoah" spells out "Shenandoah"; "New York" does not spell out
 *  "York", nor "Port Elizabeth" "Elizabeth". Only an administrative prefix counts. */
/** A place name's first word, after any administrative prefix: a FamilySearch
 *  variant-name hit ("Laxton" for "Lexington") does not share it. */
function firstWord(key: string): string {
  return key.replace(ADMIN_PREFIX_RE, "").split(" ")[0];
}

const ADMIN_PREFIX_RE = /^(?:borough|town|city|township|village|parish|county|district|municipality|hundred) of /;

/** A FamilySearch place type as a lookup key: lower-cased, with the bracketed
 *  qualifier the live API adds to some types ("County (Top level)") dropped. */
export function placeTypeKey(type: string | undefined): string {
  return normalizeKey((type ?? "").replace(/\s*\(.*\)\s*$/, ""));
}

/** A FamilySearch place type names a jurisdiction. */
function isJurisdiction(type: string | undefined): boolean {
  return JURISDICTION_TYPES.has(placeTypeKey(type));
}

/** A place type at the top of the hierarchy: a name that is one of these is
 *  already as specific as a bare name can be. */
function isTopLevel(type: string | undefined): boolean {
  return TOP_LEVEL_TYPES.has(placeTypeKey(type));
}

const TOP_LEVEL_TYPES = new Set(["continent", "country", "state", "province"]);

const JURISDICTION_TYPES = new Set([
  "continent",
  "country",
  "state",
  "province",
  "territory",
  "county",
  "district",
  "region",
  "first-level admin div",
  "second-level admin div",
]);

/** The trailing jurisdictions every sibling shares (each sibling's own first
 *  segment excluded), most specific first. One sibling shares its whole tail. */
export function sharedJurisdiction(siblings: string[][]): string[] {
  const tails = siblings.map((segs) => segs.slice(1).map(normalizeKey));
  if (tails.length === 0 || tails.some((t) => t.length === 0)) return [];
  const shared: string[] = [];
  for (let i = 1; i <= Math.min(...tails.map((t) => t.length)); i++) {
    const seg = tails[0][tails[0].length - i];
    if (!tails.every((t) => t[t.length - i] === seg)) break;
    shared.unshift(seg);
  }
  return shared;
}

/**
 * A `standardPlace` name -> its placeRepId (1:1), or null. Prefers an exact
 * fullName match among candidates.
 */
export async function standardPlaceToRepId(
  standardPlace: string,
  opts: ResolveOpts = {},
): Promise<string | null> {
  const key = normalizeKey(standardPlace);
  if (!key) return null;
  if (nameToRepIdCache.has(key)) return nameToRepIdCache.get(key) ?? null;

  let entries: SearchEntry[];
  try {
    entries = await getSearchEntries(standardPlace, opts.contextName);
  } catch {
    return null;
  }

  const match = pickExactOrBest(entries, standardPlace);
  const repId = match?.placeRepId ?? null;
  nameToRepIdCache.set(key, repId);
  return repId;
}

/**
 * A placeRepId -> its `standardPlace` name (1:1, cheap), or null. Uses the
 * description endpoint via getPlaceById.
 */
export async function repIdToStandardPlace(
  repId: string,
): Promise<string | null> {
  const info = await getRepInfo(repId);
  return info?.standardPlace ?? null;
}

async function getRepInfo(repId: string): Promise<RepInfo | null> {
  if (repInfoCache.has(repId)) return repInfoCache.get(repId) ?? null;
  let place: Awaited<ReturnType<typeof getPlaceById>>;
  try {
    place = await getPlaceById(repId);
  } catch {
    return null; // transient — do not cache
  }
  const info: RepInfo | null = place
    ? {
        standardPlace: place.fullName,
        placeId: place.placeId,
        latitude: place.latitude,
        longitude: place.longitude,
        dateRange: place.dateRange,
      }
    : null;
  repInfoCache.set(repId, info);
  return info;
}

/** Inclusive years: a fact date's earliest and latest possible year, or a
 *  representation's validity. */
interface YearSpan {
  from: number;
  to: number;
}

const RANGE_BOUND = String.raw`([+-]\d+)(?:-\d{2}){0,2}`;
const REP_RANGE = new RegExp(`^(?:${RANGE_BOUND})?/(?:${RANGE_BOUND})?$`);

/** A representation's validity as years; every year when it has no range, null
 *  when the range cannot be read. */
function repYears(dateRange: string | undefined): YearSpan | null {
  if (dateRange === undefined || dateRange.trim() === "") return { from: -Infinity, to: Infinity };
  const m = REP_RANGE.exec(dateRange.trim());
  if (!m) return null;
  return {
    from: m[1] === undefined ? -Infinity : Number(m[1]),
    to: m[2] === undefined ? Infinity : Number(m[2]),
  };
}

function dateYears(date: string | undefined): YearSpan | null {
  if (!date || !date.trim()) return null;
  const std = stdDate(date);
  const from = earliestYear(std);
  const to = latestYear(std);
  return from === null || to === null ? null : { from, to };
}

function covers(range: YearSpan | null, years: YearSpan): boolean {
  return range !== null && range.from <= years.from && years.to <= range.to;
}

/** Concurrent description lookups for one place's representations. */
const REP_LOOKUP_CONCURRENCY = 8;

/**
 * The English name of the representation of `repId`'s place that is valid at
 * `date` (any date `stdDate` reads; an imprecise one must fall wholly inside the
 * range), or null.
 *
 * A FamilySearch place has a representation per era, each with its own name
 * and range: place 1959431 is "Olne, Prince-Bishopric of Liège, Holy Roman
 * Empire" to 1795 and "Olne, Liège, Belgium" from 1830. `repId` is named when
 * its range covers the date, else the place's representation whose range does.
 * With no readable date, `repId` is named only when its range runs to the
 * present. Null when no representation covers the date, when the ones that do
 * disagree on the name, or when any lookup fails.
 */
export async function repIdToStandardPlaceAt(
  repId: string,
  date: string | undefined,
): Promise<string | null> {
  const chosen = await getRepInfo(repId);
  if (!chosen) return null;
  const range = repYears(chosen.dateRange);
  const years = dateYears(date);
  if (years === null) return range?.to === Infinity ? chosen.standardPlace : null;
  if (covers(range, years)) return chosen.standardPlace;
  if (!chosen.placeId) return null;
  const others = (await placeIdToRepIds(chosen.placeId)).filter((id) => id !== repId);
  const infos = await mapWithConcurrency(others, REP_LOOKUP_CONCURRENCY, (id) => getRepInfo(id));
  const names = new Set<string>();
  for (const info of infos) {
    if (info === null) return null;
    if (covers(repYears(info.dateRange), years)) names.add(info.standardPlace);
  }
  return names.size === 1 ? [...names][0] : null;
}

/** Most place candidates an ambiguity result will name. Mirrors
 *  `MAX_JURISDICTION_HINTS` in `record-search.ts`, for the same reason: a list
 *  long enough to be a wall of text is not a list anyone acts on. */
const MAX_PLACE_CANDIDATES = 8;

/**
 * Build the LLM-instruction error for an ambiguous place resolution. Three
 * callers (volume_search, external_links_search, place_population) throw this
 * on the `ambiguous` arm of `resolveStandardPlaceToPlaceId`.
 */
export function ambiguousPlaceError(
  standardPlace: string,
  candidates: string[],
): Error {
  return new Error(
    `"${standardPlace}" matches more than one place: ` +
      `${candidates.join("; ")}. ` +
      "Pass one of these exactly as listed, including the parenthesised type, " +
      "as standardPlace, or call place_search to see the full list."
  );
}

/**
 * The outcome of resolving a `standardPlace` to a placeId.
 *
 * `standardPlaceToPlaceId` collapses all three to `string | null`, which is why
 * this exists: `null` meant BOTH "no such place" and "several places, and
 * picking one would silently research the wrong jurisdiction", and a caller
 * reading one `null` cannot tell the user which happened. Measured on the
 * committed e2e corpus, the ambiguous arm fires far more often than the
 * feedback report that prompted this suggested (`grep -rn "to a single place"
 * eval/runlogs/e2e/`).
 */
export type PlaceIdResolution =
  | { kind: "resolved"; placeId: string }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "unresolved" };

/** One human-readable line per DISTINCT placeId, capped. The type qualifier is
 *  what separates the real pairs: Virginia has both a Franklin County and an
 *  independent City of Franklin, and their `fullName`s are identical, so a list
 *  of bare names would repeat one string and help nobody. */
function describeCandidates(pool: SearchEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of pool) {
    const id = e.placeId as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(e.type ? `${e.fullName} (${e.type})` : e.fullName);
    if (out.length === MAX_PLACE_CANDIDATES) break;
  }
  return out;
}

/**
 * A `standardPlace` name -> its parent placeId ("spot on earth"), discriminated.
 *
 * NEVER auto-picks among candidates. Virginia's Franklin County and City of
 * Franklin are a real pair, and choosing one silently researches the wrong
 * jurisdiction — worse than refusing, because nothing downstream can tell.
 * Callers that fan out over all reps (volume_search, place_population) rely on
 * that. See plan §11.
 *
 * Accepts the `fullName (Type)` disambiguation grammar the ambiguity error
 * prints: the `(Type)` suffix is stripped before searching (so it never
 * reaches FamilySearch) and used to filter the exact-fullName pool by type.
 */
export async function resolveStandardPlaceToPlaceId(
  standardPlace: string,
  opts: ResolveOpts = {},
): Promise<PlaceIdResolution> {
  // If the input carries a "(Type)" suffix, strip it before searching — the
  // parentheses would corrupt the FamilySearch name query.
  const parsed = parseTypeSuffix(standardPlace);
  const searchName = parsed ? parsed.bareName : standardPlace;

  let entries: SearchEntry[];
  try {
    entries = await getSearchEntries(searchName, opts.contextName);
  } catch {
    return { kind: "unresolved" };
  }

  // target must use the bare name so exact-match filtering works for both
  // suffixed and unsuffixed inputs.
  const target = normalizeKey(searchName);
  const exact = entries.filter(
    (e) => normalizeKey(e.fullName) === target && e.placeId,
  );
  const pool = exact.length > 0 ? exact : entries.filter((e) => e.placeId);
  if (pool.length === 0) return { kind: "unresolved" };

  // When the caller supplied a (Type) suffix, honour it before checking whether
  // the pool is already unambiguous — a single-candidate pool of the wrong type
  // must not resolve (issue #2886 review: Mora Municipality vs Lutheran Parish).
  if (parsed) {
    if (exact.length === 0) {
      // The bare name matched nothing exactly; the fallback pool must not be
      // type-filtered (it can contain unrelated places of the same type).
      return { kind: "unresolved" };
    }
    const typeKey = normalizeKey(parsed.type);
    const typed = exact.filter((e) => normalizeKey(e.type) === typeKey);
    const typedDistinct = new Set(typed.map((e) => e.placeId as string));
    if (typedDistinct.size === 1) {
      return { kind: "resolved", placeId: typed[0].placeId as string };
    }
    // Type matched zero entries, or still ambiguous even within the type.
    return { kind: "unresolved" };
  }

  const distinct = new Set(pool.map((e) => e.placeId as string));
  if (distinct.size === 1) {
    return { kind: "resolved", placeId: pool[0].placeId as string };
  }

  return { kind: "ambiguous", candidates: describeCandidates(pool) };
}

/**
 * The `string | null` form. After the ambiguity-naming change (issue #2935),
 * only `wiki-place-page.ts` calls this — as a fallback for alternate-name
 * resolution, not an error surface. A thin wrapper rather than a parallel
 * copy, per CLAUDE.md § Code reuse.
 */
export async function standardPlaceToPlaceId(
  standardPlace: string,
  opts: ResolveOpts = {},
): Promise<string | null> {
  const resolution = await resolveStandardPlaceToPlaceId(standardPlace, opts);
  return resolution.kind === "resolved" ? resolution.placeId : null;
}

/**
 * All placeRepIds a placeId has had over time (1:N). The only FS path that
 * enumerates a spot's representations — used by place_search_all and the
 * volume_search fan-out. Empty array on failure (not cached).
 */
export async function placeIdToRepIds(placeId: string): Promise<string[]> {
  const cached = placeIdRepsCache.get(placeId);
  if (cached) return cached;
  let reps: string[];
  try {
    reps = await getPlaceRepIds(placeId);
  } catch {
    return [];
  }
  placeIdRepsCache.set(placeId, reps);
  return reps;
}

/** A place's coordinates, with the Places type of the entry they came from
 *  ("City", "State", "Country", ...) when known. */
export interface PlaceCoords {
  latitude: number;
  longitude: number;
  type?: string;
}

/**
 * A `standardPlace` name -> its coordinates, or null. Coords come straight
 * from the search entry when present (no second fetch); otherwise falls back
 * to the description endpoint. Used by place_distance.
 */
export async function standardPlaceToCoords(
  standardPlace: string,
  opts: ResolveOpts = {},
): Promise<PlaceCoords | null> {
  let entries: SearchEntry[];
  try {
    entries = await getSearchEntries(standardPlace, opts.contextName);
  } catch {
    return null;
  }

  const match = pickExactOrBest(entries, standardPlace);
  if (!match) return null;

  if (match.latitude != null && match.longitude != null) {
    return { latitude: match.latitude, longitude: match.longitude, type: match.type };
  }

  const info = await getRepInfo(match.placeRepId);
  if (info && info.latitude != null && info.longitude != null) {
    return { latitude: info.latitude, longitude: info.longitude, type: match.type };
  }
  return null;
}
