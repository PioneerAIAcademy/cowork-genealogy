import type { Principal } from "../auth/principal.js";
import { BROWSER_USER_AGENT, TOOL_RESULT_CHAR_BUDGET } from "../constants.js";
import { fsFetch } from "../utils/fs-fetch.js";
import { describeFetchError } from "../utils/http.js";
import {
  RECORD_TYPE_GROUP_NAMES,
  assertKnownGroupNames,
  conceptIdsForGroups,
  refuseRecordTypeAliases,
} from "../utils/record-type-groups.js";
import { resolveStandardPlaceToPlaceId, placeIdToRepIds, ambiguousPlaceError } from "../utils/place-resolver.js";
import { fetchFulltextSearchable } from "../utils/fulltext-searchable.js";
import { formatYearRange } from "../utils/search-helpers.js";
import { volumeRollup } from "../utils/volume-rollup.js";
import type {
  VolumeSearchInput,
  VolumeSearchResult,
  VolumeGroup,
  SimplifiedCoverage,
  MetadataRmsSearchRequest,
  MetadataRmsSearchResponse,
  MetadataRmsGroup,
  MetadataRmsCoverageEntry,
} from "../types/volume-search.js";
import { rejectedTokenMessage } from "../auth/config.js";

const RMS_SEARCH_URL =
  "https://sg30p0.familysearch.org/service/records/rms/group-service/group/search";
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

// At 100 volumes a page, 10 of 33 hosted calls overflowed TOOL_RESULT_CHAR_BUDGET's
// limit (issue #3611); Freeborn, Minnesota 1870–1900 reached 99,517. After merging
// coverage rows, the worst 50-volume window measured on those bundles is 36,939,
// so 50 fits with no truncation and fitToBudget is a backstop, not the normal path.
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
export const RESULT_CHAR_BUDGET = TOOL_RESULT_CHAR_BUDGET;
// Coverage rows kept per volume, tried in order, only when a page is still over
// budget after merging. Volumes are never dropped: the upstream cursor has
// already moved past them, so a dropped volume is unreachable.
const COVERAGE_CAPS = [20, 10, 5, 3, 1];

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
  if (
    input.pageSize != null &&
    (!Number.isInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > MAX_PAGE_SIZE)
  ) {
    throw new Error(`pageSize must be a whole number from 1 to ${MAX_PAGE_SIZE}.`);
  }
  if (input.summary && input.pageToken) {
    throw new Error(
      "summary covers every matching volume, so it is given with the first page only; omit pageToken or summary."
    );
  }
  // Near-miss spellings of *this* field only. `record_search` and
  // `fulltext_search` both take a singular `recordType`, so that is the name an
  // LLM reaches for here; `record_type` is the snake_case convention
  // `research.json` uses elsewhere. Nothing validates input against the
  // advertised JSON Schema — `src/server.ts` casts `request.params.arguments`
  // straight to the handler — so an unrecognised field is ignored and the search
  // silently runs unfiltered, returning everything with no signal.
  //
  // Deliberately not a general unknown-field check: the tool's year inputs have
  // their own live spellings elsewhere (`yearFrom`/`yearTo`, `fromYear`/`toYear`)
  // and catching those too is the schema-wide `additionalProperties` question the
  // spec puts out of scope, not a bigger version of this list.
  refuseRecordTypeAliases(
    input,
    ["recordType", "record_type", "recordTypes"],
    (alias) => `volume_search filters by recordTypeGroups (an array of group names), not ${alias}.`
  );
  if (input.recordTypeGroups != null) {
    if (!Array.isArray(input.recordTypeGroups)) {
      throw new Error("recordTypeGroups must be an array of group names.");
    }
    // Never fall through to an unfiltered or empty search: upstream answers an
    // unrecognised concept id with `totalCount: 0` and status 200, which is
    // indistinguishable from a genuine absence of records. Shared with
    // `conceptIdsForGroups`, which repeats the check as a backstop for any
    // future caller that skips this one — one template, so the two cannot word
    // the same failure differently.
    assertKnownGroupNames(input.recordTypeGroups);
  }
}

const RMS_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent": BROWSER_USER_AGENT,
  "FS-User-Agent-Chain": "chesworth",
};

