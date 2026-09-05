import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/**
 * The corpus claims in the two guardrail specs stay true as `main` moves.
 *
 * WHY THIS IS NOT A COUNT CHECK. Every figure these rows quote is derived from
 * `eval/runlogs/`, and that tree changed 1,691 times across 389 commits in the
 * 30 days before this was written, in 98 distinct merged PRs. A guard asserting
 * the raw counts would therefore have reddened 98 PRs that had nothing to do
 * with these specs, at roughly three a day. That is a worse problem than the
 * drift it would catch, so this guard holds the claims that DO NOT move:
 *
 *   1. The documented call shape is still the norm. If most `plans` appends
 *      stopped omitting `items`, the satisfiability argument for the rule would
 *      be gone, and that is worth failing over.
 *   2. No row claims a shape is ABSENT while the corpus contains it. This is
 *      the exact defect that shipped: the spec said the misroute arm fires on
 *      "0 of 304" while five run logs landed in `main` carrying six instances.
 *      An absence claim is the one kind that rots into a falsehood rather than
 *      merely going stale, because a growing corpus can only refute it.
 *   3. Every quoted figure carries a `measured at <sha>` stamp naming a real
 *      ancestor commit, so a reader can tell what the number was true of.
 *
 * The derivation below is the single documented method both rows now use:
 * ops in the `args` of each `tool_calls[]` entry, over tracked files under
 * `eval/runlogs/` excluding `.ann.json`. It runs in about two seconds.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..", "..", "..", "..");
const SPECS = [
  "docs/specs/guardrail-enforcement-spec.md",
  "docs/specs/research-append-tool-spec.md",
] as const;

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: projectRoot, encoding: "utf8", maxBuffer: 1 << 28 });

function trackedRunLogs(): string[] {
  return git("ls-files", "eval/runlogs/*.json")
    .split("\n")
    .filter((f) => f && !f.endsWith(".ann.json"));
}

/** Every `tool_calls[]` entry anywhere in a run log, visiting each object once. */
function* toolCalls(node: unknown, seen: Set<unknown>): Generator<any> {
  if (node === null || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const v of node) yield* toolCalls(v, seen);
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "tool_calls" && Array.isArray(v)) {
      for (const c of v) {
        if (c && typeof c === "object" && typeof (c as any).tool === "string" && "args" in (c as any)) {
          yield c;
        }
      }
    }
    yield* toolCalls(v, seen);
  }
}

function opsOf(call: any, section: string): any[] {
  const a = call.args ?? {};
  if (Array.isArray(a.ops)) return a.ops.filter((o: any) => o && o.section === section);
  if (a.section === section) return [{ section, op: a.op, entry: a.entry, planId: a.planId }];
  return [];
}

