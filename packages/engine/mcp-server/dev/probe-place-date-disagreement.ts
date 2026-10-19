/**
 * Probe: how often does the fact's DATE change the standard_place we persist?
 *
 * `resolveStandardPlace` has always sent a bare name search and taken the
 * top-scored hit, so it returns whichever place representation FamilySearch
 * ranks highest today — the modern one. Jurisdictions move, so for a
 * 19th-century fact that is frequently anachronistic ("Rochdale, England"
 * resolves to Greater Manchester, a county created in 1974). Plan §11 step 2
 * called for threading the date through "from the start"; `ResolveOpts.date`
 * was added and left unwired.
 *
 * This measures what wiring it changes, over the real place/date pairs already
 * sitting in the eval corpus rather than a handful of hand-picked cases.
 *
 *   npx tsx dev/probe-place-date-disagreement.ts [limit]
 *
 * Live, anonymous FamilySearch calls: 3 per sampled pair (the resolver arms are
 * cached per-year, so repeats are free). Default limit 150.
 *
 * WHAT THIS PROBE DOES AND DOES NOT ESTABLISH.
 * It reports how many resolutions CHANGE, plus the raw blank-rate of the dated
 * query. It does NOT grade a change as a correction or a regression — there is
 * no ground truth here to grade against, and the corrected-vs-regressed split
 * quoted elsewhere was a hand read of the ANSWER CHANGED list below, not an
 * output of this file. Read the list and judge it yourself.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStandardPlace, mapWithConcurrency } from "../src/utils/place-resolver.js";
import { searchPlace } from "../src/utils/place-api.js";
import { stdDate } from "../src/utils/date-standardize.js";
import { earliestYear } from "../src/utils/date-helpers.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const CORPUS_DIRS = ["eval/tests/e2e", "eval/fixtures", "eval/runlogs"];
const CONCURRENCY = 8;

interface Pair { place: string; date: string; year: number; count: number }

function jsonFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...jsonFiles(full));
    else if (e.endsWith(".json")) out.push(full);
  }
  return out;
}

/** Collect every {place, date} co-located on one object (a fact or assertion). */
function collectPairs(): Pair[] {
  const seen = new Map<string, Pair>();
  const visit = (o: unknown): void => {
    if (Array.isArray(o)) { for (const v of o) visit(v); return; }
    if (o === null || typeof o !== "object") return;
    const rec = o as Record<string, unknown>;
    const place = rec.place;
    const date = rec.date ?? rec.standard_date;
    if (typeof place === "string" && place.trim() && typeof date === "string" && date.trim()) {
      const year = earliestYear(stdDate(date));
      if (year) {
        const key = `${place.trim().toLowerCase()}|${year}`;
        const hit = seen.get(key);
        if (hit) hit.count++;
        else seen.set(key, { place: place.trim(), date: date.trim(), year, count: 1 });
      }
    }
    for (const v of Object.values(rec)) visit(v);
  };
  for (const d of CORPUS_DIRS) {
    for (const f of jsonFiles(join(REPO_ROOT, d))) {
      try { visit(JSON.parse(readFileSync(f, "utf8"))); } catch { /* skip unreadable */ }
    }
  }
  return [...seen.values()];
}

const limit = Number(process.argv[2] ?? 150);
const all = collectPairs().sort((a, b) =>
  a.place.localeCompare(b.place) || a.year - b.year,
);
// Deterministic even-spread sample, so a partial run still spans the corpus
// instead of stopping inside the A's.
const stride = Math.max(1, Math.floor(all.length / limit));
const sample = all.filter((_, i) => i % stride === 0).slice(0, limit);

console.log(`corpus: ${all.length} distinct (place, year) pairs`);
console.log(`sample: ${sample.length} (stride ${stride}), 2 live calls each\n`);

interface Row extends Pair {
  undated: string | null;
  dated: string | null;
  /** Did the dated query alone return zero candidates? This is the population
   *  the undated fallback in getSearchEntries exists to rescue. It cannot be
   *  observed through resolveStandardPlace, because the fallback has already
   *  run by then — hence the raw searchPlace call. */
  datedQueryEmpty: boolean;
}
const rows: Row[] = [];
let done = 0;

await mapWithConcurrency(sample, CONCURRENCY, async (p) => {
  const [undated, dated, rawDated] = await Promise.all([
    resolveStandardPlace(p.place),
    resolveStandardPlace(p.place, { date: p.date }),
    searchPlace(p.place, { date: p.year }).catch(() => []),
  ]);
  rows.push({ ...p, undated, dated, datedQueryEmpty: rawDated.length === 0 });
  if (++done % 25 === 0) console.log(`  …${done}/${sample.length}`);
});

const differs = rows.filter((r) => r.undated !== r.dated);
const datedOnly = differs.filter((r) => !r.undated && r.dated);
const lostByDate = differs.filter((r) => r.undated && !r.dated);
const changed = differs.filter((r) => r.undated && r.dated);

console.log(`\n${"=".repeat(76)}`);
console.log(`disagree            : ${differs.length}/${rows.length}` +
  ` (${((differs.length / rows.length) * 100).toFixed(1)}%)`);
console.log(`  answer changed    : ${changed.length}   <- both arms resolved, to different places`);
console.log(`  resolved only w/ date: ${datedOnly.length}`);
console.log(`  lost with date    : ${lostByDate.length}   <- expected 0 while the fallback is in place`);
const rescued = rows.filter((r) => r.datedQueryEmpty).length;
console.log(
  `
dated query returned nothing on its own: ${rescued}/${rows.length}` +
    ` (${((rescued / rows.length) * 100).toFixed(1)}%)`,
);
console.log(
  `  each of those is a place that would go BLANK without the undated fallback`,
);
console.log(
  `  ("lost with date" reads 0 precisely because the fallback already ran)`,
);
console.log("=".repeat(76));

const show = (title: string, list: Row[]) => {
  if (!list.length) return;
  console.log(`\n--- ${title} ---`);
  for (const r of list.sort((a, b) => b.count - a.count)) {
    console.log(`\n  ${r.place}   [${r.date} -> ${r.year}]  x${r.count} in corpus`);
    console.log(`    now   : ${r.undated ?? "(unresolved)"}`);
    console.log(`    dated : ${r.dated ?? "(unresolved)"}`);
  }
};
show("ANSWER CHANGED", changed);
show("LOST WITH DATE (would regress)", lostByDate);
show("RESOLVED ONLY WITH DATE", datedOnly);
