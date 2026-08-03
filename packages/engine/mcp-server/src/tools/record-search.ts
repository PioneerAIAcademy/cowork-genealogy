import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import {
  toSimplified,
  standardizePlaces,
  collectFacts,
} from "../utils/gedcomx-convert.js";
import type { GedcomX } from "../types/gedcomx.js";
import type {
  FSSearchResponse,
  FSSearchEntry,
  FSPerson,
  FSFact,
  RecordSearchInput,
  RecordSearchResult,
  RecordSearchEvent,
  TreeMatch,
  RecordSearchToolResponse,
} from "../types/record-search.js";
import {
  isFourDigitYear,
  normalizeSex,
  parseUpstreamErrorBody,
  echoQuery,
} from "../utils/search-helpers.js";
import { toArk } from "../utils/ark.js";
import { stageSearchResults } from "../utils/results-staging.js";
import { readProjectJson } from "../utils/project-io.js";
import {
  isSubCountryPlace,
  marriageJurisdictionCandidates,
} from "../utils/marriage-jurisdictions.js";
import { rankSearchMatches } from "./rank-search-matches.js";

// Re-exported so existing importers (and tests) keep resolving it here.
export { parseUpstreamErrorBody };

const FS_SEARCH_URL =
  "https://www.familysearch.org/service/search/hr/v2/personas";

const PAGINATION_CAP = 4999;
/** Most jurisdiction candidates a nil marriage search will offer. See below. */
const MAX_JURISDICTION_HINTS = 8;
/**
 * Emitted on every `projectPath`-carrying search that names no subject. Kept
 * short on purpose: it rides two thirds of all searches (59 of 171 calls across
 * the six committed `jimmie-jewel-neal` runlogs carried `subjectId`), so its
 * cost is paid per call while its benefit is being un-forgettable.
 */
const RANKING_SKIPPED_NOTE =
  "No `subjectId`, so match-score ranking and marriage jurisdiction hints did " +
  "not run. Pass the tree person this search is about as `subjectId` to enable " +
  "both. Omit it only for a broad survey with no specific person in mind.";
const PERSISTENT_ID_URI = "http://gedcomx.org/Persistent";
const COLLECTION_RESOURCE_TYPE = "http://gedcomx.org/Collection";

const MARITAL_STATUS_VALUES = new Set([
  "Married",
  "Single",
  "Divorced",
  "Widowed",
]);
const RECORD_TYPE_TO_INT: Record<string, number> = {
  birth: 0,
  marriage: 1,
  death: 2,
  census: 3,
  immigration: 4,
  military: 5,
  probate: 6,
  other: 7,
};

interface EventGroup {
  prefix: string;
  apiDate: string;
  apiPlace: string;
}

const EVENT_GROUPS: EventGroup[] = [
  { prefix: "birth", apiDate: "q.birthLikeDate", apiPlace: "q.birthLikePlace" },
  { prefix: "death", apiDate: "q.deathLikeDate", apiPlace: "q.deathLikePlace" },
  {
    prefix: "marriage",
    apiDate: "q.marriageLikeDate",
    apiPlace: "q.marriageLikePlace",
  },
  {
    prefix: "residence",
    apiDate: "q.residenceDate",
    apiPlace: "q.residencePlace",
  },
  { prefix: "any", apiDate: "q.anyDate", apiPlace: "q.anyPlace" },
];

interface KinGroup {
  prefix: string;
  apiGiven: string;
  apiSurname: string;
}

const KIN_GROUPS: KinGroup[] = [
  { prefix: "spouse", apiGiven: "q.spouseGivenName", apiSurname: "q.spouseSurname" },
  { prefix: "father", apiGiven: "q.fatherGivenName", apiSurname: "q.fatherSurname" },
  { prefix: "mother", apiGiven: "q.motherGivenName", apiSurname: "q.motherSurname" },
  { prefix: "parent", apiGiven: "q.parentGivenName", apiSurname: "q.parentSurname" },
  { prefix: "other", apiGiven: "q.otherGivenName", apiSurname: "q.otherSurname" },
];

/** Results per page when the caller doesn't say.
 *
 *  50 when ranking is active, 20 otherwise. `count: 50` was previously a
 *  SKILL.md instruction justified by "fetch a deep-enough pool for the match
 *  re-ranker" — but prose rules decay: measured over one real session it held
 *  at 100% while the skill body was resident and fell to 45% after compaction
 *  evicted it, while the re-ranker call it existed to serve fell to 3%. The
 *  session therefore paid for deep pools it never triaged.
 *
 *  Coupling the default to `subjectId` makes the pair inseparable by
 *  construction: a deep pool is only fetched when something will cut it back.
 *  See docs/plan/research-performance-2026-07-27.md §5.3. */
export function defaultCount(input: RecordSearchInput): number {
  return input.subjectId && input.projectPath ? 50 : 20;
}

export function applyAltNameAutoPair(input: RecordSearchInput): RecordSearchInput {
  const out = { ...input };
  if (out.surnameAlt && !out.givenNameAlt && out.givenName) {
    out.givenNameAlt = out.givenName;
  }
  if (out.givenNameAlt && !out.surnameAlt && out.surname) {
    out.surnameAlt = out.surname;
  }
  return out;
}

