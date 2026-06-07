import { BROWSER_USER_AGENT } from "../constants.js";
import { standardPlaceToPlaceId } from "../utils/place-resolver.js";
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
}

const FS_EXTERNAL_URL =
  "https://www.familysearch.org/service/search/hr/external/collections/search";

const PAGE_SIZE = 100;

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

async function fetchPage(
  placeId: string,
  offset: number
): Promise<FSPlaceExternalResponse> {
  const url = new URL(FS_EXTERNAL_URL);
  url.searchParams.set("q.placeId", placeId);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("count", String(PAGE_SIZE));

  const res = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_USER_AGENT,
      Accept: "application/json",
    },
  });

  if (res.status === 403 || res.status === 429) {
    throw new Error(
      `FamilySearch rejected the request (status ${res.status}). ` +
        "This usually means rate limiting or a User-Agent block. " +
        "Wait 60 seconds and retry once. If it persists, surface this to the user."
    );
  }
  if (!res.ok) {
    throw new Error(
      `FamilySearch returned ${res.status}. ` +
        "Treat this as a transient error and retry once before giving up."
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
  const placeId = await standardPlaceToPlaceId(standardPlace);
  if (!placeId) {
    throw new Error(
      `Could not resolve "${standardPlace}" to a FamilySearch place. ` +
        "Use place_search to get a standard place name first."
    );
  }

  // The curated set per place is small; fetch every page so the returned set is
  // complete (no caller cursor — the tool filters client-side and returns the
  // whole filtered set in one response).
  const all: FSPlaceExternalCollection[] = [];
  let offset = 0;
  let totalForPlace = 0;

  for (;;) {
    const data = await fetchPage(placeId, offset);
    const collections = data.collections ?? [];
    totalForPlace = data.totalResults ?? 0;
    all.push(...collections);

    const advanced = collections.length;
    if (advanced === 0) break;
    offset += advanced;
    if (offset >= totalForPlace) break;
  }

  // When no years are given, every resource matches (dated and undated alike).
  const matched =
    startYear == null && endYear == null
      ? all
      : all.filter((c) =>
          includeCollection(
            c,
            startYear ?? Number.NEGATIVE_INFINITY,
            endYear ?? Number.POSITIVE_INFINITY
          )
        );

  const results: PlaceExternalLink[] = matched
    .filter((c) => typeof c.url === "string" && c.url.length > 0)
    .map((c) => ({
      url: c.url as string,
      linkText: c.linkText ?? "",
    }));

  const query: ExternalLinksSearchResult["query"] = { standardPlace };
  if (startYear != null) query.startYear = startYear;
  if (endYear != null) query.endYear = endYear;

  return {
    query,
    totalForPlace,
    results,
  };
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
    "included. With no years, every resource for the place is returned. The full " +
    "filtered set comes back in one response (no pagination).",
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
    },
    required: ["standardPlace"],
  },
};
