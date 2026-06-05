import { BROWSER_USER_AGENT } from "../constants.js";
import { standardPlaceToPlaceId } from "../utils/place-resolver.js";
import type {
  PlaceExternalLink,
  PlaceExternalLinksResult,
  FSPlaceExternalCollection,
  FSPlaceExternalResponse,
} from "../types/place-external-links.js";

export interface PlaceExternalLinksToolInput {
  standardPlace: string;
  startYear: number;
  endYear: number;
}

const FS_EXTERNAL_URL =
  "https://www.familysearch.org/service/search/hr/external/collections/search";

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

function parseYear(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function overlapsRange(
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

export async function placeExternalLinksTool(
  input: PlaceExternalLinksToolInput
): Promise<PlaceExternalLinksResult> {
  const { standardPlace } = input;
  // The MCP SDK does not validate arguments against inputSchema, and the
  // LLM sometimes passes year values as strings despite the integer
  // schema. Coerce defensively so the comparisons below stay numeric.
  const startYear = Number(input.startYear);
  const endYear = Number(input.endYear);

  if (!standardPlace || typeof standardPlace !== "string") {
    throw new Error(
      "standardPlace is required and must be a non-empty string. " +
        "Re-read the tool's input schema and retry with corrected arguments."
    );
  }
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) {
    throw new Error(
      "startYear and endYear are required and must be numeric. " +
        "Re-read the tool's input schema and retry with corrected arguments."
    );
  }
  if (endYear < startYear) {
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

  const all: FSPlaceExternalCollection[] = [];
  let offset = 0;
  let totalResults = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchPage(placeId, offset);
    const collections = data.collections ?? [];
    totalResults = data.totalResults ?? 0;
    all.push(...collections);

    const advanced = collections.length;
    if (advanced === 0) break;
    offset += advanced;
    if (offset >= totalResults) break;
  }

  if (offset < totalResults) {
    console.error(
      `[place_external_links] pagination cap reached: fetched ${offset} of ${totalResults} for placeId=${placeId}`
    );
  }

  const matched = all.filter((c) => overlapsRange(c, startYear, endYear));

  const place =
    all.find((c) => typeof c.place === "string" && c.place.length > 0)
      ?.place ?? null;

  const results: PlaceExternalLink[] = matched
    .filter((c) => typeof c.url === "string" && c.url.length > 0)
    .map((c) => ({
      url: c.url as string,
      linkText: c.linkText ?? "",
    }));

  return {
    standardPlace,
    place,
    totalResults,
    matchedCount: results.length,
    results,
  };
}

export const placeExternalLinksToolSchema = {
  name: "place_external_links",
  description:
    "Return FamilySearch-curated third-party genealogy resource URLs for a place and year range. " +
    "Use when the user wants links to external record collections (Ancestry, MyHeritage, FindMyPast, " +
    "national archives, etc.) covering a specific place by standard place name and time period. " +
    "Returns every collection whose date range overlaps [startYear, endYear], plus undated wiki/website " +
    "resources for that place. Pass the standard place name (the `standardPlace` field from place_search).",
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
        description: "Earliest year of interest (inclusive).",
      },
      endYear: {
        type: "integer",
        minimum: 1500,
        maximum: 2100,
        description:
          "Latest year of interest (inclusive). Must be >= startYear.",
      },
    },
    required: ["standardPlace", "startYear", "endYear"],
  },
};
