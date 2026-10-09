/**
 * Probe — evidence trail behind `tree_gaps` (issue #3273).
 *
 * Nothing in the repo calls `/platform/tree/descendancy`. This script measures
 * what the spec needs before it fixes a design:
 *
 *   A. How many generations does descendancy accept (400 at which N)?
 *   B. Do its persons carry `display` vitals (birth/marriage/death date and
 *      place, `living`)? Same question for ancestry with personDetails=true.
 *   C. Wall-clock per call, by generation count.
 *   D. Does ancestry's generations cap (8) hold, and what is the size/time at 8?
 *   E. Which ascendancy / descendancy numbers come back, and is the
 *      response a flat persons[] plus relationships[]?
 *   F. Does `collections` searchMetadata carry placeIds / typeFacet, so
 *      coverage can be scored from the catalog `collections_search` already
 *      caches (no new endpoint)?
 *
 * Requires a valid session (npx tsx dev/e2e-login.ts or the login tool).
 *
 * Usage:
 *   cd packages/engine/mcp-server
 *   npx tsx dev/probe-descendancy.ts [PID]      # default: logged-in user
 *
 * The spec cites the MEASURED block below.
 * MEASURED (2026-10-09, two roots: the logged-in user KWYN-PZG, small tree, and
 * LZJW-C31, large tree; in-progress, see the spec for the final record):
 *   A. descendancy: generations <= 4. 5 returns 400 "readDescendancy.generations:
 *      must be less than or equal to 4". Ancestry: <= 8, 9 returns 400.
 *   B. Persons carry `display` {name, gender, lifespan, ascendancyNumber,
 *      descendancyNumber} plus a top-level `living` boolean on every person.
 *      birthDate/birthPlace appear in `display` ONLY with personDetails=true
 *      (14 of 14 vs 0 of 14). Spouses carry an "-S" suffix on the number.
 *      relationships[] is empty unless marriageDetails=true (9 for 14 persons).
 *   C. Latency: descendancy 0.26-0.36s at any generation count (1.2s cold);
 *      ancestry g=8 personDetails+marriageDetails: 144 persons in 1.56s,
 *      g=6: 58 persons in 0.86s, g=4: 20 persons in 0.4s. One 8-generation
 *      ancestry call fits the 60s MCP window many times over.
 *   F. collections catalog (already cached by collections_search): all 3622
 *      entries carry searchMetadata.placeIds, typeFacet (VITAL, CENSUS,
 *      CHURCH_RECORD, MILITARY, ...), startYear/endYear, region, recordCount.
 *      So the lead's collection filter (recordType + placeId + dateRange) can
 *      be applied to the cached catalog with no new endpoint.
 *   G. (re-run after a network drop, LZJW-C31 g=3 personDetails+marriageDetails)
 *      display carries birthDate/birthPlace, deathDate/deathPlace and
 *      marriageDate (absent when unknown). Children are keyed by descendancyNumber:
 *      "1.1.3" is the third child of "1.1"; a spouse is "<n>-S<k>" (several
 *      spouses: -S1, -S2, -S3). Parentage is therefore derived from the number,
 *      not from relationships[].
 *      relationships[] is Couple only (17 for 22 persons), and an endpoint can
 *      name a person absent from persons[] (e.g. G5SL-BQ7) — guard before use.
 *
 */
import { LOCAL } from "../src/auth/principal.js";
import { fsFetch } from "../src/utils/fs-fetch.js";
import { getValidToken } from "../src/auth/refresh.js";
import { fetchAllCollections } from "../src/tools/collections-search.js";

const BASE = "https://api.familysearch.org/platform";
const ACCEPT = "application/x-fs-v1+json";

interface Timed {
  status: number;
  ms: number;
  body: any;
}

async function get(path: string): Promise<Timed> {
  const t0 = Date.now();
  const res = await fsFetch(LOCAL, `${BASE}${path}`, {
    headers: { Accept: ACCEPT },
  });
  const ms = Date.now() - t0;
  let body: any = null;
  if (res.status !== 204) {
    try {
      body = await res.json();
    } catch {
      body = null;
    }
  }
  return { status: res.status, ms, body };
}

