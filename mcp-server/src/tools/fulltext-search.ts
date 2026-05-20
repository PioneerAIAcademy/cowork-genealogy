import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import type {
  FulltextSearchInput,
  FulltextSearchResponse,
  FulltextResult,
  FulltextFacet,
  FSFulltextResponse,
  FSFulltextEntry,
  FSFulltextFacetItem,
} from "../types/fulltext-search.js";

export type { FulltextSearchInput } from "../types/fulltext-search.js";

const FS_FULLTEXT_URL =
  "https://www.familysearch.org/service/search/fulltext/search";

function validateInput(input: FulltextSearchInput): void {
  if (!input.keywords && !input.name && !input.place && !input.nlQuery && !input.dgsNumber) {
    throw new Error(
      "At least one of keywords, name, place, nlQuery, or dgsNumber is required."
    );
  }
  if (input.count !== undefined) {
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 100) {
      throw new Error("count must be between 1 and 100.");
    }
  }
  if (input.offset !== undefined) {
    if (!Number.isInteger(input.offset) || input.offset < 0) {
      throw new Error("offset must be non-negative.");
    }
  }
  if (
    (input.yearFrom !== undefined) !== (input.yearTo !== undefined)
  ) {
    throw new Error("yearFrom and yearTo must be provided together.");
  }
  if (
    input.yearFrom !== undefined &&
    input.yearTo !== undefined &&
    input.yearFrom > input.yearTo
  ) {
    throw new Error("yearFrom must be <= yearTo.");
  }
}

function buildUrl(input: FulltextSearchInput): string {
  const params: string[] = [];
  const add = (key: string, value: string | number): void => {
    params.push(`${key}=${encodeURIComponent(String(value))}`);
  };

  if (input.keywords) add("q.text", input.keywords);
  if (input.name) add("q.fullName", input.name);
  if (input.place) add("q.recordPlace", input.place);
  if (input.nlQuery) add("nlQuery", input.nlQuery);
  if (input.collectionId) add("f.collectionId", input.collectionId);
  if (input.dgsNumber) add("q.groupName", input.dgsNumber);
  if (input.yearFrom !== undefined) add("f.recordYear0", input.yearFrom);
  if (input.yearTo !== undefined) add("f.recordYear1", input.yearTo);
  if (input.recordType) add("f.recordType0", input.recordType);
  if (input.recordPlace0) add("f.recordPlace0", input.recordPlace0);
  if (input.recordPlace1) add("f.recordPlace1", input.recordPlace1);
  if (input.recordPlace2) add("f.recordPlace2", input.recordPlace2);
  if (input.recordPlace3) add("f.recordPlace3", input.recordPlace3);

  add("count", input.count ?? 5);
  add("offset", input.offset ?? 0);
  add("m.queryRequireDefault", "on");

  if (input.includeFacets) {
    add("m.defaultFacets", "on");
  }

  return `${FS_FULLTEXT_URL}?${params.join("&")}`;
}

function dedupeStrings(arr: string[]): string[] {
  return [...new Set(arr)];
}

function mapEntry(entry: FSFulltextEntry): FulltextResult | null {
  if (!entry.id) return null;
  const content = entry.content;

  const names = dedupeStrings(
    (content?.entities ?? [])
      .filter((e) => e.type === "NAME")
      .map((e) => e.value)
  );

  const places = dedupeStrings(
    (content?.entities ?? [])
      .filter((e) => e.type === "PLACE")
      .map((e) => e.value)
  );

  const dates = dedupeStrings(
    (content?.entities ?? [])
      .filter((e) => e.type === "DATE")
      .map((e) => e.value)
  );

  const highlights = content?.highlightTexts ?? [];

  const result: FulltextResult = { id: entry.id };
  if (entry.sourceUrl) result.sourceUrl = entry.sourceUrl;
  if (entry.collectionId) result.collectionId = entry.collectionId;
  if (entry.collectionTitle) result.collectionTitle = entry.collectionTitle;
  if (content?.title) result.title = content.title;
  if (content?.recordDate) result.recordDate = content.recordDate;
  if (content?.recordType) result.recordType = content.recordType;
  if (content?.recordPlace) result.recordPlace = content.recordPlace;
  if (content?.textDocument) result.textDocument = content.textDocument;
  if (names.length) result.names = names;
  if (places.length) result.places = places;
  if (dates.length) result.dates = dates;
  if (highlights.length) result.highlightTerms = highlights;

  return result;
}

