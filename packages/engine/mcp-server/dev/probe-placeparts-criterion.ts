/**
 * The corpus criterion behind the "Live-run exemption for tokenizer-only changes"
 * block in `docs/specs/record-search-tool-spec-v2.md` § "Place matching".
 *
 * Answers one question: does this change move a tokenized value that a run would
 * actually feed to `samePlace`? Two input classes, both must report `0 changed`
 * for the exemption to apply.
 *
 *   1. Tree facts — `standard_place || place` on every fact of every person and
 *      every relationship, in each `eval/tests/e2e/*\/starting-tree.gedcomx.json`
 *      (what the harness stages) and each `*.final-tree.gedcomx.json` under
 *      `eval/runlogs/` (a run's mutable tree is what `record_search` reads).
 *   2. Recorded search arguments — `marriagePlace` and `recordSubdivision` under
 *      `eval/runlogs/e2e/`, which is where `searchedPlace` comes from.
 *
 * **Why facts, and why `standard_place || place`.** This replaces a regex that
 * matched every `"place"`/`"standard_place"` key anywhere in the file and added
 * both. That over-collects in two ways, and it made the criterion report a change
 * that cannot happen: it collected the raw `place` even where a `standard_place`
 * shadowed it, so it measured strings the tokenizer never reads. On issue #1584 that
 * produced 2 spurious "changed" rows from `stribling-father-1821` —
 * `"Graham Young County Texas, USA"`, whose fact carries
 * `standard_place: "Graham, Young, Texas, United States"`. `marriage-jurisdictions.ts`
 * reads the standardized form, which holds no `County` token and does not move.
 * Correcting the collector took class 1 from 1771 distinct / 2 changed to
 * 1007 distinct / 0 changed. The spec always stated this rule; the regex
 * contradicted it.
 *
 * **What this deliberately does NOT do: filter to reachable facts.**
 * `marriageJurisdictionCandidates` only ever collects the subject's facts, spouses'
 * facts and `Couple`-relationship facts, so a fact on an unrelated person can never
 * reach `samePlace`. Narrowing class 1 that way would mean reimplementing the
 * collector's traversal here, where it would drift the moment that traversal grows a
 * source, and start silently under-reporting strings that ARE reached. Over-reporting
 * and making a human check whose fact a moved string sits on is the safe direction of
 * error. `standard_place || place` is a different kind of narrowing — it is fidelity
 * to what the tokenizer reads, not a guess about what the caller traverses.
 *
 * Usage, from anywhere in the repo:
 *
 *     npx tsx packages/engine/mcp-server/dev/probe-placeparts-criterion.ts
 *
 * BASELINE: `before()` below is the tokenizer as it stood before the change under
 * test. Replace it with `main`'s `placeParts` body when measuring a new change —
 * comparing the working tree against itself reports `0 changed` for every input and
 * is the one way this script silently says "exempt" when it has measured nothing.
 * The self-check at the end exists to catch exactly that: it asserts the comparison
 * still reports known-moving inputs, and exits non-zero if it does not.
 */
import fs from "node:fs";
import path from "node:path";
import { placeParts as after } from "../src/utils/marriage-jurisdictions.js";

/** The tokenizer before issue #1584. Replace when measuring a later change. */
function before(place: string): string[] {
  return place
    .toLowerCase()
    .split(",")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .map((part) => part.replace(/\bcounty\b|\bco\b\.?/g, "").trim())
    .filter((part) => part !== "");
}

function repoRoot(): string {
  let dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "eval")) && fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error("could not locate the repo root (looked for a dir holding ./eval and ./.git)");
}

interface Fact {
  place?: unknown;
  standard_place?: unknown;
}
interface TreeLike {
  persons?: { facts?: Fact[] }[];
  relationships?: { facts?: Fact[] }[];
}

/** Every fact a tree carries, person-borne and relationship-borne alike. */
const factsOf = (tree: TreeLike): Fact[] => [
  ...(tree.persons ?? []).flatMap((p) => p?.facts ?? []),
  ...(tree.relationships ?? []).flatMap((r) => r?.facts ?? []),
];

/** Values of the named keys anywhere in a parsed JSON value. */
function collectKeys(node: unknown, keys: Set<string>, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const v of node) collectKeys(v, keys, out);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (keys.has(k) && typeof v === "string" && v.trim() !== "") out.add(v);
      collectKeys(v, keys, out);
    }
  }
}

function main(): void {
  const root = repoRoot();
  const files: string[] = [];
  const walk = (d: string): void => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(path.join(root, "eval", "tests", "e2e"));
  walk(path.join(root, "eval", "runlogs"));

  const LOG_KEYS = new Set(["marriagePlace", "recordSubdivision"]);
  const cls1 = new Set<string>();
  const cls2 = new Set<string>();
  let nTree = 0;
  let nLog = 0;
  let nUnparseable = 0;

  for (const f of files) {
    const g = f.split(path.sep).join("/");
    if (!g.endsWith(".json")) continue;
    const isTree =
      g.endsWith("starting-tree.gedcomx.json") ||
      g.endsWith(".final-tree.gedcomx.json");
    const isRunlog = g.includes("/eval/runlogs/e2e/");
    if (!isTree && !isRunlog) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      nUnparseable++;
      continue;
    }

    if (isTree) {
      nTree++;
      for (const fact of factsOf(parsed as TreeLike)) {
        const p = (fact.standard_place as string) || (fact.place as string);
        if (typeof p === "string" && p.trim() !== "") cls1.add(p);
      }
    }
    if (isRunlog) {
      nLog++;
      collectKeys(parsed, LOG_KEYS, cls2);
    }
  }

  console.log(
    `scanned ${nTree} tree files, ${nLog} run-log files` +
      (nUnparseable ? `, ${nUnparseable} unparseable (skipped)` : ""),
  );

  let total = 0;
  for (const [name, set] of [
    ["class 1  tree-fact places (standard_place || place)", cls1],
    ["class 2  recorded search arguments", cls2],
  ] as const) {
    const moved = [...set].filter(
      (s) => JSON.stringify(before(s)) !== JSON.stringify(after(s)),
    );
    total += moved.length;
    console.log(`\n${name}: ${set.size} distinct, ${moved.length} changed`);
    for (const s of moved) {
      console.log(`   ${JSON.stringify(s)}`);
      console.log(`      ${JSON.stringify(before(s))} -> ${JSON.stringify(after(s))}`);
    }
  }

  // Self-check. A criterion reporting 0 is worth exactly as much as its ability to
  // report non-zero, and the likeliest cause of a false 0 is a `before()` identical
  // to `after()`.
  const CANARIES = ["Denver, CO", "Boulder, CO, United States", "Coïmbra, Portugal"];
  const detected = CANARIES.filter(
    (s) => JSON.stringify(before(s)) !== JSON.stringify(after(s)),
  );
  console.log(`\nself-check: ${detected.length}/${CANARIES.length} canaries detected as moved`);
  if (detected.length === 0) {
    console.error(
      "\nFAIL: the comparison detected none of the canaries, so it cannot report a\n" +
        "change at all. `before()` is probably identical to the current tokenizer —\n" +
        "replace it with main's placeParts body. Reported counts mean nothing as-is.",
    );
    process.exit(1);
  }

  console.log(
    total === 0
      ? "\nBoth classes report 0 changed: the live-run exemption applies."
      : `\n${total} moved string(s). The exemption does NOT apply on the count alone —\n` +
          "check whose fact each one sits on (see the spec's reachability note) before\n" +
          "pricing a live run.",
  );
}

main();
