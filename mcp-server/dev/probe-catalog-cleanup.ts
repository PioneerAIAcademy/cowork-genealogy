/**
 * Probe 9 — Cleanup tests to firm up four tentative findings.
 *
 *   A. q.author_surname_text=Smith — does the param work with a common
 *      surname, or is it actually broken? Probe 4 only tested "Griffin"
 *      and got 0 hits.
 *
 *   B. q.format_facet=Microfilm 35mm — probe 7 found "Microfilm" alone
 *      returns 0; the detail probe showed the real facet string is
 *      "Microfilm 35mm". Does the exact string work?
 *
 *   C. Detail endpoint with an olib: ID (olib:1932139 — the Alabama
 *      Civil War service records from probe 7). Probe 2 only tested
 *      the koha: prefix; we asserted "detail accepts either" without
 *      verifying.
 *
 *   D. c.topic1=on after f.topic0=Military — learn the real drill-down
 *      child values so q.topic1 can be documented properly.
 *
 *   npx tsx dev/probe-catalog-cleanup.ts
 */

import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const BASE = "https://www.familysearch.org/service/search/catalog/v3/search";

interface Hit {
  metadataHit?: {
    metadata?: {
      title?: Array<{ value?: string }>;
      identifier?: { value?: string };
    };
  };
}

interface FacetEntry {
  count?: number;
  displayName?: string;
  facets?: FacetEntry[];
  params?: string;
}

interface SearchResponse {
  totalHits?: number;
  searchHits?: Hit[];
  facets?: FacetEntry[];
}

async function fetchJson(token: string, url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });
  if (!res.ok) {
    return { __err: `HTTP ${res.status} ${res.statusText}`, __body: (await res.text()).slice(0, 300) };
  }
  return res.json();
}

function describeTop(data: SearchResponse): string {
  const first = data.searchHits?.[0]?.metadataHit?.metadata;
  const title = first?.title?.[0]?.value?.slice(0, 70) ?? "(no title)";
  const id = first?.identifier?.value?.split("/").pop() ?? "(no id)";
  return `top: id=${id} "${title}"`;
}

