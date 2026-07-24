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
   * The date of the fact/event, for forward-compat. NOT yet used: v1 bulk
   * standardization is date-agnostic (we populate the stable NAME; date-aware
   * placeRepId disambiguation lives in the consuming tools). See plan §11.
   */
  date?: string;
}

// ─── Caches ────────────────────────────────────────────────────────────────
// In-process Maps, no TTL — mirrors place-search.ts's placeSearchCache and
// respects "no cross-session host storage" (CLAUDE.md). The persisted
// standardPlace strings in research.json / tree.gedcomx.json are the real
// cross-session cache.

/** originalText (normalized) -> standardPlace | null. Caches DEFINITIVE
 *  0-candidate negatives only; transient (retry-exhausted) failures are never
 *  cached, so a network blip doesn't poison the cache. */
const standardizeCache = new Map<string, string | null>();
/** standardPlace name (normalized) -> placeRepId | null. */
const nameToRepIdCache = new Map<string, string | null>();
/** placeRepId -> resolved info (standardPlace, placeId, coords). */
const repInfoCache = new Map<string, RepInfo | null>();
/** placeId -> all placeRepIds for that spot over time. */
const placeIdRepsCache = new Map<string, string[]>();
/** Internal memo of raw search results, so the resolver fns above don't
 *  re-issue the same search. Key: `${name}|${contextName}` (normalized). */
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
 * Run (and memoize) a name search. Applies the same context-name filter as
 * place_search: narrow by substring, but keep the unfiltered set if nothing
 * matches (better to return extra candidates than zero). Wrapped in withRetry;
 * a successful empty result IS cached (definitive), a thrown error is not.
 */
async function getSearchEntries(
  name: string,
  contextName?: string,
): Promise<SearchEntry[]> {
  // Empty / whitespace-only name has nothing to search — short-circuit before
  // any network call. This is the single choke point all resolver fns go
  // through, so every public fn inherits the empty-input guard here.
  if (!normalizeKey(name)) return [];
  const key = `${normalizeKey(name)}|${normalizeKey(contextName ?? "")}`;
  const cached = searchEntriesCache.get(key);
  if (cached) return cached;

  let entries = await withRetry(() => searchPlace(name));

  const context = contextName?.trim().toLowerCase();
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
};

const UK_CONSTITUENTS = new Set(["england", "scotland", "wales", "northern ireland"]);

function canonicalCountry(segment: string): string | null {
  const norm = segment.trim().toLowerCase().replace(/\./g, "");
  return COUNTRY_ALIASES[norm] ?? null;
}

function placeSegments(place: string): string[] {
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
  const key = normalizeKey(originalText);
  if (!key) return null;
  if (standardizeCache.has(key)) return standardizeCache.get(key) ?? null;

  let entries: SearchEntry[];
  try {
    entries = await getSearchEntries(originalText, opts.contextName);
  } catch {
    return null; // transient failure after retries — do not cache
  }

  const best = pickBest(entries);
  const standardPlace = best?.fullName ?? null;
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
