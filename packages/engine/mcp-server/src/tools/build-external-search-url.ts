// build_external_search_url — deterministic external-site search URL templating.
//
// Migrates the seven site-wide `{...}` templates the `search-external-sites`
// skill filled in by hand (SKILL.md prose) into tested code. The LLM keeps
// every judgment (which record type/event the search targets, which curated
// link fits, what conflicts[] says about a disputed field); the tool applies
// only the string-templating. Spec: docs/specs/build-external-search-url-tool-spec.md.

export type ExternalSearchSite =
  | "ancestry"
  | "myheritage"
  | "findmypast"
  | "findagrave"
  | "newspapers"
  | "chronicling_america"
  | "digital_newspaper_archive";

export interface BuildExternalSearchUrlAttributes {
  givenName?: string;
  surname?: string;
  birthYear?: number;
  birthPlace?: string;
  deathYear?: number;
  deathPlace?: string;
  marriageYear?: number;
  marriagePlace?: string;
  residenceYear?: number;
  residencePlace?: string;
  fatherGivenName?: string;
  fatherSurname?: string;
  motherGivenName?: string;
  motherSurname?: string;
  spouseGivenName?: string;
  spouseSurname?: string;
  // FindMyPast-only tuning knobs.
  birthYearOffset?: number;
  placeProximityMiles?: number;
  eventYear?: number;
  // Free-text terms appended alongside the name, for the three sites whose
  // site-wide search is a single free-text query field rather than structured
  // name parameters (newspapers, chronicling_america, digital_newspaper_archive).
  // A caller wanting an exact phrase includes its own quote marks.
  keywords?: string;
  // Newspapers.com's generic date/place slots (no single named event fits).
  // A plain year ("1892") or a hyphenated range ("1880-1905") — this site's
  // own date filter accepts both; the tool does not parse or validate the
  // shape, only templates it.
  searchYear?: string;
  searchPlace?: string;
  // Chronicling America's date window and state.
  searchStartYear?: number;
  searchEndYear?: number;
  usState?: string;
}

export interface BuildExternalSearchUrlInput {
  site: string;
  baseUrl?: string;
  attributes: BuildExternalSearchUrlAttributes;
}

export type BuildExternalSearchUrlResult =
  | { ok: true; url: string; notes: string[] }
  | { ok: false; reason: "unsupported_site"; errors: string[]; supportedSites: string[] }
  | { ok: false; reason: "base_url_required"; errors: string[] }
  | { ok: false; reason: "no_attributes"; errors: string[] };

function isSupportedSite(site: string): site is ExternalSearchSite {
  return (SUPPORTED_SITES as string[]).includes(site);
}

// A genealogy year is a small positive integer; this bound rejects NaN,
// Infinity, 1e21-scale nonsense, and fractional years (1845.7) in one check —
// `Number.isInteger` alone accepts 1e21 (it has no fractional part) and
// rejects NaN/Infinity on its own, but the magnitude clamp is still needed.
const YEAR_MIN = 0;
const YEAR_MAX = 9999;

function num(n: number | undefined): string | undefined {
  return n !== undefined && Number.isInteger(n) && n >= YEAR_MIN && n <= YEAR_MAX
    ? String(n)
    : undefined;
}

// Empty-string treated as absent throughout — `attributes: { birthPlace: "" }`
// must not produce `birthplace=` or defeat a documented fallback (FindAGrave's
// death-place-falls-back-to-birth-place).
function str(s: string | undefined): string | undefined {
  return s !== undefined && s.length > 0 ? s : undefined;
}

function joinUnderscore(...parts: Array<string | undefined>): string | undefined {
  const present = parts.map(str).filter((p): p is string => p !== undefined);
  return present.length > 0 ? present.join("_") : undefined;
}

// Joined with a real space, not a literal `+` — `toQueryString` below encodes
// a space as `+` (form-encoding convention), so the join and the encoding
// step must not both try to own that character. Joining with `+` directly
// and then percent-encoding the whole value turns the `+` into `%2B` (a
// literal plus the receiving site's own parser must NOT decode as a space).
function joinSpace(...parts: Array<string | undefined>): string | undefined {
  const present = parts.map(str).filter((p): p is string => p !== undefined);
  return present.length > 0 ? present.join(" ") : undefined;
}

