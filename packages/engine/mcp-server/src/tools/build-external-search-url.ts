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
  | "digital_newspaper_archive"
  | "archives_gov"
  | "archive_org"
  | "billiongraves"
  | "digitalarkivet"
  | "antenati"
  | "library_archives_canada"
  | "american_ancestors"
  | "italian_genealogy";

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
  // Locale variant of a site with more than one country-specific domain — only
  // "ancestry" and "findmypast" have one today (ancestry.co.uk,
  // findmypast.co.uk). Ignored (with a note) for a site with no locale
  // variant, and ignored silently when `baseUrl` is supplied — a curated link
  // already names its own host.
  locale?: "us" | "uk";
  attributes: BuildExternalSearchUrlAttributes;
}

// The one access fact a researcher is most likely to be misinformed about —
// sourced from the tool, not left to the model's memory of a prose table it
// can misremember or misapply to a site the table never named (the FindAGrave
// "it said this was paywalled" alpha-feedback finding: FindAGrave is free,
// and the model said otherwise anyway).
export type AccessClassification = "free" | "free_bot_protected" | "subscription";

export type BuildExternalSearchUrlResult =
  | { ok: true; url: string; notes: string[]; access: AccessClassification }
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
      // No place parameter. `location` was removed after live verification
      // (issue #1980 review): the visible `location` field is a free-text
      // autocomplete box whose real filter keys off a hidden `locationId` the
      // client resolves from a dropdown, not the text itself — four different
      // `location=` values (absent, a real place, a nonsense string, and the
      // exact address copied from a matching result) all returned byte-
      // identical result sets. Emitting it was indistinguishable from a
      // silently-ignored parameter, which is the exact defect class this tool
      // exists to eliminate.
      return {
        firstname: str(a.givenName),
        lastname: str(a.surname),
        birthyear: num(a.birthYear),
        deathyear: num(a.deathYear),
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
    case "archives_gov":
      // `personOrOrg` (paired with the fixed `dataSource=authority` params
      // below) is the National Archives Catalog's dedicated person-name
      // field; `q` is free text only (a record type like "obituary"), not the
      // name itself. Sourced from the catalog's own live production JS field
      // registry, not a rendered results page — see the spec's live-check
      // section.
      return {
        personOrOrg: joinSpace(a.givenName, a.surname),
        q: str(a.keywords),
        geographicReference: str(a.birthPlace) ?? str(a.deathPlace),
      };
    case "archive_org":
      // Dublin-Core metadata (creator/date/subject/title), not a vital-
      // records schema — no structured birth/death fields exist. `query` is
      // the one real parameter (confirmed via the legacy search.php redirect
      // target); a name is only a free-text term here, same as this site's
      // own lack of a name field.
      return {
        query: joinSpace(a.givenName, a.surname, a.keywords),
      };
    case "billiongraves":
      return {
        GivenNames: str(a.givenName),
        FamilyName: str(a.surname),
        EventBirthYear: num(a.birthYear),
        EventDeathYear: num(a.deathYear),
      };
    case "digitalarkivet":
      // `birth_year_from`/`birth_year_to` is a range field; a single known
      // birth year is passed as both ends. `domicile` is the site's own name
      // for a residence/domicile place, not birth or death place.
      return {
        firstname: str(a.givenName),
        lastname: str(a.surname),
        birth_year_from: num(a.birthYear),
        birth_year_to: num(a.birthYear),
        birth_place: str(a.birthPlace),
        domicile: str(a.residencePlace),
      };
    case "antenati":
      // One year field for "whichever act matched" (birth, marriage or
      // death), not separate birth/death fields — the site indexes civil/
      // parish acts, not persons. birthYear is preferred when both are
      // known; there is no verified way to also select which act TYPE the
      // year should scope to.
      return {
        nome: str(a.givenName),
        cognome: str(a.surname),
        anno: num(a.birthYear) ?? num(a.deathYear),
        localita: str(a.birthPlace) ?? str(a.deathPlace),
      };
    case "library_archives_canada":
      // Deliberately omits ProvinceCode/GenderCode/MaritalStatusCode: those
      // are coded `<select>` values (e.g. `1`/`2`/`8` for gender) this tool
      // has no verified mapping for, and a free-text place string would not
      // bind to a coded select the way it binds to the free-text fields
      // below — passing one anyway would be exactly the silent-mismatch risk
      // this tool exists to avoid. The two fixed params are required by the
      // site's own search-form JS to select the census/genealogy dataset.
      return {
        FirstName: str(a.givenName),
        LastName: str(a.surname),
        YearOfBirth: num(a.birthYear),
      };
    case "american_ancestors":
      // `Name.First`/`Name.Last` do not bind on this site — confirmed by
      // round-tripping a GET request and checking the form's own `value=`
      // reflection, which came back blank for every name-field encoding
      // tried. `Keywords` is the one free-text field that does bind, so the
      // name travels through it instead, the same shape as the keyword-only
      // sites above. A single known year is passed as both ends of the
      // (verified-binding) `FromYear`/`ToYear` range.
      return {
        Keywords: joinSpace(a.givenName, a.surname, a.keywords),
        Location: str(a.birthPlace) ?? str(a.deathPlace),
        FromYear: num(a.birthYear),
        ToYear: num(a.birthYear),
      };
    case "italian_genealogy":
      // A phpBB forum, not a records database — confirmed by a live search
      // returning real matching posts. `keywords` is the only field; there
      // is no structured name/date/place search anywhere on this site.
      return {
        keywords: joinSpace(a.givenName, a.surname, a.keywords),
      };
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
  findagrave: new Set(["givenName", "surname", "birthYear", "deathYear"]),
  newspapers: new Set(["givenName", "surname", "keywords", "searchYear", "searchPlace"]),
  chronicling_america: new Set(["givenName", "surname", "keywords", "searchStartYear", "searchEndYear", "usState"]),
  archives_gov: new Set(["givenName", "surname", "keywords", "birthPlace", "deathPlace"]),
  archive_org: new Set(["givenName", "surname", "keywords"]),
  billiongraves: new Set(["givenName", "surname", "birthYear", "deathYear"]),
  digitalarkivet: new Set(["givenName", "surname", "birthYear", "birthPlace", "residencePlace"]),
  antenati: new Set(["givenName", "surname", "birthYear", "deathYear", "birthPlace", "deathPlace"]),
  library_archives_canada: new Set(["givenName", "surname", "birthYear"]),
  american_ancestors: new Set(["givenName", "surname", "keywords", "birthPlace", "deathPlace", "birthYear"]),
  italian_genealogy: new Set(["givenName", "surname", "keywords"]),
};

