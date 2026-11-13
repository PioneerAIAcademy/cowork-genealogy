import type { Principal } from "../auth/principal.js";
import { getValidToken } from "../auth/refresh.js";
import { rejectedTokenMessage } from "../auth/config.js";
import { BROWSER_USER_AGENT, TOOL_RESULT_CHAR_BUDGET } from "../constants.js";
import { fsFetch } from "../utils/fs-fetch.js";
import { formatYearRange } from "../utils/search-helpers.js";
import type {
  FSCollectionData,
  FSCollectionEntry,
  FSCollectionsResponse,
  FSContentCount,
  Collection,
  CollectionCatalogLoader,
  CollectionCounts,
  CollectionsSearchResult,
} from "../types/collection.js";

const FS_COLLECTIONS_URL =
  "https://www.familysearch.org/service/search/hr/v2/collections";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** A collection's FamilySearch page, returned once per answer as
 *  `collectionUrl` rather than repeated on every row. */
export const COLLECTION_URL_TEMPLATE = "https://www.familysearch.org/search/collection/{id}";

/** The whole answer, as the server serializes it (`JSON.stringify(result)`,
 *  compact), stays at or under this many characters — the shared
 *  `TOOL_RESULT_CHAR_BUDGET`, as catalog_search's answer does. */
export const ANSWER_CHAR_BUDGET = TOOL_RESULT_CHAR_BUDGET;

// One un-retried request for the whole catalog (count=5000), so the budget
// covers a large body streaming in full. Cold calls have been measured at 33s
// and 36s, above the 30s default — those are slow successes today and a hard
// failure at the default, with no second attempt behind them.
const COLLECTIONS_TIMEOUT_MS = 60_000;

// Module-level cache for the full collections response: one slot. By default it
// is keyed on the token, so a second patron's call replaces the first's. With
// `shared` (GENEALOGY_SHARED_COLLECTIONS_CACHE, self-hosted beta E4) any caller's
// cached success is served to every caller: the catalog is titles and counts with
// no patron data. Only a success is stored, and no in-flight fetch is shared, so
// one patron's failed fetch never reaches another's call.
let cache: {
  token: string;
  data: FSCollectionsResponse;
  fetchedAt: number;
} | null = null;
let shared = false;

/**
 * Set by the hosted entrypoint from the process environment. Unset — the
 * `.mcpb`, the harnesses — the cache stays per token.
 */
export function configureCollectionsCache(options: { shared?: boolean }): void {
  shared = options.shared === true;
}

/** The mode in force, for the entrypoint's start-up line: read back from the
 *  module, so the line cannot claim a mode that was never configured. */
export function collectionsCacheMode(): "shared" | "per token" {
  return shared ? "shared" : "per token";
}

/**
 * Extract the FSCollectionData from a GEDCOMX-wrapped entry.
 * Returns null if the entry structure is unexpected.
 */
function unwrapEntry(entry: FSCollectionEntry): FSCollectionData | null {
  const collections = entry.content?.gedcomx?.collections;
  if (!collections || collections.length === 0) return null;
  return collections[0];
}

/**
 * Filter entries whose title contains the query string (case-insensitive).
 */
export function filterByQuery(
  entries: FSCollectionEntry[],
  query: string
): FSCollectionData[] {
  const lowerQuery = query.toLowerCase();
  const results: FSCollectionData[] = [];

  for (const entry of entries) {
    const data = unwrapEntry(entry);
    if (!data) continue;
    if (data.title.toLowerCase().includes(lowerQuery)) {
      results.push(data);
    }
  }

  return results;
}