// Each site's table below is a straight port of the site-wide templates this
// tool replaces (search-external-sites/SKILL.md, before this PR) — see the
// spec's §4 for the per-site rationale (why keywordsplace defaults to
// birthPlace, why Ancestry's death/marriage fields are ported despite not
// appearing in its illustrative example URL, etc). Every key read here must
// also appear in RECOGNIZED_KEYS below, for that site.
function siteWideParams(
  site: Exclude<ExternalSearchSite, "digital_newspaper_archive">,
  a: BuildExternalSearchUrlAttributes,
): Record<string, string | undefined> {
  switch (site) {
    case "ancestry":
      return {
        name: joinUnderscore(a.givenName, a.surname),
        birth: num(a.birthYear),
        birthplace: str(a.birthPlace),
        death: num(a.deathYear),
        deathplace: str(a.deathPlace),
        marriage: num(a.marriageYear),
        residence: joinUnderscore(num(a.residenceYear), str(a.residencePlace)),
        father: joinUnderscore(a.fatherGivenName, a.fatherSurname),
        mother: joinUnderscore(a.motherGivenName, a.motherSurname),
        spouse: joinUnderscore(a.spouseGivenName, a.spouseSurname),
      };
    case "myheritage":
      return {
        first: str(a.givenName),
        last: str(a.surname),
        birth_year: num(a.birthYear),
        birth_place: str(a.birthPlace),
        marriage_year: num(a.marriageYear),
        marriage_place: str(a.marriagePlace),
        death_year: num(a.deathYear),
        death_place: str(a.deathPlace),
        father_first: str(a.fatherGivenName),
        father_last: str(a.fatherSurname),
        mother_first: str(a.motherGivenName),
        mother_last: str(a.motherSurname),
      };
    case "findmypast":
      return {
        firstname: str(a.givenName),
        lastname: str(a.surname),
        yearofbirth: num(a.birthYear),
        yearofbirth_offset: num(a.birthYearOffset),
        keywordsplace: str(a.birthPlace),
        keywordsplace_proximity: num(a.placeProximityMiles),
        eventyear: num(a.eventYear),
        fatherfirstname: str(a.fatherGivenName),
        motherfirstname: str(a.motherGivenName),
      };
    case "findagrave":
      return {
        firstname: str(a.givenName),
        lastname: str(a.surname),
        birthyear: num(a.birthYear),
        deathyear: num(a.deathYear),
        location: str(a.deathPlace) ?? str(a.birthPlace),
      };
    case "newspapers":
      return {
        query: joinSpace(a.givenName, a.surname, a.keywords),
        dr_year: str(a.searchYear),
        dr_place: str(a.searchPlace),
      };
    case "chronicling_america": {
      // Both ends must be valid, not merely present — `num()` rejects NaN,
      // Infinity, out-of-range, and fractional years. Checking `!== undefined`
      // alone let one bad end through as long as the other was supplied
      // (e.g. `searchStartYear: NaN, searchEndYear: 1910` shipped
      // `dates=NaN%2F1910`), because presence and validity are different
      // questions and only presence was being asked.
      const startYear = num(a.searchStartYear);
      const endYear = num(a.searchEndYear);
      return {
        // Correction: `qs` is dead on the live site (a nonsense value returns
        // the same corpus total as no term at all); `q` is what actually
        // filters — from one reviewer's live measurement (2026-09-09), not
        // independently reproduced since (loc.gov's bot protection blocks a
        // non-browser client). See the spec's "What nothing checks" section
        // for the full caveat and how to correct this if it's ever wrong.
        q: joinSpace(a.givenName, a.surname, a.keywords),
        // Correction: the shipped start_date/end_date pair is dead on the
        // live site; dates=YYYY/YYYY is the working replacement.
        dates: startYear !== undefined && endYear !== undefined ? `${startYear}/${endYear}` : undefined,
        location_state: str(a.usState)?.toLowerCase(),
      };
    }
  }
}

