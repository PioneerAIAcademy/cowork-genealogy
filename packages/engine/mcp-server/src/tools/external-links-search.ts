import { BROWSER_USER_AGENT } from "../constants.js";
import { fetchWithRetry } from "../utils/http.js";
import { resolveStandardPlaceToPlaceId, ambiguousPlaceError } from "../utils/place-resolver.js";
import {
  stageSearchResults,
  unloggedStagedSearches,
  formatUnloggedRefs,
  UNLOGGED_SEARCHES_NOTE,
  NIL_SEARCH_NEEDS_LOG_NOTE,
} from "../utils/results-staging.js";
import {
  dedupeCollections,
  recordExternalCollections,
  EXTERNAL_COLLECTIONS_FILE,
  type StoredCollectionRow,
} from "../utils/external-collections-store.js";
import type {
  PlaceExternalLink,
  ExternalLinksSearchResult,
  FSPlaceExternalCollection,
  FSPlaceExternalResponse,
} from "../types/external-links-search.js";

export interface ExternalLinksSearchInput {
  standardPlace: string;
  startYear?: number;
  endYear?: number;
  host?: string;
  projectPath?: string;
}

const FS_EXTERNAL_URL =
  "https://www.familysearch.org/service/search/hr/external/collections/search";

// The endpoint's row cap: count=1001 is HTTP 400, and count=1000 returns a place's
// whole list in one response (Pennsylvania 510/510, New York 795/795, measured).
// One request, never paging: the endpoint's order changes on every call, so
// offset paging repeats and skips rows (six fetches of Venango's 510 gave
// 337-365 unique rows).
const FETCH_COUNT = 1000;

// Cap on the inline `results[]` only, applied on every call after dedupe. The
// stored list (`external-collections.json`) holds every row and the staged
// sidecar every year-filtered row; `inlineCapped` says when this cut the inline copy.
const INLINE_CAP = 200;

