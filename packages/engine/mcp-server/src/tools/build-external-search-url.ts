// build_external_search_url — deterministic external-site search URL templating.
//
// Migrates the site-wide `{...}` templates the `search-external-sites` skill
// filled in by hand into tested code. The LLM keeps every judgment (which
// record type/event the search targets, which curated link fits, what
// conflicts[] says about a disputed field); the tool applies only the
// string-templating. Spec: docs/specs/build-external-search-url-tool-spec.md.

import { coerceJsonArg } from "../utils/coerce-json-arg.js";
import { isFourDigitYear, isHttpUrl, isNonNegativeInteger } from "../utils/search-helpers.js";

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
  // FindMyPast-only tuning knobs; each applies only when its slot (birthYear /
  // a place) is set.
  birthYearOffset?: number;
  placeProximityMiles?: number;
  eventYear?: number;
  // Free-text terms appended alongside the name on the sites whose search is a
  // single free-text field (see the `keywords` schema description). A caller
  // wanting an exact phrase includes its own quote marks.
  keywords?: string;
  // Newspapers.com's generic date/place slots. `searchYear` is a plain year
  // ("1892") or a hyphenated range ("1880-1905") — templated, not parsed.
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
  // "ancestry" and "findmypast" have one (ancestry.co.uk, findmypast.co.uk).
  // Noted and ignored for any other site; ignored silently when `baseUrl` is
  // supplied, since a curated link already names its own host.
  locale?: "us" | "uk";
  attributes: BuildExternalSearchUrlAttributes;
}

// Sourced from the tool, not left to the model's memory of a prose table
// (spec §3.1: an alpha tester was told FindAGrave, which is free, needs a
// subscription).
export type AccessClassification = "free" | "free_bot_protected" | "subscription";

export type BuildExternalSearchUrlResult =
  | { ok: true; url: string; notes: string[]; access: AccessClassification }
  | { ok: false; reason: "unsupported_site"; errors: string[]; supportedSites: string[] }
  | { ok: false; reason: "base_url_required"; errors: string[] }
  | { ok: false; reason: "invalid_base_url"; errors: string[] }
  | { ok: false; reason: "outside_coverage"; errors: string[] }
  | { ok: false; reason: "no_attributes"; errors: string[] };

// ─── Value validators (spec §3.7) ────────────────────────────────────────────
//
// Each returns the templated string for a valid value and `undefined` for an
// absent or invalid one; `attributeNotes` below tells those two cases apart.

// Calendar years share `isFourDigitYear`'s [1000, 9999] with the FamilySearch
// search tools — one rule rather than two that drift; a year below 1000 is
// rejected with a note.
function numYear(n: unknown): string | undefined {
  return typeof n === "number" && isFourDigitYear(n) ? String(n) : undefined;
}

// FindMyPast's tuning knobs are a give-or-take count and a radius in miles —
// never years, never negative.
const SMALL_NUMBER_MAX = 1000;
function numSmall(n: unknown): string | undefined {
  return isNonNegativeInteger(n, SMALL_NUMBER_MAX) ? String(n) : undefined;
}

// `null`, `""` and whitespace-only are absent; a present value is returned
// trimmed, so padding never reaches the URL as an encoded `+`.
function str(s: unknown): string | undefined {
  if (typeof s !== "string") return undefined;
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Newspapers.com's `dr_year`: a plain year or a hyphenated range, nothing
// else — `dr_year=banana` used to ship because the field is string-typed. An
// inverted range is rejected too, for the same reason `chroniclingAmericaWindow`
// rejects one: it returns nothing, and a nil from it reads as evidence.
function yearOrRange(s: unknown): string | undefined {
  const t = str(s);
  if (t === undefined || !/^\d{4}(-\d{4})?$/.test(t)) return undefined;
  const [from, to] = t.split("-");
  return to !== undefined && Number(from) > Number(to) ? undefined : t;
}

// Joins the present parts; absent parts drop out. A `" "` separator is what
// the free-text fields want — `toQueryString` encodes it as `+` (spec §3.6).
function joinPresent(sep: string, ...parts: unknown[]): string | undefined {
  const present = parts.map(str).filter((p): p is string => p !== undefined);
  return present.length > 0 ? present.join(sep) : undefined;
}

// Ancestry's paired slots are positional (`given_surname`, `year_place`): an
// absent half keeps its underscore so the present half stays in its own slot —
// `name=_Flynn` is a surname-only search, `name=Flynn` a given-name one.
function positional(left: unknown, right: unknown): string | undefined {
  const l = str(left);
  const r = str(right);
  if (l === undefined && r === undefined) return undefined;
  return `${l ?? ""}_${r ?? ""}`;
}

// ─── Chronicling America's date window and state facet ───────────────────────

// The bare `location_state=<state>` parameter does not filter: two live
// measurements (2026-09-15) left the hit count identical with and without it
// (401,243 and 2,101), while the facet form `fa=location_state:pennsylvania`
// filtered (8,045 and 16) and is the form loc.gov's own `search.facet_limits`
// names. The facet value is the full lowercase state name — a postal
// abbreviation (`ny`) measures 0 — so one is expanded here. Multi-word names
// (`new york`) are unverified against the facet (spec §9).
// `Object.create(null)`, not a plain literal: a plain object inherits
// `constructor`, `toString` and friends, so `usState: "constructor"` looked up
// a function and shipped `location_state:function Object() { [native code] }`.
const US_STATE_NAMES: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
  co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
  hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa", ks: "kansas",
  ky: "kentucky", la: "louisiana", me: "maine", md: "maryland", ma: "massachusetts",
  mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana",
  ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey", nm: "new mexico",
  ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma",
  or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina",
  sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont",
  va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
  dc: "district of columbia",
});