function mapFacets(raw: FSFulltextFacetItem[]): FulltextFacet[] {
  return raw
    .filter((f) => f.displayName && f.facets?.length)
    .map((f) => ({
      name: f.displayName!,
      count: f.count,
      items: (f.facets ?? [])
        .filter((item) => item.displayName)
        .slice(0, 20)
        .map((item) => ({
          name: item.displayName!,
          count: item.count,
          filterParam: item.params ?? "",
        })),
    }));
}

function echoQuery(input: FulltextSearchInput): Record<string, string | number | boolean> {
  const echo: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) echo[key] = value as string | number | boolean;
  }
  return echo;
}

export async function fulltextSearchTool(
  input: FulltextSearchInput
): Promise<FulltextSearchResponse> {
  validateInput(input);

  const token = await getValidToken();
  const url = buildUrl(input);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": BROWSER_USER_AGENT,
  };
  if (input.nlQuery) {
    headers["X-FS-Feature-Tag"] = "search_naturalLanguageSupport";
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "FamilySearch session expired; call the login tool to re-authenticate."
      );
    }
    if (response.status === 403) {
      throw new Error(
        "FamilySearch blocked the request. Check that the MCP server is running an unmodified build."
      );
    }
    if (response.status === 400) {
      let body: string;
      try {
        body = await response.text();
      } catch {
        body = "";
      }
      throw new Error(
        `FamilySearch full-text search rejected the query (400). ` +
        `Check query syntax — operators: + (require), - (exclude), "..." (phrase), * (wildcard). ` +
        (body ? `Detail: ${body.slice(0, 200)}` : "")
      );
    }
    throw new Error(
      `FamilySearch full-text search error: ${response.status} ${response.statusText}`
    );
  }

  const data: FSFulltextResponse = await response.json();
  const entries = data.entries ?? [];
  const results = entries
    .map(mapEntry)
    .filter((r): r is FulltextResult => r !== null);

  const out: FulltextSearchResponse = {
    query: echoQuery(input),
    totalResults: data.results ?? 0,
    returned: results.length,
    offset: data.index ?? input.offset ?? 0,
    hasMore: data.links?.next?.href != null,
    results,
  };

  if (input.includeFacets && data.facets) {
    out.facets = mapFacets(data.facets);
  }

  return out;
}

export const fulltextSearchToolSchema = {
  name: "fulltext_search",
  description:
    "Search FamilySearch's AI-transcribed historical document images using full-text search. " +
    "Unlike the indexed search tool, this searches raw transcript text with Lucene-style operators " +
    "(+ require, - exclude, \"...\" phrase, * wildcard). Finds people mentioned anywhere in a document " +
    "(witnesses, neighbors, heirs, appraisers), not just indexed principals. " +
    "No fuzzy matching — use + to require terms, otherwise default is OR. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      keywords: {
        type: "string",
        description:
          'Full-text search query with Lucene operators. Use + to require a term, - to exclude, "..." for phrase, * for wildcard (min 3 chars). ' +
          'Examples: "+Patrick +Flynn", "+"Last Will and Testament" +Flynn". Default is OR — always use + for required terms.',
      },
      name: {
        type: "string",
        description:
          "Search within name fields only. Same operator syntax as keywords.",
      },
      place: {
        type: "string",
        description:
          "Search within place fields. Note: place matches collection metadata and can cause false positives. Prefer post-filtering.",
      },
      nlQuery: {
        type: "string",
        description:
          "Natural language search query or a FamilySearch tree person ID (e.g. \"Search for John Doe born in Austria\" or \"KD96-TV2\").",
      },
      collectionId: {
        type: "string",
        description: "Filter to a specific FamilySearch collection by ID.",
      },
      dgsNumber: {
        type: "string",
        description:
          "Filter to a specific digitized volume by DGS (Image Group Number).",
      },
      yearFrom: {
        type: "number",
        description: "Start of year range filter. Must be paired with yearTo.",
      },
      yearTo: {
        type: "number",
        description: "End of year range filter. Must be paired with yearFrom.",
      },
      recordType: {
        type: "string",
        description: "Filter by record type.",
      },
      recordPlace0: {
        type: "string",
        description: "Filter by region.",
      },
      recordPlace1: {
        type: "string",
        description:
          "Filter by country (or state within US/Mexico/Canada/UK).",
      },
      recordPlace2: {
        type: "string",
        description: "Filter by county.",
      },
      recordPlace3: {
        type: "string",
        description: "Filter by city.",
      },
      count: {
        type: "number",
        description: "Number of results to return. Default 5, max 100.",
      },
      offset: {
        type: "number",
        description: "Pagination offset. Default 0.",
      },
      includeFacets: {
        type: "boolean",
        description:
          "When true, include facet counts for collection, place, year, and record type in the response. Default false.",
      },
    },
  },
};
