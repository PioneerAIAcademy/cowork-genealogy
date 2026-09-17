/**
 * One-shot smoke test for the build_external_search_url tool. Pure
 * computation, no network, no login — runs every supported site plus the
 * baseUrl-append and unsupported-site branches in one pass. A battery of
 * fixed cases rather than a single argv-driven case: the input is a nested
 * {site, baseUrl, attributes} object, which doesn't fit a scalar CLI arg.
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx dev/try-build-external-search-url.ts
 */
import { buildExternalSearchUrl } from "../src/tools/build-external-search-url.js";

const cases: Array<{ label: string; input: Parameters<typeof buildExternalSearchUrl>[0] }> = [
  {
    label: "ancestry, site-wide",
    input: {
      site: "ancestry",
      attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845, birthPlace: "Ireland" },
    },
  },
  {
    label: "ancestry, Case A (baseUrl with existing query string + sid to strip)",
    input: {
      site: "ancestry",
      baseUrl: "https://www.ancestry.com/search/collections/8054/?collection=8054&sid=abc123",
      attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845, birthPlace: "Ireland" },
    },
  },
  {
    label: "myheritage, site-wide",
    input: {
      site: "myheritage",
      attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845, birthPlace: "Ireland" },
    },
  },
  {
    label: "findmypast, site-wide with tuning knobs",
    input: {
      site: "findmypast",
      attributes: {
        givenName: "Patrick",
        surname: "Flynn",
        birthYear: 1845,
        birthYearOffset: 3,
        birthPlace: "Ireland",
        placeProximityMiles: 10,
      },
    },
  },
  {
    label: "findmypast, no year at all (expect a note)",
    input: {
      site: "findmypast",
      attributes: { givenName: "Patrick", surname: "Flynn", birthPlace: "Ireland" },
    },
  },
  {
    label: "findagrave, site-wide (location from deathPlace)",
    input: {
      site: "findagrave",
      attributes: { givenName: "Patrick", surname: "Flynn", deathYear: 1908, deathPlace: "Pennsylvania" },
    },
  },
  {
    label: "newspapers.com, obituary-style (searchYear as a plain year + keywords)",
    input: {
      site: "newspapers",
      attributes: {
        givenName: "Patrick",
        surname: "Flynn",
        searchYear: "1908",
        searchPlace: "Schuylkill County",
        keywords: "obituary",
      },
    },
  },
  {
    label: "newspapers.com, searchYear as a range (no exact year known)",
    input: {
      site: "newspapers",
      attributes: { givenName: "Patrick", surname: "Flynn", searchYear: "1880-1905" },
    },
  },
  {
    label: "chronicling_america, q (not qs) + dates=YYYY/YYYY correction",
    input: {
      site: "chronicling_america",
      attributes: {
        givenName: "Patrick",
        surname: "Flynn",
        searchStartYear: 1900,
        searchEndYear: 1910,
        usState: "Pennsylvania",
      },
    },
  },
  {
    label: "chronicling_america, curated baseUrl still gets the required dl=page fixed param",
    input: {
      site: "chronicling_america",
      baseUrl: "https://www.loc.gov/collections/chronicling-america/?fa=partof:pennsylvania",
      attributes: { givenName: "Patrick", surname: "Flynn" },
    },
  },
  {
    label: "chronicling_america, an attribute the site doesn't read (expect a note, not silence)",
    input: {
      site: "chronicling_america",
      attributes: { givenName: "Patrick", surname: "Flynn", deathYear: 1908 },
    },
  },
  {
    label: "digital_newspaper_archive, WITH baseUrl (required) + keywords",
    input: {
      site: "digital_newspaper_archive",
      baseUrl: "https://newspapers.lib.utah.edu/search",
      attributes: { givenName: "Patrick", surname: "Flynn", keywords: "obituary" },
    },
  },
  {
    label: "digital_newspaper_archive, WITHOUT baseUrl (expect base_url_required)",
    input: {
      site: "digital_newspaper_archive",
      attributes: { givenName: "Patrick", surname: "Flynn" },
    },
  },
  {
    label: "baseUrl with a #fragment (query must land before it, not after)",
    input: {
      site: "ancestry",
      baseUrl: "https://www.ancestry.com/search/collections/8054/#facets",
      attributes: { givenName: "Patrick", surname: "Flynn" },
    },
  },
  {
    label: "empty-string and non-finite attributes (expect them treated as absent, not '' / NaN in the URL)",
    input: {
      site: "ancestry",
      attributes: { givenName: "Patrick", surname: "Flynn", birthPlace: "", birthYear: NaN },
    },
  },
  {
    label: "ancestry, locale: uk (ancestry.co.uk instead of .com)",
    input: {
      site: "ancestry",
      locale: "uk",
      attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845 },
    },
  },
  {
    label: "archives_gov, name-authority search (personOrOrg, not q)",
    input: {
      site: "archives_gov",
      attributes: { givenName: "Patrick", surname: "Flynn", birthPlace: "Pennsylvania" },
    },
  },
  {
    label: "archive_org, keyword-only (no structured date/place fields)",
    input: {
      site: "archive_org",
      attributes: { givenName: "Patrick", surname: "Flynn", keywords: "genealogy" },
    },
  },
  {
    label: "billiongraves, cemetery search (no place field on this site)",
    input: {
      site: "billiongraves",
      attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845, deathYear: 1908 },
    },
  },
  {
    label: "digitalarkivet, birth-year range + domicile (residencePlace)",
    input: {
      site: "digitalarkivet",
      attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845, residencePlace: "Oslo" },
    },
  },
  {
    label: "antenati, one year field falling back from birthYear to deathYear",
    input: {
      site: "antenati",
      attributes: { givenName: "Giovanni", surname: "Strada", deathYear: 1900, deathPlace: "Milano" },
    },
  },
  {
    label: "library_archives_canada, census search (no coded ProvinceCode/GenderCode)",
    input: {
      site: "library_archives_canada",
      attributes: { givenName: "Patrick", surname: "Flynn", birthYear: 1845 },
    },
  },
  {
    label: "american_ancestors, Keywords carries the name (Name.First/Name.Last don't bind)",
    input: {
      site: "american_ancestors",
      attributes: { givenName: "Patrick", surname: "Flynn", birthPlace: "Ireland" },
    },
  },
  {
    label: "italian_genealogy, forum keyword search only",
    input: {
      site: "italian_genealogy",
      attributes: { givenName: "Patrick", surname: "Flynn" },
    },
  },
  {
    label: "unsupported site (expect unsupported_site + supportedSites)",
    input: {
      site: "wiewaswie",
      attributes: { givenName: "Patrick", surname: "Flynn" },
    },
  },
  {
    label: "no_attributes (expect rejection, not a bare site URL)",
    input: {
      site: "ancestry",
      attributes: {},
    },
  },
];

for (const { label, input } of cases) {
  console.log(`\n=== ${label} ===`);
  console.log("Input:", JSON.stringify(input));
  const result = buildExternalSearchUrl(input);
  console.log("Result:", JSON.stringify(result, null, 2));
}
