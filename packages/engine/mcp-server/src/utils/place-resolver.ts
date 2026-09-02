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
} from "./place-api.js";
import { stdDate } from "./date-standardize.js";
import { earliestYear } from "./date-helpers.js";

// Element types of the existing fetchers, without needing their (unexported)
// interfaces — keeps this module in lockstep with place-search.ts.
type SearchEntry = Awaited<ReturnType<typeof searchPlace>>[number];

interface RepInfo {
  standardPlace: string;
  placeId?: string;
  latitude?: number;
  longitude?: number;
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
 * would throw inside searchPlace, burn all three withRetry attempts, and leave
 * the place blank and uncached so the next call burns them again. The
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
 * Retry an idempotent async call with exponential backoff + jitter. Used for
 * place standardization, where a transient network / 429 / 5xx blip shouldn't
 * drop a place. Re-throws the last error after `attempts` tries so the caller
 * can decide (the resolver fns swallow it and return null WITHOUT caching, so
 * the failed lookup retries on a later call).
 *
 * NOTE: the underlying fetchers throw a generic Error on any non-2xx, so this
 * retries all thrown errors (not just 5xx). That is harmless for these
 * idempotent GETs; finer transient-only classification will land when the raw
 * fetch moves into this module (see file header TODO).
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
 * paths that persist standard_place — disambiguates same-name places. Wrapped
 * in withRetry; a successful empty result IS cached (definitive), a thrown
 * error is not.
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

  let entries = await withRetry(() => searchPlace(name, { date: year }));

  // `+date:` is a hard filter, not a preference: when no place representation
  // records coverage for that year FamilySearch returns nothing at all, even
  // for a place that resolves fine undated (measured: 13/150 of the eval
  // corpus, e.g. "Manger, Hordaland, Norge" 1801). Falling back to the undated
  // query makes the qualifier strictly additive — it can sharpen an answer but
  // never turns one into a blank. See dev/probe-place-date-disagreement.ts.
  if (year !== undefined && entries.length === 0) {
    entries = await withRetry(() => searchPlace(name));
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
// are NOT added here because expanding coverage raises a question this map
// cannot answer on its own — "georgia" is both a US state and a country, and
// the guard would be treating the state as the country. Tracked separately.
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

  // Endonyms and other-language forms for the countries above.
  deutschland: "germany",
  preussen: "germany",
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

const UK_CONSTITUENTS = new Set(["england", "scotland", "wales", "northern ireland"]);

function canonicalCountry(segment: string): string | null {
  // Fold diacritics before the lookup: "México" and "Mexico" are the same
  // country, and without this the guard silently switched itself off on the
  // accented spelling while checking the unaccented one.
  const norm = segment
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\./g, "");
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
 * - "unverifiable": the input text names no recognized country — cannot compare.
 */
export function countryConsistency(place: string, standardPlace: string): "ok" | "contradiction" | "unverifiable" {
  const inputSegs = placeSegments(place);
  if (inputSegs.length === 0) return "unverifiable";
  const inputCountry = canonicalCountry(inputSegs[inputSegs.length - 1]);
  if (!inputCountry) return "unverifiable";

  const stdCountries = placeSegments(standardPlace)
    .map(canonicalCountry)
    .filter((c): c is string => c !== null);
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
  if (!normalizeKey(originalText)) return null;
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
  // "Quebec, Canada" at 1819 to "British North America". `countryConsistency`
  // reads both as contradictions, and research_append turns a contradiction into
  // a hard error that rejects the entire append.
  //
  // Rather than weaken the guard for every caller — it is the only thing
  // standing between a wrong resolution and the file — fall back to the undated
  // answer whenever the dated one would trip it. The qualifier keeps every win
  // it earns and can never turn a writable value into a rejected write. Same
  // principle as the empty-result fallback in getSearchEntries: `+date:` may
  // sharpen an answer, never break one.
  //
  // The cost is explicit: where the guard objects we keep the modern rendering
  // and lose the historical one. That is the conservative side to err on, since
  // the guard cannot tell a sovereignty change from a mis-resolution.
  if (
    year !== undefined &&
    standardPlace &&
    countryConsistency(originalText, standardPlace) === "contradiction"
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
    place = await withRetry(() => getPlaceById(repId));
  } catch {
    return null; // transient — do not cache
  }
  const info: RepInfo | null = place
    ? {
        standardPlace: place.fullName,
        placeId: place.placeId,
        latitude: place.latitude,
        longitude: place.longitude,
      }
    : null;
  repInfoCache.set(repId, info);
  return info;
}

/**
 * A `standardPlace` name -> its parent placeId ("spot on earth"), or null.
 * Returns null when the surviving candidates DISAGREE on placeId, so callers
 * that fan out over all reps (volume_search, place_population) never silently
 * query the wrong spot. See plan §11.
 */
export async function standardPlaceToPlaceId(
  standardPlace: string,
  opts: ResolveOpts = {},
): Promise<string | null> {
  let entries: SearchEntry[];
  try {
    entries = await getSearchEntries(standardPlace, opts.contextName);
  } catch {
    return null;
  }

  const target = normalizeKey(standardPlace);
  const exact = entries.filter(
    (e) => normalizeKey(e.fullName) === target && e.placeId,
  );
  const pool = exact.length > 0 ? exact : entries.filter((e) => e.placeId);
  if (pool.length === 0) return null;

  const distinct = new Set(pool.map((e) => e.placeId as string));
  if (distinct.size > 1) return null; // ambiguous spot — guard the fan-out
  return pool[0].placeId ?? null;
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
    reps = await withRetry(() => getPlaceRepIds(placeId));
  } catch {
    return [];
  }
  placeIdRepsCache.set(placeId, reps);
  return reps;
}

/**
 * A `standardPlace` name -> its coordinates, or null. Coords come straight
 * from the search entry when present (no second fetch); otherwise falls back
 * to the description endpoint. Used by place_distance.
 */
export async function standardPlaceToCoords(
  standardPlace: string,
  opts: ResolveOpts = {},
): Promise<{ latitude: number; longitude: number } | null> {
  let entries: SearchEntry[];
  try {
    entries = await getSearchEntries(standardPlace, opts.contextName);
  } catch {
    return null;
  }

  const match = pickExactOrBest(entries, standardPlace);
  if (!match) return null;

  if (match.latitude != null && match.longitude != null) {
    return { latitude: match.latitude, longitude: match.longitude };
  }

  const info = await getRepInfo(match.placeRepId);
  if (info && info.latitude != null && info.longitude != null) {
    return { latitude: info.latitude, longitude: info.longitude };
  }
  return null;
}