function parseYear(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

// An undated resource (no start and no end year) is always included, regardless
// of the year filter. A dated resource is included when its range overlaps
// [userStart, userEnd]. Missing user bounds widen to ±Infinity, so passing only
// one bound is a half-open filter.
function includeCollection(
  collection: FSPlaceExternalCollection,
  userStart: number,
  userEnd: number
): boolean {
  const cStart = parseYear(collection.startYear);
  const cEnd = parseYear(collection.endYear);
  if (cStart === null && cEnd === null) return true;
  const effectiveStart = cStart ?? (cEnd as number);
  const effectiveEnd = cEnd ?? (cStart as number);
  return effectiveStart <= userEnd && effectiveEnd >= userStart;
}

function includeRow(row: StoredCollectionRow, userStart: number, userEnd: number): boolean {
  return includeCollection({ startYear: row.start_year, endYear: row.end_year }, userStart, userEnd);
}

async function fetchAll(placeId: string): Promise<FSPlaceExternalResponse> {
  const url = new URL(FS_EXTERNAL_URL);
  url.searchParams.set("q.placeId", placeId);
  url.searchParams.set("offset", "0");
  url.searchParams.set("count", String(FETCH_COUNT));

  const res = await fetchWithRetry(url, {
    headers: {
      "User-Agent": BROWSER_USER_AGENT,
      Accept: "application/json",
    },
  });

  if (res.status === 403) {
    throw new Error(
      `FamilySearch rejected the request (403 Forbidden). ` +
        "This usually means a User-Agent block — check that the MCP server is running an unmodified build."
    );
  }
  if (res.status === 429) {
    throw new Error(
      "FamilySearch rate limit reached and did not clear within the retry budget. " +
        "Wait 60 seconds and retry once. If it persists, surface this to the user."
    );
  }
  if (!res.ok) {
    throw new Error(
      `FamilySearch external-links API error: ${res.status} ${res.statusText}.`
    );
  }

  try {
    return (await res.json()) as FSPlaceExternalResponse;
  } catch {
    throw new Error(
      "FamilySearch returned a response that was not valid JSON. " +
        "Retry once; if it persists, surface this to the user."
    );
  }
}

export async function externalLinksSearchTool(
  input: ExternalLinksSearchInput
): Promise<ExternalLinksSearchResult> {
  const { standardPlace } = input;
  // The MCP SDK does not validate arguments against inputSchema, and the
  // LLM sometimes passes year values as strings despite the integer schema.
  // Coerce defensively so the comparisons below stay numeric. Years are
  // optional; an omitted bound means "all periods".
  const hasStart = input.startYear != null;
  const hasEnd = input.endYear != null;
  const startYear = hasStart ? Number(input.startYear) : undefined;
  const endYear = hasEnd ? Number(input.endYear) : undefined;

  if (!standardPlace || typeof standardPlace !== "string") {
    throw new Error(
      "standardPlace is required and must be a non-empty string. " +
        "Re-read the tool's input schema and retry with corrected arguments."
    );
  }
  if (
    (hasStart && !Number.isFinite(startYear)) ||
    (hasEnd && !Number.isFinite(endYear))
  ) {
    throw new Error(
      "startYear and endYear must be numeric when provided. " +
        "Re-read the tool's input schema and retry with corrected arguments."
    );
  }
  if (startYear != null && endYear != null && endYear < startYear) {
    throw new Error(
      "endYear must be greater than or equal to startYear. " +
        "Re-read the tool's input schema and retry with corrected arguments."
    );
  }

  // Resolve the standard place name to a FamilySearch placeId only after the
  // cheap guards, so malformed input never hits the network.
  const resolution = await resolveStandardPlaceToPlaceId(standardPlace);
  if (resolution.kind === "ambiguous") {
    throw ambiguousPlaceError(standardPlace, resolution.candidates);
  }
  if (resolution.kind === "unresolved") {
    throw new Error(
      `Could not resolve "${standardPlace}" to a FamilySearch place. ` +
        "Use place_search to get a standard place name first."
    );
  }
  const placeId = resolution.placeId;

  const data = await fetchAll(placeId);
  const collections = data.collections ?? [];
  const totalResults = data.totalResults;
  // A partial list is an error, never an answer: a stored list that silently
  // lacks rows reads to every later caller as "this collection is not here".
  if (typeof totalResults !== "number" || !Number.isFinite(totalResults)) {
    throw new Error(
      "FamilySearch's external-links response carried no totalResults, so whether the list is " +
        "complete cannot be told. Nothing was stored. Retry once; if it persists, surface this to the user.",
    );
  }
  if (totalResults > FETCH_COUNT) {
    throw new Error(
      `"${standardPlace}" has ${totalResults} curated links, more than the ${FETCH_COUNT} one request ` +
        "can return, so the list would be partial. Nothing was stored. Request a smaller place — a " +
        "state or county, not a whole country such as the United States.",
    );
  }
  if (totalResults > collections.length) {
    throw new Error(
      `FamilySearch returned ${collections.length} of the ${totalResults} curated links for ` +
        `"${standardPlace}", so the list is partial. Nothing was stored. Retry once; if it persists, ` +
        "surface this to the user.",
    );
  }

  const rows = dedupeCollections(
    collections.filter((c): c is FSPlaceExternalCollection & { url: string } => typeof c.url === "string"),
    standardPlace,
  );
  const totalForPlace = rows.length;

  // When no years are given, every resource matches (dated and undated alike).
  const matchedRows =
    startYear == null && endYear == null
      ? rows
      : rows.filter((r) =>
          includeRow(
            r,
            startYear ?? Number.NEGATIVE_INFINITY,
            endYear ?? Number.POSITIVE_INFINITY
          )
        );

  // The full year-filtered set (all hosts). This is what gets staged to disk —
  // host filtering and the inline cap narrow only the inline copy. Most specific
  // place first (more comma segments), so a county's own few rows lead and the
  // 200 cap falls on the end of its state's long list, never on them. The sort is
  // stable over the stored order (place, then key), so it stays deterministic.
  const depth = (place: string): number => place.split(",").length;
  const allLinks: PlaceExternalLink[] = [...matchedRows]
    .sort((a, b) => depth(b.place) - depth(a.place))
    .map((r) => ({
    url: r.url,
    linkText: r.link_text,
  }));

  const query: ExternalLinksSearchResult["query"] = { standardPlace };
  if (startYear != null) query.startYear = startYear;
  if (endYear != null) query.endYear = endYear;

  // Read BEFORE this call stages its own response, or the count includes the search
  // being answered right now. Advisory: never throws, 0 on any failure.
  const unloggedStaged =
    input.projectPath !== undefined
      ? await unloggedStagedSearches(input.projectPath)
      : [];

  const out: ExternalLinksSearchResult = {
    query,
    totalForPlace,
    returned: 0,
    // Both notes are declared here, ahead of `results`, for the same reason
    // record_search orders them so: a field after the largest field is the first
    // thing a size bound drops.
    ...(unloggedStaged.length > 0
      ? {
          unloggedSearches: UNLOGGED_SEARCHES_NOTE.replace(
            "{n}",
            String(unloggedStaged.length),
          ).replace("{refs}", formatUnloggedRefs(unloggedStaged.map((s) => s.ref))),
        }
      : {}),
    // Keyed on the PRE-FILTER set. `results` below is host-filtered and capped, so a
    // `host:` search against a place whose links are all on other hosts returns an
    // empty `results` with a non-null `staged` — telling the model to record a
    // negative finding there would deny a place that has records.
    ...(input.projectPath !== undefined && allLinks.length === 0
      ? { nilSearchNeedsLog: NIL_SEARCH_NEEDS_LOG_NOTE }
      : {}),
    results: [],
  };

  // Host-side result staging (search-result-staging-spec.md). Stage the FULL
  // year-filtered set BEFORE any host filter or inline cap, so the complete link
  // list is retained on disk (research record + feedback bundles) even when the
  // inline copy is narrowed. Purely additive and best-effort: a staging failure
  // never fails a successful search.
  if (input.projectPath !== undefined) {
    try {
      out.staged = await stageSearchResults({
        projectPath: input.projectPath,
        tool: "external_links_search",
        response: { results: allLinks },
      });
    } catch (error) {
      out.staged = null;
      out.stagingError = error instanceof Error ? error.message : String(error);
    }
  }

  // Narrow the inline copy. The `host` filter is the caller's explicit query
  // narrowing (return only their target site's links), so it always applies.
  const host =
    typeof input.host === "string" ? input.host.trim().toLowerCase() : "";
  let inline = host
    ? allLinks.filter((r) => r.url.toLowerCase().includes(host))
    : allLinks;

  if (inline.length > INLINE_CAP) {
    inline = inline.slice(0, INLINE_CAP);
    out.inlineCapped = true;
  }

  // Keep the full list in the project (every row, every year, every host). A
  // failure here never fails a search that succeeded; it is reported instead.
  if (input.projectPath !== undefined) {
    try {
      const places = await recordExternalCollections(input.projectPath, standardPlace, rows);
      if (places === null) {
        out.collectionsError =
          "Nothing was stored: projectPath does not name a project folder (one holding " +
          "research.json or tree.gedcomx.json).";
      } else {
        out.stored = { file: EXTERNAL_COLLECTIONS_FILE, places };
      }
    } catch (error) {
      out.collectionsError = error instanceof Error ? error.message : String(error);
    }
  }

  out.results = inline;
  out.returned = inline.length;
  return out;
}

export const externalLinksSearchToolSchema = {
  name: "external_links_search",
  description:
    "Return FamilySearch-curated third-party genealogy resource URLs for a place, " +
    "optionally filtered by year range. Use when the user wants links to external " +
    "record collections (Ancestry, MyHeritage, FindMyPast, national archives, etc.) " +
    "covering a specific place by standard place name. Pass a standardPlace from " +
    "place_search; add startYear/endYear to keep only collections whose date range " +
    "overlaps that window. Undated wiki/website resources for the place are always " +
    "included. With no years, every resource for the place is returned. " +
    "Pass `host` to filter to a single target site (e.g. 'ancestry.com'); the " +
    "response returns only matching links plus `returned` (their count). Pass " +
    "`projectPath` to stage the full year-filtered set to disk and get a " +
    "`staged.resultsRef` handle (pass it to research_log_append as " +
    "`stagedResultsRef` so the complete link list is retained); the full list is also " +
    "stored for research_query({section: 'external_collections'}). Inline `results[]` is " +
    "deduplicated and capped at 200 (`inlineCapped`). A whole country such as the United " +
    "States is too large: ask for a state.",
  inputSchema: {
    type: "object" as const,
    properties: {
      standardPlace: {
        type: "string",
        description:
          "The standard place name (the `standardPlace` field from place_search, e.g. 'France'). " +
          "The tool resolves it to a FamilySearch place ID internally.",
      },
      startYear: {
        type: "integer",
        minimum: 1500,
        maximum: 2100,
        description: "Earliest year of interest (inclusive). Omit for all periods.",
      },
      endYear: {
        type: "integer",
        minimum: 1500,
        maximum: 2100,
        description:
          "Latest year of interest (inclusive). Must be >= startYear. Omit for all periods.",
      },
      host: {
        type: "string",
        description:
          "Optional target-site host substring (e.g. 'ancestry.com', 'findagrave.com'). " +
          "When supplied, the inline `results[]` is filtered to links whose URL contains it — " +
          "returning the small exact set you need instead of every curated site for the place. " +
          "The full unfiltered set is still what gets staged to disk when `projectPath` is passed.",
      },
      projectPath: {
        type: "string",
        description:
          "Absolute path to the active project directory. When supplied, the tool stages the full " +
          "year-filtered link set host-side and returns a `staged.resultsRef` handle — pass that to " +
          "research_log_append as `stagedResultsRef` so the complete list is retained in the log " +
          "sidecar (and rides along in a feedback bundle) without you re-serializing it, and " +
          "stores the place's full list. Omit only for a throwaway exploratory lookup you will not log.",
      },
    },
    required: ["standardPlace"],
  },
};
