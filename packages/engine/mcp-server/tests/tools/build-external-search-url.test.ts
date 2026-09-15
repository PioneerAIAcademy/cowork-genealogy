import { describe, it, expect } from "vitest";
import { buildExternalSearchUrl, buildExternalSearchUrlSchema } from "../../src/tools/build-external-search-url.js";
import { VALIDATOR_ENUMS } from "../../src/validation/validator.js";

describe("build_external_search_url", () => {
  describe("one passing case per site", () => {
    it("ancestry: name/birth/birthplace/residence/relatives, underscore-joined", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        attributes: {
          givenName: "Patrick",
          surname: "Flynn",
          birthYear: 1845,
          birthPlace: "Ireland",
          residenceYear: 1870,
          residencePlace: "Schuylkill County, Pennsylvania",
          fatherGivenName: "Michael",
          fatherSurname: "Flynn",
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(
        "https://www.ancestry.com/search/?name=Patrick_Flynn&birth=1845&birthplace=Ireland" +
          "&residence=1870_Schuylkill+County%2C+Pennsylvania&father=Michael_Flynn",
      );
    });

    it("myheritage: first/last/birth_year/birth_place, fixed action=query", () => {
      const r = buildExternalSearchUrl({
        site: "myheritage",
        attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845, birthPlace: "Ireland" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(
        "https://www.myheritage.com/research?action=query&first=Patrick&last=Flynn&birth_year=1845&birth_place=Ireland",
      );
    });

    it("findmypast: firstname/lastname/yearofbirth/keywordsplace", () => {
      const r = buildExternalSearchUrl({
        site: "findmypast",
        attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845, birthPlace: "Ireland" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(
        "https://www.findmypast.com/search/results?firstname=Patrick&lastname=Flynn&yearofbirth=1845&keywordsplace=Ireland",
      );
    });

    it("findagrave: firstname/lastname/birthyear/deathyear, no place parameter", () => {
      const r = buildExternalSearchUrl({
        site: "findagrave",
        attributes: {
          givenName: "Patrick",
          surname: "Flynn",
          deathYear: 1908,
          deathPlace: "Pennsylvania",
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // deathPlace is not a recognized attribute for findagrave (see the
      // "location removed" note below) — it's flagged, not silently dropped.
      expect(r.notes.some((n) => n.includes("'deathPlace'") && n.includes("findagrave"))).toBe(true);
      expect(r.url).toBe(
        "https://www.findagrave.com/memorial/search?firstname=Patrick&lastname=Flynn&deathyear=1908",
      );
    });

    it("newspapers: query is space-joined (form-encoded as +), dr_year/dr_place are generic", () => {
      const r = buildExternalSearchUrl({
        site: "newspapers",
        attributes: { givenName: "Patrick", surname: "Flynn", searchYear: "1908", searchPlace: "Schuylkill County" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(
        "https://www.newspapers.com/search/?query=Patrick+Flynn&dr_year=1908&dr_place=Schuylkill+County",
      );
    });

    it("chronicling_america: q space-joined, dates=YYYY/YYYY, state as the fa= facet, dl=page fixed", () => {
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        attributes: {
          givenName: "Patrick",
          surname: "Flynn",
          searchStartYear: 1900,
          searchEndYear: 1910,
          usState: "Pennsylvania",
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(
        "https://www.loc.gov/collections/chronicling-america/?dl=page&q=Patrick+Flynn&dates=1900%2F1910&fa=location_state:pennsylvania",
      );
    });

    it("digital_newspaper_archive: only q=given+surname appended to a required baseUrl", () => {
      const r = buildExternalSearchUrl({
        site: "digital_newspaper_archive",
        baseUrl: "https://newspapers.lib.utah.edu/search",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://newspapers.lib.utah.edu/search?q=Patrick+Flynn");
    });

    it("archives_gov: personOrOrg + fixed dataSource=authority", () => {
      const r = buildExternalSearchUrl({
        site: "archives_gov",
        attributes: { givenName: "Patrick", surname: "Flynn", birthPlace: "Ireland" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(
        "https://catalog.archives.gov/search?dataSource=authority&availableOnline=false" +
          "&personOrOrg=Patrick+Flynn&geographicReference=Ireland",
      );
    });

    it("archive_org: query is the only field, space-joined", () => {
      const r = buildExternalSearchUrl({
        site: "archive_org",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://archive.org/search?query=Patrick+Flynn");
    });

    it("billiongraves: GivenNames/FamilyName/EventBirthYear/EventDeathYear", () => {
      const r = buildExternalSearchUrl({
        site: "billiongraves",
        attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845, deathYear: 1908 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(
        "https://billiongraves.com/search/results?GivenNames=Patrick&FamilyName=Flynn" +
          "&EventBirthYear=1845&EventDeathYear=1908",
      );
    });

    it("digitalarkivet: a single birthYear fills both ends of the range field", () => {
      const r = buildExternalSearchUrl({
        site: "digitalarkivet",
        attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845, birthPlace: "Ireland" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(
        "https://www.digitalarkivet.no/en/search/persons/advanced?firstname=Patrick&lastname=Flynn" +
          "&birth_year_from=1845&birth_year_to=1845&birth_place=Ireland",
      );
    });

    it("antenati: nome/cognome/anno/localita, Italian field names", () => {
      const r = buildExternalSearchUrl({
        site: "antenati",
        attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845, birthPlace: "Ireland" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(
        "https://antenati.cultura.gov.it/search-nominative/?nome=Patrick&cognome=Flynn" +
          "&anno=1845&localita=Ireland",
      );
    });

    it("library_archives_canada: FirstName/LastName/YearOfBirth, fixed DataSource+ST", () => {
      const r = buildExternalSearchUrl({
        site: "library_archives_canada",
        attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(
        "https://recherche-collection-search.bac-lac.gc.ca/eng/Home/Result?DataSource=Genealogy%7CCensus" +
          "&ST=SCTB&FirstName=Patrick&LastName=Flynn&YearOfBirth=1845",
      );
    });

    it("american_ancestors: name travels through Keywords, not a non-binding Name.First/Name.Last", () => {
      const r = buildExternalSearchUrl({
        site: "american_ancestors",
        attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845, birthPlace: "Ireland" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(
        "https://app.americanancestors.org/SearchResults/AdvancedSearch?Keywords=Patrick+Flynn" +
          "&Location=Ireland&FromYear=1845&ToYear=1845",
      );
    });

    it("italian_genealogy: keywords + the three fixed params from the one confirmed-working URL", () => {
      const r = buildExternalSearchUrl({
        site: "italian_genealogy",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(
        "https://www.italiangenealogy.com/forum/search?terms=all&sf=all&sr=posts&keywords=Patrick+Flynn",
      );
    });
  });

  describe("locale: ancestry.co.uk / findmypast.co.uk (issue #1980 launch scope)", () => {
    it("locale uk builds against ancestry.co.uk with the same parameters", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        locale: "uk",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.ancestry.co.uk/search/?name=Patrick_Flynn");
    });

    it("locale uk builds against findmypast.co.uk with the same parameters", () => {
      const r = buildExternalSearchUrl({
        site: "findmypast",
        locale: "uk",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.findmypast.co.uk/search/results?firstname=Patrick&lastname=Flynn");
    });

    it("locale us (or omitted) builds against the .com default", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        locale: "us",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.ancestry.com/search/?name=Patrick_Flynn");
    });

    it("locale uk is noted, not silently ignored, for a site with no UK variant", () => {
      const r = buildExternalSearchUrl({
        site: "findagrave",
        locale: "uk",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.findagrave.com/memorial/search?firstname=Patrick&lastname=Flynn");
      expect(r.notes.some((n) => n.includes("uk") && n.includes("findagrave"))).toBe(true);
    });

    it("a curated baseUrl overrides locale — a curated link already names its own host", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        locale: "uk",
        baseUrl: "https://www.ancestry.com/search/collections/8054/",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.ancestry.com/search/collections/8054/?name=Patrick_Flynn");
    });
  });

  describe("Chronicling America corrections (issue #1980)", () => {
    it("never emits start_date/end_date", () => {
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        attributes: { givenName: "Patrick", surname: "Flynn", searchStartYear: 1900, searchEndYear: 1910 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toMatch(/start_date|end_date/);
      expect(r.url).toMatch(/dates=1900%2F1910/);
    });

    it("omits dates entirely when only one bound is given", () => {
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        attributes: { givenName: "Patrick", surname: "Flynn", searchStartYear: 1900 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toMatch(/dates=/);
    });

    it("never emits qs — q is the parameter that actually filters on the live site", () => {
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toMatch(/[?&]qs=/);
      expect(r.url).toMatch(/[?&]q=Patrick\+Flynn/);
    });
  });

  describe("free-text keywords (newspapers, chronicling_america, digital_newspaper_archive)", () => {
    it("appends to newspapers.com's query alongside the name", () => {
      const r = buildExternalSearchUrl({
        site: "newspapers",
        attributes: { givenName: "Patrick", surname: "Flynn", keywords: "obituary" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toMatch(/query=Patrick\+Flynn\+obituary/);
    });

    it("appends to chronicling_america's q alongside the name", () => {
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        attributes: { givenName: "Patrick", surname: "Flynn", keywords: "obituary" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toMatch(/[?&]q=Patrick\+Flynn\+obituary/);
    });

    it("appends to digital_newspaper_archive's q alongside the name", () => {
      const r = buildExternalSearchUrl({
        site: "digital_newspaper_archive",
        baseUrl: "https://newspapers.lib.utah.edu/search",
        attributes: { givenName: "Patrick", surname: "Flynn", keywords: "obituary" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://newspapers.lib.utah.edu/search?q=Patrick+Flynn+obituary");
    });

    it("preserves an exact phrase the caller quotes itself", () => {
      const r = buildExternalSearchUrl({
        site: "newspapers",
        attributes: { keywords: '"Patrick Flynn"' },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toMatch(/query=%22Patrick\+Flynn%22/);
    });

    it("is not a recognized parameter for structured-name sites (ancestry) — noted, not silently dropped", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        attributes: { givenName: "Patrick", surname: "Flynn", keywords: "obituary" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toMatch(/obituary/);
      expect(r.notes.some((n) => n.includes("'keywords'") && n.includes("ancestry"))).toBe(true);
    });
  });

  describe("searchYear accepts a range, not just a single year", () => {
    it("passes a hyphenated range straight through", () => {
      const r = buildExternalSearchUrl({
        site: "newspapers",
        attributes: { givenName: "Patrick", surname: "Flynn", searchYear: "1880-1905" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toMatch(/dr_year=1880-1905/);
    });
  });

  describe("sid is never emitted", () => {
    it("is not in any per-site table's own output", () => {
      const r = buildExternalSearchUrl({
        site: "findmypast",
        attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toMatch(/sid=/);
    });

    it("is stripped from a supplied baseUrl, while other params are preserved", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.com/search/collections/8054/?sid=abc123&foo=bar",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toMatch(/sid=/);
      expect(r.url).toMatch(/foo=bar/);
      expect(r.url).toMatch(/name=Patrick_Flynn/);
    });

    it("is stripped case-insensitively (SID, Sid)", () => {
      const upper = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.com/search/collections/8054/?SID=abc123&foo=bar",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      const mixed = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.com/search/collections/8054/?Sid=abc123&foo=bar",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(upper.ok).toBe(true);
      expect(mixed.ok).toBe(true);
      if (!upper.ok || !mixed.ok) return;
      expect(upper.url).not.toMatch(/[?&][Ss][Ii][Dd]=/);
      expect(mixed.url).not.toMatch(/[?&][Ss][Ii][Dd]=/);
      expect(upper.url).toMatch(/foo=bar/);
    });
  });

  describe("baseUrl append, both join characters", () => {
    it("uses ? when the base URL has no existing query string", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.com/search/collections/8054/",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.ancestry.com/search/collections/8054/?name=Patrick_Flynn");
    });

    it("uses & when the base URL already has a query string", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.com/search/collections/8054/?collection=8054",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(
        "https://www.ancestry.com/search/collections/8054/?collection=8054&name=Patrick_Flynn",
      );
    });
  });

  describe("baseUrl edge cases (found in review)", () => {
    it("appends the query before a #fragment, not after it", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.com/search/collections/8054/#facets",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(
        "https://www.ancestry.com/search/collections/8054/?name=Patrick_Flynn#facets",
      );
    });

    it("preserves an existing query containing a literal ? without dropping anything after it", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.com/search/collections/8054/?a=1?b=2",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(
        "https://www.ancestry.com/search/collections/8054/?a=1?b=2&name=Patrick_Flynn",
      );
    });

    it("does not re-encode an existing value already in a different valid encoding", () => {
      // A key the tool never sets (not `name`, which the next test covers
      // separately as an override case) — this test is purely about leaving
      // an untouched existing value's own encoding alone.
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.com/search/collections/8054/?ref=Smith%2C%20John",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toMatch(/[?&]ref=Smith%2C%20John(&|$)/);
    });

    it("overrides rather than duplicates a key the curated baseUrl already carries (review finding)", () => {
      // ?name=John_Smith + the tool's own name=Patrick_Flynn used to ship as
      // both, `?name=John_Smith&name=Patrick_Flynn` — parser-dependent which
      // one a receiving site actually uses. The tool's own value must win,
      // with no leftover duplicate key.
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.com/search/collections/8054/?name=John_Smith",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.ancestry.com/search/collections/8054/?name=Patrick_Flynn");
    });

    it("overrides a fixed param the curated baseUrl already carries, not just an attribute-derived one", () => {
      // ?dl=title (a curated Chronicling America link's own value) collided
      // with the tool's own required dl=page — the spec calls dl=page
      // required precisely because without it the search hits newspaper
      // titles, not digitised pages, so a stale dl=title silently coexisting
      // defeats the one param the correction exists to guarantee.
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        baseUrl: "https://www.loc.gov/collections/chronicling-america/?dl=title",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.loc.gov/collections/chronicling-america/?dl=page&q=Patrick+Flynn");
    });

    it("does not delete a curated baseUrl's own value for a key this call never supplies (review finding)", () => {
      // siteWideParams() always declares every key a site recognizes,
      // undefined-valued when the caller omits that attribute — an earlier
      // version of the override fix built `overriddenKeys` from
      // `Object.keys(params)` directly, which named every key the site could
      // ever emit rather than the ones this call is actually setting, and
      // silently deleted an already-correct curated value with nothing to
      // replace it and no note.
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.com/search/collections/8054/?birthplace=Boston",
        attributes: { givenName: "Patrick", surname: "Flynn" }, // no birthPlace supplied
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.ancestry.com/search/collections/8054/?birthplace=Boston&name=Patrick_Flynn");
    });

    it("preserves an existing valueless flag parameter as-is", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.com/search/collections/8054/?flag",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toMatch(/[?&]flag(&|$)/);
      expect(r.url).not.toMatch(/flag=/);
    });

    it("applies the site's fixed params even when appending onto a baseUrl", () => {
      const r = buildExternalSearchUrl({
        site: "myheritage",
        baseUrl: "https://www.myheritage.com/research?collection=123",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toMatch(/[?&]action=query(&|$)/);
    });

    it("applies chronicling_america's required dl=page even when appending onto a baseUrl", () => {
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        baseUrl: "https://www.loc.gov/collections/chronicling-america/?fa=partof:pennsylvania",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toMatch(/[?&]dl=page(&|$)/);
    });
  });

  describe("baseUrl treats empty/whitespace-only the same as absent (issue #1980 review)", () => {
    it("falls back to the site-wide URL when baseUrl is an empty string", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.ancestry.com/search/?name=Patrick_Flynn");
    });

    it("falls back to the site-wide URL when baseUrl is whitespace-only", () => {
      const r = buildExternalSearchUrl({
        site: "myheritage",
        baseUrl: "   ",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url.startsWith("https://www.myheritage.com/research?")).toBe(true);
      expect(r.url).not.toMatch(/^\s/);
    });

    it("digital_newspaper_archive still requires a real baseUrl — an empty string does not satisfy it", () => {
      const r = buildExternalSearchUrl({
        site: "digital_newspaper_archive",
        baseUrl: "",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("base_url_required");
    });
  });

  describe("digital_newspaper_archive requires baseUrl", () => {
    it("rejects with base_url_required when baseUrl is omitted", () => {
      const r = buildExternalSearchUrl({
        site: "digital_newspaper_archive",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("base_url_required");
    });

    it("never invents a facet or date parameter even when supplied", () => {
      const r = buildExternalSearchUrl({
        site: "digital_newspaper_archive",
        baseUrl: "https://newspapers.lib.utah.edu/search",
        attributes: {
          givenName: "Patrick",
          surname: "Flynn",
          searchStartYear: 1900,
          searchEndYear: 1910,
          usState: "utah",
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://newspapers.lib.utah.edu/search?q=Patrick+Flynn");
    });
  });

  describe("unsupported site", () => {
    it("names exactly the fifteen supported sites", () => {
      const r = buildExternalSearchUrl({
        site: "wiewaswie",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("unsupported_site");
      if (r.reason !== "unsupported_site") return;
      expect(r.supportedSites.sort()).toEqual(
        [
          "ancestry",
          "chronicling_america",
          "digital_newspaper_archive",
          "findagrave",
          "findmypast",
          "myheritage",
          "newspapers",
          "archives_gov",
          "archive_org",
          "billiongraves",
          "digitalarkivet",
          "antenati",
          "library_archives_canada",
          "american_ancestors",
          "italian_genealogy",
        ].sort(),
      );
    });

    it("every advertised supported site builds without throwing (issue #1980 review)", () => {
      // Reproduces the review finding's actual failure mode directly: before
      // the fix, SUPPORTED_SITES was derived from the full `external_site`
      // enum, which already carries room for 14 follow-up sites this tool
      // has no `siteWideParams` case for (the review's own repro appended
      // "fold3" to that enum and got a live `TypeError` on
      // `Object.values(undefined)`). This loop is the general form: call the
      // PUBLIC API for every site this tool currently advertises as
      // supported, with only a name supplied (plus the required `baseUrl` for
      // `digital_newspaper_archive`), and assert none of them throws. A
      // future site added to `SUPPORTED_SITES` with no matching
      // `siteWideParams` case reproduces the exact crash this guards against.
      const supportedSites = (() => {
        const r = buildExternalSearchUrl({ site: "not-a-real-site", attributes: {} });
        if (r.ok) throw new Error("expected unsupported_site");
        if (r.reason !== "unsupported_site") throw new Error(`expected unsupported_site, got ${r.reason}`);
        return r.supportedSites;
      })();
      expect(supportedSites.length).toBeGreaterThan(0);
      for (const site of supportedSites) {
        expect(() =>
          buildExternalSearchUrl({
            site,
            baseUrl: site === "digital_newspaper_archive" ? "https://example.org/search" : undefined,
            attributes: { givenName: "Patrick", surname: "Flynn" },
          }),
        ).not.toThrow();
      }
    });

    it("SUPPORTED_SITES is a subset of the shared external_site enum (one-directional drift check)", () => {
      // Not derived from the enum (see the comment above SUPPORTED_SITES's
      // declaration) — this test is what still catches a spelling drift or
      // rename between this file and the shared enum, without the crash risk
      // of deriving supported-sites FROM a schema that may list more sites
      // than this tool has implementations for.
      const r = buildExternalSearchUrl({ site: "not-a-real-site", attributes: {} });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("unsupported_site");
      if (r.reason !== "unsupported_site") return;
      const enumValues: ReadonlySet<string> = VALIDATOR_ENUMS.external_site;
      for (const site of r.supportedSites) {
        expect(enumValues.has(site), `${site} is not in the shared external_site enum`).toBe(true);
      }
    });
  });

  describe("no_attributes", () => {
    it("rejects a site whose every own parameter is absent from attributes", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        attributes: { eventYear: 1900 },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("no_attributes");
    });

    it("treats an empty string the same as absent", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        attributes: { birthPlace: "" },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("no_attributes");
    });
  });

  describe("empty strings and non-finite numbers are treated as absent", () => {
    it("an empty birthPlace does not reach the URL as birthplace=", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        attributes: { givenName: "Patrick", surname: "Flynn", birthPlace: "" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toMatch(/birthplace=/);
    });

    it("an empty birthPlace falls through to the documented deathPlace fallback (antenati)", () => {
      const r = buildExternalSearchUrl({
        site: "antenati",
        attributes: { givenName: "Patrick", surname: "Flynn", birthPlace: "", deathPlace: "Ireland" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toMatch(/localita=Ireland/);
    });

    it("rejects NaN, Infinity, and out-of-range/fractional years", () => {
      for (const bad of [NaN, Infinity, -Infinity, 1e21, 1845.7]) {
        const r = buildExternalSearchUrl({
          site: "ancestry",
          attributes: { givenName: "Patrick", surname: "Flynn", birthYear: bad },
        });
        expect(r.ok, `birthYear=${bad}`).toBe(true);
        if (!r.ok) continue;
        expect(r.url, `birthYear=${bad}`).not.toMatch(/birth=/);
      }
    });

    it("a two-ended date window with one invalid end omits dates entirely, rather than shipping NaN (issue #1980 review)", () => {
      for (const bad of [NaN, Infinity, -Infinity, 1e21, 1845.7, -1]) {
        const r = buildExternalSearchUrl({
          site: "chronicling_america",
          attributes: {
            givenName: "Patrick",
            surname: "Flynn",
            searchStartYear: bad,
            searchEndYear: 1910,
          },
        });
        expect(r.ok, `searchStartYear=${bad}`).toBe(true);
        if (!r.ok) continue;
        expect(r.url, `searchStartYear=${bad}`).not.toMatch(/dates=/);
      }
    });
  });

  describe("a supplied attribute the target site doesn't read is noted, not silently dropped", () => {
    it("flags deathYear supplied to chronicling_america", () => {
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        attributes: { givenName: "Patrick", surname: "Flynn", deathYear: 1908 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.notes.some((n) => n.includes("'deathYear'") && n.includes("chronicling_america"))).toBe(true);
    });

    it("does not flag an attribute the site does read", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.notes.some((n) => n.includes("birthYear"))).toBe(false);
    });
  });

  describe("relative names, partial", () => {
    it("joins from whichever half of a relative's name is present", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        attributes: { givenName: "Patrick", surname: "Flynn", fatherGivenName: "Michael" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // Positional: a lone given name keeps its underscore so it stays in the
      // given-name slot (`father=Michael_`), not Ancestry's surname slot.
      expect(r.url).toMatch(/father=Michael_(&|$)/);
    });
  });

  describe("FindMyPast unscoped-by-year note", () => {
    it("still succeeds but notes the missing year", () => {
      const r = buildExternalSearchUrl({
        site: "findmypast",
        attributes: { givenName: "Patrick", surname: "Flynn", birthPlace: "Ireland" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.notes.some((n) => /unscoped by year/.test(n))).toBe(true);
    });
  });

  describe("access classification (alpha feedback: FindAGrave wrongly called paywalled)", () => {
    it.each([
      ["ancestry", "subscription"],
      ["myheritage", "subscription"],
      ["findmypast", "subscription"],
      ["findagrave", "free"],
      ["newspapers", "subscription"],
      ["chronicling_america", "free_bot_protected"],
      ["archives_gov", "free"],
      ["archive_org", "free"],
      ["billiongraves", "free"],
      ["digitalarkivet", "free"],
      ["antenati", "free"],
      ["library_archives_canada", "free"],
      ["american_ancestors", "free"],
      ["italian_genealogy", "free"],
    ] as const)("%s reports access %s", (site, access) => {
      const r = buildExternalSearchUrl({
        site,
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.access).toBe(access);
    });

    it("digital_newspaper_archive reports free_bot_protected", () => {
      const r = buildExternalSearchUrl({
        site: "digital_newspaper_archive",
        baseUrl: "https://newspapers.lib.utah.edu/search",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.access).toBe("free_bot_protected");
    });

    it("american_ancestors is 'free' but still notes the results-viewing caveat", () => {
      // "free" alone would repeat the FindAGrave failure mode in the other
      // direction if it implied a subscription never matters here — the
      // permanent note carries the nuance the 3-value enum can't.
      const r = buildExternalSearchUrl({
        site: "american_ancestors",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.access).toBe("free");
      expect(r.notes.some((n) => /subscription may still be required to view full results/.test(n))).toBe(true);
    });
  });

  describe("null-safety and invalid-value notes (review findings, 2026-09-13)", () => {
    it("treats a null string attribute as absent instead of crashing", () => {
      // `str()` previously checked `!== undefined` only; a model emitting
      // `null` for a field it doesn't know reached `.length` on `null` and
      // threw. Reproduced live across 11 of the tool's string attributes.
      expect(() =>
        buildExternalSearchUrl({
          site: "ancestry",
          attributes: { givenName: "Patrick", surname: "Flynn", birthPlace: null as any },
        }),
      ).not.toThrow();
      const r = buildExternalSearchUrl({
        site: "ancestry",
        attributes: { givenName: "Patrick", surname: "Flynn", birthPlace: null as any },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toContain("birthplace=");
    });

    it("treats a null year attribute as absent instead of a stray param", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        attributes: { givenName: "Patrick", surname: "Flynn", birthYear: null as any },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toContain("birth=");
    });

    it("notes a recognized string key supplied with the wrong type, not just an unrecognized one", () => {
      // A recognized key of the wrong type reached the same silent
      // `undefined` as an absent one — 89 cases across every site×key
      // combination in the review, 76 with an empty notes array.
      const r = buildExternalSearchUrl({
        site: "ancestry",
        attributes: { givenName: "Patrick", surname: "Flynn", birthPlace: 12345 as any },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toContain("birthplace=");
      expect(r.notes.some((n) => /'birthPlace' was supplied but is not a usable string/.test(n))).toBe(true);
    });

    it("notes a recognized year key supplied out of range, not just an absent one", () => {
      const r = buildExternalSearchUrl({
        site: "findmypast",
        attributes: { givenName: "Patrick", surname: "Flynn", eventYear: 99999 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toContain("eventyear=");
      expect(r.notes.some((n) => /'eventYear' was supplied but is not a valid year/.test(n))).toBe(true);
      // The presence-vs-validity bug: this exact case (an invalid eventYear,
      // no birthYear) must still warn the search is unscoped by year — an
      // earlier version's `!== undefined` check treated 99999 as "present"
      // and suppressed the warning.
      expect(r.notes.some((n) => /unscoped by year/.test(n))).toBe(true);
    });

    it("notes a half-supplied Chronicling America date window", () => {
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        attributes: { givenName: "Patrick", surname: "Flynn", searchStartYear: 1880 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toContain("dates=");
      expect(r.notes.some((n) => /must both be supplied for a dates window/.test(n))).toBe(true);
    });

    it("notes a Chronicling America window whose one end is null — presence is not validity (review finding)", () => {
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        attributes: { givenName: "Patrick", surname: "Flynn", searchStartYear: null as any, searchEndYear: 1910 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toContain("dates=");
      expect(r.notes.some((n) => /must both be supplied for a dates window/.test(n))).toBe(true);
    });

    it("notes a Chronicling America window whose one end is out of range, not just absent (review finding)", () => {
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        attributes: { givenName: "Patrick", surname: "Flynn", searchStartYear: 1880, searchEndYear: 99999 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toContain("dates=");
      expect(r.notes.some((n) => /must both be supplied for a dates window/.test(n))).toBe(true);
    });

    it("notes a wrong-typed usState instead of dropping it silently (review finding)", () => {
      // usState was the one recognized key in none of the old type Sets, so a
      // number here vanished from the URL with an empty notes array.
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        attributes: { givenName: "Patrick", surname: "Flynn", usState: 12 as any },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toContain("fa=");
      expect(r.notes.some((n) => /'usState' was supplied but is not a usable string/.test(n))).toBe(true);
    });

    it("rejects a year below 1000 with a note, matching the shared isFourDigitYear bound", () => {
      const r = buildExternalSearchUrl({
        site: "antenati",
        attributes: { givenName: "Pietro", surname: "Rossi", birthYear: 950 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toContain("anno=");
      expect(r.notes.some((n) => /'birthYear' was supplied but is not a valid year/.test(n))).toBe(true);
    });

    it("trims a whitespace-padded baseUrl instead of shipping the padding into the URL (review finding)", () => {
      // `new URL()` strips the padding itself, so the untrimmed string passed
      // isHttpUrl while appendToBaseUrl's substring slicing kept the spaces.
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "  https://www.ancestry.com/search/collections/8054/  ",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.ancestry.com/search/collections/8054/?name=Patrick_Flynn");
    });
  });

  describe("second review round (2026-09-14)", () => {
    it("trims padding on string attributes so it never reaches the URL as an encoded plus", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        attributes: { givenName: " Patrick ", surname: "Flynn ", birthPlace: " Ireland" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.ancestry.com/search/?name=Patrick_Flynn&birthplace=Ireland");
    });

    it("keeps Ancestry's positional underscore when one half of a pair is absent", () => {
      // `name=Flynn` is a given-name search on Ancestry; a surname-only search
      // is `name=_Flynn`, as the hand-filled template always produced.
      const r = buildExternalSearchUrl({
        site: "ancestry",
        attributes: { surname: "Flynn", residencePlace: "Pennsylvania" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.ancestry.com/search/?name=_Flynn&residence=_Pennsylvania");
    });

    it("rejects a FindMyPast call carrying only a tuning knob — a knob without its slot is not a search", () => {
      const r = buildExternalSearchUrl({ site: "findmypast", attributes: { birthYearOffset: 2 } });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("no_attributes");
    });

    it("notes a FindMyPast knob supplied without its slot on an otherwise valid call", () => {
      const r = buildExternalSearchUrl({
        site: "findmypast",
        attributes: { givenName: "Patrick", surname: "Flynn", birthYearOffset: 2 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toContain("yearofbirth_offset=");
      expect(r.notes.some((n) => /'birthYearOffset' has no effect without birthYear/.test(n))).toBe(true);
    });

    it("lets a FindMyPast marriage search name its place through keywordsplace", () => {
      const r = buildExternalSearchUrl({
        site: "findmypast",
        attributes: { givenName: "Patrick", surname: "Flynn", eventYear: 1870, marriagePlace: "Schuylkill County, Pennsylvania" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toContain("keywordsplace=Schuylkill+County%2C+Pennsylvania");
      expect(r.notes.some((n) => /'marriagePlace' is not used/.test(n))).toBe(false);
    });

    it("notes a supplied attribute shadowed by a site's single-field fallback", () => {
      const r = buildExternalSearchUrl({
        site: "antenati",
        attributes: { givenName: "Giovanni", surname: "Strada", birthYear: 1850, deathYear: 1910, birthPlace: "Milano", deathPlace: "Torino" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toContain("anno=1850");
      expect(r.url).toContain("localita=Milano");
      expect(r.notes.some((n) => /'deathYear' is not used by antenati when birthYear is supplied/.test(n))).toBe(true);
      expect(r.notes.some((n) => /'deathPlace' is not used by antenati when birthPlace is supplied/.test(n))).toBe(true);
    });

    it("notes when this call's value replaces one already in the curated baseUrl", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.com/search/collections/8054/?name=John_Smith",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.ancestry.com/search/collections/8054/?name=Patrick_Flynn");
      expect(r.notes.some((n) => /'name' already in baseUrl was replaced/.test(n))).toBe(true);
    });

    it("applies no Chronicling America window when the start year is after the end year", () => {
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        attributes: { givenName: "Patrick", surname: "Flynn", searchStartYear: 1910, searchEndYear: 1900 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toContain("dates=");
      expect(r.notes.some((n) => /searchStartYear is after searchEndYear/.test(n))).toBe(true);
    });

    it("refuses a Chronicling America window entirely outside the 1798–1963 corpus", () => {
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        attributes: { givenName: "John", surname: "Flynn", searchStartYear: 1970, searchEndYear: 1975 },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("outside_coverage");
      expect(r.errors.join(" ")).toMatch(/1798–1963/);
    });

    it("notes a Chronicling America window that only partly overlaps the corpus", () => {
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        attributes: { givenName: "John", surname: "Flynn", searchStartYear: 1960, searchEndYear: 1970 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toContain("dates=1960%2F1970");
      expect(r.notes.some((n) => /extends past the 1798–1963 page corpus/.test(n))).toBe(true);
    });

    it("rejects a baseUrl whose host belongs to a different site", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.myheritage.com/research?collection=123",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("invalid_base_url");
      expect(r.errors.join(" ")).toMatch(/does not belong to ancestry/);
    });

    it("rejects the retired chroniclingamerica.loc.gov host, whose parameters are ignored", () => {
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        baseUrl: "https://chroniclingamerica.loc.gov/search/pages/results/?state=Pennsylvania",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("invalid_base_url");
      expect(r.errors.join(" ")).toMatch(/retired/);
    });

    it("accepts a curated baseUrl on a sibling subdomain or the UK variant of the site", () => {
      const sub = buildExternalSearchUrl({
        site: "american_ancestors",
        baseUrl: "https://www.americanancestors.org/search/database-search",
        attributes: { surname: "Flynn" },
      });
      expect(sub.ok).toBe(true);
      const uk = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.co.uk/search/collections/8054/",
        attributes: { surname: "Flynn" },
      });
      expect(uk.ok).toBe(true);
    });

    it("rejects a non-string baseUrl instead of throwing", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: ["https://www.ancestry.com/search/"] as any,
        attributes: { surname: "Flynn" },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("invalid_base_url");
      expect(r.errors.join(" ")).toMatch(/must be a string; got array/);
    });

    it("coerces a JSON-stringified attributes object instead of reporting no_attributes", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        attributes: JSON.stringify({ givenName: "Patrick", surname: "Flynn" }) as any,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.ancestry.com/search/?name=Patrick_Flynn");
    });

    it("names the shape problem when attributes is not an object at all", () => {
      const r = buildExternalSearchUrl({ site: "ancestry", attributes: 42 as any });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("no_attributes");
      expect(r.errors.join(" ")).toMatch(/attributes must be an object; got number/);
    });

    it("carries the attribute notes into a no_attributes error so the caller learns why", () => {
      const r = buildExternalSearchUrl({ site: "ancestry", attributes: { birthYear: 99999 } });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("no_attributes");
      expect(r.errors.some((e) => /'birthYear' was supplied but is not a valid year/.test(e))).toBe(true);
    });

    it("coerces a numeric string in a year attribute the way research_log_append coerces resultsExamined", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        attributes: { givenName: "Patrick", surname: "Flynn", birthYear: "1845" as any },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toContain("birth=1845");
    });

    it("emits each site's standing note from the tool, not from skill prose", () => {
      const grave = buildExternalSearchUrl({ site: "findagrave", attributes: { givenName: "Patrick", surname: "Flynn" } });
      expect(grave.ok).toBe(true);
      if (!grave.ok) return;
      expect(grave.notes.some((n) => /user-contributed — a lead, not proof/.test(n))).toBe(true);
      const dna = buildExternalSearchUrl({
        site: "digital_newspaper_archive",
        baseUrl: "https://newspapers.lib.utah.edu/search",
        attributes: { keywords: "obituary" },
      });
      expect(dna.ok).toBe(true);
      if (!dna.ok) return;
      expect(dna.url).toBe("https://newspapers.lib.utah.edu/search?q=obituary");
      expect(dna.notes.some((n) => /no date filter/.test(n))).toBe(true);
    });

    it("names null and array attributes precisely in the no_attributes error", () => {
      const nul = buildExternalSearchUrl({ site: "ancestry", attributes: null as any });
      expect(nul.ok).toBe(false);
      if (nul.ok) return;
      expect(nul.errors.join(" ")).toMatch(/attributes must be an object; got null/);
      const arr = buildExternalSearchUrl({ site: "ancestry", attributes: [] as any });
      expect(arr.ok).toBe(false);
      if (arr.ok) return;
      expect(arr.errors.join(" ")).toMatch(/attributes must be an object; got array/);
    });

    it("notes a replaced curated key once even when the curated query repeats it", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.com/search/collections/8054/?name=A_B&name=C_D",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.ancestry.com/search/collections/8054/?name=Patrick_Flynn");
      expect(r.notes.filter((n) => /'name' already in baseUrl/.test(n))).toHaveLength(1);
    });

    it("emits Chronicling America's state as the fa= facet with a postal abbreviation expanded (round-4 B1)", () => {
      // The bare location_state= parameter measured as a no-op on the live
      // site; only the facet form filters, and only on the full lowercase name.
      const r = buildExternalSearchUrl({
        site: "chronicling_america",
        attributes: { givenName: "Patrick", surname: "Flynn", usState: "NY" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toContain("fa=location_state:new+york");
      expect(r.url).not.toContain("location_state=");
    });

    it("refuses a digital_newspaper_archive baseUrl on another supported site's own domain (round-4 B3)", () => {
      const r = buildExternalSearchUrl({
        site: "digital_newspaper_archive",
        baseUrl: "https://www.newspapers.com/search/",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("invalid_base_url");
      expect(r.errors.join(" ")).toMatch(/newspapers'?s own domain/);
    });

    it("matches a curated host on the site's registrable domain, never on a bare registry suffix", () => {
      const suffix = buildExternalSearchUrl({
        site: "library_archives_canada",
        baseUrl: "https://gc.ca/anything",
        attributes: { surname: "Flynn" },
      });
      expect(suffix.ok).toBe(false);
      const sibling = buildExternalSearchUrl({
        site: "library_archives_canada",
        baseUrl: "https://www.bac-lac.gc.ca/eng/census/Pages/census.aspx",
        attributes: { surname: "Flynn" },
      });
      expect(sibling.ok).toBe(true);
    });

    it("compares curated keys decoded, so a percent-encoded key is still overridden once", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.com/search/collections/8054/?birt%68=1800",
        attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.ancestry.com/search/collections/8054/?name=Patrick_Flynn&birth=1845");
      expect(r.notes.some((n) => /'birth' already in baseUrl was replaced/.test(n))).toBe(true);
    });

    it("preserves a ';'-joined curated group instead of destroying its other parameters", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.com/search/collections/8054/?birth=1800;name=X",
        attributes: { birthYear: 1850 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe("https://www.ancestry.com/search/collections/8054/?birth=1800;name=X&birth=1850");
      expect(r.notes.some((n) => /'birth' is already in baseUrl inside a ';'-joined group/.test(n))).toBe(true);
    });

    it("rejects a searchYear that is neither a plain year nor a hyphenated range", () => {
      const bad = buildExternalSearchUrl({
        site: "newspapers",
        attributes: { givenName: "Patrick", surname: "Flynn", searchYear: "banana" },
      });
      expect(bad.ok).toBe(true);
      if (!bad.ok) return;
      expect(bad.url).not.toContain("dr_year=");
      expect(bad.notes.some((n) => /'searchYear' was supplied but is not a plain year or hyphenated range/.test(n))).toBe(true);
      const range = buildExternalSearchUrl({
        site: "newspapers",
        attributes: { givenName: "Patrick", surname: "Flynn", searchYear: "1880-1905" },
      });
      expect(range.ok).toBe(true);
      if (!range.ok) return;
      expect(range.url).toContain("dr_year=1880-1905");
    });

    it("notes an http: baseUrl, which the desktop viewer does not open", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "http://www.ancestry.com/search/collections/8054/",
        attributes: { surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.notes.some((n) => /uses http:/.test(n))).toBe(true);
    });

    it("coerces only a plain decimal numeric string, not a hex or exponent literal", () => {
      const hex = buildExternalSearchUrl({
        site: "ancestry",
        attributes: { givenName: "Patrick", surname: "Flynn", birthYear: "0x733" as any },
      });
      expect(hex.ok).toBe(true);
      if (!hex.ok) return;
      expect(hex.url).not.toContain("birth=");
      expect(hex.notes.some((n) => /'birthYear' was supplied but is not a valid year/.test(n))).toBe(true);
    });

    it("rejects a non-negative-integer birthYearOffset/placeProximityMiles rather than sharing the year bound", () => {
      const r = buildExternalSearchUrl({
        site: "findmypast",
        attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845, birthYearOffset: 9999, placeProximityMiles: -5 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).not.toContain("yearofbirth_offset=");
      expect(r.url).not.toContain("keywordsplace_proximity=");
    });

    it("accepts a valid birthYearOffset/placeProximityMiles", () => {
      const r = buildExternalSearchUrl({
        site: "findmypast",
        attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845, birthYearOffset: 3, birthPlace: "Ireland", placeProximityMiles: 10 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // Each knob rides only with its slot: the offset with yearofbirth, the
      // radius with keywordsplace.
      expect(r.url).toContain("yearofbirth_offset=3");
      expect(r.url).toContain("keywordsplace=Ireland");
      expect(r.url).toContain("keywordsplace_proximity=10");
    });
  });

  describe("baseUrl format validation (review finding, 2026-09-13)", () => {
    it("rejects a baseUrl that is not a URL at all", () => {
      const r = buildExternalSearchUrl({
        site: "digital_newspaper_archive",
        baseUrl: "Utah Digital Newspapers",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("invalid_base_url");
    });

    it("rejects a javascript: baseUrl", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "javascript:alert(1)",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("invalid_base_url");
    });

    it("rejects a data: baseUrl", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "data:text/html,<b>x</b>",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("invalid_base_url");
    });

    it("still accepts a real https baseUrl", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        baseUrl: "https://www.ancestry.com/search/collections/8054/",
        attributes: { givenName: "Patrick", surname: "Flynn" },
      });
      expect(r.ok).toBe(true);
    });
  });

  describe("SUPPORTED_SITES reference safety (review finding, 2026-09-13)", () => {
    it("mutating a returned supportedSites array does not affect a later call", () => {
      const first = buildExternalSearchUrl({
        site: "not-a-real-site",
        attributes: { givenName: "Patrick" },
      });
      expect(first.ok).toBe(false);
      if (first.ok || first.reason !== "unsupported_site") throw new Error("expected unsupported_site");
      first.supportedSites.push("hacked-in-site");

      const second = buildExternalSearchUrl({
        site: "not-a-real-site",
        attributes: { givenName: "Patrick" },
      });
      expect(second.ok).toBe(false);
      if (second.ok || second.reason !== "unsupported_site") throw new Error("expected unsupported_site");
      expect(second.supportedSites).not.toContain("hacked-in-site");
      expect(buildExternalSearchUrlSchema.inputSchema.properties.site.enum).not.toContain("hacked-in-site");
    });
  });
});
