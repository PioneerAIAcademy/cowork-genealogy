import { BROWSER_USER_AGENT } from "../constants.js";
import type {
  PlaceExternalLink,
  PlaceExternalLinksResult,
  FSPlaceExternalCollection,
  FSPlaceExternalResponse,
} from "../types/place-external-links.js";

export interface PlaceExternalLinksToolInput {
  placeId: string;
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
  const { placeId } = input;
  // The MCP SDK does not validate arguments against inputSchema, and the
  // LLM sometimes passes year values as strings despite the integer
  // schema. Coerce defensively so the comparisons below stay numeric.
  const startYear = Number(input.startYear);
  const endYear = Number(input.endYear);

  if (!placeId || typeof placeId !== "string") {
    throw new Error(
      "placeId is required and must be a non-empty string. " +
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
    "national archives, etc.) covering a specific place by FamilySearch place ID and time period. " +
    "Returns every collection whose date range overlaps [startYear, endYear], plus undated wiki/website " +
    "resources for that place. Requires a place ID — do not guess; obtain it from the places tool " +
    "or the user.",
  inputSchema: {
    type: "object" as const,
    properties: {
      placeId: {
        type: "string",
        description:
          "FamilySearch place ID (numeric string), e.g. '1927089' for France. " +
          "Get this from the places tool, not by guessing.",
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
    required: ["placeId", "startYear", "endYear"],
  },
};
