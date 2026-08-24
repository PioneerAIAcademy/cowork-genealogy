/**
 * Probe: how often does `resolveStandardPlace` silently return a place COARSER
 * than the one the record named?
 *
 * The resolver sends the whole recorded string and takes the top hit. When the
 * leaf ("Ogden city Ward 2", "Barsebäck parish", "Wanrooij") is not in the
 * FamilySearch authority, the search falls back up the hierarchy and returns
 * the county or province — which is then persisted as `standard_place` with no
 * signal that the most specific part of the claim was dropped.
 *
 * Classifies every sampled place as:
 *   matched    — the standard place's leaf corresponds to the recorded leaf
 *   coarsened  — the standard place corresponds to a PARENT segment instead
 *   divergent  — it corresponds to no segment of the input (suspect)
 *
 * For the non-matched ones it also resolves the leaf-dropped string, to test
 * whether an explicit leaf-drop retry would return anything different.
 *
 *   npx tsx dev/probe-place-leaf-coarsening.ts [limit]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStandardPlace, mapWithConcurrency } from "../src/utils/place-resolver.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const CORPUS_DIRS = ["eval/tests/e2e", "eval/fixtures", "eval/runlogs"];

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "")
   .toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const segs = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** Do two place segments refer to the same thing? Token-containment either way. */
function segMatch(a: string, b: string): boolean {
  const [x, y] = [fold(a), fold(b)];
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function jsonFiles(dir: string): string[] {
  const out: string[] = [];
  let es: string[];
  try { es = readdirSync(dir); } catch { return out; }
  for (const e of es) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...jsonFiles(full));
    else if (e.endsWith(".json")) out.push(full);
  }
  return out;
}

function corpusPlaces(): { place: string; count: number }[] {
  const seen = new Map<string, { place: string; count: number }>();
  const visit = (o: unknown): void => {
    if (Array.isArray(o)) { for (const v of o) visit(v); return; }
    if (o === null || typeof o !== "object") return;
    const rec = o as Record<string, unknown>;
    const p = rec.place;
    if (typeof p === "string" && p.trim() && segs(p).length >= 2) {
      const k = p.trim().toLowerCase();
      const hit = seen.get(k);
      if (hit) hit.count++; else seen.set(k, { place: p.trim(), count: 1 });
    }
    for (const v of Object.values(rec)) visit(v);
  };
  for (const d of CORPUS_DIRS) {
    for (const f of jsonFiles(join(REPO_ROOT, d))) {
      try { visit(JSON.parse(readFileSync(f, "utf8"))); } catch { /* skip */ }
    }
  }
  return [...seen.values()];
}

const limit = Number(process.argv[2] ?? 150);
const all = corpusPlaces().sort((a, b) => a.place.localeCompare(b.place));
const stride = Math.max(1, Math.floor(all.length / limit));
const sample = all.filter((_, i) => i % stride === 0).slice(0, limit);

console.log(`corpus: ${all.length} distinct multi-segment places`);
console.log(`sample: ${sample.length} (stride ${stride})\n`);

type Verdict = "matched" | "coarsened" | "divergent" | "unresolved";
interface Row { place: string; count: number; std: string | null; verdict: Verdict; depth: number; dropped: string | null }
const rows: Row[] = [];
let done = 0;

await mapWithConcurrency(sample, 8, async (p) => {
  const std = await resolveStandardPlace(p.place);
  const inSegs = segs(p.place);
  let verdict: Verdict = "unresolved";
  let depth = -1;
  if (std) {
    const stdLeaf = segs(std)[0] ?? "";
    if (segMatch(stdLeaf, inSegs[0])) { verdict = "matched"; depth = 0; }
    else {
      const i = inSegs.findIndex((s, idx) => idx > 0 && segMatch(stdLeaf, s));
      if (i > 0) { verdict = "coarsened"; depth = i; } else verdict = "divergent";
    }
  }
  // Would an explicit leaf-drop retry find anything different?
  const dropped = verdict === "matched" || inSegs.length < 3
    ? null
    : await resolveStandardPlace(inSegs.slice(1).join(", "));
  rows.push({ ...p, std, verdict, depth, dropped });
  if (++done % 25 === 0) console.log(`  …${done}/${sample.length}`);
});

const by = (v: Verdict) => rows.filter((r) => r.verdict === v);
const pct = (n: number) => `${((n / rows.length) * 100).toFixed(1)}%`;
console.log(`\n${"=".repeat(76)}`);
for (const v of ["matched", "coarsened", "divergent", "unresolved"] as Verdict[]) {
  console.log(`${v.padEnd(12)} ${String(by(v).length).padStart(4)}/${rows.length}  ${pct(by(v).length)}`);
}
const weighted = rows.reduce((a, r) => a + (r.verdict === "coarsened" ? r.count : 0), 0);
const totalOcc = rows.reduce((a, r) => a + r.count, 0);
console.log(`\ncoarsened weighted by corpus frequency: ${weighted}/${totalOcc} occurrences (${((weighted/totalOcc)*100).toFixed(1)}%)`);
const leafDropHelps = rows.filter((r) => r.dropped && r.std && r.dropped !== r.std);
console.log(`leaf-drop retry returns something DIFFERENT: ${leafDropHelps.length}`);
console.log("=".repeat(76));

for (const v of ["divergent", "coarsened"] as Verdict[]) {
  const list = by(v).sort((a, b) => b.count - a.count).slice(0, 12);
  if (!list.length) continue;
  console.log(`\n--- ${v.toUpperCase()} (top ${list.length} by frequency) ---`);
  for (const r of list) {
    console.log(`\n  "${r.place}"  x${r.count}`);
    console.log(`    -> ${r.std}${v === "coarsened" ? `   (dropped ${r.depth} level(s))` : ""}`);
    if (r.dropped && r.dropped !== r.std) console.log(`    leaf-dropped retry -> ${r.dropped}`);
  }
}
