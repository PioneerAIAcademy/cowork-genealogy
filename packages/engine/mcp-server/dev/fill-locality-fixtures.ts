/**
 * Rewrite the `localities` entries of fixture research.json files the way a
 * caller's `research_append` now stores them: counts stamped, then the place's
 * and (in the United States, Canada and Mexico) the country's collections filled
 * from FamilySearch's live catalog. Only entries in those three countries are
 * touched; ids, order and every other field are kept. A collection the catalog
 * does not hold is a fixture's own synthetic one, served by its mock fixtures, so
 * it keeps the counts the fixture gave it rather than the null the stamp sets.
 *
 * Needs a FamilySearch login (`~/.familysearch-mcp/tokens.json`).
 *
 * Usage:
 *   npx tsx dev/fill-locality-fixtures.ts <research.json> [<research.json> ...]
 */
import { readFile, writeFile } from "fs/promises";
import { fillLocalityEntryFromCatalog } from "../src/tools/research-append.js";
import { collectionCatalogLoader } from "../src/tools/collections-search.js";
import { localityNationalCountry } from "../src/utils/collection-scope.js";
import { LOCAL } from "../src/auth/principal.js";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: npx tsx dev/fill-locality-fixtures.ts <research.json> [...]");
  process.exit(2);
}

const catalog = await collectionCatalogLoader(LOCAL)();
let touched = 0;
for (const file of files) {
  const research = JSON.parse(await readFile(file, "utf-8"));
  for (const entry of Array.isArray(research.localities) ? research.localities : []) {
    if (!localityNationalCountry(entry)) continue;
    const sent: any[] = Array.isArray(entry.collections) ? entry.collections.map((c: any) => ({ ...c })) : [];
    const before = sent.length;
    const warnings = fillLocalityEntryFromCatalog(entry, catalog).filter((w) => !w.includes("is not in FamilySearch's collection catalog"));
    for (const c of entry.collections ?? []) {
      if (catalog.has(String(c.id))) continue;
      const own = sent.find((o) => String(o.id) === String(c.id));
      if (!own) continue;
      for (const k of ["person_count", "record_count"]) {
        if (k in own) c[k] = own[k];
        else delete c[k];
      }
      warnings.push(`kept the fixture's own counts for synthetic collection '${c.id}'`);
    }
    touched++;
    console.log(`${file} ${entry.id} (${entry.place}, ${entry.time_period}): ${before} -> ${entry.collections?.length ?? 0}`);
    for (const w of warnings) console.log(`    ${w}`);
  }
  await writeFile(file, JSON.stringify(research, null, 2) + "\n");
}
if (touched === 0) {
  console.error("no United States, Canada or Mexico locality in the files given");
  process.exit(1);
}
