// Replay #4665's outside-site jurisdiction refusal over the committed e2e corpus:
// the false-block direction (a legitimate FamilySearch item the guard would refuse).
//
//   npx tsx dev/replay-outside-site-guard.ts [cacheDir]
//
// The predicate is the TOOL'S OWN (`outsideSiteJurisdictionError`), never restated.
// Each run is replayed against the link_texts it would have held: the live
// `external_links_search` rows for that run's own `localities[]` places, as
// `external-collections.json` stores them, through the tool's own `siteLinkTexts`. The corpus holds no
// external-collections.json, so the rows are fetched live (network) and cached in
// `cacheDir` (default: the OS temp dir) so a re-run is free. A place that does not
// resolve, or is too large to list, contributes no rows and is counted.
//
// Also reports the step-1 counts from the issue: FamilySearch items whose
// `rationale` names a fixed site, and how many of those carry an `external_site`
// log entry on the same item.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outsideSiteJurisdictionError, OUTSIDE_SITE_NAMES, routesToFamilySearch } from "../src/utils/plan-item-plausibility.js";
import { externalLinkRows } from "../src/tools/external-links-search.js";
import { siteLinkTexts } from "../src/utils/external-collections-store.js";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const RUNS = join(ROOT, "eval", "runlogs", "e2e");
const CACHE = process.argv[2] ?? join(tmpdir(), "replay-outside-site-guard");
mkdirSync(CACHE, { recursive: true });
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));

type PlaceRows = { rows: { link_text: string; place: string }[] } | { skipped: string };
async function rowsFor(place: string): Promise<PlaceRows> {
  const file = join(CACHE, `rows-${encodeURIComponent(place)}.json`);
  if (existsSync(file)) return readJson(file);
  let out: PlaceRows;
  try {
    const r = await externalLinkRows(place);
    out = "rows" in r
      ? { rows: r.rows.map((x) => ({ link_text: x.link_text, place: x.place })) }
      : { skipped: `too large (${r.tooLarge})` };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    out = { skipped: message.slice(0, 120) };
    // Only a definitive answer is cached: an ambiguous or unresolved name stays so on
    // a re-run, while a timeout, a 5xx or an expired token must be retried, or the
    // place would silently drop out of every later replay.
    if (!/matches more than one place|Could not resolve/.test(message)) return out;
  }
  writeFileSync(file, JSON.stringify(out), "utf-8");
  return out;
}

const fixedNames = Object.values(OUTSIDE_SITE_NAMES).flat();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const namesFixed = (text: string) =>
  fixedNames.some((n) => new RegExp(`(?:^|[^a-z0-9])${esc(n)}(?:$|[^a-z0-9])`).test(text.toLowerCase()));

let files = 0, items = 0, fsItems = 0, blankRepoItems = 0, refusals = 0, rationaleHits = 0, rationaleWithExternal = 0;
const places = new Set<string>();
const skipped = new Map<string, string>();
const refused: string[] = [];

for (const scenario of readdirSync(RUNS).filter((d) => statSync(join(RUNS, d)).isDirectory()).sort()) {
  for (const f of readdirSync(join(RUNS, scenario)).filter((x) => x.endsWith(".final-research.json")).sort()) {
    files++;
    const doc = readJson(join(RUNS, scenario, f));
    const rows: { link_text: string; place: string }[] = [];
    for (const loc of Array.isArray(doc.localities) ? doc.localities : []) {
      if (typeof loc?.place !== "string" || loc.place.trim() === "") continue;
      places.add(loc.place);
      const r = await rowsFor(loc.place);
      if ("rows" in r) rows.push(...r.rows);
      else skipped.set(loc.place, r.skipped);
    }
    const linkTexts = siteLinkTexts(rows);
    const externalOn = new Set(
      (Array.isArray(doc.log) ? doc.log : []).filter((e: any) => e?.external_site).map((e: any) => e.plan_item_id),
    );
    for (const plan of Array.isArray(doc.plans) ? doc.plans : []) {
      for (const item of Array.isArray(plan?.items) ? plan.items : []) {
        items++;
        // The guard's own routing rule: a blank or missing repository is FamilySearch too.
        if (!routesToFamilySearch(item)) continue;
        fsItems++;
        if (String(item?.repository ?? "").trim() === "") blankRepoItems++;
        const error = outsideSiteJurisdictionError(item, linkTexts);
        if (error) {
          refusals++;
          refused.push(`${scenario}/${f} ${item.id}: ${error.slice(0, 160)}`);
        }
        if (typeof item?.rationale === "string" && namesFixed(item.rationale)) {
          rationaleHits++;
          if (externalOn.has(item.id)) rationaleWithExternal++;
        }
      }
    }
  }
}

console.log(`files ${files}, plan items ${items}, FamilySearch items ${fsItems} (blank repository: ${blankRepoItems})`);
console.log(`locality places ${places.size}, of which contributed no rows ${skipped.size}`);
for (const [p, why] of skipped) console.log(`  no rows: ${p} — ${why}`);
console.log(`refusals over FamilySearch items, each run against its own localities' link_texts: ${refusals}`);
for (const r of refused) console.log(`  ${r}`);
console.log(`FamilySearch items whose rationale names a fixed site: ${rationaleHits}, with an external_site entry on the item: ${rationaleWithExternal}`);
