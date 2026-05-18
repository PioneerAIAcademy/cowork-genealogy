/**
 * Probe 4 — Catalog search query-parameter matrix.
 *
 * Tests which `q.*` and `f.*` parameters from the FS internal
 * Atlassian page actually work against /service/search/catalog/v3/search,
 * and reports `totalHits` + top hit's title/format for each.
 *
 * For each query we print:
 *   - the params we sent
 *   - HTTP status
 *   - totalHits
 *   - searchHits[0].metadataHit.metadata.{title[0].value, format?}
 *
 * If a param is unrecognized, FS usually returns 200 with the same
 * (broader) result set as omitting it — so we cross-check by comparing
 * totalHits against a baseline. The baseline query (Alabama, exact) was
 * 894 in probe 1.
 *
 *   npx tsx dev/probe-catalog-params.ts
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
  // Baseline — no params (returns everything)
  {
    label: "BASELINE — no query (catalog-wide)",
    params: { "m.defaultFacets": "off", "m.queryRequireDefault": "on" },
  },
  // q.title — search by title (use "marriage")
  {
    label: "q.title=marriage",
    params: { "q.title": "marriage", "m.defaultFacets": "off", "m.queryRequireDefault": "on" },
  },
  // q.surname — search by surname
  {
    label: "q.surname=Flynn",
    params: { "q.surname": "Flynn", "m.defaultFacets": "off", "m.queryRequireDefault": "on" },
  },
  // q.author — author search
  {
    label: "q.author=Griffin",
    params: { "q.author": "Griffin", "m.defaultFacets": "off", "m.queryRequireDefault": "on" },
  },
  {
    label: "q.author_surname_text=Griffin",
    params: { "q.author_surname_text": "Griffin", "m.defaultFacets": "off", "m.queryRequireDefault": "on" },
  },
  // q.subject — subject search
  {
    label: "q.subject=DNA",
    params: { "q.subject": "DNA", "m.defaultFacets": "off", "m.queryRequireDefault": "on" },
  },
  // q.year — single year
  {
    label: "q.year=1880",
    params: { "q.year": "1880", "m.defaultFacets": "off", "m.queryRequireDefault": "on" },
  },
  // q.year0 / q.year1 — year range
  {
    label: "q.year0=1850&q.year1=1860 (range)",
    params: { "q.year0": "1850", "q.year1": "1860", "m.defaultFacets": "off", "m.queryRequireDefault": "on" },
  },
  // q.place — exact match (we know baseline)
  {
    label: "q.place=Alabama (exact)",
    params: {
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "m.defaultFacets": "off", "m.queryRequireDefault": "on",
    },
  },
  // q.place_id — internal id (probably different from Places API)
  {
    label: "q.place_id=33 (collections API Alabama id — may not match catalog)",
    params: { "q.place_id": "33", "m.defaultFacets": "off", "m.queryRequireDefault": "on" },
  },
  // q.film_number — DGS
  {
    label: "q.film_number=004001998",
    params: { "q.film_number": "004001998", "m.defaultFacets": "off", "m.queryRequireDefault": "on" },
  },
  // q.keywords — general keyword search
  {
    label: "q.keywords=Alabama",
    params: { "q.keywords": "Alabama", "m.defaultFacets": "off", "m.queryRequireDefault": "on" },
  },
  // q.isn — ISBN/ISSN
  {
    label: "q.isn=9780786430789 (the book from probe 2)",
    params: { "q.isn": "9780786430789", "m.defaultFacets": "off", "m.queryRequireDefault": "on" },
  },
  // q.oclc_id
  {
    label: "q.oclc_id=181368793 (book from probe 2)",
    params: { "q.oclc_id": "181368793", "m.defaultFacets": "off", "m.queryRequireDefault": "on" },
  },
  // q.title with require modifier
  {
    label: "q.title=marriage with q.title.require=on",
    params: {
      "q.title": "marriage",
      "q.title.require": "on",
      "m.defaultFacets": "off", "m.queryRequireDefault": "on",
    },
  },
  // f.surname — filter form (strict)
  {
    label: "f.surname=Flynn (filter form)",
    params: { "f.surname": "Flynn", "m.defaultFacets": "off", "m.queryRequireDefault": "on" },
  },
  // Combined: q.title + q.place
  {
    label: "q.title=marriage AND q.place=Alabama",
    params: {
      "q.title": "marriage",
      "q.place": "Alabama, United States",
      "q.place.exact": "on",
      "m.defaultFacets": "off", "m.queryRequireDefault": "on",
    },
  },
];

interface SearchHit {
  metadataHit?: {
    metadata?: {
      title?: Array<{ value?: string }>;
      format?: string;
      creator?: string[];
      identifier?: { value?: string };
    };
    score?: number;
  };
}

interface SearchResponse {
  searchHits?: SearchHit[];
  totalHits?: number;
  offset?: number;
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

  let data: SearchResponse;
  try {
    data = (await res.json()) as SearchResponse;
  } catch {
    console.log(`[${q.label}] HTTP ${status} — non-JSON`);
    return;
  }

  const total = data.totalHits ?? 0;
  const first = data.searchHits?.[0]?.metadataHit?.metadata;
  const title = first?.title?.[0]?.value?.slice(0, 80) ?? "(no title)";
  const format = first?.format ?? "(no format)";
  const id = first?.identifier?.value?.split("/").pop() ?? "(no id)";

  console.log(`[${q.label}]`);
  console.log(`  HTTP ${status}  totalHits=${total}`);
  console.log(`  top: format=${format}  id=${id}`);
  console.log(`        title="${title}"`);
}

async function main(): Promise<void> {
  const token = await getValidToken();
  console.log(`Running ${QUERIES.length} query-param probes...\n`);

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