// The attribute keys each site above actually reads. Kept beside
// `siteWideParams` (not derived from it) so a supplied-but-unrecognized
// attribute can be flagged in `notes` — the caller passing `deathYear` to a
// site with no death slot should not fail silently.
const RECOGNIZED_KEYS: Record<Exclude<ExternalSearchSite, "digital_newspaper_archive">, Set<keyof BuildExternalSearchUrlAttributes>> = {
  ancestry: new Set([
    "givenName", "surname", "birthYear", "birthPlace", "deathYear", "deathPlace",
    "marriageYear", "residenceYear", "residencePlace", "fatherGivenName", "fatherSurname",
    "motherGivenName", "motherSurname", "spouseGivenName", "spouseSurname",
  ]),
  myheritage: new Set([
    "givenName", "surname", "birthYear", "birthPlace", "marriageYear", "marriagePlace",
    "deathYear", "deathPlace", "fatherGivenName", "fatherSurname", "motherGivenName", "motherSurname",
  ]),
  findmypast: new Set([
    "givenName", "surname", "birthYear", "birthYearOffset", "birthPlace",
    "placeProximityMiles", "eventYear", "fatherGivenName", "motherGivenName",
  ]),
  findagrave: new Set(["givenName", "surname", "birthYear", "deathYear", "deathPlace", "birthPlace"]),
  newspapers: new Set(["givenName", "surname", "keywords", "searchYear", "searchPlace"]),
  chronicling_america: new Set(["givenName", "surname", "keywords", "searchStartYear", "searchEndYear", "usState"]),
};

const SITE_BASE_URL: Record<Exclude<ExternalSearchSite, "digital_newspaper_archive">, string> = {
  ancestry: "https://www.ancestry.com/search/",
  myheritage: "https://www.myheritage.com/research",
  findmypast: "https://www.findmypast.com/search/results",
  findagrave: "https://www.findagrave.com/memorial/search",
  newspapers: "https://www.newspapers.com/search/",
  chronicling_america: "https://www.loc.gov/collections/chronicling-america/",
};

// The sites this tool can actually build a URL for — every key `SITE_BASE_URL`
// declares (a `Record` with exactly those keys, so `Object.keys` can never
// diverge from `siteWideParams`'s own switch) plus `digital_newspaper_archive`,
// which is handled separately. Deliberately NOT derived from the shared
// `external_site` enum: that enum already carries the 14 follow-up sites'
// eventual names (issue #1980's own deferred scope), and a site advertised
// as valid before its `siteWideParams` case exists crashes on `Object.values`
// of the switch's implicit `undefined` return — reproduced by appending a
// site to the enum with no matching implementation here. `tsc` sees no error,
// because `isSupportedSite`'s type predicate is an unchecked runtime
// assertion the compiler cannot verify against the switch's actual cases.
// A spread off `Object.keys(...)` is an identifier expression, not a string
// literal array, so `tool-schema-enums.test.ts`'s literal-array scan does not
// treat this as a hand-typed copy of `external_site` — nothing here needs the
// VALIDATOR_ENUMS import that the previous, enum-derived version required.
const SUPPORTED_SITES: ExternalSearchSite[] = [
  ...(Object.keys(SITE_BASE_URL) as Array<Exclude<ExternalSearchSite, "digital_newspaper_archive">>),
  "digital_newspaper_archive",
];

const SITE_FIXED_PARAMS: Partial<Record<Exclude<ExternalSearchSite, "digital_newspaper_archive">, Record<string, string>>> = {
  myheritage: { action: "query" },
  // Required — without it the search returns newspaper titles from the U.S.
  // Newspaper Directory, not digitised pages.
  chronicling_america: { dl: "page" },
};

// Encodes a value the way a browser's own search form would submit it
// (application/x-www-form-urlencoded): a space becomes `+`, everything else
// is percent-encoded. `encodeURIComponent` alone escapes a literal `+` to
// `%2B`, which is why `joinSpace` above joins with a real space rather than
// inserting `+` before this runs — doing it the other way round turned an
// intended "space between words" into a literal plus sign on the wire.
function encodeFormValue(v: string): string {
  return encodeURIComponent(v).replace(/%20/g, "+");
}

