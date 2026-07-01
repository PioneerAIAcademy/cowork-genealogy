import { getValidToken } from "../auth/refresh.js";
import {
  toSimplified,
  standardizePlaces,
  collectFacts,
} from "../utils/gedcomx-convert.js";
import {
  isFourDigitYear,
  normalizeSex,
  parseUpstreamErrorBody,
  echoQuery,
} from "../utils/search-helpers.js";
import type { GedcomX } from "../types/gedcomx.js";
import type {
  FSTreeSearchEntry,
  FSTreeSearchPerson,
  FSTreeSearchResponse,
  PersonSearchInput,
  PersonSearchResult,
  PersonSearchToolResponse,
} from "../types/person-search.js";

const FS_TREE_SEARCH_URL = "https://api.familysearch.org/platform/tree/search";
const ACCEPT_HEADER = "application/x-gedcomx-atom+json";
const PAGINATION_CAP = 4999;
const PERSISTENT_ID_URI = "http://gedcomx.org/Persistent";

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
];

interface KinGroup {
  prefix: string;
  apiGiven: string;
  apiSurname: string;
  // father/mother/parent accept a birth place; spouse does not.
  apiBirthPlace?: string;
}

const KIN_GROUPS: KinGroup[] = [
  { prefix: "spouse", apiGiven: "q.spouseGivenName", apiSurname: "q.spouseSurname" },
  {
    prefix: "father",
    apiGiven: "q.fatherGivenName",
    apiSurname: "q.fatherSurname",
    apiBirthPlace: "q.fatherBirthLikePlace",
  },
  {
    prefix: "mother",
    apiGiven: "q.motherGivenName",
    apiSurname: "q.motherSurname",
    apiBirthPlace: "q.motherBirthLikePlace",
  },
  {
    prefix: "parent",
    apiGiven: "q.parentGivenName",
    apiSurname: "q.parentSurname",
    apiBirthPlace: "q.parentBirthLikePlace",
  },
];

function get(input: PersonSearchInput, key: string): unknown {
  return input[key as keyof PersonSearchInput];
}

// True when the input carries at least one "other" search field — anything
// besides surname that meaningfully narrows. Per the surname-plus-one rule,
// `sex`, the `*Exact` toggles, and `count`/`offset` do NOT count.
function hasOtherSearchField(input: PersonSearchInput): boolean {
  if (input.givenName) return true;
  for (const group of EVENT_GROUPS) {
    if (get(input, `${group.prefix}YearFrom`) !== undefined) return true;
    if (get(input, `${group.prefix}YearTo`) !== undefined) return true;
    if (get(input, `${group.prefix}Place`)) return true;
  }
  for (const group of KIN_GROUPS) {
    if (get(input, `${group.prefix}GivenName`)) return true;
    if (get(input, `${group.prefix}Surname`)) return true;
    if (group.apiBirthPlace && get(input, `${group.prefix}BirthPlace`)) return true;
  }
  return false;
}

export function validateInput(input: PersonSearchInput): void {
  if (!input.surname || !hasOtherSearchField(input)) {
    throw new Error(
      "person_search requires a surname plus at least one other search field (a given name, a life-event date or place, or a relative's name). sex and exact-match toggles don't count."
    );
  }

  if (input.count !== undefined) {
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 100) {
      throw new Error("count must be between 1 and 100.");
    }
  }
  if (input.offset !== undefined) {
    if (
      !Number.isInteger(input.offset) ||
      input.offset < 0 ||
      input.offset > PAGINATION_CAP
    ) {
      throw new Error(
        "offset must be between 0 and 4999 (FamilySearch search-depth limit). Narrow the query instead of paging deeper."
      );
    }
  }

  for (const group of EVENT_GROUPS) {
    const fromKey = `${group.prefix}YearFrom`;
    const toKey = `${group.prefix}YearTo`;
    const from = get(input, fromKey) as number | undefined;
    const to = get(input, toKey) as number | undefined;
    if (from !== undefined && !isFourDigitYear(from)) {
      throw new Error(`${fromKey} must be a 4-digit year (e.g., 1809).`);
    }
    if (to !== undefined && !isFourDigitYear(to)) {
      throw new Error(`${toKey} must be a 4-digit year (e.g., 1809).`);
    }
    if ((from === undefined) !== (to === undefined)) {
      throw new Error(
        `${fromKey} and ${toKey} must be provided together.`
      );
    }
    if (from !== undefined && to !== undefined && from > to) {
      throw new Error(`${fromKey} must be <= ${toKey}.`);
    }
  }

  if (input.sex !== undefined && !normalizeSex(input.sex)) {
    throw new Error(
      "sex must be 'Male', 'Female', or 'Unknown' (case-insensitive)."
    );
  }
}

