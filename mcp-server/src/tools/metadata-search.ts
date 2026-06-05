import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { placeIdToRepIds } from "./place-search.js";
import type {
  MetadataSearchInput,
  MetadataSearchResult,
  MetadataGroup,
  SimplifiedCoverage,
  MetadataRmsSearchRequest,
  MetadataRmsSearchResponse,
  MetadataRmsGroup,
  MetadataRmsCoverageEntry,
  FulltextGroupNumberResponse,
} from "../types/metadata-search.js";

const RMS_SEARCH_URL =
  "https://sg30p0.familysearch.org/service/records/rms/group-service/group/search";
const FULLTEXT_GROUP_URL =
  "https://sg30p0.familysearch.org/service/search/fulltext/search/groupNumber";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RECORD_TYPE_PLACEHOLDER_RE = /^(concept-id|title):/;

function validate(input: MetadataSearchInput): void {
  if (!input.placeId) {
    throw new Error("metadata_search requires a placeId.");
  }
  if (input.fromDate && !DATE_RE.test(input.fromDate)) {
    throw new Error(
      "fromDate must be in YYYY-MM-DD format (e.g., '1730-01-01')."
    );
  }
  if (input.toDate && !DATE_RE.test(input.toDate)) {
    throw new Error(
      "toDate must be in YYYY-MM-DD format (e.g., '1810-12-31')."
    );
  }
}

function rmsHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": BROWSER_USER_AGENT,
    "FS-User-Agent-Chain": "chesworth",
  };
}

