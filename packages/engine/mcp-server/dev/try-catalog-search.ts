/**
 * One-shot smoke test for `catalog_search` against the live service.
 *
 *   npx tsx dev/try-catalog-search.ts "Maine, United States"
 *   npx tsx dev/try-catalog-search.ts "Javorje nad Škofjo Loko, Slovenia"
 *
 * Requires a prior `login` so ~/.familysearch-mcp/tokens.json exists.
 */
import { LOCAL } from "../src/auth/principal.js";
import { catalogSearchTool } from "../src/tools/catalog-search.js";

async function main(): Promise<void> {
  const place = process.argv[2] ?? "Maine, United States";
  const started = Date.now();
  const r = await catalogSearchTool(
    { standardPlace: place, count: 8, hydrate: 4 },
    LOCAL,
  );
  console.log(
    `${place} -> ${r.totalHits} hits, ${r.returned} returned, ` +
      `placeResolved=${r.placeResolved}, hydrationTimedOut=${r.hydrationTimedOut}, ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  for (const h of r.hits.slice(0, 6)) {
    console.log(`\n  ${h.title.slice(0, 72)}`);
    console.log(`    id=${h.id ?? "(none)"}  hydrated=${h.hydrated}`);
    if (h.repositoryCalls.length) console.log(`    access: ${h.repositoryCalls.join(", ")}`);
    for (const f of (h.filmNotes ?? []).slice(0, 2)) {
      console.log(
        `    film: filmNumber=${f.filmNumber ?? "-"} imageGroupNumber=${f.imageGroupNumber ?? "-"}` +
          (f.text ? ` "${f.text.slice(0, 44)}"` : ""),
      );
    }
    if (h.digitalLibraryUrl) console.log(`    book: ${h.digitalLibraryUrl}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
