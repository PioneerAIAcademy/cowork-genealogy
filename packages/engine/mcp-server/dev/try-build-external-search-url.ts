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
    label: "newspapers.com, obituary-style (generic year/place)",
    input: {
      site: "newspapers",
      attributes: { givenName: "Patrick", surname: "Flynn", searchYear: 1908, searchPlace: "Schuylkill County" },
    },
  },
  {
    label: "chronicling_america, dates=YYYY/YYYY correction",
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
    label: "digital_newspaper_archive, WITH baseUrl (required)",
    input: {
      site: "digital_newspaper_archive",
      baseUrl: "https://newspapers.lib.utah.edu/search",
      attributes: { givenName: "Patrick", surname: "Flynn" },
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