async function callGroupSearch(
  body: MetadataRmsSearchRequest,
  token: string
): Promise<MetadataRmsSearchResponse> {
  let response: Response;
  try {
    response = await fetch(RMS_SEARCH_URL, {
      method: "PUT",
      headers: rmsHeaders(token),
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(
      `Could not reach FamilySearch metadata search API: ${message}.`
    );
  }

  if (response.status === 401) {
    throw new Error(
      "FamilySearch session not accepted; call the login tool to re-authenticate."
    );
  }
  if (response.status === 403) {
    throw new Error("FamilySearch metadata search API error: 403 Forbidden.");
  }
  if (!response.ok) {
    throw new Error(
      `FamilySearch metadata search API error: ${response.status} ${response.statusText}.`
    );
  }

  return (await response.json()) as MetadataRmsSearchResponse;
}

async function fetchFulltextSearchable(
  groupNames: string[],
  token: string
): Promise<Set<string> | null> {
  const ids = groupNames.join(",");
  const url = `${FULLTEXT_GROUP_URL}?ids=${encodeURIComponent(ids)}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: rmsHeaders(token) });
      if (!response.ok) {
        if (attempt === 2) return null;
        continue;
      }
      const data = (await response.json()) as FulltextGroupNumberResponse;
      return new Set(data.ids ?? []);
    } catch {
      if (attempt === 2) return null;
    }
  }
  return null;
}

function derivePrefix(groupName: string): string {
  const underscoreIdx = groupName.indexOf("_");
  return underscoreIdx === -1 ? groupName : groupName.slice(0, underscoreIdx);
}

function computeRecordSearchablePercent(group: MetadataRmsGroup): number | null {
  const total = group.childCount;
  const indexed = group.indexedChildCount;
  const nonIndexable = group.noIndexableDataChildCount ?? 0;
  if (total == null || indexed == null) return null;
  const denominator = total - nonIndexable;
  if (denominator <= 0) return null;
  return Math.round((indexed / denominator) * 100);
}

function mapCoverage(entry: MetadataRmsCoverageEntry): SimplifiedCoverage {
  const coverage: SimplifiedCoverage = { place: entry.place ?? "" };
  if (entry.datesOrig != null) coverage.dateRange = entry.datesOrig;
  if (
    entry.recordTypeOrig != null &&
    !RECORD_TYPE_PLACEHOLDER_RE.test(entry.recordTypeOrig)
  ) {
    coverage.recordType = entry.recordTypeOrig;
  }
  return coverage;
}

function mapGroup(
  group: MetadataRmsGroup,
  fulltextSet: Set<string> | null
): MetadataGroup {
  const imageGroupNumber = group.groupName;
  const imageGroupPrefix = derivePrefix(imageGroupNumber);
  const imageCount = group.childCount ?? null;
  const recordSearchablePercent = computeRecordSearchablePercent(group);
  const fulltextSearchable =
    fulltextSet === null ? null : fulltextSet.has(imageGroupNumber);

  const result: MetadataGroup = {
    imageGroupNumber,
    imageGroupPrefix,
    imageCount,
    recordSearchablePercent,
    fulltextSearchable,
    languages: group.languages ?? [],
    coverages: (group.coverages ?? []).map(mapCoverage),
  };

  if (group.title != null) result.title = group.title;
  if (group.volumes != null) result.volumes = group.volumes;

  return result;
}

export async function metadataSearchTool(
  input: MetadataSearchInput
): Promise<MetadataSearchResult> {
  validate(input);

  const token = await getValidToken();

  const placeRepIds = await placeIdToRepIds(input.placeId, token);
  if (placeRepIds.length === 0) {
    throw new Error(
      `No place representations found for placeId ${input.placeId}.`
    );
  }

  const body: MetadataRmsSearchRequest = {
    coverage: {
      placeRepIds,
      ...(input.fromDate ? { fromDateString: input.fromDate } : {}),
      ...(input.toDate ? { toDateString: input.toDate } : {}),
    },
    types: ["NATURAL"],
    returnChildCounts: true,
    active: true,
    pageSize: 100,
    ...(input.pageToken ? { nextPageToken: input.pageToken } : {}),
  };

  const response = await callGroupSearch(body, token);

  const groups = response.groups ?? [];
  const groupNames = groups.map((g) => g.groupName);

  const fulltextSet = groupNames.length > 0
    ? await fetchFulltextSearchable(groupNames, token)
    : new Set<string>();

  const mappedGroups = groups.map((g) => mapGroup(g, fulltextSet));

  const query: MetadataSearchResult["query"] = { placeId: input.placeId };
  if (input.fromDate) query.fromDate = input.fromDate;
  if (input.toDate) query.toDate = input.toDate;

  const result: MetadataSearchResult = {
    query,
    totalGroups: response.totalCount ?? 0,
    returned: response.numberReturned ?? 0,
    groups: mappedGroups,
  };

  if (response.nextPageToken != null) {
    result.nextPageToken = response.nextPageToken;
  }

  return result;
}

export const metadataSearchSchema = {
  name: "metadata_search",
  description:
    "Search FamilySearch's Records Management Service for image groups — " +
    "digitized volumes of historical documents (microfilm rolls, book scans) — " +
    "covering a place and date range. Provide a placeId from place_search and an " +
    "optional date range. For each volume it returns coverage (places, dates, " +
    "record types), how much of the volume is indexed for record_search " +
    "(recordSearchablePercent), and whether it is full-text searchable " +
    "(fulltextSearchable). Use the returned imageGroupNumber with image_search to " +
    "list the volume's images, or with fulltext_search to search its text. " +
    "Results are paginated — pass back nextPageToken (with the same placeId and " +
    "dates) as pageToken to get the next page. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      placeId: {
        type: "string",
        description:
          "FamilySearch place ID from place_search. Required. The tool " +
          "internally converts it to place representation IDs for the query.",
      },
      fromDate: {
        type: "string",
        description:
          "Start of date range in YYYY-MM-DD format (e.g., '1730-01-01').",
      },
      toDate: {
        type: "string",
        description:
          "End of date range in YYYY-MM-DD format (e.g., '1810-12-31').",
      },
      pageToken: {
        type: "string",
        description:
          "Pagination cursor. Pass the nextPageToken from a previous " +
          "response, together with the same placeId/fromDate/toDate, to " +
          "fetch the next page.",
      },
    },
    required: ["placeId"],
  },
};