export function buildSearchUrl(input: PersonSearchInput): string {
  const params: string[] = [];
  const add = (key: string, value: string | number | boolean): void => {
    params.push(`${key}=${encodeURIComponent(String(value))}`);
  };

  if (input.surname) add("q.surname", input.surname);
  if (input.givenName) add("q.givenName", input.givenName);
  if (input.sex) {
    const normalized = normalizeSex(input.sex);
    if (normalized) add("q.sex", normalized);
  }
  if (input.surnameExact) add("q.surname.exact", "on");
  if (input.givenNameExact) add("q.givenName.exact", "on");

  for (const group of EVENT_GROUPS) {
    const from = get(input, `${group.prefix}YearFrom`) as number | undefined;
    const to = get(input, `${group.prefix}YearTo`) as number | undefined;
    const place = get(input, `${group.prefix}Place`) as string | undefined;
    if (from !== undefined && to !== undefined) {
      add(`${group.apiDate}.from`, from);
      add(`${group.apiDate}.to`, to);
    }
    if (get(input, `${group.prefix}YearExact`)) add(`${group.apiDate}.exact`, "on");
    if (place) add(group.apiPlace, place);
    if (get(input, `${group.prefix}PlaceExact`)) add(`${group.apiPlace}.exact`, "on");
  }

  for (const group of KIN_GROUPS) {
    const given = get(input, `${group.prefix}GivenName`) as string | undefined;
    const surname = get(input, `${group.prefix}Surname`) as string | undefined;
    if (given) add(group.apiGiven, given);
    if (surname) add(group.apiSurname, surname);
    if (get(input, `${group.prefix}GivenNameExact`)) add(`${group.apiGiven}.exact`, "on");
    if (get(input, `${group.prefix}SurnameExact`)) add(`${group.apiSurname}.exact`, "on");
    if (group.apiBirthPlace) {
      const birthPlace = get(input, `${group.prefix}BirthPlace`) as string | undefined;
      if (birthPlace) add(group.apiBirthPlace, birthPlace);
      if (get(input, `${group.prefix}BirthPlaceExact`)) {
        add(`${group.apiBirthPlace}.exact`, "on");
      }
    }
  }

  add("count", input.count ?? 20);
  add("offset", input.offset ?? 0);

  // Required: without this, q.* terms only rerank — they don't filter.
  add("m.queryRequireDefault", "on");

  return `${FS_TREE_SEARCH_URL}?${params.join("&")}`;
}

// Each entry's cluster holds the matched person plus relatives. The matched
// person is the one whose `id` equals `entry.id`; fall back to ark-suffix
// match, then the first person.
export function findMatchedPerson(
  entry: FSTreeSearchEntry
): FSTreeSearchPerson | null {
  const persons = entry.content?.gedcomx?.persons ?? [];
  if (persons.length === 0) return null;

  const entryId = entry.id;
  if (entryId) {
    const byId = persons.find((p) => p.id === entryId);
    if (byId) return byId;
    const byArk = persons.find((p) =>
      (p.identifiers?.[PERSISTENT_ID_URI] ?? []).some((url) => url.endsWith(entryId))
    );
    if (byArk) return byArk;
  }

  return persons[0] ?? null;
}

export function mapEntry(entry: FSTreeSearchEntry): PersonSearchResult | null {
  if (!entry.id) return null;
  const person = findMatchedPerson(entry);
  if (!person) return null;

  // Lean output: only the matched person — no relatives, no relationships.
  // The matched person is full GedcomX at runtime; FSTreeSearchPerson is a
  // narrower declaration, hence the cast.
  const gedcomx = toSimplified({ persons: [person] } as unknown as GedcomX);

  // Drop per-person source references. We pass only the person (not its
  // sourceDescriptions) to toSimplified, so these are dangling IDs that bloat
  // the pick-list without resolving to anything. Full sources come from
  // person_read on the chosen person. This mutates person_search's own
  // result only — toSimplified is untouched, so record_search / person_read
  // keep their sources behavior.
  for (const p of gedcomx.persons ?? []) delete p.sources;

  // Order keys metadata-first (personId, score, confidence) so the large
  // gedcomx blob reads last — matches the spec's result example.
  return {
    personId: entry.id,
    ...(entry.score !== undefined ? { score: entry.score } : {}),
    ...(entry.confidence !== undefined ? { confidence: entry.confidence } : {}),
    gedcomx,
  };
}

