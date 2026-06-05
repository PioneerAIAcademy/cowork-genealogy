import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { extractPrimaryId, placeIdToRepIds } from "./place-search.js";
import type {
  ImageSearchInput,
  ImageSearchResult,
  ImageGroup,
  SimplifiedCoverage,
  FSPlaceLookupResponse,
  RmsSearchRequest,
  RmsSearchResponse,
  RmsGroup,
  RmsCoverageEntry,
} from "../types/image-search.js";

const PLACES_API_BASE = "https://api.familysearch.org/platform/places";
const RMS_SEARCH_URL =
  "https://sg30p0.familysearch.org/service/records/rms/group-service/group/search";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convert a placeRepId back to a placeId via the places description API.
 *
 * GET /places/description/{placeRepId} returns the representation with its
 * `Primary` identifier, whose last path segment is the placeId. Returns null
 * if the placeId cannot be resolved.
 */
export async function repIdToPlaceId(
  placeRepId: number,
  token: string
): Promise<string | null> {
  const response = await fetch(
    `${PLACES_API_BASE}/description/${placeRepId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as FSPlaceLookupResponse;
  const entry =
    data.places?.find(
      (p) => p.identifiers?.["http://gedcomx.org/Primary"] != null
    ) ?? data.places?.find((p) => p.display != null);

  return extractPrimaryId(entry?.identifiers) ?? null;
}

function validate(input: ImageSearchInput): void {
  const { placeId, imageGroupNumber, fromDate, toDate } = input;

  if (!placeId && !imageGroupNumber) {
    throw new Error(
      "image_search requires either placeId or imageGroupNumber."
    );
  }
  if (placeId && imageGroupNumber) {
    throw new Error("Provide either placeId or imageGroupNumber, not both.");
  }
  if ((fromDate || toDate) && !placeId) {
    throw new Error("fromDate and toDate require placeId.");
  }
  if (fromDate && !DATE_RE.test(fromDate)) {
    throw new Error(
      "fromDate must be in YYYY-MM-DD format (e.g., '1730-01-01')."
    );
  }
  if (toDate && !DATE_RE.test(toDate)) {
    throw new Error(
      "toDate must be in YYYY-MM-DD format (e.g., '1810-12-31')."
    );
  }
}

async function buildRequestBody(
  input: ImageSearchInput,
  token: string
): Promise<RmsSearchRequest> {
  const base = {
    types: ["NATURAL"],
    returnChildCounts: false,
    active: true,
  };

  if (input.imageGroupNumber) {
    return { ...base, name: `${input.imageGroupNumber}*` };
  }

  const placeRepIds = await placeIdToRepIds(input.placeId!, token);
  if (placeRepIds.length === 0) {
    throw new Error(
      `No place representations found for placeId ${input.placeId}.`
    );
  }

  return {
    ...base,
    coverage: {
      placeRepIds,
      ...(input.fromDate ? { fromDateString: input.fromDate } : {}),
      ...(input.toDate ? { toDateString: input.toDate } : {}),
    },
  };
}

async function callRms(
  body: RmsSearchRequest,
  token: string
): Promise<RmsSearchResponse> {
  let response: Response;
  try {
    response = await fetch(RMS_SEARCH_URL, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": BROWSER_USER_AGENT,
        "FS-User-Agent-Chain": "chesworth",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(
      `Could not reach FamilySearch image search API: ${message}.`
    );
  }

  if (response.status === 401) {
    throw new Error(
      "FamilySearch session not accepted; call the login tool to re-authenticate."
    );
  }
  if (response.status === 403) {
    throw new Error("FamilySearch image search API error: 403 Forbidden.");
  }
  if (!response.ok) {
    throw new Error(
      `FamilySearch image search API error: ${response.status} ${response.statusText}.`
    );
  }

  return (await response.json()) as RmsSearchResponse;
}

async function mapCoverage(
  coverage: RmsCoverageEntry,
  token: string,
  cache: Map<number, string | null>
): Promise<SimplifiedCoverage> {
  let placeId = "";
  if (coverage.placeRepId != null) {
    if (!cache.has(coverage.placeRepId)) {
      cache.set(coverage.placeRepId, await repIdToPlaceId(coverage.placeRepId, token));
    }
    placeId = cache.get(coverage.placeRepId) ?? "";
  }

  return {
    place: coverage.place ?? "",
    placeId,
    ...(coverage.datesOrig != null ? { dateRange: coverage.datesOrig } : {}),
    ...(coverage.recordTypeOrig != null
      ? { recordType: coverage.recordTypeOrig }
      : {}),
    placeRelevance: coverage.placeRelevance ?? 0,
  };
}

async function mapGroup(
  group: RmsGroup,
  token: string,
  cache: Map<number, string | null>
): Promise<ImageGroup> {
  const coverages = await Promise.all(
    (group.coverages ?? []).map((c) => mapCoverage(c, token, cache))
  );

  return {
    id: group.id,
    imageGroupNumber: group.groupName,
    ...(group.title != null ? { title: group.title } : {}),
    types: group.types ?? [],
    creators: group.creators ?? [],
    languages: group.languages ?? [],
    ...(group.custodians != null ? { custodians: group.custodians } : {}),
    ...(group.volumes != null ? { volumes: group.volumes } : {}),
    coverages,
  };
}

export async function imageSearchTool(
  input: ImageSearchInput
): Promise<ImageSearchResult> {
  validate(input);

  const token = await getValidToken();
  const body = await buildRequestBody(input, token);
  const response = await callRms(body, token);

  const groups = response.groups ?? [];
  const cache = new Map<number, string | null>();
  const mapped = await Promise.all(
    groups.map((g) => mapGroup(g, token, cache))
  );

  return {
    query: {
      ...(input.placeId ? { placeId: input.placeId } : {}),
      ...(input.fromDate ? { fromDate: input.fromDate } : {}),
      ...(input.toDate ? { toDate: input.toDate } : {}),
      ...(input.imageGroupNumber
        ? { imageGroupNumber: input.imageGroupNumber }
        : {}),
    },
    totalGroups: response.totalCount ?? 0,
    returned: response.numberReturned ?? 0,
    groups: mapped,
  };
}

export const imageSearchSchema = {
  name: "image_search",
  description:
    "Search FamilySearch's Records Management Service for image groups — " +
    "digitized volumes of historical documents (microfilm rolls, book scans). " +
    "Two query modes: (1) search by place + date range using a placeId from " +
    "place_search, or (2) look up a specific volume by image group number. " +
    "Returns image group metadata including coverage (places, dates, record " +
    "types) and creators. Use the results with image_read to view individual " +
    "images from a group. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      placeId: {
        type: "string",
        description:
          "FamilySearch place ID from place_search. The tool internally " +
          "converts this to place representation IDs for the RMS query.",
      },
      fromDate: {
        type: "string",
        description:
          "Start of date range in YYYY-MM-DD format (e.g., '1730-01-01'). " +
          "Only used with placeId.",
      },
      toDate: {
        type: "string",
        description:
          "End of date range in YYYY-MM-DD format (e.g., '1810-12-31'). " +
          "Only used with placeId.",
      },
      imageGroupNumber: {
        type: "string",
        description:
          "Image group number (e.g., '007621224'). Image group numbers " +
          "come from catalog search results.",
      },
    },
  },
};