const SITE_BASE_URL: Record<Exclude<ExternalSearchSite, "digital_newspaper_archive">, string> = {
  ancestry: "https://www.ancestry.com/search/",
  myheritage: "https://www.myheritage.com/research",
  findmypast: "https://www.findmypast.com/search/results",
  findagrave: "https://www.findagrave.com/memorial/search",
  newspapers: "https://www.newspapers.com/search/",
  chronicling_america: "https://www.loc.gov/collections/chronicling-america/",
  archives_gov: "https://catalog.archives.gov/search",
  archive_org: "https://archive.org/search",
  billiongraves: "https://billiongraves.com/search/results",
  digitalarkivet: "https://www.digitalarkivet.no/en/search/persons/advanced",
  antenati: "https://antenati.cultura.gov.it/search-nominative/",
  library_archives_canada: "https://recherche-collection-search.bac-lac.gc.ca/eng/Home/Result",
  american_ancestors: "https://app.americanancestors.org/SearchResults/AdvancedSearch",
  italian_genealogy: "https://www.italiangenealogy.com/forum/search",
};

// A closed `Record` over the full `ExternalSearchSite` union (not filtered
// like `SITE_BASE_URL`) — deliberately exhaustive so a new site added to the
// union without a matching entry here is a compile error, not a silent gap.
// There is no crash-safety reason to loosen this the way `SUPPORTED_SITES`
// is loosened: an incomplete `SITE_ACCESS` cannot be reached at runtime for
// an unimplemented site, since `siteWideParams` and `SITE_BASE_URL` gate
// that already.
const SITE_ACCESS: Record<ExternalSearchSite, AccessClassification> = {
  ancestry: "subscription",
  myheritage: "subscription",
  findmypast: "subscription",
  findagrave: "free",
  newspapers: "subscription",
  chronicling_america: "free_bot_protected",
  digital_newspaper_archive: "free_bot_protected",
  archives_gov: "free",
  archive_org: "free",
  billiongraves: "free",
  digitalarkivet: "free",
  antenati: "free",
  library_archives_canada: "free",
  // The search itself is free; a subscription may still gate viewing full
  // results, which "free" alone doesn't say — see the permanent note pushed
  // for this site in `buildExternalSearchUrl` below.
  american_ancestors: "free",
  italian_genealogy: "free",
};

// US/UK locale variants of a site sharing one parameter table — the issue's
// own instruction is to handle these as a host argument on the existing
// entry, not a duplicate table, since ancestry.co.uk and findmypast.co.uk
// were confirmed (live fetch; and for findmypast.co.uk, Google-indexed real
// production URLs, since Cloudflare blocks a direct fetch of either
// findmypast domain equally) to use the identical path and parameter names
// as their .com counterparts.
const UK_BASE_URL: Partial<Record<Exclude<ExternalSearchSite, "digital_newspaper_archive">, string>> = {
  ancestry: "https://www.ancestry.co.uk/search/",
  findmypast: "https://www.findmypast.co.uk/search/results",
};

