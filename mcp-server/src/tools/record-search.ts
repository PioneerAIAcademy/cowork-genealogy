import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { toSimplified } from "../utils/gedcomx-convert.js";
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

const FS_SEARCH_URL =
  "https://www.familysearch.org/service/search/hr/v2/personas";

const PAGINATION_CAP = 4999;
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

function isFourDigitYear(value: number): boolean {
  return Number.isInteger(value) && value >= 1000 && value <= 9999;
}

function normalizeSex(value: string): string | null {
  const lookup: Record<string, string> = {
    male: "Male",
    female: "Female",
    unknown: "Unknown",
  };
  return lookup[value.toLowerCase()] ?? null;
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
  const count = input.count ?? 20;
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

  add("count", input.count ?? 20);
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

  const arkUrl = person.identifiers?.[PERSISTENT_ID_URI]?.[0];

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
  const recordUrl = recordSd?.identifiers?.[PERSISTENT_ID_URI]?.[0];

  const treeMatches: TreeMatch[] = (entry.hints ?? [])
    .map((hint) => {
      const id = parseTreePersonId(hint.id);
      if (!id) return null;
      return { treePersonId: id, stars: hint.stars ?? 0 };
    })
    .filter((m): m is TreeMatch => m !== null)
    .sort((a, b) => b.stars - a.stars);

  const result: RecordSearchResult = {
    personId: entry.id,
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
  if (arkUrl) result.arkUrl = arkUrl;
  if (collectionId) result.collectionId = collectionId;
  if (collectionTitle) result.collectionTitle = collectionTitle;
  if (collectionUrl) result.collectionUrl = collectionUrl;
  if (recordTitle) result.recordTitle = recordTitle;
  if (recordUrl) result.recordUrl = recordUrl;

  // Carry the simplified GedcomX so downstream tools (match_two_examples)
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

export function parseUpstreamErrorBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const detail = errors
    .map((e) => {
      if (typeof e === "string") return e;
      if (e && typeof e === "object") {
        const msg = (e as { message?: unknown }).message;
        if (typeof msg === "string") return msg;
      }
      return null;
    })
    .filter((s): s is string => s !== null)
    .join("; ");
  return detail || null;
}

function echoQuery(input: RecordSearchInput): Partial<RecordSearchInput> {
  const echo: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) echo[key] = value;
  }
  return echo as Partial<RecordSearchInput>;
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

  return {
    query: echoQuery(input),
    totalMatches: data.results ?? 0,
    paginationCappedAt: PAGINATION_CAP,
    returned: results.length,
    offset: data.index ?? input.offset ?? 0,
    hasMore: data.links?.next?.href != null,
    results,
  };
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

      collectionId: { type: "number", description: "A single FamilySearch collection ID. Call the `place_collections` tool first to find the right ID for a place or topic. Note: this is a different ID system from the `place_search` tool's IDs — pass a place *name* to `place_collections`, not a place ID." },
      recordCountry: { type: "string", description: "Country where the record was created (e.g., `'United States'`, `'England'`). Acts as an anchor — at least one of `surname` or `recordCountry` must be supplied." },
      recordSubdivision: { type: "string", description: "State, province, or first-level subdivision within the country (e.g., `'Alabama'`). Requires `recordCountry` to be supplied alongside it." },
      recordType: { type: "string", enum: ["birth", "marriage", "death", "census", "immigration", "military", "probate", "other"], description: "Type of record. Mapped to the upstream's integer recordType encoding by the tool." },
      maritalStatus: { type: "string", enum: ["Married", "Single", "Divorced", "Widowed"], description: "Marital status of the searched person. Case-sensitive — must be supplied with the exact capitalization shown. Many records leave this field unfilled, so filtering on it excludes records where the field is blank." },
      isPrincipal: { type: "boolean", description: "Filter by the searched person's role in the record. `true` returns only records where the matched person is the principal subject (e.g., the deceased on a death certificate, the bride/groom on a marriage). `false` returns only records where the matched person is mentioned but is not the principal (e.g., as a parent, witness, sibling). Omit the parameter to return both — the broadest set, recommended for most natural-language searches." },

      count: { type: "number", description: "Number of results per page. Default 20, max 100." },
      offset: { type: "number", description: "Pagination offset. Default 0. The combined value `offset + count` must be at most 4999 (FamilySearch's hard search-depth limit)." },
    },
  },
};
