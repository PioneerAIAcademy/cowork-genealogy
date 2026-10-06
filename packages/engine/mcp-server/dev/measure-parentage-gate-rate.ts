/**
 * How often does the warning gate refuse a parentage write?
 *
 * The gate reads relationship endpoints from `parent`/`child` as well as
 * `person1`/`person2`. Before that it read only the Couple pair, so a
 * ParentChild edge marked nobody as touched and the gate could not fire on a
 * parentage write at all. Turning it on is a policy decision about the exempt
 * list, and a policy decision needs a rate.
 *
 * `PLAN.md` is deleted on merge, and the guardrail spec holds that a row whose
 * evidence cannot be re-derived is not evidence — so this is committed rather
 * than run once and quoted. It reads only committed artifacts: no API, no
 * token, no network.
 *
 *   npx tsx dev/measure-parentage-gate-rate.ts            # current exempt list
 *   npx tsx dev/measure-parentage-gate-rate.ts --all      # ignore exemptions
 *
 * Method: for each ParentChild edge in each committed e2e final tree, treat the
 * edge as the write — `before` is the tree without it, `after` is the tree —
 * and ask `introducedWarnings` with the edge's two ends as the touched persons.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  introducedWarnings,
  computeTouchedPersonIds,
  GATE_EXEMPT_TYPES,
} from "../src/validation/introduced-warnings.js";
import type { SimplifiedGedcomX } from "../src/types/gedcomx.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const E2E = join(REPO, "eval", "runlogs", "e2e");
const IGNORE_EXEMPTIONS = process.argv.includes("--all");

function finalTrees(): Array<{ slug: string; file: string; tree: SimplifiedGedcomX }> {
  const out: Array<{ slug: string; file: string; tree: SimplifiedGedcomX }> = [];
  if (!existsSync(E2E)) return out;
  for (const slug of readdirSync(E2E)) {
    const dir = join(E2E, slug);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(".final-tree.gedcomx.json")) continue;
      try {
        out.push({ slug, file: name, tree: JSON.parse(readFileSync(join(dir, name), "utf-8")) });
      } catch {
        /* Unreadable sidecar: dropped from BOTH numerator and denominator, so
           the corpus silently shrinks. Reported below so the shrink is visible. */
        unreadable++;
      }
    }
  }
  return out;
}

const byType = new Map<string, number>();
// Distinct warningIds, not just instances: removing EITHER parent edge
// introduces the same two-fathers warning, so one warning is counted twice at
// edge level. Both numbers are reported because they answer different
// questions -- how many writes would be refused, and how many distinct
// problems exist.
const idsByType = new Map<string, Set<string>>();
const runsWithARefusal = new Set<string>();
let edges = 0;
let refusedEdges = 0;
let instances = 0;
let unreadable = 0;

const corpus = finalTrees();
for (const { slug, file, tree } of corpus) {
  const rels = Array.isArray(tree.relationships) ? tree.relationships : [];
  for (const r of rels) {
    const parent = (r as { parent?: string }).parent;
    const child = (r as { child?: string }).child;
    if (r.type !== "ParentChild" || !parent || !child) continue;
    edges++;
    const before = { ...tree, relationships: rels.filter((x) => x !== r) } as SimplifiedGedcomX;
    // `computeTouchedPersonIds`, NOT a hand-passed [parent, child]. Hand-passing
    // models what the gate SHOULD do rather than what it does, so reverting the
    // endpoint fix would leave this script's output byte-identical -- committed
    // evidence that does not exercise the thing it is evidence for.
    const touched = computeTouchedPersonIds(before, tree);
    const res = introducedWarnings(before, tree, touched, undefined, undefined, !IGNORE_EXEMPTIONS);
    const found = res.allIntroduced;
    if (found.length === 0) continue;
    refusedEdges++;
    runsWithARefusal.add(`${slug}/${file}`);
    for (const w of found) {
      instances++;
      byType.set(w.issueType, (byType.get(w.issueType) ?? 0) + 1);
      if (!idsByType.has(w.issueType)) idsByType.set(w.issueType, new Set());
      idsByType.get(w.issueType)!.add(w.warningId);
    }
  }
}


console.log(`committed e2e final trees : ${corpus.length}` + (unreadable ? ` (+${unreadable} unreadable, excluded)` : ""));
console.log(`ParentChild edges         : ${edges}`);
console.log(
  `edges refused             : ${refusedEdges}` +
    ` (${edges ? ((refusedEdges / edges) * 100).toFixed(1) : "0.0"}%)` +
    `  across ${runsWithARefusal.size} run(s)`,
);
console.log(`warning instances         : ${instances}`);
console.log(IGNORE_EXEMPTIONS ? "exemptions IGNORED (--all)" : `exemptions applied (${GATE_EXEMPT_TYPES.size} types)`);
const distinct = new Set<string>();
for (const ids of idsByType.values()) for (const id of ids) distinct.add(id);
console.log(`distinct warnings         : ${distinct.size}`);
console.log("by type (instances / distinct warnings):");
for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(4)} / ${String(idsByType.get(t)?.size ?? 0).padStart(4)}  ${t}`);
}