function emptyResponse(input: PersonSearchInput): PersonSearchToolResponse {
  return {
    query: echoQuery(input),
    totalMatches: 0,
    paginationCappedAt: PAGINATION_CAP,
    returned: 0,
    offset: input.offset ?? 0,
    hasMore: false,
    results: [],
  };
}

export async function personSearchTool(
  input: PersonSearchInput
): Promise<PersonSearchToolResponse> {
  validateInput(input);

  const token = await getValidToken();
  const url = buildSearchUrl(input);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: ACCEPT_HEADER,
      "Accept-Language": "en",
    },
  });

  // 204: a hard filter matched nothing — no body to read.
  if (response.status === 204) {
    return emptyResponse(input);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "FamilySearch session not accepted; call the login tool to re-authenticate."
      );
    }
    if (response.status === 400) {
      let detail: string | null = null;
      try {
        detail = parseUpstreamErrorBody(await response.json());
      } catch {
        detail = null;
      }
      if (detail) {
        throw new Error(`FamilySearch tree search rejected the query: ${detail}.`);
      }
      throw new Error(
        `FamilySearch tree search rejected the query (400 ${response.statusText}).`
      );
    }
    if (response.status === 429) {
      throw new Error(
        "FamilySearch rate limit reached. Wait a moment and try again."
      );
    }
    throw new Error(
      `FamilySearch tree search API error: ${response.status} ${response.statusText}`
    );
  }

  const data: FSTreeSearchResponse = await response.json();
  const entries = data.entries ?? [];
  const results = entries
    .map(mapEntry)
    .filter((r): r is PersonSearchResult => r !== null);

  // Standardize places across the whole response in one pass. Best-effort.
  await standardizePlaces(
    results.flatMap((r) => (r.gedcomx ? collectFacts(r.gedcomx) : [])),
  );

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