// The sites this tool can actually build a URL for — every key `SITE_BASE_URL`
// declares (a `Record` with exactly those keys, so `Object.keys` can never
// diverge from `siteWideParams`'s own switch) plus `digital_newspaper_archive`,
// which is handled separately. Deliberately NOT derived from the shared
// `external_site` enum: a site advertised as valid before its
// `siteWideParams` case exists crashes on `Object.values` of the switch's
// implicit `undefined` return — reproduced by appending a site to the enum
// with no matching implementation here. `tsc` sees no error, because
// `isSupportedSite`'s type predicate is an unchecked runtime assertion the
// compiler cannot verify against the switch's actual cases. A spread off
// `Object.keys(...)` is an identifier expression, not a string literal array,
// so `tool-schema-enums.test.ts`'s literal-array scan does not treat this as
// a hand-typed copy of `external_site` — nothing here needs the
// VALIDATOR_ENUMS import that an enum-derived version would require.
//
// Six sites named in the launch-scope table are deliberately NOT here, each
// for a reason live research could not resolve, so none gets an invented
// template: `byu.edu` and `nyu.edu` (no verifiable structured search endpoint
// could be found behind either domain), `usgwarchives.net` (unreachable from
// every network vantage point tried), `uscis.gov` (its one live endpoint is
// a paid request/order form with no searchable results page, not a query
// interface), `italianparishrecords.org` (a pure browse-by-region directory
// with no search of any kind at any level), and `genealogycenter.info` (its
// two top-level search forms are POST-only and silently ignore a GET query
// string — a real surname, no surname, and a nonsense surname all returned
// byte-identical results; the site is otherwise a loose federation of dozens
// of independently-shaped sub-databases with no confirmed common parameter
// naming).
const SUPPORTED_SITES: ExternalSearchSite[] = [
  ...(Object.keys(SITE_BASE_URL) as Array<Exclude<ExternalSearchSite, "digital_newspaper_archive">>),
  "digital_newspaper_archive",
];

const SITE_FIXED_PARAMS: Partial<Record<Exclude<ExternalSearchSite, "digital_newspaper_archive">, Record<string, string>>> = {
  myheritage: { action: "query" },
  // Required — without it the search returns newspaper titles from the U.S.
  // Newspaper Directory, not digitised pages.
  chronicling_america: { dl: "page" },
  // Scopes the catalog to person/org name-authority records, matching the
  // `personOrOrg` field above — without it the same field is read by the
  // archival-description search instead.
  archives_gov: { dataSource: "authority", availableOnline: "false" },
  // Required by the search-form's own client JS to select the census/
  // genealogy dataset before redirecting to the results endpoint.
  library_archives_canada: { DataSource: "Genealogy|Census", ST: "SCTB" },
  // The exact three fields present on the one confirmed-working search URL
  // (858 real matches) — omitting them was not tested and is not assumed safe.
  italian_genealogy: { terms: "all", sf: "all", sr: "posts" },
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
  const { site, baseUrl: rawBaseUrl, locale, attributes } = input ?? ({} as BuildExternalSearchUrlInput);
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
    return { ok: true, url: appendToBaseUrl(baseUrl, { q }), notes, access: SITE_ACCESS[site] };
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
  if (site === "american_ancestors") {
    notes.push("search is free; a subscription may still be required to view full results");
  }

  // A curated `baseUrl` already names its own host, so `locale` only applies
  // to the site-wide fallback. A `locale: "uk"` for a site with no UK
  // variant is noted, not silently ignored — the caller asked for something
  // this tool cannot do and should know its request had no effect.
  let siteWideUrl = SITE_BASE_URL[site];
  if (!baseUrl && locale === "uk") {
    const ukUrl = UK_BASE_URL[site];
    if (ukUrl) {
      siteWideUrl = ukUrl;
    } else {
      notes.push(`locale "uk" has no variant for ${site} — used the default site instead`);
    }
  }

  const combinedParams = { ...(SITE_FIXED_PARAMS[site] ?? {}), ...params };
  const url = appendToBaseUrl(baseUrl ?? siteWideUrl, combinedParams);

  return { ok: true, url, notes, access: SITE_ACCESS[site] };
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
    "Build a pre-filled search URL for one of the supported external genealogy " +
    "sites (see the `site` enum) from structured search attributes. Pass " +
    "`baseUrl` (a FamilySearch-curated collection link) to append parameters " +
    "onto it instead of building a fresh site-wide search — required for " +
    "digital_newspaper_archive, which has no fixed site-wide URL. Pass `locale: " +
    "\"uk\"` for the .co.uk variant of ancestry or findmypast (ignored, with a " +
    "note, for any other site). You decide which record type/event the search " +
    "targets and how to resolve any conflicts[] entry on a disputed field; the " +
    "tool only templates the URL. On success the response's `access` field " +
    "classifies the site as `free`, `free_bot_protected`, or `subscription` — " +
    "read it from here, not from memory, when telling the user what access " +
    "the search needs. It writes nothing and makes no network call.",
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
      locale: {
        type: "string",
        enum: ["us", "uk"],
        description:
          "Country-domain variant. \"uk\" builds against ancestry.co.uk or " +
          "findmypast.co.uk instead of the .com default; has no effect on any " +
          "other site, or when `baseUrl` is supplied.",
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