const US_STATE_FULL_NAMES = new Set(Object.values(US_STATE_NAMES));

// Accepts a state name, a postal abbreviation, or a full place string — every
// place in `research.json` is comma-qualified ("Schuylkill, Pennsylvania,
// United States"), and passing one straight through shipped
// `location_state:pennsylvania%2C+united+states`, a facet that matches nothing.
//
// Segments are tried RIGHT-TO-LEFT, because a place string runs narrow to
// broad and a finer unit can share a state's name: "Indiana, Pennsylvania,
// United States" is a borough in Pennsylvania, and "Washington, District of
// Columbia" is a city in DC — left-to-right scanning scoped both to the wrong
// state, silently. A value with no recognized state in it yields no facet and
// a note, rather than a URL whose zero hits read as evidence of absence.
function usStateFacet(v: unknown): string | undefined {
  const raw = str(v);
  if (raw === undefined) return undefined;
  for (const segment of raw.split(",").reverse()) {
    const s = segment.trim().toLowerCase();
    if (s.length === 0) continue;
    const expanded = US_STATE_NAMES[s];
    if (expanded !== undefined) return expanded;
    if (US_STATE_FULL_NAMES.has(s)) return s;
  }
  return undefined;
}

// The Library of Congress page corpus; a window entirely outside it cannot
// return a page, and a URL for it would log a nil as evidence of absence.
const CHRONICLING_AMERICA_COVERAGE = { first: 1798, last: 1963 } as const;

interface YearWindow {
  start?: number;
  end?: number;
  dates?: string;
  halfWindow: boolean;
  inverted: boolean;
}

// Both ends must be valid years, and ordered, for `dates=YYYY/YYYY` to apply.
// `{ searchStartYear: null, searchEndYear: 1910 }` and `{ 1880, 99999 }` both
// look two-ended to a presence check yet template no window at all.
function chroniclingAmericaWindow(a: BuildExternalSearchUrlAttributes): YearWindow {
  const start = numYear(a.searchStartYear);
  const end = numYear(a.searchEndYear);
  const halfWindow = (start !== undefined) !== (end !== undefined);
  if (start === undefined || end === undefined) return { halfWindow, inverted: false };
  const s = Number(start);
  const e = Number(end);
  if (s > e) return { halfWindow: false, inverted: true };
  return { start: s, end: e, dates: `${start}/${end}`, halfWindow: false, inverted: false };
}

// ─── Per-site parameter tables (spec §4) ─────────────────────────────────────