/**
 * Derive the collection-title search term from a place. FamilySearch organizes
 * record collections at the state/province level for the United States, Canada,
 * and Mexico, and at the country level everywhere else. Given a `standardPlace`
 * (the fully-qualified name from place_search, e.g.
 * "Schuylkill, Pennsylvania, United States"), return the right title-match term:
 *   - United States   -> the state            ("Pennsylvania")
 *   - Canada / Mexico  -> "Country, State"      ("Canada, Ontario")
 *   - everywhere else  -> the country          ("France")
 *
 * The standardPlace format is comma-separated with the country last and the
 * state/province second-to-last. A free-text query that isn't a standardPlace
 * (no recognized country tail, e.g. "Census" or "Schuylkill County Pennsylvania")
 * passes through unchanged, so the tool still accepts an arbitrary place query.
 */
export function standardPlaceToCollectionsQuery(value: string): string {
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return value.trim();

  const country = parts[parts.length - 1];
  const state = parts.length >= 2 ? parts[parts.length - 2] : undefined;

  if (country === "United States") return state ?? country;
  if (country === "Canada" || country === "Mexico") {
    return state ? `${country}, ${state}` : country;
  }
  return country;
}

/**
 * Fetch all collections from FamilySearch (cached for 1 hour, per token unless
 * the cache is shared).
 */
export async function fetchAllCollections(
  token: string,
  principal: Principal,
): Promise<FSCollectionsResponse> {
  if (
    cache &&
    (shared || cache.token === token) &&
    Date.now() - cache.fetchedAt < CACHE_TTL_MS
  ) {
    return cache.data;
  }

  const url = `${FS_COLLECTIONS_URL}?count=5000&offset=0&facets=OFF`;

  const response = await fsFetch(
    principal,
    url,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": BROWSER_USER_AGENT,
      },
    },
    COLLECTIONS_TIMEOUT_MS,
  );

  // A rejected token is a sign-in problem, and says so in the caller's own
  // words (the desktop's login tool, the worker's button, the connector's link).
  if (response.status === 401) {
    throw new Error(await rejectedTokenMessage(principal));
  }
  if (!response.ok) {
    throw new Error(
      `FamilySearch collections API error: ${response.status} ${response.statusText}`
    );
  }

  const data: FSCollectionsResponse = await response.json();

  cache = { token, data, fetchedAt: Date.now() };
  return data;
}

/**
 * Clear the module-level cache (for testing).
 */
export function clearCollectionsCache(): void {
  cache = null;
}

/**
 * Get a count from a content array by resourceType suffix.
 */
function getCount(
  content: FSContentCount[] | undefined,
  typeSuffix: string
): number {
  const entry = content?.find((c) => c.resourceType.endsWith(typeSuffix));
  return entry?.count ?? 0;
}

/** Every catalog collection's counts by id: `personCount` as `toCollection`
 *  derives it, and the `/Record` count its rows no longer carry. */
export function collectionCountsById(data: FSCollectionsResponse): Map<string, CollectionCounts> {
  const out = new Map<string, CollectionCounts>();
  for (const entry of data.entries ?? []) {
    const c = unwrapEntry(entry);
    if (!c) continue;
    out.set(String(c.id), { personCount: getCount(c.content, "/Person"), recordCount: getCount(c.content, "/Record") });
  }
  return out;
}

/** The catalog through `principal`'s own FamilySearch session, for
 *  `research_append`'s locality count stamp. Bound at dispatch (`server.ts`), so
 *  `research-append.ts` imports no token code. */
export function collectionCatalogLoader(principal: Principal): CollectionCatalogLoader {
  return async () => collectionCountsById(await fetchAllCollections(await getValidToken(principal), principal));
}

function toCollection(data: FSCollectionData): Collection {
  const meta = data.searchMetadata?.[0];
  const dateRange = formatYearRange(meta?.startYear, meta?.endYear);

  return {
    id: data.id,
    title: data.title,
    dateRange,
    personCount: getCount(data.content, "/Person"),
  };
}

/**
 * The parts of a `standardPlace` below the collection scope it derives — for
 * "Palermo, Sicilia, Italy" (scope "Italy") that is Palermo and Sicilia; for
 * "Schuylkill, Pennsylvania, United States" (scope "Pennsylvania") it is
 * Schuylkill. A free-text query that passed through as its own scope has none.
 */