function toQueryString(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeFormValue(v)}`).join("&");
}

// Appends params onto an existing URL without decoding/re-encoding anything
// already there. Earlier drafts routed the existing query through
// `URLSearchParams`, which silently rewrote it three ways: a `#fragment`
// landed after the appended `?query` (browsers never send anything after
// `#`, so the search was never actually scoped); `?a=1?b=2` lost `b=2`
// (URLSearchParams parses the whole remainder as one key); and a
// already-encoded value was re-encoded to a different but equivalent form
// (`Smith%2C%20John` -> `Smith%2C+John`), which is not the "does not
// otherwise alter" guarantee the spec makes. Working on raw substrings
// avoids all three: the fragment is split off first and reattached at the
// very end, and the existing query is preserved as one untouched string.
function appendToBaseUrl(baseUrl: string, params: Record<string, string | undefined>): string {
  const hashIndex = baseUrl.indexOf("#");
  const fragment = hashIndex === -1 ? "" : baseUrl.slice(hashIndex);
  const withoutFragment = hashIndex === -1 ? baseUrl : baseUrl.slice(0, hashIndex);

  const qIndex = withoutFragment.indexOf("?");
  const path = qIndex === -1 ? withoutFragment : withoutFragment.slice(0, qIndex);
  const existingQuery = qIndex === -1 ? "" : withoutFragment.slice(qIndex + 1);

  const existingTokens = existingQuery.length > 0 ? existingQuery.split("&") : [];
  const preservedTokens = existingTokens.filter((token) => {
    const key = token.split("=", 1)[0];
    return key.toLowerCase() !== "sid";
  });

  const appended = toQueryString(params);
  const combinedQuery = [preservedTokens.join("&"), appended].filter((s) => s.length > 0).join("&");
  const query = combinedQuery.length > 0 ? `?${combinedQuery}` : "";
  return `${path}${query}${fragment}`;
}

export function buildExternalSearchUrl(input: BuildExternalSearchUrlInput): BuildExternalSearchUrlResult {
  const { site, baseUrl: rawBaseUrl, attributes } = input ?? ({} as BuildExternalSearchUrlInput);
  const a = attributes ?? {};
  // "" and whitespace-only are absent, the same convention `str()` applies to
  // every attribute — without this, `baseUrl: ""` (or a caller passing a
  // curated link that turned out blank) built a dead link (`"?name=Flynn"`,
  // no host at all) rather than falling back to the site-wide URL, and
  // `baseUrl: "   "` built one with a literal leading space in the URL.
  const baseUrl = rawBaseUrl?.trim() ? rawBaseUrl : undefined;

  if (!isSupportedSite(site)) {
    return {
      ok: false,
      reason: "unsupported_site",
      errors: [`"${site}" is not a supported site`],
      supportedSites: SUPPORTED_SITES,
    };
  }

  if (site === "digital_newspaper_archive") {
    if (!baseUrl) {
      return {
        ok: false,
        reason: "base_url_required",
        errors: [
          "digital_newspaper_archive has no fixed site-wide URL — pass the specific archive's own search endpoint as baseUrl",
        ],
      };
    }
    const q = joinSpace(a.givenName, a.surname, a.keywords);
    if (!q) {
      return { ok: false, reason: "no_attributes", errors: ["givenName and/or surname required"] };
    }
    // Do not invent facet or date parameters for these archives — an
    // unrecognized parameter is silently ignored or errors the page.
    const notes = unusedAttributeNotes(a, new Set(["givenName", "surname", "keywords"]), site);
    return { ok: true, url: appendToBaseUrl(baseUrl, { q }), notes };
  }

  const params = siteWideParams(site, a);
  const hasAnyParam = Object.values(params).some((v) => v !== undefined);
  if (!hasAnyParam) {
    return {
      ok: false,
      reason: "no_attributes",
      errors: [`no attributes supplied for ${site} produced any parameter`],
    };
  }

  const notes = unusedAttributeNotes(a, RECOGNIZED_KEYS[site], site);
  if (site === "findmypast" && a.birthYear === undefined && a.eventYear === undefined) {
    notes.push("no yearofbirth or eventyear supplied — search is unscoped by year");
  }

  const combinedParams = { ...(SITE_FIXED_PARAMS[site] ?? {}), ...params };
  const url = appendToBaseUrl(baseUrl ?? SITE_BASE_URL[site], combinedParams);

  return { ok: true, url, notes };
}

