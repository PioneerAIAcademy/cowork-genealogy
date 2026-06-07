import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { standardPlaceToPlaceId, placeIdToRepIds } from "../utils/place-resolver.js";
import type {
  VolumeSearchInput,
  VolumeSearchResult,
  VolumeGroup,
  SimplifiedCoverage,
  MetadataRmsSearchRequest,
  MetadataRmsSearchResponse,
  MetadataRmsGroup,
  MetadataRmsCoverageEntry,
  FulltextGroupNumberResponse,
} from "../types/volume-search.js";

const RMS_SEARCH_URL =
  "https://sg30p0.familysearch.org/service/records/rms/group-service/group/search";
const FULLTEXT_GROUP_URL =
  "https://sg30p0.familysearch.org/service/search/fulltext/search/groupNumber";

const RECORD_TYPE_PLACEHOLDER_RE = /^(concept-id|title):/;

function validate(input: VolumeSearchInput): void {
  if (!input.standardPlace) {
    throw new Error("volume_search requires a standardPlace.");
  }
  if (input.startYear != null && !Number.isInteger(input.startYear)) {
    throw new Error("startYear must be an integer year (e.g., 1730).");
  }
  if (input.endYear != null && !Number.isInteger(input.endYear)) {
    throw new Error("endYear must be an integer year (e.g., 1810).");
  }
  if (
    input.startYear != null &&
    input.endYear != null &&
    input.endYear < input.startYear
  ) {
    throw new Error("endYear must be greater than or equal to startYear.");
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
      `Could not reach FamilySearch volume search API: ${message}.`
    );
  }

  if (response.status === 401) {
    throw new Error(
      "FamilySearch session not accepted; call the login tool to re-authenticate."
    );
  }
  if (response.status === 403) {
    throw new Error("FamilySearch volume search API error: 403 Forbidden.");
  }
  if (!response.ok) {
    throw new Error(
      `FamilySearch volume search API error: ${response.status} ${response.statusText}.`
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
): VolumeGroup {
  const imageGroupNumber = group.groupName;
  const imageGroupPrefix = derivePrefix(imageGroupNumber);
  const imageCount = group.childCount ?? null;
  const recordSearchablePercent = computeRecordSearchablePercent(group);
  const fulltextSearchable =
    fulltextSet === null ? null : fulltextSet.has(imageGroupNumber);

  const result: VolumeGroup = {
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

export async function volumeSearchTool(
  input: VolumeSearchInput
): Promise<VolumeSearchResult> {
  validate(input);

  // Auth first, so an unauthenticated user always gets the login-instruction
  // error (rather than a "could not resolve" message) regardless of the place.
  const token = await getValidToken();

  // Resolve the standard place name -> placeId -> all of its representation
  // IDs. standardPlaceToPlaceId returns null when the name is unresolvable or
  // resolves to multiple distinct spots (guards the fan-out).
  const placeId = await standardPlaceToPlaceId(input.standardPlace);
  if (!placeId) {
    throw new Error(
      `Could not resolve "${input.standardPlace}" to a single place; ` +
        "use place_search to get a standard place name first."
    );
  }

  const placeRepIds = await placeIdToRepIds(placeId);
  if (placeRepIds.length === 0) {
    throw new Error(
      `No place representations found for "${input.standardPlace}".`
    );
  }

  // The RMS API filters by ISO date strings; volume coverage is a year-range
  // concern, so derive whole-year bounds from the integer year inputs.
  const fromDateString =
    input.startYear != null ? `${input.startYear}-01-01` : undefined;
  const toDateString =
    input.endYear != null ? `${input.endYear}-12-31` : undefined;

  const body: MetadataRmsSearchRequest = {
    coverage: {
      // RMS expects numeric rep IDs; the resolver returns them as strings.
      // Drop any non-numeric id rather than emitting NaN (-> null) into the body.
      placeRepIds: placeRepIds.map(Number).filter((n) => !Number.isNaN(n)),
      ...(fromDateString ? { fromDateString } : {}),
      ...(toDateString ? { toDateString } : {}),
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

  const results = groups.map((g) => mapGroup(g, fulltextSet));

  const query: VolumeSearchResult["query"] = { standardPlace: input.standardPlace };
  if (input.startYear != null) query.startYear = input.startYear;
  if (input.endYear != null) query.endYear = input.endYear;

  const result: VolumeSearchResult = {
    query,
    totalResults: response.totalCount ?? 0,
    results,
  };

  if (response.nextPageToken != null) {
    result.nextPageToken = response.nextPageToken;
  }

  return result;
}

export const volumeSearchSchema = {
  name: "volume_search",
  description:
    "Search FamilySearch's Records Management Service for digitized volumes — " +
    "image groups of historical documents (microfilm rolls, book scans) — " +
    "covering a place and year range. Provide a standardPlace from place_search and an " +
    "optional year range. For each volume it returns coverage (places, dates, " +
    "record types), how much of the volume is indexed for record_search " +
    "(recordSearchablePercent), and whether it is full-text searchable " +
    "(fulltextSearchable). Use the returned imageGroupNumber with image_search to " +
    "list the volume's images, or with fulltext_search to search its text. " +
    "Results are paginated — pass back nextPageToken (with the same standardPlace and " +
    "years) as pageToken to get the next page. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      standardPlace: {
        type: "string",
        description:
          "Standard place name (the `standardPlace` field from place_search). " +
          "Required. The tool resolves it to a placeId and its place " +
          "representation IDs for the query.",
      },
      startYear: {
        type: "integer",
        description:
          "Earliest year of interest (inclusive), e.g. 1730. Omit for all periods.",
      },
      endYear: {
        type: "integer",
        description:
          "Latest year of interest (inclusive), e.g. 1810. Must be >= startYear. " +
          "Omit for all periods.",
      },
      pageToken: {
        type: "string",
        description:
          "Pagination cursor. Pass the nextPageToken from a previous " +
          "response, together with the same standardPlace/startYear/endYear, to " +
          "fetch the next page.",
      },
    },
    required: ["standardPlace"],
  },
};