export function subPlaceTerms(standardPlace: string): string[] {
  const parts = standardPlace
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const scope = standardPlaceToCollectionsQuery(standardPlace);
  if (scope === standardPlace.trim()) return [];
  // The scope standardPlaceToCollectionsQuery derived is the country (the last
  // part) or a state level (the last two); every part before it is below it.
  return parts.slice(0, scope === parts[parts.length - 1] ? -1 : -2);
}

/** One whole-word, case-insensitive matcher per term, built once per answer. */
function wholeWordMatchers(terms: readonly string[]): RegExp[] {
  return terms.map((t) => {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
  });
}

/**
 * Hold the answer to `budget` characters of compact JSON. An answer already
 * within it is returned unchanged — the same rows, in catalog order, with no
 * `truncated` or `matched`. Over it, rows whose title names a part of
 * `standardPlace` below the scope come first, then the rest in catalog order,
 * and rows are kept in that order until the next would not fit; the answer then
 * carries `truncated: true` and `matched` (the rows before any were left out).
 */
export function fitToBudget(
  result: CollectionsSearchResult,
  standardPlace: string,
  budget: number = ANSWER_CHAR_BUDGET,
): CollectionsSearchResult {
  if (JSON.stringify(result).length <= budget) return result;

  const matchers = wholeWordMatchers(subPlaceTerms(standardPlace));
  const named: Collection[] = [];
  const rest: Collection[] = [];
  for (const r of result.results) (matchers.some((m) => m.test(r.title)) ? named : rest).push(r);
  const ordered = [...named, ...rest];

  const out: CollectionsSearchResult = {
    collectionUrl: result.collectionUrl,
    scope: result.scope,
    totalForPlace: result.totalForPlace,
    truncated: true,
    matched: result.results.length,
    results: [],
  };
  let size = JSON.stringify(out).length;
  for (const row of ordered) {
    const add = JSON.stringify(row).length + (out.results.length ? 1 : 0);
    if (size + add > budget) break;
    out.results.push(row);
    size += add;
  }
  return out;
}

// A collection overlaps [startYear, endYear] when its searchMetadata year span
// intersects the window. A collection with no year span (undated) is always
// included, mirroring the rest of the place-search family.
export function overlapsYears(
  data: FSCollectionData,
  startYear: number,
  endYear: number
): boolean {
  const meta = data.searchMetadata?.[0];
  const cStart = meta?.startYear;
  const cEnd = meta?.endYear;
  if (cStart == null && cEnd == null) return true;
  const effectiveStart = cStart ?? (cEnd as number);
  const effectiveEnd = cEnd ?? (cStart as number);
  return effectiveStart <= endYear && effectiveEnd >= startYear;
}

/**
 * Score how well the catalog covers a place and period: how many collections
 * (and indexed records) match the place's collection scope, overlap the years,
 * and, when `typeFacets` is given, carry one of those record-type facets
 * (VITAL, CENSUS, CHURCH_RECORD, ...). Pure over the already-fetched catalog.
 */
export function collectionCoverage(
  entries: FSCollectionEntry[],
  standardPlace: string,
  startYear: number,
  endYear: number,
  typeFacets?: readonly string[],
): { collections: number; records: number; recordTypes: string[]; censusYears: number[] } {
  const scope = standardPlaceToCollectionsQuery(standardPlace);
  const types = new Set<string>();
  const censusYears = new Set<number>();
  let records = 0;
  let collections = 0;
  for (const c of filterByQuery(entries, scope)) {
    if (!overlapsYears(c, startYear, endYear)) continue;
    const meta = c.searchMetadata?.[0];
    const facet = meta?.typeFacet;
    // A census names the whole household, so its years matter for every hole
    // type, not only those that list CENSUS among their facets.
    if (facet === "CENSUS" && meta?.startYear != null && meta.startYear === meta.endYear) {
      censusYears.add(meta.startYear);
    }
    if (typeFacets && (!facet || !typeFacets.includes(facet))) continue;
    collections += 1;
    records += meta?.recordCount ?? getCount(c.content, "/Record");
    if (facet) types.add(facet);
  }
  return { collections, records, recordTypes: [...types].sort(), censusYears: [...censusYears].sort((a, b) => a - b) };
}