export function validateInput(input: RecordSearchInput): void {
  if (!input.surname && !input.recordCountry) {
    throw new Error(
      "search needs at least one anchor: surname or recordCountry. Searches without an anchor are too expensive on the FamilySearch API."
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
  // Ranking active (subjectId supplied) justifies a deep pool: the re-ranker
  // cuts it back host-side, so the model never sees 50 raw stubs. Without
  // ranking a deep pool is pure context waste, so the default stays 20. See
  // docs/plan/research-performance-2026-07-27.md §5.3 — the two are coupled.
  const count = input.count ?? defaultCount(input);
  const offset = input.offset ?? 0;
  if (offset + count > PAGINATION_CAP) {
    throw new Error(
      "offset + count must be <= 4999 (FamilySearch search depth limit). Narrow the query instead of paging deeper."
    );
  }

  for (const group of EVENT_GROUPS) {
    const fromKey = `${group.prefix}YearFrom` as keyof RecordSearchInput;
    const toKey = `${group.prefix}YearTo` as keyof RecordSearchInput;
    const from = input[fromKey] as number | undefined;
    const to = input[toKey] as number | undefined;
    if (from !== undefined && !isFourDigitYear(from)) {
      throw new Error(
        `${String(fromKey)} must be a 4-digit year (e.g., 1809).`
      );
    }
    if (to !== undefined && !isFourDigitYear(to)) {
      throw new Error(
        `${String(toKey)} must be a 4-digit year (e.g., 1809).`
      );
    }
    if ((from === undefined) !== (to === undefined)) {
      throw new Error(
        `${group.prefix}YearFrom and ${group.prefix}YearTo must be provided together.`
      );
    }
    if (from !== undefined && to !== undefined && from > to) {
      throw new Error(
        `${group.prefix}YearFrom must be <= ${group.prefix}YearTo.`
      );
    }
  }

  if (input.recordSubdivision && !input.recordCountry) {
    throw new Error("recordSubdivision requires recordCountry.");
  }

  if (input.sex !== undefined) {
    const normalized = normalizeSex(input.sex);
    if (!normalized) {
      throw new Error(
        "sex must be 'Male', 'Female', or 'Unknown' (case-insensitive)."
      );
    }
  }

  if (
    input.maritalStatus !== undefined &&
    !MARITAL_STATUS_VALUES.has(input.maritalStatus)
  ) {
    throw new Error(
      "maritalStatus must be exactly one of: 'Married', 'Single', 'Divorced', 'Widowed' (case-sensitive)."
    );
  }

  if (
    input.recordType !== undefined &&
    !(input.recordType in RECORD_TYPE_TO_INT)
  ) {
    throw new Error(
      "recordType must be one of: birth, marriage, death, census, immigration, military, probate, other."
    );
  }
}

export function buildSearchUrl(input: RecordSearchInput): string {
  const params: string[] = [];
  const add = (key: string, value: string | number | boolean): void => {
    params.push(`${key}=${encodeURIComponent(String(value))}`);
  };

  if (input.surname) add("q.surname", input.surname);
  if (input.givenName) add("q.givenName", input.givenName);
  if (input.surnameAlt) add("q.surname.1", input.surnameAlt);
  if (input.givenNameAlt) add("q.givenName.1", input.givenNameAlt);

  if (input.sex) {
    const normalized = normalizeSex(input.sex);
    if (normalized) add("q.sex", normalized);
  }

  if (input.surnameExact) {
    add("q.surname.exact", "on");
    if (input.surnameAlt) add("q.surname.exact.1", "on");
  }
  if (input.givenNameExact) {
    add("q.givenName.exact", "on");
    if (input.givenNameAlt) add("q.givenName.exact.1", "on");
  }

  for (const group of EVENT_GROUPS) {
    const fromKey = `${group.prefix}YearFrom` as keyof RecordSearchInput;
    const toKey = `${group.prefix}YearTo` as keyof RecordSearchInput;
    const exactKey = `${group.prefix}YearExact` as keyof RecordSearchInput;
    const placeKey = `${group.prefix}Place` as keyof RecordSearchInput;
    const placeExactKey = `${group.prefix}PlaceExact` as keyof RecordSearchInput;

    const from = input[fromKey] as number | undefined;
    const to = input[toKey] as number | undefined;
    if (from !== undefined && to !== undefined) {
      add(`${group.apiDate}.from`, from);
      add(`${group.apiDate}.to`, to);
    }
    if (input[exactKey]) add(`${group.apiDate}.exact`, "on");

    const place = input[placeKey] as string | undefined;
    if (place) add(group.apiPlace, place);
    if (input[placeExactKey]) add(`${group.apiPlace}.exact`, "on");
  }

  for (const group of KIN_GROUPS) {
    const givenKey = `${group.prefix}GivenName` as keyof RecordSearchInput;
    const surnameKey = `${group.prefix}Surname` as keyof RecordSearchInput;
    const givenExactKey = `${group.prefix}GivenNameExact` as keyof RecordSearchInput;
    const surnameExactKey = `${group.prefix}SurnameExact` as keyof RecordSearchInput;

    const given = input[givenKey] as string | undefined;
    const surname = input[surnameKey] as string | undefined;
    if (given) add(group.apiGiven, given);
    if (surname) add(group.apiSurname, surname);
    if (input[givenExactKey]) add(`${group.apiGiven}.exact`, "on");
    if (input[surnameExactKey]) add(`${group.apiSurname}.exact`, "on");
  }

  if (input.collectionId !== undefined) add("f.collectionId", input.collectionId);
  if (input.imageGroupNumber) add("q.filmNumber", input.imageGroupNumber);
  if (input.recordCountry) add("q.recordCountry", input.recordCountry);
  if (input.recordSubdivision && input.recordCountry) {
    add(
      "q.recordSubcountry",
      `${input.recordCountry},${input.recordSubdivision}`
    );
  }
  if (input.recordType) {
    add("f.recordType", RECORD_TYPE_TO_INT[input.recordType]);
  }
  if (input.maritalStatus) add("f.maritalStatus", input.maritalStatus);
  if (input.isPrincipal !== undefined) add("q.isPrincipal", input.isPrincipal);

  add("count", input.count ?? defaultCount(input));
  add("offset", input.offset ?? 0);

  add("m.queryRequireDefault", "on");
  add("m.defaultFacets", "off");

  return `${FS_SEARCH_URL}?${params.join("&")}`;
}

export function findRepresentedPerson(entry: FSSearchEntry): FSPerson | null {
  const persons = entry.content?.gedcomx?.persons ?? [];
  if (persons.length === 0) return null;

  const entryId = entry.id;
  if (entryId) {
    for (const p of persons) {
      const arks = p.identifiers?.[PERSISTENT_ID_URI] ?? [];
      if (arks.some((url) => url.endsWith(entryId))) {
        return p;
      }
    }
  }

  return persons.find((p) => p.principal === true) ?? null;
}

export function extractEvent(fact: FSFact): RecordSearchEvent | null {
  const date = fact.date?.original;
  const place = fact.place?.original;
  const value = fact.value;
  if (!date && !place && !value) return null;

  const segments = fact.type.split("/");
  const type = segments[segments.length - 1] || fact.type;

  const event: RecordSearchEvent = { type };
  if (date) event.date = date;
  if (place) event.place = place;
  if (value) event.value = value;
  return event;
}

function lastPathSegment(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const segments = value.split("/");
  return segments[segments.length - 1] || undefined;
}

// Hints carry tree-person ARKs like "ark:/61903/4:1:GQWZ-GPX". The bare
// tree-person ID (what /platform/tree/persons/{id} expects) is the suffix
// after the last colon.
function parseTreePersonId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const lastSlashSegment = value.split("/").pop() ?? "";
  const segments = lastSlashSegment.split(":");
  return segments[segments.length - 1] || undefined;
}

function endsWithBirth(type: string): boolean {
  return type.endsWith("/Birth");
}
function endsWithDeath(type: string): boolean {
  return type.endsWith("/Death");
}

function pickFactOriginal(
  facts: FSFact[],
  predicate: (type: string) => boolean,
  field: "date" | "place"
): string | undefined {
  for (const fact of facts) {
    if (!predicate(fact.type)) continue;
    if (field === "date" && fact.date?.original) return fact.date.original;
    if (field === "place" && fact.place?.original) return fact.place.original;
  }
  return undefined;
}

export function mapEntry(entry: FSSearchEntry): RecordSearchResult | null {
  const person = findRepresentedPerson(entry);
  if (!person) return null;
  if (!entry.id) return null;

  const facts = person.facts ?? [];
  const display = person.display;

  const personName =
    display?.name ?? person.names?.[0]?.nameForms?.[0]?.fullText;

  let sex: string | undefined;
  if (display?.gender) {
    sex = display.gender;
  } else if (person.gender?.type) {
    sex = lastPathSegment(person.gender.type);
  }

  const birthDate =
    display?.birthDate ?? pickFactOriginal(facts, endsWithBirth, "date");
  const birthPlace =
    display?.birthPlace ?? pickFactOriginal(facts, endsWithBirth, "place");
  const deathDate =
    display?.deathDate ?? pickFactOriginal(facts, endsWithDeath, "date");
  const deathPlace =
    display?.deathPlace ?? pickFactOriginal(facts, endsWithDeath, "place");

  const events: RecordSearchEvent[] = [];
  for (const fact of facts) {
    if (endsWithBirth(fact.type) || endsWithDeath(fact.type)) continue;
    const event = extractEvent(fact);
    if (event) events.push(event);
  }

  // Canonical 1:1: record-persona ARK. Prefer the persona's Persistent ARK
  // (the URL FamilySearch returns); fall back to constructing one from
  // entry.id (always a 1:1: persona in this search).
  const personaArkUrl = person.identifiers?.[PERSISTENT_ID_URI]?.[0];
  const recordId = personaArkUrl
    ? toArk(personaArkUrl)
    : /^\d:\d:/.test(entry.id)
      ? toArk(entry.id)
      : `ark:/61903/1:1:${entry.id}`;

  const sourceDescriptions = entry.content?.gedcomx?.sourceDescriptions ?? [];
  const collectionSd = sourceDescriptions.find(
    (sd) => sd.resourceType === COLLECTION_RESOURCE_TYPE
  );
  let collectionId: string | undefined;
  let collectionTitle: string | undefined;
  let collectionUrl: string | undefined;
  if (collectionSd) {
    collectionUrl = collectionSd.about;
    collectionTitle = collectionSd.titles?.[0]?.value;
    if (collectionUrl) {
      const match = collectionUrl.match(/\/collections\/([^/?#]+)/);
      if (match) collectionId = match[1];
    }
  }

  const recordSd = sourceDescriptions.find(
    (sd) => sd !== collectionSd && (sd.titles?.length || sd.identifiers)
  );
  const recordTitle = recordSd?.titles?.[0]?.value;
  const recordSourceArkUrl = recordSd?.identifiers?.[PERSISTENT_ID_URI]?.[0];

  const treeMatches: TreeMatch[] = (entry.hints ?? [])
    .map((hint) => {
      const id = parseTreePersonId(hint.id);
      if (!id) return null;
      return { treePersonId: id, stars: hint.stars ?? 0 };
    })
    .filter((m): m is TreeMatch => m !== null)
    .sort((a, b) => b.stars - a.stars);

  const result: RecordSearchResult = {
    recordId,
    events,
    treeMatches,
  };
  if (personName) result.personName = personName;
  if (entry.score !== undefined) result.score = entry.score;
  if (entry.confidence !== undefined) result.confidence = entry.confidence;
  if (sex) result.sex = sex;
  if (birthDate) result.birthDate = birthDate;
  if (birthPlace) result.birthPlace = birthPlace;
  if (deathDate) result.deathDate = deathDate;
  if (deathPlace) result.deathPlace = deathPlace;
  if (collectionId) result.collectionId = collectionId;
  if (collectionTitle) result.collectionTitle = collectionTitle;
  if (collectionUrl) result.collectionUrl = collectionUrl;
  if (recordTitle) result.recordTitle = recordTitle;
  if (recordSourceArkUrl) result.recordArk = toArk(recordSourceArkUrl);

  // Carry the simplified GedcomX so downstream tools (same_person)
  // get the real records, not a hand-rebuilt approximation. The FS search
  // payload is full GedcomX at runtime; FSGedcomx is just a narrower
  // declaration of the fields mapEntry reads, hence the cast.
  const rawGedcomx = entry.content?.gedcomx;
  if (rawGedcomx) {
    result.gedcomx = toSimplified(rawGedcomx as unknown as GedcomX);
  }
  if (person.id) result.primaryId = person.id;

  return result;
}

export async function recordSearchTool(
  input: RecordSearchInput
): Promise<RecordSearchToolResponse> {
  validateInput(input);

  const normalizedInput: RecordSearchInput = { ...input };
  if (normalizedInput.sex) {
    normalizedInput.sex = normalizeSex(normalizedInput.sex) ?? normalizedInput.sex;
  }
  const paired = applyAltNameAutoPair(normalizedInput);

  const token = await getValidToken();
  const url = buildSearchUrl(paired);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "FamilySearch session not accepted; call the login tool to re-authenticate."
      );
    }
    if (response.status === 403) {
      throw new Error(
        "FamilySearch search blocked the request. The User-Agent header was rejected by the WAF — check that the MCP server is running an unmodified build."
      );
    }
    if (response.status === 400) {
      let detail: string | null = null;
      try {
        const body = await response.json();
        detail = parseUpstreamErrorBody(body);
      } catch {
        detail = null;
      }
      if (detail) {
        throw new Error(`FamilySearch search rejected the query: ${detail}.`);
      }
      throw new Error(
        `FamilySearch search rejected the query (400 ${response.statusText}).`
      );
    }
    throw new Error(
      `FamilySearch search API error: ${response.status} ${response.statusText}`
    );
  }

  const data: FSSearchResponse = await response.json();
  const entries = data.entries ?? [];
  const results = entries
    .map(mapEntry)
    .filter((r): r is RecordSearchResult => r !== null);

  // Standardize places across the whole response in one pass (dedup spans all
  // entries; the resolver caches identical strings). Best-effort — never throws.
  await standardizePlaces(
    results.flatMap((r) => (r.gedcomx ? collectFacts(r.gedcomx) : [])),
  );

  const out: RecordSearchToolResponse = {
    query: echoQuery(input),
    totalMatches: data.results ?? 0,
    paginationCappedAt: PAGINATION_CAP,
    returned: results.length,
    offset: data.index ?? input.offset ?? 0,
    hasMore: data.links?.next?.href != null,
    // BEFORE `results`, deliberately, and this is load-bearing rather than
    // stylistic. `results` is by far the largest field in the response, so
    // anything serialized after it is the first thing any size bound drops:
    // across the 46 `record_search` calls in `run-2026-07-31_13-02-13` the
    // existing `ranked` field appears in the runlog **0 times**, though 18 of
    // those calls supplied `subjectId` and were therefore ranked. A signal whose
    // entire purpose is to be measurable from the runlog cannot sit behind the
    // field that crowds it out. (The capture itself is also being widened, in
    // `eval/harness/e2e/orchestrator.py` — belt and braces, since this response
    // is read by more than one consumer and only one of them is being fixed.)
    //
    // The condition is `projectPath && no subjectId` and NOTHING else. No tree
    // read, no name/date matching, no attempt to judge whether the search
    // "looked like" it was about a tree person — that test is a heuristic, and
    // gating the signal on an unvalidated heuristic would bias the very coverage
    // measurement the signal exists to produce. A caller running a legitimate
    // broad survey gets one extra short field; whether an omission was
    // legitimate is answered at analysis time from the args already in the
    // runlog.
    //
    // Truthiness, not `=== undefined`, on `subjectId`: the ranking gate below is
    // itself `input.subjectId &&`, so matching it exactly is what keeps this
    // field from ever claiming ranking was skipped when it ran, or vice versa.
    ...(input.projectPath !== undefined && !input.subjectId
      ? { rankingSkipped: RANKING_SKIPPED_NOTE }
      : {}),
    results,
  };

  // Host-side result staging (search-result-staging-spec.md). Purely additive
  // and best-effort: a staging failure never fails a successful search.
  if (input.projectPath !== undefined) {
    try {
      out.staged = await stageSearchResults({
        projectPath: input.projectPath,
        tool: "record_search",
        response: out,
      });
    } catch (error) {
      out.staged = null;
      out.stagingError = error instanceof Error ? error.message : String(error);
    }
  }

  // Whenever results were staged, slim the INLINE projection so a broad search
  // can't overflow the model's context — the bulk lives in the staged file,
  // which rank_search_matches (and record_read) read host-side, and the
  // remaining flat stub fields still carry names/dates/places for triage. This
  // is unconditional (no opt-in flag): once staged, nothing needs the dropped
  // fields inline, so the overflow protection can't be forgotten by the caller.
  //
  // Safe because the staged file is already serialized to disk by the awaited
  // stageSearchResults above, so mutating the inline copy cannot corrupt the
  // sidecar — the sidecar, the viewer's SidecarResultCard, and the eval fixtures
  // all keep full fidelity. Never slim when `staged` is null (an un-staged
  // exploratory search — nothing was retained to re-read from).
  //
  // Measured against the 3,380 rows of a real 140-search session: gedcomx aside,
  // collectionUrl was 14.0% of row bytes, collectionTitle 9.4%, empty
  // treeMatches 2.9%. primaryId (4.6%) is deliberately KEPT — rank_search_matches
  // skips any candidate lacking it (rank-search-matches.ts), so dropping it would
  // silently disable the re-ranker.
  if (out.staged) {
    const collections: Record<string, string> = {};
    for (const r of out.results) {
      delete r.gedcomx;

      // Derivable from collectionId; nothing reads it off the inline stub.
      delete r.collectionUrl;

      // Hoist the repeated per-row title into one response-level map.
      if (r.collectionId && r.collectionTitle) {
        collections[r.collectionId] = r.collectionTitle;
        delete r.collectionTitle;
      }

      // `treeMatches: []` on most rows — say nothing instead of saying "none".
      if (Array.isArray(r.treeMatches) && r.treeMatches.length === 0) {
        delete (r as Partial<RecordSearchResult>).treeMatches;
      }

      // FamilySearch repeats identical event entries (e.g. the same Census
      // date+place twice). Exact-duplicate removal only — no type filtering,
      // since Race/MaritalStatus are real triage signal.
      if (Array.isArray(r.events) && r.events.length > 1) {
        const seen = new Set<string>();
        r.events = r.events.filter((e) => {
          const k = JSON.stringify(e);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      }
    }
    if (Object.keys(collections).length > 0) out.collections = collections;
  }

  // Rank host-side when the caller named a subject. This is the "always call
  // rank_search_matches" rule turned into a tool contract — a documented step
  // decays under compaction (77% → 3% in one measured session), a contract
  // cannot. `rank_search_matches` remains a standalone tool: it is still the
  // way to re-rank a finalized results/<log_id>.json later, and the way to rank
  // against a different subject than the one searched for.
  //
  // Strictly best-effort. The original reason these were separate tools was
  // graceful degradation — "a matcher throttle slows ranking, not search" — and
  // that property is preserved here: any ranking failure leaves the search
  // result intact and merely sets `rankingError`. Ranking is read-only
  // (scoring + a staged-file read), so unlike a folded log write it introduces
  // no partial-failure state.
  if (out.staged && input.subjectId && input.projectPath) {
    try {
      out.ranked = await rankSearchMatches({
        projectPath: input.projectPath,
        stagedResultsRef: out.staged.resultsRef,
        subjectId: input.subjectId,
        checkAttachments: true,
      });
    } catch (error) {
      out.rankingError = error instanceof Error ? error.message : String(error);
    }
  }

  // A nil marriage search is a prompt, not a finding. Same reasoning as the
  // ranking contract above: the rule "when a marriage search comes back empty,
  // try where the couple were EARLIER, because marriage precedes migration" is
  // one the model is supposed to remember and measurably does not. Across four
  // scored `jimmie-jewel-neal` runs every marriage search stayed in the family's
  // later residence — the jurisdiction the tree's own marriage fact named —
  // while the answering record sat in the husband's birth state, a fact already
  // present in the same tree. Computing the alternatives is date arithmetic over
  // places the tree already holds, so the tool does it instead of asking.
  //
  // Fires on a search that did not find the subject here — either literally no
  // hits, or hits that ranking judged to hold no match (`subjectResolvable`
  // false). The ranker sets that in TWO branches — a scoreable subject against a
  // pool with no match, and a subject too thin to discriminate — and the hint
  // fires on both deliberately; see the spec's `subjectResolvable` paragraph.
  // Nil-only was too narrow: in one verification run it fired once, at 121 of 180
  // minutes. A search that returned rows but matched nobody is an equally good
  // moment to offer the alternative.
  //
  // Also gated on the search having been scoped to something NARROWER THAN A
  // COUNTRY. Unscoped and country-wide are the same situation: every candidate
  // the tree can offer was already inside the search, so naming localities within
  // it is noise and the note's "in the place searched" would be false. Across the
  // six committed runlogs, 9 of 26 marriage-scoped searches carried no place
  // scope at all — latent only because all 9 also omitted `subjectId`.
  //
  // Strictly best-effort and advisory — a tree that cannot be read leaves the
  // search untouched, exactly like the ranking block.
  const isMarriageSearch =
    input.recordType === "marriage" ||
    input.marriagePlace !== undefined ||
    input.marriageYearFrom !== undefined ||
    input.marriageYearTo !== undefined;

  const foundNobody =
    out.totalMatches === 0 || out.ranked?.subjectResolvable === false;

  // The place that was just searched is not always `marriagePlace`. In practice
  // the caller usually scopes a marriage search with `recordCountry` +
  // `recordSubdivision` instead — 6 of 7 marriage searches in one run, 4 of 5 in
  // another. Reading only `marriagePlace` left `searchedPlace` undefined on those,
  // so nothing was excluded and the jurisdiction that had just come back empty was
  // offered back as its own top alternative.
  const searchedPlace =
    input.marriagePlace ||
    [input.recordSubdivision, input.recordCountry].filter(Boolean).join(", ") ||
    undefined;

  if (
    isMarriageSearch &&
    foundNobody &&
    isSubCountryPlace(searchedPlace) &&
    input.subjectId &&
    input.projectPath
  ) {
    try {
      const tree = await readProjectJson(input.projectPath, "tree.gedcomx.json");
      const candidates = marriageJurisdictionCandidates(tree, input.subjectId, {
        searchedPlace,
        marriageYearFrom: input.marriageYearFrom,
        marriageYearTo: input.marriageYearTo,
      });
      if (candidates.length > 0) {
        out.jurisdictionHints = {
          searchedPlace,
          // Capped: 4 spouses x 8 placed facts is 40 objects, and this lands in a
          // response whose own assembly above deliberately strips `gedcomx`, hoists
          // `collectionTitle` and drops empty `treeMatches` for context economy.
          // The tail of a distance-ordered list is the least useful part of it.
          candidates: candidates.slice(0, MAX_JURISDICTION_HINTS),
          note:
            "This marriage search did not find the subject in the place searched. A " +
            "marriage is filed where the wedding happened, not where the couple later " +
            "lived, and a couple usually married BEFORE they migrated. Listed below are " +
            "other places these people are on record as having been, ordered by how " +
            "close they sit to this search's date window — most recent BEFORE the " +
            "window first, since that is the best guess for where they were when they " +
            "married; undated places next; places dated after the window last. Search " +
            "these before concluding no marriage record exists. " +
            "These are places to LOOK, not evidence of anything: a jurisdiction " +
            "appearing here is not a reason to attach a person found there. Each entry " +
            "says whose fact it came from and when, because a place contributed by a " +
            "spouse from a much later marriage may have no bearing on this one.",
        };
      }
    } catch {
      // A missing or malformed tree is not a search failure. Stay silent.
    }
  }

  return out;
}

export const recordSearchToolSchema = {
  name: "record_search",
  description:
    "Search FamilySearch's historical record index for a specific person. " +
    "Requires at least one anchor: surname or recordCountry. Other fields " +
    "narrow ranking. Returns ranked person matches with key facts, " +
    "persistent URLs, source-record details, and Family-Tree-person match " +
    "suggestions. Requires authentication — call the login tool first if " +
    "not logged in. For ambiguous place names, call the places tool first. " +
    "To scope to a specific record collection, call the collections tool " +
    "first to find the right collectionId.",
  inputSchema: {
    type: "object",
    properties: {
      surname: { type: "string", description: "Family name of the searched person. Strongest anchor for genealogy queries. At least one of `surname` or `recordCountry` must be supplied." },
      givenName: { type: "string", description: "Given (first) name of the searched person." },
      surnameAlt: { type: "string", description: "Alternate family name (e.g., a woman's maiden name when also searching by married surname). Triggers a UNION search — results match either `surname` OR `surnameAlt`. The tool auto-fills `givenNameAlt = givenName` if only this side is supplied." },
      givenNameAlt: { type: "string", description: "Alternate given name. UNION with `givenName`. The tool auto-fills `surnameAlt = surname` if only this side is supplied." },
      sex: { type: "string", enum: ["Male", "Female", "Unknown"], description: "Sex of the searched person. Case-insensitive on input — `'male'` is normalized to `'Male'`." },
      surnameExact: { type: "boolean", description: "When `true`, requires an exact surname match (no fuzzy nicknames or spelling variants). Applies to `surnameAlt` too when both are set." },
      givenNameExact: { type: "boolean", description: "When `true`, requires an exact given-name match (no fuzzy nicknames or spelling variants). Applies to `givenNameAlt` too when both are set." },

      birthYearFrom: { type: "number", description: "Lower bound of the birth-year range. 4-digit year (e.g., 1850). Must be paired with `birthYearTo`." },
      birthYearTo: { type: "number", description: "Upper bound of the birth-year range. 4-digit year (e.g., 1859). Must be paired with `birthYearFrom`." },
      birthYearExact: { type: "boolean", description: "When `true`, the birth-year range is matched exactly (no fuzz around the bounds)." },
      birthPlace: { type: "string", description: "Birth place name (e.g., `'Kentucky'`, `'Hardin, Kentucky, United States'`). For ambiguous place names, call the `place_search` tool first to disambiguate." },
      birthPlaceExact: { type: "boolean", description: "When `true`, requires an exact place match (no expansion to parent jurisdictions)." },

      deathYearFrom: { type: "number", description: "Lower bound of the death-year range. 4-digit year (e.g., 1900). Must be paired with `deathYearTo`." },
      deathYearTo: { type: "number", description: "Upper bound of the death-year range. 4-digit year (e.g., 1920). Must be paired with `deathYearFrom`." },
      deathYearExact: { type: "boolean", description: "When `true`, the death-year range is matched exactly." },
      deathPlace: { type: "string", description: "Death place name. For ambiguous place names, call the `place_search` tool first to disambiguate." },
      deathPlaceExact: { type: "boolean", description: "When `true`, requires an exact place match (no expansion to parent jurisdictions)." },

      marriageYearFrom: { type: "number", description: "Lower bound of the marriage-year range. 4-digit year (e.g., 1830). Must be paired with `marriageYearTo`." },
      marriageYearTo: { type: "number", description: "Upper bound of the marriage-year range. 4-digit year (e.g., 1840). Must be paired with `marriageYearFrom`." },
      marriageYearExact: { type: "boolean", description: "When `true`, the marriage-year range is matched exactly." },
      marriagePlace: { type: "string", description: "Marriage place name. For ambiguous place names, call the `place_search` tool first to disambiguate." },
      marriagePlaceExact: { type: "boolean", description: "When `true`, requires an exact place match (no expansion to parent jurisdictions)." },

      residenceYearFrom: { type: "number", description: "Lower bound of the residence-year range (typically census-style anchor). 4-digit year (e.g., 1860). Must be paired with `residenceYearTo`." },
      residenceYearTo: { type: "number", description: "Upper bound of the residence-year range. 4-digit year (e.g., 1870). Must be paired with `residenceYearFrom`." },
      residenceYearExact: { type: "boolean", description: "When `true`, the residence-year range is matched exactly." },
      residencePlace: { type: "string", description: "Residence place name. For ambiguous place names, call the `place_search` tool first to disambiguate." },
      residencePlaceExact: { type: "boolean", description: "When `true`, requires an exact place match (no expansion to parent jurisdictions)." },

      anyYearFrom: { type: "number", description: "Lower bound of an any-event year range. 4-digit year (e.g., 1850). Use when the event type is unknown or doesn't matter. Must be paired with `anyYearTo`." },
      anyYearTo: { type: "number", description: "Upper bound of an any-event year range. 4-digit year (e.g., 1880). Must be paired with `anyYearFrom`." },
      anyYearExact: { type: "boolean", description: "When `true`, the any-event year range is matched exactly." },
      anyPlace: { type: "string", description: "Place name for an event of any type. For ambiguous place names, call the `place_search` tool first to disambiguate." },
      anyPlaceExact: { type: "boolean", description: "When `true`, requires an exact place match (no expansion to parent jurisdictions)." },

      spouseGivenName: { type: "string", description: "Spouse's given name (a person mentioned alongside the searched person as their spouse on the record)." },
      spouseSurname: { type: "string", description: "Spouse's family name." },
      spouseGivenNameExact: { type: "boolean", description: "When `true`, requires an exact match on the spouse's given name." },
      spouseSurnameExact: { type: "boolean", description: "When `true`, requires an exact match on the spouse's family name." },
      fatherGivenName: { type: "string", description: "Father's given name (a person mentioned on the record as the searched person's father)." },
      fatherSurname: { type: "string", description: "Father's family name." },
      fatherGivenNameExact: { type: "boolean", description: "When `true`, requires an exact match on the father's given name." },
      fatherSurnameExact: { type: "boolean", description: "When `true`, requires an exact match on the father's family name." },
      motherGivenName: { type: "string", description: "Mother's given name (a person mentioned on the record as the searched person's mother)." },
      motherSurname: { type: "string", description: "Mother's family name." },
      motherGivenNameExact: { type: "boolean", description: "When `true`, requires an exact match on the mother's given name." },
      motherSurnameExact: { type: "boolean", description: "When `true`, requires an exact match on the mother's family name." },
      parentGivenName: { type: "string", description: "A parent's given name when the parent's sex is unknown. Use instead of `fatherGivenName` / `motherGivenName` when you don't know which parent." },
      parentSurname: { type: "string", description: "A parent's family name when the parent's sex is unknown." },
      parentGivenNameExact: { type: "boolean", description: "When `true`, requires an exact match on the parent's given name." },
      parentSurnameExact: { type: "boolean", description: "When `true`, requires an exact match on the parent's family name." },
      otherGivenName: { type: "string", description: "Given name of a person who appears on the record alongside the searched person, of unknown relationship (use when you know two names co-occur but not how they relate)." },
      otherSurname: { type: "string", description: "Family name of a person who appears on the record alongside the searched person, of unknown relationship." },
      otherGivenNameExact: { type: "boolean", description: "When `true`, requires an exact match on the other given name." },
      otherSurnameExact: { type: "boolean", description: "When `true`, requires an exact match on the other family name." },

      collectionId: { type: "string", description: "A single FamilySearch collection ID — the `id` string returned by the `collections_search` tool (e.g., `\"1743384\"`). Call `collections_search` first to find the right ID for a place or topic. Note: this is a different ID system from the `place_search` tool's IDs — pass a place *name* to `collections_search`, not a place ID." },
      imageGroupNumber: { type: "string", description: "Filter to a specific digitized volume by image group number (e.g., `'004010852'`). Also accepts split DGS format (e.g., `'004010852_001_M9QY-X6Y'`). Use the `image_search` tool first to find the image group number for a place and date range." },
      recordCountry: { type: "string", description: "Country where the record was created (e.g., `'United States'`, `'England'`). Acts as an anchor — at least one of `surname` or `recordCountry` must be supplied." },
      recordSubdivision: { type: "string", description: "State, province, or first-level subdivision within the country (e.g., `'Alabama'`). Requires `recordCountry` to be supplied alongside it." },
      recordType: { type: "string", enum: ["birth", "marriage", "death", "census", "immigration", "military", "probate", "other"], description: "Type of record. Mapped to the upstream's integer recordType encoding by the tool." },
      maritalStatus: { type: "string", enum: ["Married", "Single", "Divorced", "Widowed"], description: "Marital status of the searched person. Case-sensitive — must be supplied with the exact capitalization shown. Many records leave this field unfilled, so filtering on it excludes records where the field is blank." },
      isPrincipal: { type: "boolean", description: "Filter by the searched person's role in the record. `true` returns only records where the matched person is the principal subject (e.g., the deceased on a death certificate, the bride/groom on a marriage). `false` returns only records where the matched person is mentioned but is not the principal (e.g., as a parent, witness, sibling). Omit the parameter to return both — the broadest set, recommended for most natural-language searches." },

      subjectId: { type: "string", description: "A `persons[].id` from the project's tree.gedcomx.json (e.g. `\"I1\"`). Supply it together with `projectPath` and the tool ALSO ranks the results against that subject with FamilySearch's own matcher and returns them under `ranked` — match-scored, attachment-checked, best first. This replaces a separate `rank_search_matches` call. Supply it for any search where you know which tree person you are looking for, which is nearly all of them. Ranking never fails the search: on a ranking error you still get `results`, plus `rankingError`. Omit it only when the search is not about a specific tree person (a broad survey, or a person not yet in the tree)." },
      count: { type: "number", description: "Number of results per page. Max 100. Default 50 when `subjectId` is supplied — ranking cuts a deep pool back host-side, so fetching one is worth it — and 20 otherwise, since an unranked deep pool is just more stubs for you to read. Override only for a deliberate reason." },
      offset: { type: "number", description: "Pagination offset. Default 0. The combined value `offset + count` must be at most 4999 (FamilySearch's hard search-depth limit)." },

      projectPath: { type: "string", description: "Absolute path to the active project directory. When supplied, the tool stages its raw results host-side and returns a `staged.resultsRef` handle. The inline results then come back as compact stubs — no per-result `gedcomx`, no `collectionUrl` (derive it from `collectionId`), no `treeMatches` key when there are none, and no per-row `collectionTitle`: those are hoisted into a single response-level `collections` map of `collectionId` → title. The full-fidelity rows live in the staged file, so a broad search can't overflow the context. Pass the `staged.resultsRef` to `rank_search_matches` to re-rank by match score, and to `research_log_append` as `stagedResultsRef` so the results are retained in the log sidecar without you re-serializing them (that also lets you omit `query` — the staged payload already carries it). Omit `projectPath` for an exploratory search you do not intend to log (results come back inline at full fidelity)." },
    },
  },
};