// Each case is a straight port of the site-wide template it replaces. Every
// attribute a case uses is read unconditionally into a local first:
// RECOGNIZED_KEYS below is derived by running these cases against a recording
// proxy, so a read hidden behind a short-circuit would drop that attribute
// from the site's recognized set.
function siteWideParams(
  site: ExternalSearchSite,
  a: BuildExternalSearchUrlAttributes,
): Record<string, string | undefined> {
  switch (site) {
    case "ancestry":
      return {
        name: positional(a.givenName, a.surname),
        birth: numYear(a.birthYear),
        birthplace: str(a.birthPlace),
        death: numYear(a.deathYear),
        deathplace: str(a.deathPlace),
        marriage: numYear(a.marriageYear),
        residence: positional(numYear(a.residenceYear), a.residencePlace),
        father: positional(a.fatherGivenName, a.fatherSurname),
        mother: positional(a.motherGivenName, a.motherSurname),
        spouse: positional(a.spouseGivenName, a.spouseSurname),
      };
    case "myheritage":
      return {
        first: str(a.givenName),
        last: str(a.surname),
        birth_year: numYear(a.birthYear),
        birth_place: str(a.birthPlace),
        marriage_year: numYear(a.marriageYear),
        marriage_place: str(a.marriagePlace),
        death_year: numYear(a.deathYear),
        death_place: str(a.deathPlace),
        father_first: str(a.fatherGivenName),
        father_last: str(a.fatherSurname),
        mother_first: str(a.motherGivenName),
        mother_last: str(a.motherSurname),
      };
    case "findmypast": {
      const yearOfBirth = numYear(a.birthYear);
      const offset = numSmall(a.birthYearOffset);
      // `keywordsplace` is the site's one generic place field: birth first,
      // then whichever event place the search carries, so a marriage or death
      // search scoped by `eventYear` can still name its place.
      const birthPlace = str(a.birthPlace);
      const marriagePlace = str(a.marriagePlace);
      const deathPlace = str(a.deathPlace);
      const residencePlace = str(a.residencePlace);
      const place = birthPlace ?? marriagePlace ?? deathPlace ?? residencePlace;
      const proximity = numSmall(a.placeProximityMiles);
      return {
        firstname: str(a.givenName),
        lastname: str(a.surname),
        yearofbirth: yearOfBirth,
        // A knob without its slot does nothing on the site and must not count
        // as a search term.
        yearofbirth_offset: yearOfBirth !== undefined ? offset : undefined,
        keywordsplace: place,
        keywordsplace_proximity: place !== undefined ? proximity : undefined,
        eventyear: numYear(a.eventYear),
        fatherfirstname: str(a.fatherGivenName),
        motherfirstname: str(a.motherGivenName),
      };
    }
    case "findagrave":
      // No place parameter: the visible `location` box keys off a hidden
      // `locationId` the client resolves from a dropdown, not the text —
      // four different `location=` values returned byte-identical results.
      return {
        firstname: str(a.givenName),
        lastname: str(a.surname),
        birthyear: numYear(a.birthYear),
        deathyear: numYear(a.deathYear),
      };
    case "newspapers":
      return {
        query: joinPresent(" ", a.givenName, a.surname, a.keywords),
        dr_year: yearOrRange(a.searchYear),
        dr_place: str(a.searchPlace),
      };
    case "chronicling_america": {
      const window = chroniclingAmericaWindow(a);
      const state = usStateFacet(a.usState);
      return {
        // `q` filters; `qs` is dead on the live site (a nonsense value returns
        // the whole corpus). `dates=YYYY/YYYY` replaced the dead
        // start_date/end_date pair, and `fa=location_state:<name>` the dead
        // bare `location_state=` parameter. Spec §9 has each measurement.
        q: joinPresent(" ", a.givenName, a.surname, a.keywords),
        dates: window.dates,
        fa: state !== undefined ? `location_state:${state}` : undefined,
      };
    }
    case "digital_newspaper_archive":
      // No fixed URL (SITE_BASE_URL is null, so `baseUrl` is required). Only
      // `q` is appended: an invented facet or date parameter is silently
      // ignored or errors the page on these archives.
      return { q: joinPresent(" ", a.givenName, a.surname, a.keywords) };
    case "archives_gov": {
      // `personOrOrg` (with the fixed `dataSource=authority`) is the catalog's
      // person-name field; `q` is free text only. From the catalog's own live
      // JS field registry (spec live-check section).
      const birthPlace = str(a.birthPlace);
      const deathPlace = str(a.deathPlace);
      return {
        personOrOrg: joinPresent(" ", a.givenName, a.surname),
        q: str(a.keywords),
        geographicReference: birthPlace ?? deathPlace,
      };
    }
    case "archive_org":
      // Dublin-Core metadata, no vital-records fields; `query` is the one
      // real parameter and a name is only a free-text term here.
      return {
        query: joinPresent(" ", a.givenName, a.surname, a.keywords),
      };
    case "billiongraves":
      return {
        GivenNames: str(a.givenName),
        FamilyName: str(a.surname),
        EventBirthYear: numYear(a.birthYear),
        EventDeathYear: numYear(a.deathYear),
      };
    case "digitalarkivet":
      // A single known birth year is passed as both ends of the range field;
      // `domicile` is the site's own name for a residence place.
      return {
        firstname: str(a.givenName),
        lastname: str(a.surname),
        birth_year_from: numYear(a.birthYear),
        birth_year_to: numYear(a.birthYear),
        birth_place: str(a.birthPlace),
        domicile: str(a.residencePlace),
      };
    case "antenati": {
      // One year and one place field for whichever act matched (the site
      // indexes acts, not persons); birth is preferred when both are known.
      const birthYear = numYear(a.birthYear);
      const deathYear = numYear(a.deathYear);
      const birthPlace = str(a.birthPlace);
      const deathPlace = str(a.deathPlace);
      return {
        nome: str(a.givenName),
        cognome: str(a.surname),
        anno: birthYear ?? deathYear,
        localita: birthPlace ?? deathPlace,
      };
    }
    case "library_archives_canada":
      // ProvinceCode/GenderCode/MaritalStatusCode are coded <select> values
      // this tool has no verified mapping for, so they are deliberately not
      // templated; the two fixed params select the census/genealogy dataset.
      return {
        FirstName: str(a.givenName),
        LastName: str(a.surname),
        YearOfBirth: numYear(a.birthYear),
      };
    case "american_ancestors": {
      // `Name.First`/`Name.Last` do not bind on this site (confirmed by GET
      // round-trip); `Keywords` is the one free-text field that does, so the
      // name travels through it. A single year is both ends of the range.
      const birthPlace = str(a.birthPlace);
      const deathPlace = str(a.deathPlace);
      return {
        Keywords: joinPresent(" ", a.givenName, a.surname, a.keywords),
        Location: birthPlace ?? deathPlace,
        FromYear: numYear(a.birthYear),
        ToYear: numYear(a.birthYear),
      };
    }
    case "italian_genealogy":
      // A phpBB forum: `keywords` is the only field.
      return {
        keywords: joinPresent(" ", a.givenName, a.surname, a.keywords),
      };
  }
}

