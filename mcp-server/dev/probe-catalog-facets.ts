/**
 * Probe 5 — Catalog facets and groupBy.
 *
 * The wiki page describes two unique catalog features:
 *
 *   1. `m.defaultFacets=on` — enables Year, Category, Availability,
 *      Language and Format facets in the response.
 *
 *   2. Granular `c.*` count terms — drill-down facets like c.year0,
 *      c.year1, c.topic0..c.topic5, c.format_facet, c.subject_facet,
 *      c.author_facet, c.availability.
 *
 *   3. `groupBy` — restructures output so instead of individual
 *      records, you get a count per facet value.
 *      Supported: groupBy=author, groupBy=subject, groupBy=placeSubject.
 *
 * This probe runs one query per facet/groupBy variant and reports
 * the relevant slice of the response (full `facets` block for
 * faceted queries, raw body for groupBy).
 *
 *   npx tsx dev/probe-catalog-facets.ts
 */

import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const BASE_URL =
  "https://www.familysearch.org/service/search/catalog/v3/search";

interface Probe {
  label: string;
  params: Record<string, string>;
  showRaw: boolean;
}

const PROBES: Probe[] = [
  {
    label: "5A. m.defaultFacets=on with q.place=Alabama",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "on",
    },
    showRaw: false,
  },
  {
    label: "5B. c.format_facet=on (format breakdown for Alabama)",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
      "c.format_facet": "on",
    },
    showRaw: false,
  },
  {
    label: "5C. c.availability=on (Available/Restricted breakdown)",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
      "c.availability": "on",
    },
    showRaw: false,
  },
  {
    label: "5D. c.subject_facet=on",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
      "c.subject_facet": "on",
    },
    showRaw: false,
  },
  {
    label: "5E. c.year0=on (hierarchical year — top level)",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
      "c.year0": "on",
    },
    showRaw: false,
  },
  {
    label: "5F. c.topic0=on (hierarchical topic — top level)",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
      "c.topic0": "on",
    },
    showRaw: false,
  },
  {
    label: "5G. groupBy=author with q.author=Smith",
    params: {
      "q.author": "Smith",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
      "groupBy": "author",
    },
    showRaw: true,
  },
  {
    label: "5H. groupBy=subject with q.subject=DNA",
    params: {
      "q.subject": "DNA",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
      "groupBy": "subject",
    },
    showRaw: true,
  },
  {
    label: "5I. groupBy=placeSubject with q.place=Alabama",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
      "groupBy": "placeSubject",
    },
    showRaw: true,
  },
];

function buildUrl(params: Record<string, string>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) sp.set(k, v);
  return `${BASE_URL}?${sp.toString()}`;
}

async function run(token: string, probe: Probe): Promise<void> {
  const url = buildUrl(probe.params);
  console.log(`\n--- [${probe.label}] ---`);
  console.log(`URL: ${url}`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });

  console.log(`HTTP ${res.status} ${res.statusText}`);
  if (!res.ok) {
    console.log(`Body: ${(await res.text()).slice(0, 400)}`);
    return;
  }

  const data = (await res.json()) as Record<string, unknown>;
  console.log(`totalHits: ${data.totalHits}`);
  console.log(`searchHits.length: ${Array.isArray(data.searchHits) ? data.searchHits.length : 0}`);
  console.log(`facets:`);
  console.log(JSON.stringify(data.facets, null, 2));

  if (probe.showRaw) {
    console.log(`\nFull response (first 4000c):`);
    console.log(JSON.stringify(data, null, 2).slice(0, 4000));
  }
}

async function main(): Promise<void> {
  const token = await getValidToken();
  for (const p of PROBES) {
    await run(token, p);
  }
  console.log("\n================================================================");
  console.log("DONE");
  console.log("================================================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
