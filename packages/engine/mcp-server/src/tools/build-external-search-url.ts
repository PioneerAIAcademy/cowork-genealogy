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

const SUPPORTED_SITES: ExternalSearchSite[] = [
  "ancestry",
  "myheritage",
  "findmypast",
  "findagrave",
  "newspapers",
  "chronicling_america",
  "digital_newspaper_archive",
];

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
  // Newspapers.com's generic date/place slots (no single named event fits).
  searchYear?: number;
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

function joinUnderscore(...parts: Array<string | undefined>): string | undefined {
  const present = parts.filter((p): p is string => !!p && p.length > 0);
  return present.length > 0 ? present.join("_") : undefined;
}

function joinPlus(...parts: Array<string | undefined>): string | undefined {
  const present = parts.filter((p): p is string => !!p && p.length > 0);
  return present.length > 0 ? present.join("+") : undefined;
}

function num(n: number | undefined): string | undefined {
  return n === undefined ? undefined : String(n);
}

// Each site's table below is a straight port of its SKILL.md template
// (search-external-sites/SKILL.md:277-337) — see the spec's §4 for the
// per-site rationale (why keywordsplace defaults to birthPlace, why
// Ancestry's death/marriage fields are ported despite not appearing in its
// illustrative example URL, etc).
function siteWideParams(
  site: Exclude<ExternalSearchSite, "digital_newspaper_archive">,
  a: BuildExternalSearchUrlAttributes,
): Record<string, string | undefined> {
  switch (site) {
    case "ancestry":
      return {
        name: joinUnderscore(a.givenName, a.surname),
        birth: num(a.birthYear),
        birthplace: a.birthPlace,
        death: num(a.deathYear),
        deathplace: a.deathPlace,
        marriage: num(a.marriageYear),
        residence: joinUnderscore(num(a.residenceYear), a.residencePlace),
        father: joinUnderscore(a.fatherGivenName, a.fatherSurname),
        mother: joinUnderscore(a.motherGivenName, a.motherSurname),
        spouse: joinUnderscore(a.spouseGivenName, a.spouseSurname),
      };
    case "myheritage":
      return {
        first: a.givenName,
        last: a.surname,
        birth_year: num(a.birthYear),
        birth_place: a.birthPlace,
        marriage_year: num(a.marriageYear),
        marriage_place: a.marriagePlace,
        death_year: num(a.deathYear),
        death_place: a.deathPlace,
        father_first: a.fatherGivenName,
        father_last: a.fatherSurname,
        mother_first: a.motherGivenName,
        mother_last: a.motherSurname,
      };
    case "findmypast":
      return {
        firstname: a.givenName,
        lastname: a.surname,
        yearofbirth: num(a.birthYear),
        yearofbirth_offset: num(a.birthYearOffset),
        keywordsplace: a.birthPlace,
        keywordsplace_proximity: num(a.placeProximityMiles),
        eventyear: num(a.eventYear),
        fatherfirstname: a.fatherGivenName,
        motherfirstname: a.motherGivenName,
      };
    case "findagrave":
      return {
        firstname: a.givenName,
        lastname: a.surname,
        birthyear: num(a.birthYear),
        deathyear: num(a.deathYear),
        location: a.deathPlace ?? a.birthPlace,
      };
    case "newspapers":
      return {
        query: joinPlus(a.givenName, a.surname),
        dr_year: num(a.searchYear),
        dr_place: a.searchPlace,
      };
    case "chronicling_america":
      return {
        qs: joinPlus(a.givenName, a.surname),
        // Correction: the shipped start_date/end_date pair is dead on the
        // live site; dates=YYYY/YYYY is the working replacement.
        dates: a.searchStartYear !== undefined && a.searchEndYear !== undefined
          ? `${a.searchStartYear}/${a.searchEndYear}`
          : undefined,
        location_state: a.usState?.toLowerCase(),
      };
  }
}

const SITE_BASE_URL: Record<Exclude<ExternalSearchSite, "digital_newspaper_archive">, string> = {
  ancestry: "https://www.ancestry.com/search/",
  myheritage: "https://www.myheritage.com/research",
  findmypast: "https://www.findmypast.com/search/results",
  findagrave: "https://www.findagrave.com/memorial/search",
  newspapers: "https://www.newspapers.com/search/",
  chronicling_america: "https://www.loc.gov/collections/chronicling-america/",
};

const SITE_FIXED_PARAMS: Partial<Record<Exclude<ExternalSearchSite, "digital_newspaper_archive">, Record<string, string>>> = {
  myheritage: { action: "query" },
  // Required — without it the search returns newspaper titles from the U.S.
  // Newspaper Directory, not digitised pages (SKILL.md:316-318).
  chronicling_america: { dl: "page" },
};

function toQueryString(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

function appendToBaseUrl(baseUrl: string, params: Record<string, string | undefined>): string {
  const [path, existingQuery] = baseUrl.split("?", 2);
  const existingParams = new URLSearchParams(existingQuery ?? "");
  // The one documented stray parameter that must never survive into a
  // presented URL: browser session state, not a search parameter
  // (SKILL.md:300).
  existingParams.delete("sid");
  const appended = toQueryString(params);
  const preserved = existingParams.toString();
  const combined = [preserved, appended].filter((s) => s.length > 0).join("&");
  return combined.length > 0 ? `${path}?${combined}` : path;
}

export function buildExternalSearchUrl(input: BuildExternalSearchUrlInput): BuildExternalSearchUrlResult {
  const { site, baseUrl, attributes } = input ?? ({} as BuildExternalSearchUrlInput);
  const a = attributes ?? {};

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
    const q = joinPlus(a.givenName, a.surname);
    if (!q) {
      return { ok: false, reason: "no_attributes", errors: ["givenName and/or surname required"] };
    }
    // Do not invent facet or date parameters for these archives — an
    // unrecognized parameter is silently ignored or errors the page
    // (SKILL.md:339-342).
    return { ok: true, url: appendToBaseUrl(baseUrl, { q }), notes: [] };
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

  const notes: string[] = [];
  if (site === "findmypast" && a.birthYear === undefined && a.eventYear === undefined) {
    notes.push("no yearofbirth or eventyear supplied — search is unscoped by year");
  }

  const url = baseUrl
    ? appendToBaseUrl(baseUrl, params)
    : appendToBaseUrl(
        `${SITE_BASE_URL[site]}`,
        { ...(SITE_FIXED_PARAMS[site] ?? {}), ...params },
      );

  return { ok: true, url, notes };
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
          searchYear: {
            type: "number",
            description: "Newspapers.com only: the year to search around — whichever event the search targets.",
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