// `null`: no fixed site-wide URL — the caller's `baseUrl` names the specific
// archive (spec §3.3). `digital_newspaper_archive` is last so the advertised
// enum order is stable.
const SITE_BASE_URL: Record<ExternalSearchSite, string | null> = {
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
  digital_newspaper_archive: null,
};

// The sites this tool can build a URL for — exactly `SITE_BASE_URL`'s keys,
// which a closed `Record` ties to the union and therefore to
// `siteWideParams`'s switch. Deliberately NOT derived from the shared
// `external_site` enum: that enum also carries a value this tool has no
// template for (`familysearch_web`), and advertising a site with no case
// crashed on first use. Six sites named in the launch scope have no template
// for the live-checked reasons in spec §3.10.
const SUPPORTED_SITES: ExternalSearchSite[] = Object.keys(SITE_BASE_URL) as ExternalSearchSite[];

function isSupportedSite(site: string): site is ExternalSearchSite {
  return (SUPPORTED_SITES as string[]).includes(site);
}

// Which attributes each site's case reads, recorded by running the case
// against a proxy that logs every property access — so this cannot drift from
// `siteWideParams`. A supplied attribute outside its site's set is flagged
// in `notes` rather than vanishing silently.
function recordedKeys(site: ExternalSearchSite): ReadonlySet<keyof BuildExternalSearchUrlAttributes> {
  const read = new Set<keyof BuildExternalSearchUrlAttributes>();
  const recorder = new Proxy({} as BuildExternalSearchUrlAttributes, {
    get(_target, key) {
      if (typeof key === "string") read.add(key as keyof BuildExternalSearchUrlAttributes);
      return undefined;
    },
  });
  siteWideParams(site, recorder);
  return read;
}

const RECOGNIZED_KEYS = SUPPORTED_SITES.reduce(
  (acc, site) => {
    acc[site] = recordedKeys(site);
    return acc;
  },
  {} as Record<ExternalSearchSite, ReadonlySet<keyof BuildExternalSearchUrlAttributes>>,
);

// Exhaustive over the union (a new site with no entry is a compile error);
// unreachable at runtime for an unimplemented site because `SITE_BASE_URL`
// gates that first.
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
  // The search is free; viewing full results may need a subscription — the
  // permanent note in SITE_NOTES carries what the 3-value enum cannot.
  american_ancestors: "free",
  italian_genealogy: "free",
};

// US/UK variants share one parameter table (spec §3.9) — confirmed to use the
// identical path and parameter names as the .com sites.
const UK_BASE_URL: Partial<Record<ExternalSearchSite, string>> = {
  ancestry: "https://www.ancestry.co.uk/search/",
  findmypast: "https://www.findmypast.co.uk/search/results",
};

// Applied on every call, with or without `baseUrl` (spec §3.4).
const SITE_FIXED_PARAMS: Partial<Record<ExternalSearchSite, Record<string, string>>> = {
  myheritage: { action: "query" },
  // Without it the search returns newspaper titles, not digitised pages.
  chronicling_america: { dl: "page" },
  // Scopes the catalog to person/org name-authority records, matching
  // `personOrOrg`.
  archives_gov: { dataSource: "authority", availableOnline: "false" },
  // Required by the search form's own client JS to select the dataset.
  library_archives_canada: { DataSource: "Genealogy|Census", ST: "SCTB" },
  // The exact fields on the one confirmed-working search URL.
  italian_genealogy: { terms: "all", sf: "all", sr: "posts" },
};

const USER_CONTRIBUTED_NOTE =
  "entries are user-contributed — a lead, not proof; photographed evidence outweighs " +
  "contributor-entered text once a capture comes back";

// A note every call for the site carries (spec §3.1): a fact the caller must
// relay that the URL itself cannot express, kept here rather than as a
// per-site list in SKILL.md prose the model has to remember to apply.
const SITE_NOTES: Partial<Record<ExternalSearchSite, string>> = {
  american_ancestors: "search is free; a subscription may still be required to view full results",
  findagrave: USER_CONTRIBUTED_NOTE,
  billiongraves: USER_CONTRIBUTED_NOTE,
  chronicling_america:
    `digitised page coverage runs ${CHRONICLING_AMERICA_COVERAGE.first}–${CHRONICLING_AMERICA_COVERAGE.last}, ` +
    "title-by-title and complete for no state — a nil result never means no newspaper covered the event",
  digital_newspaper_archive:
    "this archive's URL carries no date filter — tell the user which date range to set in the site's own UI",
};

// ─── baseUrl host agreement (spec §3.2) ──────────────────────────────────────

