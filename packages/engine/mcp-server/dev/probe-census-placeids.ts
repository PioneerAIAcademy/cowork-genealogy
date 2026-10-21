/**
 * Probe — the evidence behind `timeline_build`'s census years (issue #3516,
 * PR C, `docs/plan/attached-records-baseline.md` Fix 1 and Fix 3).
 *
 *   A. Do `searchMetadata.placeIds` in the collections catalog match the place
 *      ids `standardPlaceToPlaceId` returns? Checked for Alabama, Ohio, New
 *      York, England, the United States, Ireland and Denmark. The plan says to
 *      put it to the lead before building Fix 1 if they do not.
 *   B. Every single-year collection whose title names a census, under any
 *      facet, grouped by the catalog place id it is filed under, with its
 *      record count. Fix 3 drops a year whose collections are tiny next to the
 *      group's full years; this prints what a threshold has to separate.
 *
 * Read-only. Run: npx tsx dev/probe-census-placeids.ts
 */

import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";
import { fetchAllCollections } from "../src/tools/collections-search.js";
import { standardPlaceToPlaceId, resolveStandardPlace } from "../src/utils/place-resolver.js";

const PLACES = [
  "Alabama, United States",
  "Ohio, United States",
  "New York, United States",
  "England, United Kingdom",
  "United States",
  "Ireland",
  "Denmark",
];

async function main(): Promise<void> {
  const token = await getValidToken(LOCAL);
  const catalog = await fetchAllCollections(token, LOCAL);
  const collections = (catalog.entries ?? []).flatMap((e) => e.content?.gedcomx?.collections ?? []);
  console.log(`catalog: ${collections.length} collections`);

  const filedUnder = new Map<number, number>();
  for (const c of collections) for (const id of c.searchMetadata?.[0]?.placeIds ?? []) filedUnder.set(id, (filedUnder.get(id) ?? 0) + 1);

  console.log("\nA. place ids");
  for (const name of PLACES) {
    const std = (await resolveStandardPlace(name)) ?? name;
    const id = await standardPlaceToPlaceId(std);
    const n = id ? filedUnder.get(Number(id)) ?? 0 : 0;
    console.log(`  ${name.padEnd(26)} -> ${String(std).padEnd(40)} id=${id ?? "null"}  collections filed under it: ${n}`);
  }

  console.log("\nB. single-year census collections, by filed-under place id");
  const rows: { pid: number; year: number; facet: string; records: number; title: string }[] = [];
  for (const c of collections) {
    const m = c.searchMetadata?.[0];
    if (!m || !/census/i.test(c.title) || m.startYear === undefined || m.startYear !== m.endYear) continue;
    for (const pid of m.placeIds ?? []) {
      rows.push({ pid, year: m.startYear, facet: m.typeFacet ?? "-", records: m.recordCount ?? 0, title: c.title });
    }
  }
  const byPid = new Map<number, typeof rows>();
  for (const r of rows) byPid.set(r.pid, [...(byPid.get(r.pid) ?? []), r]);
  for (const [pid, rs] of [...byPid].sort((a, b) => b[1].length - a[1].length)) {
    const max = Math.max(...rs.map((r) => r.records));
    console.log(`  place ${pid}: ${rs.length} collections, largest ${max.toLocaleString()} records`);
    for (const r of rs.sort((a, b) => a.year - b.year)) {
      const share = max > 0 ? ((100 * r.records) / max).toFixed(2) : "-";
      console.log(`    ${r.year} ${r.facet.padEnd(14)} ${r.records.toLocaleString().padStart(12)}  ${share.padStart(7)}%  ${r.title}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