function summarize(label: string, r: Timed): void {
  const persons = r.body?.persons ?? [];
  const rels = r.body?.relationships ?? [];
  const withDisplay = persons.filter((p: any) => p.display).length;
  const withBirth = persons.filter((p: any) => p.display?.birthDate).length;
  const withLiving = persons.filter(
    (p: any) => typeof p.living === "boolean",
  ).length;
  console.log(
    `${label}: HTTP ${r.status} ${r.ms}ms persons=${persons.length} ` +
      `relationships=${rels.length} display=${withDisplay} ` +
      `display.birthDate=${withBirth} living-flag=${withLiving}`,
  );
}

async function main(): Promise<void> {
  let pid = process.argv[2];
  if (!pid) {
    const cur = await get("/users/current");
    pid = cur.body?.users?.[0]?.personId;
    console.log(`root (current user): ${pid}`);
  }
  if (!pid) throw new Error("no root person");

  console.log("\n== A/C. descendancy generations sweep ==");
  for (const g of [1, 2, 3, 4, 5, 6, 8, 10]) {
    const r = await get(`/tree/descendancy?person=${pid}&generations=${g}`);
    summarize(`descendancy generations=${g}`, r);
    if (r.status === 400) {
      console.log("  400 body:", JSON.stringify(r.body)?.slice(0, 300));
      break;
    }
  }

  console.log("\n== A/C. descendancy personDetails variants ==");
  for (const q of ["personDetails=true", "marriageDetails=true", "personDetails=true&marriageDetails=true"]) {
    const r = await get(`/tree/descendancy?person=${pid}&generations=2&${q}`);
    summarize(`descendancy g=2 ${q}`, r);
  }

  console.log("\n== B. descendancy sample person shape (g=2) ==");
  const d2 = await get(`/tree/descendancy?person=${pid}&generations=2`);
  console.log(JSON.stringify(d2.body?.persons?.[1] ?? d2.body?.persons?.[0], null, 2)?.slice(0, 1800));

  console.log("\n== D. ancestry generations sweep, personDetails=true ==");
  for (const g of [4, 6, 8, 9]) {
    const r = await get(
      `/tree/ancestry?person=${pid}&generations=${g}&personDetails=true&marriageDetails=true`,
    );
    summarize(`ancestry generations=${g}`, r);
    if (r.status === 400) {
      console.log("  400 body:", JSON.stringify(r.body)?.slice(0, 300));
      break;
    }
  }

  console.log("\n== E. ancestry sample person (display + facts) ==");
  const a = await get(`/tree/ancestry?person=${pid}&generations=2&personDetails=true`);
  console.log(JSON.stringify(a.body?.persons?.[1], null, 2)?.slice(0, 1800));

  console.log("\n== F. collections searchMetadata coverage fields ==");
  const token = await getValidToken(LOCAL);
  const data = await fetchAllCollections(token, LOCAL);
  const metas = (data.entries ?? []).flatMap(
    (e) => e.content?.gedcomx?.collections ?? [],
  );
  const total = metas.length;
  const withPlaceIds = metas.filter((c) => c.searchMetadata?.[0]?.placeIds?.length).length;
  const withType = metas.filter((c) => c.searchMetadata?.[0]?.typeFacet).length;
  const withYears = metas.filter((c) => c.searchMetadata?.[0]?.startYear != null).length;
  const withRecords = metas.filter((c) => c.searchMetadata?.[0]?.recordCount != null).length;
  console.log(
    `collections=${total} placeIds=${withPlaceIds} typeFacet=${withType} ` +
      `years=${withYears} recordCount=${withRecords}`,
  );
  console.log(
    "typeFacet values:",
    [...new Set(metas.map((c) => c.searchMetadata?.[0]?.typeFacet))].slice(0, 20),
  );
  console.log(
    "sample:",
    JSON.stringify(metas.find((c) => c.searchMetadata?.[0]?.placeIds?.length)?.searchMetadata, null, 2)?.slice(0, 600),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