// A curated `baseUrl` must belong to the requested site: a MyHeritage link
// with `site: "ancestry"` would carry Ancestry's parameter names to a host
// that ignores them. Compared on the site host's registrable domain, so a
// sibling subdomain (`app.americanancestors.org` ~ `www.americanancestors.org`)
// and the UK variant pass while a bare registry suffix (`gc.ca` for
// `recherche-collection-search.bac-lac.gc.ca`) does not.
function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

// Two-label public suffixes that occur among the supported hosts; every other
// host is treated as <name>.<tld>.
const TWO_LABEL_SUFFIXES = new Set(["co.uk", "gc.ca", "gov.it"]);

function registrableDomain(host: string): string {
  const labels = host.split(".");
  const keep = TWO_LABEL_SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

function inDomainOf(host: string, siteHost: string): boolean {
  const reg = registrableDomain(siteHost);
  return host === reg || host.endsWith(`.${reg}`);
}

// The site, if any, whose own domain a host belongs to.
function siteOwningHost(host: string): ExternalSearchSite | undefined {
  for (const site of SUPPORTED_SITES) {
    for (const u of [SITE_BASE_URL[site], UK_BASE_URL[site]]) {
      if (u !== null && u !== undefined && inDomainOf(host, hostOf(u))) return site;
    }
  }
  return undefined;
}

// Hosts a site has retired: the page still loads, but the parameters this
// tool appends are ignored and the search runs unscoped.
const RETIRED_HOSTS: Partial<Record<ExternalSearchSite, string[]>> = {
  chronicling_america: ["chroniclingamerica.loc.gov"],
};

function baseUrlHostError(site: ExternalSearchSite, baseUrl: string): string | undefined {
  const siteUrl = SITE_BASE_URL[site];
  const host = hostOf(baseUrl);
  if (siteUrl === null) {
    // No fixed host of its own — but a supported site's own domain passed
    // here would carry that site's `access` wrongly (newspapers.com is a
    // subscription site; this class is `free_bot_protected`) and persist the
    // wrong `site` into the log. Route it to its own table instead.
    const owner = siteOwningHost(host);
    if (owner !== undefined) {
      return (
        `baseUrl host "${host}" is ${owner}'s own domain — pass site: "${owner}" so its parameter ` +
        `table and access classification apply`
      );
    }
    return undefined;
  }
  if (RETIRED_HOSTS[site]?.includes(host.replace(/^www\./, ""))) {
    return (
      `baseUrl host "${host}" is retired for ${site} — its parameters are ignored and the ` +
      `search runs unscoped; use ${siteUrl}`
    );
  }
  const allowed = [siteUrl, UK_BASE_URL[site]].filter((u): u is string => u !== undefined).map(hostOf);
  if (!allowed.some((h) => inDomainOf(host, h))) {
    return `baseUrl host "${host}" does not belong to ${site} (expected ${allowed.map(registrableDomain).join(" or ")})`;
  }
  return undefined;
}

// ─── Encoding and append (spec §3.2, §3.6) ───────────────────────────────────

// application/x-www-form-urlencoded: a space becomes `+`, everything else is
// percent-encoded. `encodeURIComponent` alone would turn a literal `+` into
// `%2B`, which is why joins use a real space rather than inserting `+`.
// `:` stays literal — RFC 3986 permits it in a query, and loc.gov's facet form
// (`fa=location_state:pennsylvania`) was measured in exactly that shape.
function encodeFormValue(v: string): string {
  return encodeURIComponent(v).replace(/%20/g, "+").replace(/%3A/g, ":");
}

function toQueryString(entries: Array<[string, string]>): string {
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeFormValue(v)}`).join("&");
}

// Raw-substring append: the existing query is never re-parsed, re-split or
// re-encoded (a `#fragment` is split off first and reattached last; `?a=1?b=2`
// stays whole; `Smith%2C%20John` keeps its bytes; a bare `?flag` stays
// valueless). `sid` is always stripped. A key this call sets replaces the same
// key already present (exact, case-sensitive match) rather than duplicating it
// — a duplicate's outcome is parser-dependent, and a stale `dl=title` beside
// the required `dl=page` would silently coexist. Only keys with a defined
// value count: every site's table declares every key it could emit, so
// `Object.keys` alone deleted a curated value the call never supplied.
function appendToBaseUrl(
  baseUrl: string,
  params: Record<string, string | undefined>,
): { url: string; overridden: string[]; semicolonGroups: string[] } {
  const hashIndex = baseUrl.indexOf("#");
  const fragment = hashIndex === -1 ? "" : baseUrl.slice(hashIndex);
  const withoutFragment = hashIndex === -1 ? baseUrl : baseUrl.slice(0, hashIndex);

  const qIndex = withoutFragment.indexOf("?");
  const path = qIndex === -1 ? withoutFragment : withoutFragment.slice(0, qIndex);
  const existingQuery = qIndex === -1 ? "" : withoutFragment.slice(qIndex + 1);

  const defined = Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined);
  const overriddenKeys = new Set(defined.map(([k]) => k));
  const overridden: string[] = [];
  const semicolonGroups: string[] = [];
  const existingTokens = existingQuery.length > 0 ? existingQuery.split("&") : [];
  const preservedTokens: string[] = [];
  for (const token of existingTokens) {
    // A `;`-joined group (`birth=1800;name=X`) is one token here. Treating its
    // first key as the whole token's key destroyed every other parameter in
    // the group — including when that first key was `sid`, which sent the
    // whole group through the strip below. Only the `sid` members are
    // removed; the rest is preserved whole, since `;` is not a separator this
    // tool may assume the site honours.
    if (token.includes(";")) {
      const kept = token.split(";").filter((sub) => decodeKey(sub.split("=", 1)[0]).toLowerCase() !== "sid");
      if (kept.length === 0) continue;
      for (const sub of kept) {
        const subKey = decodeKey(sub.split("=", 1)[0]);
        if (overriddenKeys.has(subKey) && !semicolonGroups.includes(subKey)) semicolonGroups.push(subKey);
      }
      preservedTokens.push(kept.join(";"));
      continue;
    }
    // Compared decoded: `birt%68` is the same key as `birth`.
    const key = decodeKey(token.split("=", 1)[0]);
    if (key.toLowerCase() === "sid") continue;
    if (overriddenKeys.has(key)) {
      if (!overridden.includes(key)) overridden.push(key);
      continue;
    }
    preservedTokens.push(token);
  }

  const appended = toQueryString(defined);
  const combinedQuery = [preservedTokens.join("&"), appended].filter((s) => s.length > 0).join("&");
  const query = combinedQuery.length > 0 ? `?${combinedQuery}` : "";
  return { url: `${path}${query}${fragment}`, overridden, semicolonGroups };
}

