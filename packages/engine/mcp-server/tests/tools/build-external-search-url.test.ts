import { describe, it, expect } from "vitest";
import { buildExternalSearchUrl } from "../../src/tools/build-external-search-url.js";

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
          "&residence=1870_Schuylkill%20County%2C%20Pennsylvania&father=Michael_Flynn",
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

    it("findagrave: firstname/lastname/birthyear/deathyear/location (from deathPlace)", () => {
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
      expect(r.url).toBe(
        "https://www.findagrave.com/memorial/search?firstname=Patrick&lastname=Flynn&deathyear=1908&location=Pennsylvania",
      );
    });

    it("newspapers: query is plus-joined, dr_year/dr_place are generic", () => {
      const r = buildExternalSearchUrl({
        site: "newspapers",
        attributes: { givenName: "Patrick", surname: "Flynn", searchYear: 1908, searchPlace: "Schuylkill County" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(
        "https://www.newspapers.com/search/?query=Patrick%2BFlynn&dr_year=1908&dr_place=Schuylkill%20County",
      );
    });

    it("chronicling_america: qs plus-joined, dates=YYYY/YYYY, location_state lowercased, dl=page fixed", () => {
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
        "https://www.loc.gov/collections/chronicling-america/?dl=page&qs=Patrick%2BFlynn&dates=1900%2F1910&location_state=pennsylvania",
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
      expect(r.url).toBe("https://newspapers.lib.utah.edu/search?q=Patrick%2BFlynn");
    });
  });

  describe("Chronicling America correction (issue #1980)", () => {
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
      expect(r.url).toBe("https://newspapers.lib.utah.edu/search?q=Patrick%2BFlynn");
    });
  });

  describe("unsupported site", () => {
    it("names exactly the seven supported sites", () => {
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
        ].sort(),
      );
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
  });

  describe("relative names, partial", () => {
    it("joins from whichever half of a relative's name is present", () => {
      const r = buildExternalSearchUrl({
        site: "ancestry",
        attributes: { givenName: "Patrick", surname: "Flynn", fatherGivenName: "Michael" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toMatch(/father=Michael(&|$)/);
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
});