export const personSearchToolSchema = {
  name: "person_search",
  description:
    "Search the FamilySearch Family Tree for a person. Requires a surname " +
    "plus at least one other search field (a given name, a life-event year " +
    "or place, or a relative's name; sex and exact-match toggles don't " +
    "count). Additional fields narrow the ranking. Returns a ranked list of " +
    "candidate tree persons, each with a tree-person ID and simplified " +
    "GedcomX (name + facts), so the user can pick which one to research. To " +
    "expand a chosen match into parents, spouses, and children, call " +
    "person_read with relatives: true. Requires authentication — call the " +
    "login tool first if not logged in. For ambiguous place names, call the " +
    "place_search tool first.",
  inputSchema: {
    type: "object",
    properties: {
      givenName: { type: "string", description: "Given (first) name. Counts as a qualifying 'other' field alongside the required surname." },
      surname: { type: "string", description: "Family name. Required on every search, and must be accompanied by at least one other search field (a given name, a life-event year/place, or a relative's name). `sex` and `*Exact` toggles do not count." },
      sex: { type: "string", enum: ["Male", "Female", "Unknown"], description: "Sex of the person. Case-insensitive on input — `'male'` is normalized to `'Male'`. Does not satisfy the surname-plus-one rule on its own." },
      givenNameExact: { type: "boolean", description: "When `true`, requires an exact given-name match (no fuzzy nicknames or spelling variants)." },
      surnameExact: { type: "boolean", description: "When `true`, requires an exact surname match (no fuzzy nicknames or spelling variants)." },

      birthYearFrom: { type: "number", description: "Lower bound of the birth-year range. 4-digit year (e.g., 1809). Must be paired with `birthYearTo`." },
      birthYearTo: { type: "number", description: "Upper bound of the birth-year range. 4-digit year. Must be paired with `birthYearFrom`. For a single year, set From and To equal." },
      birthYearExact: { type: "boolean", description: "When `true`, the birth-year range is matched exactly." },
      birthPlace: { type: "string", description: "Birth place name. For ambiguous place names, call the `place_search` tool first." },
      birthPlaceExact: { type: "boolean", description: "When `true`, requires an exact place match (no expansion to parent jurisdictions)." },

      deathYearFrom: { type: "number", description: "Lower bound of the death-year range. 4-digit year. Must be paired with `deathYearTo`." },
      deathYearTo: { type: "number", description: "Upper bound of the death-year range. 4-digit year. Must be paired with `deathYearFrom`." },
      deathYearExact: { type: "boolean", description: "When `true`, the death-year range is matched exactly." },
      deathPlace: { type: "string", description: "Death place name." },
      deathPlaceExact: { type: "boolean", description: "When `true`, requires an exact place match." },

      marriageYearFrom: { type: "number", description: "Lower bound of the marriage-year range. 4-digit year. Must be paired with `marriageYearTo`." },
      marriageYearTo: { type: "number", description: "Upper bound of the marriage-year range. 4-digit year. Must be paired with `marriageYearFrom`." },
      marriageYearExact: { type: "boolean", description: "When `true`, the marriage-year range is matched exactly." },
      marriagePlace: { type: "string", description: "Marriage place name." },
      marriagePlaceExact: { type: "boolean", description: "When `true`, requires an exact place match." },

      residenceYearFrom: { type: "number", description: "Lower bound of the residence-year range. 4-digit year. Must be paired with `residenceYearTo`." },
      residenceYearTo: { type: "number", description: "Upper bound of the residence-year range. 4-digit year. Must be paired with `residenceYearFrom`." },
      residenceYearExact: { type: "boolean", description: "When `true`, the residence-year range is matched exactly." },
      residencePlace: { type: "string", description: "Residence place name." },
      residencePlaceExact: { type: "boolean", description: "When `true`, requires an exact place match." },

      spouseGivenName: { type: "string", description: "Spouse's given name." },
      spouseSurname: { type: "string", description: "Spouse's family name." },
      spouseGivenNameExact: { type: "boolean", description: "When `true`, requires an exact match on the spouse's given name." },
      spouseSurnameExact: { type: "boolean", description: "When `true`, requires an exact match on the spouse's family name." },

      fatherGivenName: { type: "string", description: "Father's given name." },
      fatherSurname: { type: "string", description: "Father's family name." },
      fatherGivenNameExact: { type: "boolean", description: "When `true`, requires an exact match on the father's given name." },
      fatherSurnameExact: { type: "boolean", description: "When `true`, requires an exact match on the father's family name." },
      fatherBirthPlace: { type: "string", description: "Father's birth place name." },
      fatherBirthPlaceExact: { type: "boolean", description: "When `true`, requires an exact match on the father's birth place." },

      motherGivenName: { type: "string", description: "Mother's given name." },
      motherSurname: { type: "string", description: "Mother's family name." },
      motherGivenNameExact: { type: "boolean", description: "When `true`, requires an exact match on the mother's given name." },
      motherSurnameExact: { type: "boolean", description: "When `true`, requires an exact match on the mother's family name." },
      motherBirthPlace: { type: "string", description: "Mother's birth place name." },
      motherBirthPlaceExact: { type: "boolean", description: "When `true`, requires an exact match on the mother's birth place." },

      parentGivenName: { type: "string", description: "A parent's given name when the parent's sex is unknown." },
      parentSurname: { type: "string", description: "A parent's family name when the parent's sex is unknown." },
      parentGivenNameExact: { type: "boolean", description: "When `true`, requires an exact match on the parent's given name." },
      parentSurnameExact: { type: "boolean", description: "When `true`, requires an exact match on the parent's family name." },
      parentBirthPlace: { type: "string", description: "A parent's birth place name." },
      parentBirthPlaceExact: { type: "boolean", description: "When `true`, requires an exact match on the parent's birth place." },

      count: { type: "number", description: "Results per call. Default 20, range 1–100." },
      offset: { type: "number", description: "0-based index of the first result. Default 0, range 0–4999 (FamilySearch's search-depth limit)." },
    },
  },
} as const;

// Re-export the input type for index.ts wiring.
export type { PersonSearchInput };