function decodeKey(k: string): string {
  try {
    return decodeURIComponent(k);
  } catch {
    return k;
  }
}

// ─── Attribute kinds and notes (spec §3.1, §3.7) ─────────────────────────────

type AttributeKind = "string" | "yearRange" | "year" | "smallNumber";

// One kind per attribute, exhaustive over the interface (`-?`), and the
// conditional type ties each kind to the field's declared type — a new
// attribute with no entry, or a year field marked "string", fails `tsc`.
const ATTRIBUTE_KIND: {
  [K in keyof BuildExternalSearchUrlAttributes]-?: NonNullable<BuildExternalSearchUrlAttributes[K]> extends string
    ? "string" | "yearRange"
    : "year" | "smallNumber";
} = {
  givenName: "string",
  surname: "string",
  birthYear: "year",
  birthPlace: "string",
  deathYear: "year",
  deathPlace: "string",
  marriageYear: "year",
  marriagePlace: "string",
  residenceYear: "year",
  residencePlace: "string",
  fatherGivenName: "string",
  fatherSurname: "string",
  motherGivenName: "string",
  motherSurname: "string",
  spouseGivenName: "string",
  spouseSurname: "string",
  birthYearOffset: "smallNumber",
  placeProximityMiles: "smallNumber",
  eventYear: "year",
  keywords: "string",
  searchYear: "yearRange",
  searchPlace: "string",
  searchStartYear: "year",
  searchEndYear: "year",
  usState: "string",
};

const VALIDATE_BY_KIND: Record<AttributeKind, (v: unknown) => string | undefined> = {
  string: str,
  yearRange: yearOrRange,
  year: numYear,
  smallNumber: numSmall,
};

const KIND_LABEL: Record<AttributeKind, string> = {
  string: "usable string",
  yearRange: "plain year or ordered hyphenated range (YYYY or YYYY-YYYY)",
  year: "valid year",
  smallNumber: "valid number",
};

function describeType(v: unknown): string {
  return v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
}

function isSuppliedValue(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  return typeof v === "string" ? v.trim().length > 0 : true;
}

// A model that stringifies a number (`birthYear: "1845"`) meant the number —
// the same slip research_log_append coerces on `resultsExamined`. Only the
// year/number attributes are coerced, and only a plain decimal literal:
// `Number()` would also read `"0x733"` as 1843 or `"1e3"` as 1000, neither of
// which a model means as a year. A number in a string attribute stays a
// wrong-typed value and gets its note.
function coerceNumericStrings(a: BuildExternalSearchUrlAttributes): BuildExternalSearchUrlAttributes {
  const out: Record<string, unknown> = { ...a };
  for (const key of Object.keys(out) as Array<keyof BuildExternalSearchUrlAttributes>) {
    const kind = ATTRIBUTE_KIND[key];
    const v = out[key];
    if ((kind === "year" || kind === "smallNumber") && typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) {
      out[key] = Number(v);
    }
  }
  return out as BuildExternalSearchUrlAttributes;
}