/** `nextResearchId`'s rule: highest existing + 1, zero-padded to 3. */
function nextPlanId(existing: string[]): string {
  let n = 0;
  for (const id of existing) {
    const m = /^pl_(\d+)$/.exec(String(id));
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `pl_${String(n + 1).padStart(3, "0")}`;
}

interface Derived {
  planAppendOps: number;
  omitItems: number;
  misrouteFloor: number;
  /** Scopes whose scenario fixture yielded at least one seeded plan id. The
   *  misroute arm returns early on a zero floor, so without this a renamed
   *  fixture directory zeroes the floor and retires that arm silently. */
  seededScopes: number;
}

function derive(): Derived {
  let planAppendOps = 0;
  let omitItems = 0;
  let misrouteFloor = 0;
  let seededScopes = 0;
  for (const rel of trackedRunLogs()) {
    let doc: any;
    try {
      doc = JSON.parse(readFileSync(join(projectRoot, rel), "utf8"));
    } catch {
      continue; // a malformed log is not this guard's business
    }
    const scopes: any[] = Array.isArray(doc?.tests) ? doc.tests : [doc];
    for (const scope of scopes) {
      // A run's scenario fixture gives the seeded plan ids, which is what makes
      // the assigned `pl_` id derivable. A refused call writes nothing, so the
      // seeded state also holds for the retry, and BOTH halves of a retry loop
      // are derivable rather than only the first.
      let seeded: string[] = [];
      const scen = scope?.scenario;
      if (typeof scen === "string") {
        try {
          const fixture = JSON.parse(
            readFileSync(join(projectRoot, "eval/fixtures/scenarios", scen, "research.json"), "utf8"),
          );
          seeded = (fixture.plans ?? []).map((p: any) => p?.id).filter(Boolean);
          if (seeded.length > 0) seededScopes += 1;
        } catch {
          seeded = [];
        }
      }
      for (const call of toolCalls(scope, new Set())) {
        if (!String(call.tool).includes("research_append")) continue;
        const planAppends = opsOf(call, "plans").filter((o) => o.op === "append");
        const itemOps = opsOf(call, "plan_items");
        for (const o of planAppends) {
          planAppendOps += 1;
          const e = o.entry;
          if (e && typeof e === "object" && !("items" in e)) omitItems += 1;
        }
        if (planAppends.length > 0 && seeded.length > 0 && itemOps.length > 0) {
          const created = nextPlanId(seeded);
          const named = new Set(itemOps.map((x) => String(x.planId)).filter((s) => s !== "undefined"));
          const e = planAppends[0].entry ?? {};
          const endsEmpty =
            !("items" in e) || (Array.isArray((e as any).items) && (e as any).items.length === 0);
          if (endsEmpty && named.size > 0 && !named.has(created)) misrouteFloor += 1;
        }
      }
    }
  }
  return { planAppendOps, omitItems, misrouteFloor, seededScopes };
}

const specText = Object.fromEntries(
  SPECS.map((rel) => [rel, readFileSync(join(projectRoot, rel), "utf8")]),
) as Record<string, string>;

describe("the specs' corpus claims survive main moving", () => {
  const d = derive();

  it("derives a non-trivial corpus, so a green result is not vacuous", () => {
    // Without this, a broken traversal returns zeros and every assertion below
    // passes for the wrong reason.
    expect(
      d.planAppendOps,
      "derived 0 `plans` append ops — the traversal is broken, not the corpus empty",
    ).toBeGreaterThan(50);
    // And the SEED lookup specifically. The misroute arm below returns early on a
    // zero floor, which is correct when the corpus holds no instances and
    // indistinguishable from a broken fixture path, since the lookup sits inside
    // a `catch { seeded = [] }`. Renaming one path segment took the floor from 6
    // to 0 with the file still green. 1322 of 2545 scopes resolve today.
    expect(
      d.seededScopes,
      "no run-log scope resolved its scenario's seeded plan ids — the fixture " +
        "lookup is broken, so misrouteFloor is 0 for the wrong reason",
    ).toBeGreaterThan(100);
  });

  it("the documented call shape is still the norm the rule rests on", () => {
    // ADR-0011's satisfiability argument for the plan rules is that nearly every
    // real call already omits `items` and batches the item ops. A floor, not an
    // exact count, because the count moves with every landed run log.
    const share = d.omitItems / d.planAppendOps;
    expect(
      share,
      `only ${d.omitItems} of ${d.planAppendOps} \`plans\` append ops omit \`items\` ` +
        `(${(share * 100).toFixed(1)}%). The rule's satisfiability argument is that the ` +
        `batched shape is what agents already produce; if that stopped being true the ` +
        `argument needs rewriting, not the floor lowering.`,
    ).toBeGreaterThan(0.8);
  });

  it("no spec claims the misroute arm never fires while the corpus says it does", () => {
    // THE DEFECT THIS GUARD EXISTS FOR. The row read "fires on 0 of 304" while
    // five run logs in `main` carried six instances. An absence claim is the one
    // kind a growing corpus can only refute, so it is the one worth asserting.
    if (d.misrouteFloor === 0) return; // nothing to contradict
    const offenders: string[] = [];
    for (const [rel, text] of Object.entries(specText)) {
      // Emphasis- and wrap-tolerant: markdown splits phrases with ** and
      // newlines, so a literal search for "0 of 304" finds nothing.
      const flat = text.replace(/[*`_]/g, "").replace(/\s+/g, " ");
      // Scoped to the misroute arm. "never fires" also describes the raw-write
      // lockdown and a caller rule elsewhere in these files, and flagging those
      // would make this guard a nuisance nobody keeps.
      const ABSENCE = /(fires on 0\b|fires on none|never fires|0 of \d+)/gi;
      for (const m of flat.matchAll(ABSENCE)) {
        const around = flat.slice(Math.max(0, m.index! - 220), m.index! + 220);
        if (/misroute|misrouted|plans append ops|plan_items op/i.test(around)) {
          offenders.push(`${rel}: "${m[0]}" asserted of the misroute arm`);
        }
      }
    }
    expect(
      offenders,
      `the corpus derives ${d.misrouteFloor} misrouting \`plans\` append op(s), so a spec ` +
        `claiming it never fires is false. Re-derive and state the floor instead.`,
    ).toEqual([]);
  });

  it("every quoted corpus figure names the commit it was measured at", () => {
    // A stamped figure stays true of something; an unstamped one silently rots.
    // PER FIGURE, not per file. The first draft asked whether the file
    // contained a stamp anywhere; by that point the whole file is one string,
    // so a single stamp covered every figure in it. A reviewer inserted a
    // fabricated `of 999 corpus plans append ops` row with no stamp near it and
    // the suite stayed green — which is the case that will actually happen,
    // when someone adds a figure next to an already-stamped one.
    // Two alternatives: the `plans append ops` phrasing, and any `N of M (P%)`
    // headline. Digit classes allow commas and more than four digits: the
    // reviewer's form was `\d{1,4}`, and this file's own neighbours already
    // include `3,466 of 7,238`, so the next comma-grouped figure would have
    // slipped through unstamped. Widening costs nothing measured: both specs
    // still yield the same four matches and no false positive, and the
    // interposed-words case (`3,466 of 7,238 write units (47%)`) stays out
    // because the paren must follow the second number directly.
    const FIGURE =
      /\b(?:of|fires on) [\d,]{1,7} (?:corpus )?plans append ops|\b[\d,]{1,7} of [\d,]{1,7} \(\d+(?:\.\d+)?%\)/gi;
    const STAMP = /measured at [0-9a-f]{7,40}\b/i;
    const missing: string[] = [];
    for (const [rel, text] of Object.entries(specText)) {
      const flat = text.replace(/[*`_]/g, "").replace(/\s+/g, " ");
      // Shape and proximity only. An earlier arm also asserted the sha was an
      // ANCESTOR of HEAD; it passed locally and failed CI on all four stamps,
      // because the workflow checks out shallow and a real commit is simply
      // unreachable there. Raising fetch-depth on every run for one check is
      // the wrong trade, and skipping when the history is shallow would stand
      // the check down exactly where it runs. A further draft validated every
      // "measured at X" in the file and false-flagged a pre-existing sentence
      // about a measured VALUE (`measured at 0.9999484`); the 300-character
      // window below does not re-trip it, because that sentence sits nowhere
      // near a figure. Reachability is a human's job when they chase a stamp.
      for (const m of flat.matchAll(FIGURE)) {
        const near = flat.slice(Math.max(0, m.index! - 300), m.index! + m[0].length + 300);
        if (!STAMP.test(near)) {
          missing.push(`${rel}: "${m[0]}" carries no "measured at <sha>" stamp within 300 characters`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

});