// ---------- Tool entry point ----------

export interface CollectionsSearchInput {
  standardPlace: string;
  startYear?: number;
  endYear?: number;
}

export async function collectionsSearchTool(
  input: CollectionsSearchInput,
  principal: Principal
): Promise<CollectionsSearchResult> {
  if (!input.standardPlace) {
    throw new Error(
      "collections_search requires a standardPlace (preferably the standardPlace from place_search)."
    );
  }

  const hasStart = input.startYear != null;
  const hasEnd = input.endYear != null;
  const startYear = hasStart ? Number(input.startYear) : undefined;
  const endYear = hasEnd ? Number(input.endYear) : undefined;
  if (startYear != null && endYear != null && endYear < startYear) {
    throw new Error("endYear must be greater than or equal to startYear.");
  }

  // Derive the right collection scope (US state, "Country, State" for
  // Canada/Mexico, country otherwise). Free-text queries pass through.
  const scope = standardPlaceToCollectionsQuery(input.standardPlace);

  const token = await getValidToken(principal);
  const data = await fetchAllCollections(token, principal);
  const entries = data.entries ?? [];

  // Title match first; totalForPlace is this count, BEFORE any date filter.
  const matchedByScope = filterByQuery(entries, scope);

  const dateFiltered =
    startYear == null && endYear == null
      ? matchedByScope
      : matchedByScope.filter((c) =>
          overlapsYears(
            c,
            startYear ?? Number.NEGATIVE_INFINITY,
            endYear ?? Number.POSITIVE_INFINITY
          )
        );

  return fitToBudget(
    {
      collectionUrl: COLLECTION_URL_TEMPLATE,
      scope,
      totalForPlace: matchedByScope.length,
      results: dateFiltered.map(toCollection),
    },
    input.standardPlace,
  );
}

/**
 * MCP Tool Schema for collections_search (list mode).
 */
export const collectionsSearchToolSchema = {
  name: "collections_search",
  description:
    "List FamilySearch record collections for a place. Pass `standardPlace` — " +
    "preferably the standardized place name from place_search (e.g. " +
    "\"Schuylkill, Pennsylvania, United States\"); a plain place name also works. " +
    "FamilySearch organizes collections at the state/province level for the " +
    "United States, Canada, and Mexico, and at the country level everywhere else, " +
    "so results come back at that scope (the tool derives it and returns it as " +
    "`scope`). Optionally filter by startYear/endYear to keep only collections " +
    "whose date range overlaps that window. Each row is {id, title, dateRange, " +
    "personCount}; a collection's page is `collectionUrl` with `{id}` replaced by " +
    "the row's id. There is no pagination: the matched set comes back in one " +
    `response, held to ${ANSWER_CHAR_BUDGET.toLocaleString("en-US")} characters. ` +
    "When it is over that, `truncated: true` " +
    "is set, `matched` gives how many rows matched, and rows whose title names " +
    "a part of `standardPlace` below the scope are kept first. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      standardPlace: {
        type: "string",
        description:
          "The place to list collections for — preferably the `standardPlace` " +
          "from place_search (e.g. \"Schuylkill, Pennsylvania, United States\"). " +
          "The tool derives the right collection scope (the US state, " +
          "\"Country, State\" for Canada/Mexico, or the country) and matches it " +
          "against collection titles. A plain place name works too.",
      },
      startYear: {
        type: "integer",
        description:
          "Earliest year of interest (inclusive). Omit for all periods.",
      },
      endYear: {
        type: "integer",
        description:
          "Latest year of interest (inclusive). Must be >= startYear. Omit for all periods.",
      },
    },
    required: ["standardPlace"],
  },
};