// One pass over every supplied attribute. Unrecognized by this site → "not
// used" (a caller may believe a death event scoped a search that ran
// whole-corpus). Recognized but rejected by its validator → "wrong type / out
// of range". `null`, `""` and whitespace count as absent on both branches, the
// convention `str()` sets: `deathYear: null` says "I have no death year", not
// "scope by this", so there is nothing lost to warn about.
function attributeNotes(
  a: BuildExternalSearchUrlAttributes,
  recognized: ReadonlySet<keyof BuildExternalSearchUrlAttributes>,
  site: ExternalSearchSite,
): string[] {
  const notes: string[] = [];
  for (const key of Object.keys(a) as Array<keyof BuildExternalSearchUrlAttributes>) {
    const value = a[key];
    if (!isSuppliedValue(value)) continue;
    if (!recognized.has(key)) {
      notes.push(`'${key}' is not used by ${site} — supplied but ignored`);
      continue;
    }
    const kind = ATTRIBUTE_KIND[key];
    if (VALIDATE_BY_KIND[kind](value) === undefined) {
      notes.push(`'${key}' was supplied but is not a ${KIND_LABEL[kind]} for ${site} — ignored`);
    }
  }
  return notes;
}

// A site with one field for several attributes takes the first valid one; the
// rest would vanish silently without this.
function shadowedNotes(
  site: ExternalSearchSite,
  field: string,
  candidates: Array<[keyof BuildExternalSearchUrlAttributes, unknown]>,
  validate: (v: unknown) => string | undefined,
): string[] {
  const valid = candidates.filter(([, v]) => validate(v) !== undefined);
  if (valid.length < 2) return [];
  const [winner, ...shadowed] = valid;
  return shadowed.map(
    ([key]) => `'${key}' is not used by ${site} when ${winner[0]} is supplied — the site has one ${field} field`,
  );
}

