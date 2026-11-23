/**
 * Probe: which FamilySearch collections a name search cannot find anyone in.
 *
 * Reads the live catalog through `collectionCatalogLoader` and prints:
 *   - the personCount distribution;
 *   - every collection with recordCount 0, sorted by personCount;
 *   - the counts for 2036959, 1680835, 1675510 and 2228170;
 *   - how many collections each browse-only rule marks, and where they disagree.
 *
 * Run: npx tsx dev/probe-browse-only-collections.ts   (needs a FamilySearch login)
 */
import { LOCAL } from "../src/auth/principal.js";
import { collectionCatalogLoader } from "../src/tools/collections-search.js";
import { collectionAvailability } from "../src/utils/collection-availability.js";
import type { CollectionCounts } from "../src/types/collection.js";

const NAMED = ["2036959", "1680835", "1675510", "2228170"];

const catalog = await collectionCatalogLoader(LOCAL)();
const rows = [...catalog.entries()];
console.log(`catalog: ${rows.length} collections, read ${new Date().toISOString()}`);

const bands: Array<[string, (n: number) => boolean]> = [
  ["0", (n) => n === 0],
  ["1-99", (n) => n >= 1 && n < 100],
  ["100-999", (n) => n >= 100 && n < 1_000],
  ["1k-99k", (n) => n >= 1_000 && n < 100_000],
  ["100k+", (n) => n >= 100_000],
];
console.log("\npersonCount distribution:");
for (const [label, inBand] of bands) {
  console.log(`  ${label.padEnd(8)} ${rows.filter(([, c]) => inBand(c.personCount)).length}`);
}

const line = (id: string, c: CollectionCounts) =>
  `${id.padEnd(8)} persons=${c.personCount} records=${c.recordCount} images=${c.imageCount ?? "?"} ` +
  `shared=${collectionAvailability(c.personCount, c.imageCount)} | ${c.title ?? ""}`;

console.log("\nrecordCount 0, by personCount:");
for (const [id, c] of rows
  .filter(([, c]) => c.recordCount === 0)
  .sort(([, a], [, b]) => a.personCount - b.personCount)) {
  console.log(`  ${line(id, c)}`);
}

console.log("\nnamed collections:");
for (const id of NAMED) {
  const c = catalog.get(id);
  console.log(`  ${c ? line(id, c) : `${id} not in catalog`}`);
}

const shared = (c: CollectionCounts) => collectionAvailability(c.personCount, c.imageCount) === "browse-only";
const issueRule = (c: CollectionCounts) => c.personCount === 0 || (c.recordCount === 0 && c.personCount < 100);
console.log(`\nbrowse-only, shared collectionAvailability: ${rows.filter(([, c]) => shared(c)).length}`);
console.log(`browse-only, personCount 0 or (recordCount 0 and personCount < 100): ${rows.filter(([, c]) => issueRule(c)).length}`);
console.log("\nshared rule only:");
for (const [id, c] of rows.filter(([, c]) => shared(c) && !issueRule(c))) console.log(`  ${line(id, c)}`);
console.log("\nrecordCount rule only:");
for (const [id, c] of rows.filter(([, c]) => !shared(c) && issueRule(c))) console.log(`  ${line(id, c)}`);
