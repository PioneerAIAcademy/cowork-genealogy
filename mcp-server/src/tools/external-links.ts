import type {
  ExternalLink,
  ExternalLinksResult,
  FSExternalCollection,
  FSExternalResponse,
} from "../types/external-links.js";

export interface ExternalLinksToolInput {
  placeId: string;
  startYear: number;
  endYear: number;
}

const FS_EXTERNAL_URL =
  "https://www.familysearch.org/service/search/hr/external/collections/search";

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

// Same WAF-bypass UA as collections.ts. FS's Imperva/Incapsula layer
// 403s requests without a browser-like User-Agent on this endpoint.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function parseYear(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function overlapsRange(
  collection: FSExternalCollection,
  userStart: number,
  userEnd: number
): boolean {
  const cStart = parseYear(collection.startYear);
  const cEnd = parseYear(collection.endYear);
  if (cStart === null && cEnd === null) return true;
  const effectiveStart = cStart ?? cEnd ?? userStart;
  const effectiveEnd = cEnd ?? cStart ?? userEnd;
  return effectiveStart <= userEnd && effectiveEnd >= userStart;
}

async function fetchPage(
  placeId: string,
  offset: number
): Promise<FSExternalResponse> {
  const url = new URL(FS_EXTERNAL_URL);
  url.searchParams.set("q.placeId", placeId);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("count", String(PAGE_SIZE));

  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
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
    return (await res.json()) as FSExternalResponse;
  } catch {
    throw new Error(
      "FamilySearch returned a response that was not valid JSON. " +
        "Retry once; if it persists, surface this to the user."
    );
  }
}

export async function externalLinks(
  input: ExternalLinksToolInput
): Promise<ExternalLinksResult> {
  const { placeId, startYear, endYear } = input;

  if (!placeId || typeof placeId !== "string") {
    throw new Error(
      "placeId is required and must be a non-empty string. " +
        "Re-read the tool's input schema and retry with corrected arguments."
    );
  }
  if (endYear < startYear) {
    throw new Error(
      "endYear must be greater than or equal to startYear. " +
        "Re-read the tool's input schema and retry with corrected arguments."
    );
  }

  const all: FSExternalCollection[] = [];
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
      `[external_links] pagination cap reached: fetched ${offset} of ${totalResults} for placeId=${placeId}`
    );
  }

  const matched = all.filter((c) => overlapsRange(c, startYear, endYear));

  const place =
    all.find((c) => typeof c.place === "string" && c.place.length > 0)
      ?.place ?? null;

  const results: ExternalLink[] = matched
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

export const externalLinksSchema = {
  name: "external_links",
  description:
    "Return FamilySearch-curated third-party genealogy resource URLs for a place and year range. " +
    "Use when the user wants links to external record collections (Ancestry, MyHeritage, FindMyPast, " +
    "national archives, etc.) covering a specific place by FamilySearch place ID and time period. " +
    "Returns every collection whose date range overlaps [startYear, endYear], plus undated wiki/website " +
    "resources for that place. Requires a place ID — do not guess; obtain it from the population tool " +
    "or the user.",
  inputSchema: {
    type: "object" as const,
    properties: {
      placeId: {
        type: "string",
        description:
          "FamilySearch place ID (numeric string), e.g. '1927089' for France. " +
          "Get this from the population MCP server, not by guessing.",
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
