/**
 * Check `src/data/census-table.ts` against the live FamilySearch catalog: every
 * row's collection exists, indexes records, and its title names the row's year
 * (a single year or a listed one; a range fails). Also reports any table row
 * naming a fragment census. Prints one line per row and exits non-zero on any
 * failure. Run it whenever the table changes; no CI job runs it (it needs a
 * FamilySearch login).
 *
 * Run: npx tsx dev/check-census-table.ts
 */

import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";
import { fetchAllCollections } from "../src/tools/collections-search.js";
import { CENSUS_TABLE, checkRow, fragmentViolations, type CatalogEntry } from "../src/data/census-table.js";

async function main(): Promise<void> {
  const token = await getValidToken(LOCAL);
  const catalog = await fetchAllCollections(token, LOCAL);
  const byId = new Map<string, CatalogEntry>();
  for (const entry of catalog.entries ?? []) {
    for (const c of entry.content?.gedcomx?.collections ?? []) {
      byId.set(String(c.id), {
        id: String(c.id),
        title: c.title,
        recordCount: c.searchMetadata?.[0]?.recordCount ?? 0,
      });
    }
  }
  console.log(`catalog: ${byId.size} collections; table: ${CENSUS_TABLE.length} rows`);

  let failures = 0;
  for (const row of CENSUS_TABLE) {
    const problems = checkRow(row, byId.get(row.collectionId));
    const title = byId.get(row.collectionId)?.title ?? "-";
    if (problems.length === 0) {
      console.log(`PASS ${row.year} ${row.label.padEnd(22)} ${row.collectionId.padStart(8)}  ${title}`);
    } else {
      failures += 1;
      for (const p of problems) console.log(`FAIL ${p}`);
    }
  }
  for (const v of fragmentViolations()) {
    failures += 1;
    console.log(`FAIL ${v}`);
  }
  console.log(failures === 0 ? `\nall ${CENSUS_TABLE.length} rows pass` : `\n${failures} failing`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