// A supplied attribute that the target site's mapping never reads vanishes
// from the URL with no signal — the caller may believe a death event scoped
// a chronicling_america search that actually ran whole-corpus and undated.
function unusedAttributeNotes(
  a: BuildExternalSearchUrlAttributes,
  recognized: Set<keyof BuildExternalSearchUrlAttributes>,
  site: ExternalSearchSite,
): string[] {
  const supplied = (Object.keys(a) as Array<keyof BuildExternalSearchUrlAttributes>).filter((k) => {
    const v = a[k];
    return typeof v === "string" ? v.length > 0 : v !== undefined;
  });
  const unused = supplied.filter((k) => !recognized.has(k));
  return unused.map((k) => `'${k}' is not used by ${site} — supplied but ignored`);
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const buildExternalSearchUrlSchema = {
  name: "build_external_search_url",
  description:
    "Build a pre-filled search URL for one of seven supported external genealogy " +
    "sites (ancestry, myheritage, findmypast, findagrave, newspapers, " +
    "chronicling_america, digital_newspaper_archive) from structured search " +
    "attributes. Pass `baseUrl` (a FamilySearch-curated collection link) to append " +
    "parameters onto it instead of building a fresh site-wide search — required " +
    "for digital_newspaper_archive, which has no fixed site-wide URL. You decide " +
    "which record type/event the search targets and how to resolve any " +
    "conflicts[] entry on a disputed field; the tool only templates the URL. " +
    "It writes nothing and makes no network call.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site: {
        type: "string",
        enum: SUPPORTED_SITES,
        description: "Which site to build a search URL for.",
      },
      baseUrl: {
        type: "string",
        description:
          "A FamilySearch-curated collection URL to append parameters onto, instead of " +
          "a fresh site-wide search. Required for digital_newspaper_archive.",
      },
      attributes: {
        type: "object",
        description: "Search attributes, filled from whatever is known and relevant to this search.",
        properties: {
          givenName: { type: "string" },
          surname: { type: "string" },
          birthYear: { type: "number" },
          birthPlace: { type: "string" },
          deathYear: { type: "number" },
          deathPlace: { type: "string" },
          marriageYear: { type: "number" },
          marriagePlace: { type: "string" },
          residenceYear: { type: "number" },
          residencePlace: { type: "string" },
          fatherGivenName: { type: "string" },
          fatherSurname: { type: "string" },
          motherGivenName: { type: "string" },
          motherSurname: { type: "string" },
          spouseGivenName: { type: "string" },
          spouseSurname: { type: "string" },
          birthYearOffset: {
            type: "number",
            description: "FindMyPast only: the give-or-take on the birth year (site default 2).",
          },
          placeProximityMiles: {
            type: "number",
            description: "FindMyPast only: the place radius in miles (site default 5).",
          },
          eventYear: {
            type: "number",
            description:
              "FindMyPast only: the event year when the search targets an event other than birth (e.g. a marriage or death search).",
          },
          keywords: {
            type: "string",
            description:
              "Additional free-text search terms (a record type like 'obituary', a nickname, or an " +
              "exact phrase in your own quote marks) appended alongside the name. Only used by sites " +
              "with a single free-text query field: newspapers, chronicling_america, digital_newspaper_archive.",
          },
          searchYear: {
            type: "string",
            description:
              "Newspapers.com only: the year to search around, or a hyphenated range (e.g. '1880-1905') " +
              "when the event's year isn't known exactly — whichever event the search targets.",
          },
          searchPlace: {
            type: "string",
            description: "Newspapers.com only: the place to search around — whichever event the search targets.",
          },
          searchStartYear: {
            type: "number",
            description: "Chronicling America only: the start of the date window.",
          },
          searchEndYear: {
            type: "number",
            description: "Chronicling America only: the end of the date window.",
          },
          usState: {
            type: "string",
            description: "Chronicling America only: the US state to scope the search to.",
          },
        },
      },
    },
    required: ["site", "attributes"],
  },
};
