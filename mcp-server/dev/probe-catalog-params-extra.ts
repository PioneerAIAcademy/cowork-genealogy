/**
 * Probe 7 — Five high-value catalog params not covered by probe 4.
 *
 * Closes the meaningful gap from the wiki-page param list:
 *
 *   1. q.topic0..q.topic5  (hierarchical genealogy categories — e.g.
 *      "Birth, Marriage and Death", "Military", "Census, Taxation,
 *      and Voter Lists"). Facet probe 5A showed these as valid topic0
 *      values; testing whether q.topic0=<value> filters as expected.
 *
 *   2. q.format_facet — filter by Book / Microfilm / Manuscript / etc.
 *
 *   3. q.availability — filter by holding library (Online,
 *      FamilySearch Library, on-site center, etc.).
 *
 *   4. q.place_ancestors — likely the real hierarchical place filter
 *      (vs. the broken q.place_id system).
 *
 *   5. q.inclusive_dates — direct date-coverage filter; could replace
 *      the broken q.year0/q.year1 range form.
 *
 * Every query sets m.queryRequireDefault=on (the mandatory flag from
 * probe 4) and uses the Alabama baseline (894 hits) when narrowing,
 * so the effect of each new filter is visible.
 *
 *   npx tsx dev/probe-catalog-params-extra.ts
 */

import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const BASE_URL =
  "https://www.familysearch.org/service/search/catalog/v3/search";

interface Query {
  label: string;
  params: Record<string, string>;
}

const QUERIES: Query[] = [
  // Sanity baseline — Alabama (894 hits, verified in probe 1)
  {
    label: "BASELINE — q.place=Alabama (exact) — should be 894",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },

  // ----- 1. q.topic0..q.topic5 (hierarchical genealogy categories) -----
  {
    label: "1a. q.topic0=Military (Alabama narrowed) — facet showed 11",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "q.topic0": "Military",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },
  {
    label: "1b. q.topic0=Birth, Marriage and Death (Alabama) — facet showed 11",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "q.topic0": "Birth, Marriage and Death",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },
  {
    label: "1c. q.topic0=Census, Taxation, and Voter Lists (Alabama) — facet showed 4",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "q.topic0": "Census, Taxation, and Voter Lists",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },
  {
    label: "1d. q.topic1=Vital Records (drill-down — needs topic0 first?)",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "q.topic0": "Birth, Marriage and Death",
      "q.topic1": "Vital Records",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },
  {
    label: "1e. f.topic0=Military (filter form instead of q.) — Alabama",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "f.topic0": "Military",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },

  // ----- 2. q.format_facet -----
  {
    label: "2a. q.format_facet=Book (Alabama)",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "q.format_facet": "Book",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },
  {
    label: "2b. q.format_facet=Microfilm (Alabama)",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "q.format_facet": "Microfilm",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },
  {
    label: "2c. f.format_facet=Book (filter form)",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "f.format_facet": "Book",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },

  // ----- 3. q.availability -----
  {
    label: "3a. q.availability=Online (Alabama)",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "q.availability": "Online",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },
  {
    label: "3b. q.availability=FamilySearch Library (Alabama)",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "q.availability": "FamilySearch Library",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },
  {
    label: "3c. f.availability=Online (filter form)",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "f.availability": "Online",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },

  // ----- 4. q.place_ancestors (hierarchical place filter) -----
  {
    label: "4a. q.place_ancestors=United States",
    params: {
      "q.place_ancestors": "United States",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },
  {
    label: "4b. q.place_ancestors=Alabama, United States",
    params: {
      "q.place_ancestors": "Alabama, United States",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },
  {
    label: "4c. q.place_ancestors with a path (US -> Alabama -> Mobile County)",
    params: {
      "q.place_ancestors": "Mobile County, Alabama, United States",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },

  // ----- 5. q.inclusive_dates -----
  {
    label: "5a. q.inclusive_dates=1861-1865 (the book from probe 2)",
    params: {
      "q.inclusive_dates": "1861-1865",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },
  {
    label: "5b. q.inclusive_dates=1880 (single year)",
    params: {
      "q.inclusive_dates": "1880",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },
  {
    label: "5c. q.inclusive_dates=1850-1900 + Alabama",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "q.inclusive_dates": "1850-1900",
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    },
  },
];

interface SearchHit {
  metadataHit?: {
    metadata?: {
      title?: Array<{ value?: string }>;
      creator?: string[];
      identifier?: { value?: string };
    };
  };
}

interface SearchResponse {
  searchHits?: SearchHit[];
  totalHits?: number;
}

function buildUrl(params: Record<string, string>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) sp.set(k, v);
  return `${BASE_URL}?${sp.toString()}`;
}

async function runQuery(token: string, q: Query): Promise<void> {
  const url = buildUrl(q.params);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": BROWSER_USER_AGENT,
      },
    });
  } catch (err) {
    console.log(`[${q.label}] FETCH ERROR: ${(err as Error).message}`);
    return;
  }

  const status = `${res.status} ${res.statusText}`;
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    console.log(`[${q.label}] HTTP ${status} — ${body}`);
    return;
  }

  const data = (await res.json()) as SearchResponse;
  const total = data.totalHits ?? 0;
  const first = data.searchHits?.[0]?.metadataHit?.metadata;
  const title = first?.title?.[0]?.value?.slice(0, 80) ?? "(no title)";
  const id = first?.identifier?.value?.split("/").pop() ?? "(no id)";

  console.log(`[${q.label}]`);
  console.log(`  HTTP ${status}  totalHits=${total}`);
  console.log(`  top: id=${id}  title="${title}"`);
}

async function main(): Promise<void> {
  const token = await getValidToken();
  console.log(`Running ${QUERIES.length} extra-param probes...\n`);

  for (const q of QUERIES) {
    await runQuery(token, q);
    console.log();
  }

  console.log("================================================================");
  console.log("DONE");
  console.log("================================================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