async function main(): Promise<void> {
  const token = await getValidToken();

  // ----- TEST A: q.author_surname_text with common surname -----
  console.log("================================================================");
  console.log("A. q.author_surname_text=Smith (common surname — settles broken?)");
  console.log("================================================================");
  for (const name of ["Smith", "Jones", "Williams"]) {
    const url =
      `${BASE}?m.queryRequireDefault=on&m.defaultFacets=off` +
      `&q.author_surname_text=${encodeURIComponent(name)}`;
    const data = (await fetchJson(token, url)) as SearchResponse;
    if ("__err" in data) {
      console.log(`  q.author_surname_text=${name}: ${(data as { __err: string }).__err}`);
      continue;
    }
    console.log(`  q.author_surname_text=${name}: totalHits=${data.totalHits ?? 0}`);
    if ((data.totalHits ?? 0) > 0) {
      console.log(`    ${describeTop(data)}`);
    }
  }

  // ----- TEST B: q.format_facet with exact facet string -----
  console.log("\n================================================================");
  console.log("B. q.format_facet with the exact facet-emitted string");
  console.log("================================================================");
  for (const fmt of ["Microfilm 35mm", "Microfilm", "Book", "Periodical", "Manuscript"]) {
    const url =
      `${BASE}?m.queryRequireDefault=on&m.defaultFacets=off` +
      `&q.place=${encodeURIComponent("Alabama, United States")}&q.place.exact=on` +
      `&q.format_facet=${encodeURIComponent(fmt)}`;
    const data = (await fetchJson(token, url)) as SearchResponse;
    if ("__err" in data) {
      console.log(`  q.format_facet="${fmt}": ${(data as { __err: string }).__err}`);
      continue;
    }
    console.log(`  q.format_facet="${fmt}" (+Alabama): totalHits=${data.totalHits ?? 0}`);
    if ((data.totalHits ?? 0) > 0) {
      console.log(`    ${describeTop(data)}`);
    }
  }

  // Also enumerate format facet values with c.format_facet=on
  console.log("\n  --- enumerate via c.format_facet=on (Alabama scope) ---");
  const facetUrl =
    `${BASE}?m.queryRequireDefault=on&m.defaultFacets=off` +
    `&q.place=${encodeURIComponent("Alabama, United States")}&q.place.exact=on` +
    `&c.format_facet=on`;
  const facetData = (await fetchJson(token, facetUrl)) as SearchResponse;
  const formatFacet = facetData.facets?.find((f) => f.displayName === "Format");
  if (formatFacet?.facets) {
    for (const entry of formatFacet.facets) {
      console.log(`    "${entry.displayName}" — count=${entry.count}`);
    }
  } else {
    console.log(`    (no Format facet returned — top-level: ${JSON.stringify(facetData.facets).slice(0, 200)})`);
  }

  // ----- TEST C: detail endpoint with olib: prefix -----
  console.log("\n================================================================");
  console.log("C. Detail endpoint with olib: prefix");
  console.log("================================================================");
  for (const id of ["olib:1932139", "1932139", "olib:1661470"]) {
    const url = `https://www.familysearch.org/service/search/catalog/item/${encodeURIComponent(id)}`;
    const data = await fetchJson(token, url);
    if (typeof data === "object" && data !== null && "__err" in data) {
      console.log(`  ${id}: ${(data as { __err: string }).__err}`);
      continue;
    }
    const source = (data as { source?: Record<string, unknown> }).source;
    if (!source) {
      console.log(`  ${id}: (no source — keys: ${Object.keys(data as object).join(", ")})`);
      continue;
    }
    const title = source.title ?? source.display_title ?? "(no title)";
    const format = source.format ?? "(no format)";
    const keyCount = Object.keys(source).length;
    console.log(`  ${id}: format=${JSON.stringify(format)} title=${JSON.stringify(title).slice(0, 80)} (source has ${keyCount} fields)`);
  }

  // ----- TEST D: c.topic1=on after f.topic0=Military -----
  console.log("\n================================================================");
  console.log("D. c.topic1=on with f.topic0=Military — learn drill-down values");
  console.log("================================================================");
  const drillUrl =
    `${BASE}?m.queryRequireDefault=on&m.defaultFacets=off` +
    `&q.place=${encodeURIComponent("Alabama, United States")}&q.place.exact=on` +
    `&f.topic0=Military` +
    `&c.topic1=on`;
  const drillData = (await fetchJson(token, drillUrl)) as SearchResponse;
  if ("__err" in drillData) {
    console.log(`  ${(drillData as { __err: string }).__err}`);
  } else {
    console.log(`  totalHits=${drillData.totalHits ?? 0}`);
    const topicFacet = drillData.facets?.[0];
    if (topicFacet?.facets) {
      console.log(`  ${topicFacet.facets.length} topic1 values:`);
      for (const entry of topicFacet.facets) {
        console.log(`    "${entry.displayName}" — count=${entry.count}`);
      }
    } else {
      console.log(`  (no facets returned — raw: ${JSON.stringify(drillData.facets).slice(0, 300)})`);
    }
  }

  // Now actually USE one of those drill-down values to verify q.topic1
  console.log(`\n  --- verify q.topic1=<first drilled value> filters as expected ---`);
  const topicFacet = (drillData as SearchResponse).facets?.[0];
  const firstChild = topicFacet?.facets?.[0]?.displayName;
  if (firstChild) {
    const verifyUrl =
      `${BASE}?m.queryRequireDefault=on&m.defaultFacets=off` +
      `&q.place=${encodeURIComponent("Alabama, United States")}&q.place.exact=on` +
      `&q.topic0=Military` +
      `&q.topic1=${encodeURIComponent(firstChild)}`;
    const verifyData = (await fetchJson(token, verifyUrl)) as SearchResponse;
    console.log(`  q.topic0=Military & q.topic1="${firstChild}": totalHits=${verifyData.totalHits ?? 0}`);
    if ((verifyData.totalHits ?? 0) > 0) {
      console.log(`    ${describeTop(verifyData)}`);
    }
  } else {
    console.log(`  (no child value to verify — skipping)`);
  }

  console.log("\n================================================================");
  console.log("DONE");
  console.log("================================================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