// Per-site observations about how this call's attributes landed in `params`.
function siteNotes(
  site: ExternalSearchSite,
  a: BuildExternalSearchUrlAttributes,
  params: Record<string, string | undefined>,
): string[] {
  const notes: string[] = [];
  switch (site) {
    case "findmypast":
      // Tested on the templated params, not on presence: an out-of-range
      // `eventYear` must warn exactly like an absent one.
      if (params.yearofbirth === undefined && params.eventyear === undefined) {
        notes.push("no yearofbirth or eventyear supplied — search is unscoped by year");
      }
      if (params.yearofbirth === undefined && numSmall(a.birthYearOffset) !== undefined) {
        notes.push("'birthYearOffset' has no effect without birthYear — ignored");
      }
      if (params.keywordsplace === undefined && numSmall(a.placeProximityMiles) !== undefined) {
        notes.push("'placeProximityMiles' has no effect without a place — ignored");
      }
      notes.push(
        ...shadowedNotes(
          site,
          "keywordsplace",
          [
            ["birthPlace", a.birthPlace],
            ["marriagePlace", a.marriagePlace],
            ["deathPlace", a.deathPlace],
            ["residencePlace", a.residencePlace],
          ],
          str,
        ),
      );
      break;
    case "chronicling_america": {
      const window = chroniclingAmericaWindow(a);
      if (window.halfWindow) {
        notes.push(
          "searchStartYear/searchEndYear must both be supplied for a dates window — only one produced a " +
            "valid year, so no date window was applied",
        );
      }
      if (window.inverted) {
        notes.push("searchStartYear is after searchEndYear — no date window was applied");
      }
      if (str(a.usState) !== undefined && usStateFacet(a.usState) === undefined) {
        notes.push("'usState' names no US state this site can facet on — no state filter was applied");
      }
      const { first, last } = CHRONICLING_AMERICA_COVERAGE;
      if (window.start !== undefined && window.end !== undefined && (window.start < first || window.end > last)) {
        notes.push(
          `the ${window.start}–${window.end} window extends past the ${first}–${last} page corpus — only the ` +
            "overlap can return pages",
        );
      }
      break;
    }
    case "antenati":
      notes.push(...shadowedNotes(site, "anno", [["birthYear", a.birthYear], ["deathYear", a.deathYear]], numYear));
      notes.push(
        ...shadowedNotes(site, "localita", [["birthPlace", a.birthPlace], ["deathPlace", a.deathPlace]], str),
      );
      break;
    case "archives_gov":
      notes.push(
        ...shadowedNotes(
          site,
          "geographicReference",
          [["birthPlace", a.birthPlace], ["deathPlace", a.deathPlace]],
          str,
        ),
      );
      break;
    case "american_ancestors":
      notes.push(
        ...shadowedNotes(site, "Location", [["birthPlace", a.birthPlace], ["deathPlace", a.deathPlace]], str),
      );
      break;
  }
  return notes;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function buildExternalSearchUrl(input: BuildExternalSearchUrlInput): BuildExternalSearchUrlResult {
  const { site, baseUrl: rawBaseUrl, locale } = input ?? ({} as BuildExternalSearchUrlInput);

  // `attributes` is a nested object — the shape a model most often
  // stringifies — so it is JSON-coerced like research_log_append's object
  // arguments before anything reads it.
  const coercedAttributes = coerceJsonArg(input?.attributes);
  const attributesIsObject =
    coercedAttributes !== null && typeof coercedAttributes === "object" && !Array.isArray(coercedAttributes);
  const a = coerceNumericStrings(attributesIsObject ? (coercedAttributes as BuildExternalSearchUrlAttributes) : {});

  if (rawBaseUrl !== undefined && rawBaseUrl !== null && typeof rawBaseUrl !== "string") {
    return {
      ok: false,
      reason: "invalid_base_url",
      errors: [`baseUrl must be a string; got ${describeType(rawBaseUrl)}`],
    };
  }
  // The TRIMMED value is used, not merely checked: `new URL()` strips padding
  // itself, so a padded URL passes `isHttpUrl` while the raw string would
  // reach the substring append and ship a leading space. "" and
  // whitespace-only are absent (spec §3.7).
  const trimmedBaseUrl = typeof rawBaseUrl === "string" ? rawBaseUrl.trim() : "";
  const baseUrl = trimmedBaseUrl.length > 0 ? trimmedBaseUrl : undefined;

  // Anything but an absolute http(s) URL is a caller error — a plain label or
  // a `javascript:`/`data:` value must never come back as `{ ok: true }`.
  if (baseUrl && !isHttpUrl(baseUrl)) {
    return {
      ok: false,
      reason: "invalid_base_url",
      errors: [`baseUrl ${JSON.stringify(baseUrl)} is not an absolute http(s) URL`],
    };
  }

  if (!isSupportedSite(site)) {
    return {
      ok: false,
      reason: "unsupported_site",
      errors: [`"${site}" is not a supported site`],
      supportedSites: [...SUPPORTED_SITES],
    };
  }

  if (baseUrl) {
    const hostError = baseUrlHostError(site, baseUrl);
    if (hostError) return { ok: false, reason: "invalid_base_url", errors: [hostError] };
  }

  const siteWideUrl = SITE_BASE_URL[site];
  if (!baseUrl && siteWideUrl === null) {
    return {
      ok: false,
      reason: "base_url_required",
      errors: [`${site} has no fixed site-wide URL — pass the specific archive's own search endpoint as baseUrl`],
    };
  }

  if (site === "chronicling_america") {
    const window = chroniclingAmericaWindow(a);
    const { first, last } = CHRONICLING_AMERICA_COVERAGE;
    if (window.start !== undefined && window.end !== undefined && (window.end < first || window.start > last)) {
      return {
        ok: false,
        reason: "outside_coverage",
        errors: [
          `searchStartYear/searchEndYear ${window.start}–${window.end} lie entirely outside Chronicling America's ` +
            `${first}–${last} digitised page corpus — route to the state/regional archive for the place or a paid site`,
        ],
      };
    }
  }

  const params = siteWideParams(site, a);
  const notes = attributeNotes(a, RECOGNIZED_KEYS[site], site);
  if (!Object.values(params).some((v) => v !== undefined)) {
    // The notes ride in `errors` so the caller learns WHY nothing landed —
    // "no attributes" alone reads as "you sent none" when it sent invalid ones.
    return {
      ok: false,
      reason: "no_attributes",
      errors: [
        `no attributes supplied for ${site} produced any parameter`,
        ...(attributesIsObject ? [] : [`attributes must be an object; got ${describeType(input?.attributes)}`]),
        ...notes,
      ],
    };
  }
  notes.push(...siteNotes(site, a, params));
  const siteNote = SITE_NOTES[site];
  if (siteNote) notes.push(siteNote);

  // `locale` applies only to the site-wide fallback — a curated `baseUrl`
  // names its own host. A locale with no variant is noted, not ignored.
  let resolvedSiteUrl = siteWideUrl;
  if (!baseUrl && locale === "uk") {
    const ukUrl = UK_BASE_URL[site];
    if (ukUrl) {
      resolvedSiteUrl = ukUrl;
    } else {
      notes.push(`locale "uk" has no variant for ${site} — used the default site instead`);
    }
  }

  const combinedParams = { ...(SITE_FIXED_PARAMS[site] ?? {}), ...params };
  const { url, overridden, semicolonGroups } = appendToBaseUrl(baseUrl ?? (resolvedSiteUrl as string), combinedParams);
  for (const key of overridden) {
    notes.push(`'${key}' already in baseUrl was replaced by this call's own value`);
  }
  for (const key of semicolonGroups) {
    notes.push(
      `'${key}' is already in baseUrl inside a ';'-joined group, which was left untouched — the parameter may appear twice`,
    );
  }
  if (baseUrl !== undefined && new URL(baseUrl).protocol === "http:") {
    notes.push("baseUrl uses http:, which the desktop viewer does not open — prefer the https form of this link");
  }

  return { ok: true, url, notes, access: SITE_ACCESS[site] };
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
        // A spread, so a caller mutating a returned array can never rewrite
        // the advertised enum.
        enum: [...SUPPORTED_SITES],
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
              "exact phrase in your own quote marks) appended alongside the name. Used by every site " +
              "with a free-text query field: newspapers, chronicling_america, digital_newspaper_archive, " +
              "archives_gov (its q field), archive_org, american_ancestors, and italian_genealogy — for " +
              "archive_org and italian_genealogy this is the only field available for a record-type term.",
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