async function callGroupSearch(
  body: MetadataRmsSearchRequest,
  principal: Principal,
): Promise<MetadataRmsSearchResponse> {
  let response: Response;
  try {
    response = await fsFetch(principal, RMS_SEARCH_URL, {
      method: "PUT",
      headers: RMS_HEADERS,
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(
      `Could not reach FamilySearch volume search API: ${describeFetchError(error)}.`
    );
  }

  if (response.status === 401) {
    throw new Error(await rejectedTokenMessage(principal, "FamilySearch session not accepted; call the login tool to re-authenticate."));
  }
  if (response.status === 403) {
    throw new Error("FamilySearch volume search API error: 403 Forbidden.");
  }
  if (!response.ok) {
    // `statusText` is empty on a bodyless response, which is how a real upstream
    // 409 reached the user as "409 ." -- a status, a space and a full stop, with
    // nothing to act on. Read the body so the message carries whatever upstream
    // did say, and say nothing about WHY it said it: no 409 here is reproducible,
    // and a guessed upstream diagnosis is a claim we cannot defend.
    const body = (await response.text().catch(() => "")).trim();
    const detail = body ? ` ${body}` : "";
    if (response.status === 409) {
      throw new Error(
        `FamilySearch volume search API error: 409.${detail} ` +
          "A pageToken is only valid alongside a byte-identical search and it expires; " +
          "re-issue this search from the first page with the same standardPlace, year " +
          "range, recordTypeGroups and pageSize, omitting pageToken."
      );
    }
    throw new Error(
      `FamilySearch volume search API error: ${response.status} ${response.statusText}.${detail}`
    );
  }

  return (await response.json()) as MetadataRmsSearchResponse;
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
 *
 * Nor is it `parseYear` in `external-links-search.ts`, which looks like the same
 * job but is not: that one is `Number.parseInt`, which reads 16 out of "16xx"
 * and 999 out of "999-01-01". This wants the leading *four* digits or nothing,
 * because the value is an ISO timestamp and a partial parse would put a
 * plausible-looking wrong year on a coverage. Merging the two means either
 * loosening this or tightening a shipped tool's behaviour.
 */
function leadingYear(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const match = /^(\d{4})/.exec(value);
  return match ? Number(match[1]) : undefined;
}

/** One upstream coverage row, mapped but not yet merged. */
interface MappedCoverage {
  place: string;
  dateRange?: string;
  recordType?: string;
  recordTypeConceptId?: number;
}

function mapCoverage(entry: MetadataRmsCoverageEntry): MappedCoverage {
  const coverage: MappedCoverage = { place: entry.place ?? "" };
  const startYear = leadingYear(entry.fromdateString);
  const endYear = leadingYear(entry.todateString);

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
  // With the structured years gone from the output, `dateRange` is the only date
  // on a row, so a one-sided span says which side is open: `formatYearRange`
  // renders a lone start year as a bare "1870", which reads as that year alone.
  const dateRange =
    displayRange ||
    (startYear != null && endYear == null
      ? `from ${startYear}`
      : endYear != null && startYear == null
        ? `until ${endYear}`
        : formatYearRange(startYear, endYear));
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

/**
 * Collapse rows that differ only by place. Statewide series repeat one date range
 * and record type across dozens of towns — Freeborn's muster rolls carry 31–48
 * rows each — and that repetition is most of an oversized page.
 *
 * Keyed on the record type the reader sees: with a `recordType`, two rows that
 * share it merge even when their concept ids differ, so no two output rows look
 * identical. Only a row with no `recordType` keys on (and shows) its concept id.
 */
export function mergeCoverages(rows: MappedCoverage[]): SimplifiedCoverage[] {
  const merged: SimplifiedCoverage[] = [];
  const byKey = new Map<string, SimplifiedCoverage>();
  for (const row of rows) {
    // `datesOrig` writes a span with an en-dash, an em-dash or a spaced hyphen
    // where the fallback writes a bare hyphen, so one span would otherwise key
    // several ways; the first-seen text is what shows.
    const date = (row.dateRange ?? "").replace(/\s*[–—-]\s*/g, "-");
    const key = row.recordType != null
      ? `type\u0000${date}\u0000${row.recordType}`
      : `concept\u0000${date}\u0000${row.recordTypeConceptId ?? ""}`;
    let out = byKey.get(key);
    if (!out) {
      out = { places: [] };
      if (row.dateRange) out.dateRange = row.dateRange;
      if (row.recordType != null) out.recordType = row.recordType;
      else if (row.recordTypeConceptId != null) {
        out.recordTypeConceptId = row.recordTypeConceptId;
      }
      byKey.set(key, out);
      merged.push(out);
    }
    if (row.place && !out.places.includes(row.place)) out.places.push(row.place);
  }
  return merged;
}

function mapGroup(
  group: MetadataRmsGroup,
  fulltextSet: Set<string> | null
): VolumeGroup {
  const imageGroupNumber = group.groupName;
  const imageCount = group.childCount ?? null;
  const recordSearchablePercent = computeRecordSearchablePercent(group);
  const fulltextSearchable =
    fulltextSet === null ? null : fulltextSet.has(imageGroupNumber);

  const result: VolumeGroup = {
    imageGroupNumber,
    imageCount,
    recordSearchablePercent,
    fulltextSearchable,
    languages: group.languages ?? [],
    coverages: mergeCoverages((group.coverages ?? []).map(mapCoverage)),
  };

  if (group.title != null) result.title = group.title;
  if (group.volumes != null) result.volumes = group.volumes;

  return result;
}

/**
 * Keep the serialized answer under `budget` characters by shortening coverage
 * lists, longest first, to each cap in COVERAGE_CAPS in turn, marking every
 * shortened volume with `coverageCount`. Longest first, so one oversized volume
 * does not cost its neighbours rows they had room for. Never drops a volume. If
 * even the smallest cap does not fit, returns that most-shortened answer.
 */
export function fitToBudget(
  result: VolumeSearchResult,
  budget: number = RESULT_CHAR_BUDGET
): VolumeSearchResult {
  let size = JSON.stringify(result).length;
  if (size <= budget) return result;
  const groups = [...result.results];
  // Compact JSON serializes each array element on its own, so replacing one
  // volume changes the answer's length by exactly the change in that volume's.
  const lengths = groups.map((g) => JSON.stringify(g).length);
  const longestFirst = groups
    .map((_, i) => i)
    .sort((a, b) => groups[b].coverages.length - groups[a].coverages.length);
  for (const cap of COVERAGE_CAPS) {
    for (const i of longestFirst) {
      const g = result.results[i];
      if (g.coverages.length <= cap) break;
      groups[i] = { ...g, coverages: g.coverages.slice(0, cap), coverageCount: g.coverages.length };
      const length = JSON.stringify(groups[i]).length;
      size += length - lengths[i];
      lengths[i] = length;
      if (size <= budget) return { ...result, results: groups };
    }
  }
  return { ...result, results: groups };
}

export async function volumeSearchTool(
  input: VolumeSearchInput,
  principal: Principal
): Promise<VolumeSearchResult> {
  validate(input);

  // fsFetch handles auth internally; the first FS call will surface a login
  // error if needed. Place resolution runs first (no auth required).

  // Resolve the standard place name -> placeId -> all of its representation
  // IDs. The two failures are answered separately: a name that matches nothing
  // is a different problem from one that matches several spots, and the second
  // is recoverable in one call once the candidates are named. Never auto-pick
  // among them -- that researches the wrong jurisdiction silently.
  const resolution = await resolveStandardPlaceToPlaceId(input.standardPlace);
  if (resolution.kind === "ambiguous") {
    throw ambiguousPlaceError(input.standardPlace, resolution.candidates);
  }
  if (resolution.kind === "unresolved") {
    throw new Error(
      `Could not resolve "${input.standardPlace}" to a single place; ` +
        "use place_search to get a standard place name first."
    );
  }
  const placeId = resolution.placeId;

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

  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;

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
    pageSize,
    ...(input.pageToken ? { nextPageToken: input.pageToken } : {}),
  };

  const [response, summary] = await Promise.all([
    callGroupSearch(body, principal),
    // The summary is extra: its failure must never cost the caller the page.
    input.summary
      ? volumeRollup(body, principal, callGroupSearch).catch(
          (error: unknown) => (error instanceof Error ? error.message : String(error))
        )
      : undefined,
  ]);

  const groups = response.groups ?? [];
  const groupNames = groups.map((g) => g.groupName);

  const fulltextSet = groupNames.length > 0
    ? await fetchFulltextSearchable(groupNames, principal)
    : new Set<string>();

  const results = groups.map((g) => mapGroup(g, fulltextSet));

  const query: VolumeSearchResult["query"] = { standardPlace: input.standardPlace, pageSize };
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
  if (typeof summary === "string") result.summaryError = summary;
  else if (summary) result.summary = summary;

  return fitToBudget(result);
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
    "Each coverage row lists every place (`places`) that shares its date range and " +
    "record type. " +
    "Results are paginated, 50 volumes a page by default — pass back nextPageToken " +
    "(with the same standardPlace, years, record-type groups and pageSize) as " +
    "pageToken to get the next page. A volume carrying coverageCount had its " +
    "coverages shortened to fit the answer; call again with a smaller pageSize, " +
    "starting from the first page, to see them all. " +
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
      pageSize: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        description:
          "Volumes per page, 1–100. Defaults to 50. Every page of one search " +
          "must use the same pageSize.",
      },
      pageToken: {
        type: "string",
        description:
          "Pagination cursor. Pass the nextPageToken from a previous " +
          "response, together with the same standardPlace/startYear/endYear/" +
          "recordTypeGroups/pageSize, to fetch the next page.",
      },
      summary: {
        type: "boolean",
        description:
          "Set true on a place survey to also get `summary`: every matching volume " +
          "(not just this page) counted by record-type group, with how many are " +
          "browse-only and how many full-text-only, plus an untyped bucket. A volume " +
          "counts in every group its " +
          "coverages reach, parents included. First page only — not with pageToken. " +
          "Slower: it reads all matching volumes. If it cannot be computed, the page " +
          "still returns, with `summaryError` saying why.",
      },
    },
    required: ["standardPlace"],
  },
};
