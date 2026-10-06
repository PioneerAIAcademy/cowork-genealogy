/**
 * Probe: how often a committed e2e final tree holds a child with two or more
 * parents of one sex. The satisfiability evidence for issue #2525, which made
 * the #2840 warning gate see ParentChild edges.
 *
 * Before #2525 the gate never ran on a ParentChild edge (computeTouchedPersonIds
 * read only Couple endpoints), so its false-deny measurement could not see this
 * shape. After it, `tooManyFathers2` / `tooManyMothers2` gate every writer that
 * produces it. A per-call replay is not possible: e2e run logs keep each call's
 * `{tool, args}` and no before-state. The end state is what this counts.
 *
 * Two counts per hit, because they answer different questions:
 * - `warning`: same-sex parents of any subtype, which is what tooManyFathers2 /
 *   tooManyMothers2 fire on, and so what the gate now refuses.
 * - `biological`: same-sex parents whose edge has no subtype or `Biological`,
 *   which is what `conflicts_surfaced` routes to conflict-resolution.
 *
 * Offline. Not shipped in any artifact. Re-run rather than quoting figures
 * forward; the corpus moves as run logs land.
 *
 * Usage:
 *   npx tsx dev/probe-same-sex-parents.ts [--list] [--all-warnings]
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import type { SimplifiedGedcomX } from "../src/types/gedcomx.js";
import { normalizeGender } from "../src/utils/mob.js";
import { isQualifyingParentChildEdge } from "../src/tools/person-warnings.js";

const root = resolve(import.meta.dirname, "..", "..", "..", "..", "eval", "runlogs", "e2e");
const list = process.argv.includes("--list");

let trees = 0;
const hits: string[] = [];
const cases = new Set<string>();
const runs = new Set<string>();
let warningHits = 0;
let biologicalHits = 0;

for (const fixture of readdirSync(root).sort()) {
  const dir = join(root, fixture);
  if (!statSync(dir).isDirectory()) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".final-tree.gedcomx.json")).sort()) {
    trees++;
    const tree = JSON.parse(readFileSync(join(dir, file), "utf-8")) as SimplifiedGedcomX;
    const people = new Map((tree.persons ?? []).map((p) => [p.id, p]));
    const byChild = new Map<string, Array<{ parent: string; biological: boolean }>>();
    for (const r of tree.relationships ?? []) {
      if (r.type !== "ParentChild" || !r.parent || !r.child) continue;
      const list = byChild.get(r.child) ?? [];
      list.push({ parent: r.parent, biological: isQualifyingParentChildEdge(r) });
      byChild.set(r.child, list);
    }
    for (const [child, edges] of byChild) {
      for (const sex of ["Male", "Female"] as const) {
        const ofSex = edges.filter((e) => normalizeGender(people.get(e.parent)?.gender) === sex);
        const any = new Set(ofSex.map((e) => e.parent));
        if (any.size < 2) continue;
        const bio = new Set(ofSex.filter((e) => e.biological).map((e) => e.parent));
        warningHits++;
        if (bio.size >= 2) biologicalHits++;
        cases.add(fixture);
        runs.add(`${fixture}/${file}`);
        const name = (id: string) => {
          const n = people.get(id)?.names?.[0];
          return n ? `${n.given ?? ""} ${n.surname ?? ""}`.trim() : "?";
        };
        const subtypes = ofSex.map((e) => `${e.parent} ${name(e.parent)}${e.biological ? "" : " [non-biological]"}`);
        hits.push(`${fixture}  ${file.replace(".final-tree.gedcomx.json", "")}  child ${child} ${name(child)}  ${sex === "Male" ? "fathers" : "mothers"}: ${subtypes.join(" | ")}`);
      }
    }
  }
}

// Every warning a ParentChild edge introduces, by type: take each edge out of
// the final tree and diff the gate's introduced warnings for putting it back.
// Before the gate saw these edges this was invisible; it is the full set the
// gate now refuses on a parent link, not just the same-sex parent count above.
if (process.argv.includes("--all-warnings")) {
  const { introducedWarnings, computeTouchedPersonIds } = await import("../src/validation/introduced-warnings.js");
  const byType = new Map<string, number>();
  let edges = 0;
  let refused = 0;
  for (const fixture of readdirSync(root).sort()) {
    const dir = join(root, fixture);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".final-tree.gedcomx.json"))) {
      const tree = JSON.parse(readFileSync(join(dir, file), "utf-8")) as SimplifiedGedcomX;
      for (const edge of tree.relationships ?? []) {
        if (edge.type !== "ParentChild") continue;
        edges++;
        const without = { ...tree, relationships: (tree.relationships ?? []).filter((r) => r !== edge) };
        const result = introducedWarnings(without, tree, computeTouchedPersonIds(without, tree));
        for (const w of result.allIntroduced) byType.set(w.issueType, (byType.get(w.issueType) ?? 0) + 1);
        if (result.allIntroduced.length > 0) refused++;
      }
    }
  }
  console.log(`ParentChild edges replayed: ${edges}; would be refused: ${refused}`);
  for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${t}`);
}

console.log(`final trees read:            ${trees}`);
console.log(`children, 2+ same-sex parents (tooManyFathers2/Mothers2 fires): ${warningHits}`);
console.log(`  of which 2+ biological (conflicts_surfaced fires):           ${biologicalHits}`);
console.log(`runs with a hit:             ${runs.size}`);
console.log(`cases with a hit:            ${cases.size}`);
if (list) for (const h of hits) console.log(`  ${h}`);
