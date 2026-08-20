import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { fetchWithTimeout } from "../utils/http.js";
import {
  RECORD_TYPE_GROUPS,
  RECORD_TYPE_GROUP_NAMES,
  conceptIdsForGroups,
} from "../utils/record-type-groups.js";
import { standardPlaceToPlaceId, placeIdToRepIds } from "../utils/place-resolver.js";
import { formatYearRange } from "../utils/search-helpers.js";
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

// `concept-id:…` is an opaque internal id with nothing a reader can use. A
// `title:…` prefix is different in kind: it marks *provenance* — the value came
// from the volume's title rather than the concept taxonomy — and what follows it
// is real, so the prefix is stripped and the value kept.
//
// It appears on `recordTypeOrig` AND `datesOrig`, independently of each other:
// Wayne, Ohio and Kent both return coverages where a `title:`-prefixed date sits
// beside a clean record type (e.g. `"title:1867-1908"` / `"Death records"`), so
// neither field can be normalized on the strength of the other.
//
// Measured live 2026-08-15, full pagination, 1500–1950: over Harjager härad
// 1762 of 1889 record types carry the prefix, and every `title:`-prefixed
// *record type* observed was a real type (Taxation, Census, Probate records,
// Military records, Town records, Church records) — the same types also occur
// unprefixed in the same corpus. Discarding them is what hid the Swedish
// mantalslängder from `volume_search` (issue #572). Prefixed date ranges are far
// rarer (Harjager 4/1889, Wayne 11/710, Kent 1/1379) but reach the agent as an
// unparseable `"title:1683-1700"` — including on `008768877`, the häradsrätt
// court series that issue #1596 names as an unexamined route for that fixture.
const RECORD_TYPE_OPAQUE_RE = /^concept-id:/;
const TITLE_PREFIX_RE = /^title:\s*/;

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
  // `record_search` and `fulltext_search` both take a singular `recordType`, so
  // it is the field an LLM reaches for here. Nothing validates input against the
  // advertised JSON Schema — `src/index.ts` casts `request.params.arguments`
  // straight to the handler — so without this the wrong field name is ignored and
  // the search silently runs unfiltered, returning everything with no signal.
  if ("recordType" in input) {
    throw new Error(
      "volume_search filters by recordTypeGroups (an array of group names), " +
        "not recordType. Valid groups: " +
        RECORD_TYPE_GROUP_NAMES.join(", ") +
        "."
    );
  }
  if (input.recordTypeGroups != null) {
    if (!Array.isArray(input.recordTypeGroups)) {
      throw new Error("recordTypeGroups must be an array of group names.");
    }
    const unknown = input.recordTypeGroups.filter(
      (name) => !RECORD_TYPE_GROUPS.has(name)
    );
    if (unknown.length > 0) {
      // Never fall through to an unfiltered or empty search: upstream answers an
      // unrecognised concept id with `totalCount: 0` and status 200, which is
      // indistinguishable from a genuine absence of records.
      throw new Error(
        `Unknown record-type group(s): ${unknown.join(", ")}. Valid groups: ` +
          RECORD_TYPE_GROUP_NAMES.join(", ") +
          "."
      );
    }
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
    response = await fetchWithTimeout(RMS_SEARCH_URL, {
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
      const response = await fetchWithTimeout(url, { headers: rmsHeaders(token) });
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

/**
 * The year at the start of an ISO-shaped span (`"1683-01-01T00:00:00"` -> 1683).
 *
 * Not `earliestYear`/`latestYear` from `utils/date-helpers.ts`: those parse the
 * repo's genealogical standard-date strings ("11 Sep 1718", "Bet 1870 and 1880")
 * and return null for every ISO form. Widening them would touch the timeline,
 * conflict and warning paths for no gain here.
 */
function leadingYear(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const match = /^(\d{4})/.exec(value);
  return match ? Number(match[1]) : undefined;
}

function mapCoverage(entry: MetadataRmsCoverageEntry): SimplifiedCoverage {
  const coverage: SimplifiedCoverage = { place: entry.place ?? "" };
  const startYear = leadingYear(entry.fromdateString);
  const endYear = leadingYear(entry.todateString);
  if (startYear != null) coverage.startYear = startYear;
  if (endYear != null) coverage.endYear = endYear;

  // Strip first, then decide: the fallback has to key off "nothing survived",
  // not "the field was absent". A `datesOrig` of `"title:"` strips to empty, and
  // keying off presence would skip the fallback and emit years with no range —
  // the very outcome the fallback exists to prevent.
  const displayRange =
    entry.datesOrig?.replace(TITLE_PREFIX_RE, "").trim() ?? "";
  // `datesOrig` is display text and is absent more often than the structured
  // pair — Wayne, Ohio carries it on 335 of 463 coverages against 462 for the
  // pair — so fall back rather than emitting no date at all. The fallback is
  // `collections_search`'s own formatter, so the two tools cannot describe one
  // span differently; `""` from it means "no range", which leaves the optional
  // field off.
  const dateRange = displayRange || formatYearRange(startYear, endYear);
  if (dateRange) coverage.dateRange = dateRange;
  const rawType = entry.recordTypeOrig;
  if (rawType != null && !RECORD_TYPE_OPAQUE_RE.test(rawType)) {
    const recordType = rawType.replace(TITLE_PREFIX_RE, "").trim();
    if (recordType) coverage.recordType = recordType;
  }
  if (typeof entry.recordTypeConceptId === "number") {
    coverage.recordTypeConceptId = entry.recordTypeConceptId;
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

  // Anchors plus strays for each requested group. An empty array is left off the
  // body entirely: upstream treats `recordTypeConceptIds: []` as no filter, so
  // sending it would be a no-op that reads like a filter in the request log.
  const recordTypeConceptIds = input.recordTypeGroups?.length
    ? conceptIdsForGroups(input.recordTypeGroups)
    : undefined;

  const body: MetadataRmsSearchRequest = {
    coverage: {
      // RMS expects numeric rep IDs; the resolver returns them as strings.
      // Drop any non-numeric id rather than emitting NaN (-> null) into the body.
      placeRepIds: placeRepIds.map(Number).filter((n) => !Number.isNaN(n)),
      ...(fromDateString ? { fromDateString } : {}),
      ...(toDateString ? { toDateString } : {}),
      ...(recordTypeConceptIds?.length ? { recordTypeConceptIds } : {}),
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
  // Only when a filter was actually applied. An empty array means "no filter"
  // upstream and is omitted from the request body, so echoing it back would
  // describe a filtered search that never happened.
  if (input.recordTypeGroups?.length) {
    query.recordTypeGroups = input.recordTypeGroups;
  }

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
    "Search FamilySearch's Records Management Service for image groups — " +
    "digitized volumes of historical documents (microfilm rolls, book scans) — " +
    "covering a place and year range. Provide a standardPlace from place_search and an " +
    "optional year range. For each volume it returns coverage (places, dates, " +
    "record types), how much of the volume is indexed for record_search " +
    "(recordSearchablePercent), and whether it is full-text searchable " +
    "(fulltextSearchable). Use the returned imageGroupNumber with image_search to " +
    "list the volume's images, or with fulltext_search to search its text. " +
    "Results are paginated — pass back nextPageToken (with the same standardPlace, " +
    "years and record-type groups) as pageToken to get the next page. " +
    "Optionally narrow to record-type groups with recordTypeGroups. " +
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
      recordTypeGroups: {
        type: "array",
        items: { type: "string", enum: [...RECORD_TYPE_GROUP_NAMES] },
        description:
          "Restrict to volumes of these record-type groups. Multiple groups are " +
          "OR-ed. Selecting a group also returns the groups nested beneath it — " +
          "'Government' also returns Tax, Prison, Poor Law, Passports and more. " +
          "This filters volumes, not coverages: a matched volume is returned with " +
          "all of its coverage rows, so some will carry other record types and " +
          "years outside the requested range. Omit to search all record types.",
      },
      pageToken: {
        type: "string",
        description:
          "Pagination cursor. Pass the nextPageToken from a previous " +
          "response, together with the same standardPlace/startYear/endYear/" +
          "recordTypeGroups, to fetch the next page.",
      },
    },
    required: ["standardPlace"],
  },
};
