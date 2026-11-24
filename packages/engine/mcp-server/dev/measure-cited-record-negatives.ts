/**
 * Measure: how often `research_log_append`'s cited-record check (issue #4667)
 * refuses, over every negative record_search log op the committed run logs carry.
 *
 * The figures in docs/specs/guardrail-enforcement-spec.md (§4 register row and
 * the §5 "A negative search's rows include a record the tree cites on its
 * subject" subsection) come from this script. Re-run it rather than quoting
 * them: a re-run of a skill REPLACES its run log, so the corpus moves.
 *
 * For each research_log_append op with `tool: "record_search"`,
 * `outcome` `"negative"` or `"error"` and a `stagedResultsRef`, it finds the record_search
 * call whose response staged that handle and judges the op with
 * `citedSubjectRows` / `citedRecordNegativeError`. The staged query is the
 * call's own `args` (record_search stages `echoQuery(input)`, subjectId
 * included); the rows are the response's `results`, which is the page shown,
 * so a hit outside it is missed (a lower bound on that axis).
 *
 * The tree as it stood at log time is in no run log, so:
 *   - unit run logs: the test's `scenario` tree,
 *     `eval/fixtures/scenarios/<scenario>/tree.gedcomx.json`;
 *   - e2e run logs: judged twice, against the fixture's
 *     `eval/tests/e2e/<slug>/starting-tree.gedcomx.json` (LOWER bound: the
 *     tree grows during the run) and the run's committed
 *     `<run>.final-tree.gedcomx.json` (UPPER bound: it may cite records only
 *     after the search was logged).
 * e2e logs keep a `response_summary` string that is sometimes truncated; an op
 * whose response cannot be read is counted as unpaired, never guessed.
 *
 * It also reports CANDIDATES: ops whose rows include a cited subject record
 * before the "what the search was for" condition is applied, so the spec can
 * say how many that condition lets through.
 *
 * Offline; no FamilySearch session needed. Not shipped in any artifact.
 *
 * Usage:
 *   npx tsx dev/measure-cited-record-negatives.ts [--list]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { citedRecordNegativeError, citedSubjectRows } from "../src/tools/research-log-append.js";
import { sanitizeTree } from "../src/validation/tree-sanitize.js";
import { bareName, opsOf, readRunLog, repoRoot, responseOf, runLogFiles, toolCalls } from "./runlog-calls.js";

const list = process.argv.slice(2).includes("--list");

const treeCache = new Map<string, any | null>();
function readTree(rel: string): any | null {
  if (!treeCache.has(rel)) {
    const abs = join(repoRoot, rel);
    let tree: any | null = null;
    if (existsSync(abs)) {
      try {
        // The tool judges the sanitized tree, so the replay does too.
        tree = sanitizeTree(JSON.parse(readFileSync(abs, "utf-8"))).tree;
      } catch {
        tree = null;
      }
    }
    treeCache.set(rel, tree);
  }
  return treeCache.get(rel)!;
}

type Judged = { file: string; label: string; ref: string; query: any; rows: unknown[]; notes: string; outcome: string };
type Candidate = Judged & { cited: string[]; refused: boolean };
type Tally = { ops: number; noTree: number; candidates: Candidate[]; refused: number };
const tally = (): Tally => ({ ops: 0, noTree: 0, candidates: [], refused: 0 });

let negativeOps = 0;
let unpaired = 0;
/** Paired ops whose rows come only from a truncated summary's `_first_n`. */
let truncatedRows = 0;
/** Every record_search with a subject, any outcome, with a row the tree cites on that subject: shows the matcher can see one at all. */
let citedAnyOutcome = 0;
const unit = tally();
const e2eLower = tally();
const e2eUpper = tally();

/** The negative or error staged record_search ops under `node`, each paired with the call that staged its handle. */
type Paired = { ref: string; query: any; rows: unknown[]; notes: string; outcome: string };
function pairedNegatives(node: unknown, controlTree: any | null): Paired[] {
  const staged = new Map<string, { query: any; rows: unknown[]; truncated: boolean }>();
  const negatives: { ref: string; notes: string; outcome: string }[] = [];
  for (const call of toolCalls(node)) {
    const name = bareName(call);
    if (name === "record_search") {
      const r = responseOf(call);
      const ref = r?.staged?.resultsRef;
      // A compacted e2e summary keeps the first rows as `results._first_n`.
      const rows = Array.isArray(r?.results) ? r.results : r?.results?._first_n;
      if (typeof ref === "string" && Array.isArray(rows)) staged.set(ref, { query: call.args, rows, truncated: !Array.isArray(r.results) });
      if (controlTree && Array.isArray(rows) && citedSubjectRows(call.args, rows, controlTree).length > 0) citedAnyOutcome++;
    } else if (name === "research_log_append") {
      for (const op of opsOf(call.args)) {
        if (op?.tool === "record_search" && (op?.outcome === "negative" || op?.outcome === "error") && typeof op?.stagedResultsRef === "string") {
          negatives.push({ ref: op.stagedResultsRef, notes: typeof op.notes === "string" ? op.notes : "", outcome: op.outcome });
        }
      }
    }
  }
  negativeOps += negatives.length;
  const out: Paired[] = [];
  for (const { ref, notes, outcome } of negatives) {
    const s = staged.get(ref);
    if (!s) {
      unpaired++;
      continue;
    }
    if (s.truncated) truncatedRows++;
    out.push({ ref, notes, outcome, query: s.query, rows: s.rows });
  }
  return out;
}

function judge(t: Tally, j: Judged, tree: any | null) {
  t.ops++;
  if (!tree) {
    t.noTree++;
    return;
  }
  const staged = { envelope: { payload: { query: j.query, results: j.rows } } };
  const refused = citedRecordNegativeError({ tool: "record_search", outcome: j.outcome }, staged, tree) !== null;
  if (refused) t.refused++;
  const cited = citedSubjectRows(j.query, j.rows, tree).map(
    (c) => `${c.recordId} (${c.sourceIds.join(",")}${c.forTheSearch ? ", for the search" : ""})`,
  );
  if (cited.length > 0) t.candidates.push({ ...j, cited, refused });
}

const files = runLogFiles().filter((f) => !f.endsWith(".gedcomx.json"));
for (const file of files) {
  const doc: any = readRunLog(file);
  if (doc === undefined) continue;
  if (file.startsWith("eval/runlogs/e2e/")) {
    const slug = file.split("/")[3];
    const lower = readTree(`eval/tests/e2e/${slug}/starting-tree.gedcomx.json`);
    const upper = readTree(file.replace(/\.json$/, ".final-tree.gedcomx.json"));
    for (const p of pairedNegatives(doc, upper)) {
      const j = { file, label: slug, ...p };
      judge(e2eLower, j, lower);
      judge(e2eUpper, j, upper);
    }
  } else if (Array.isArray(doc?.tests)) {
    for (const test of doc.tests) {
      const scenario = typeof test?.scenario === "string" ? test.scenario : undefined;
      const tree = scenario ? readTree(`eval/fixtures/scenarios/${scenario}/tree.gedcomx.json`) : null;
      for (const p of pairedNegatives(test, tree)) judge(unit, { file, label: String(test?.test_id), ...p }, tree);
    }
  }
}

const head = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], { cwd: repoRoot, encoding: "utf-8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "eval/runlogs"], { cwd: repoRoot, encoding: "utf-8" }).trim();
console.log(`HEAD ${head}${dirty ? " (eval/runlogs has uncommitted changes)" : ""}; ${files.length} run-log files`);
console.log(
  `negative or error staged record_search ops: ${negativeOps}; paired with their search: ${negativeOps - unpaired}; ` +
    `unpaired (response missing or truncated): ${unpaired}; of the paired, judged on a truncated summary's first rows only: ${truncatedRows}`,
);
console.log(
  `control: record_search calls (ANY outcome) whose rows include a record the tree cites on their subject: ${citedAnyOutcome}` +
    (citedAnyOutcome === 0 ? "  <-- 0 here means the matcher sees nothing; do not trust a 0 below" : ""),
);

function report(name: string, t: Tally) {
  console.log(
    `\n${name}: ${t.ops} paired ops (${t.noTree} with no tree to judge against); ` +
      `candidates (a cited subject record in the rows): ${t.candidates.length}; refused: ${t.refused}`,
  );
  if (!list) return;
  for (const c of t.candidates) {
    const { projectPath: _p, ...q } = c.query ?? {};
    console.log(
      `  - [${c.refused ? "REFUSED" : "allowed"}] ${c.label} ${c.file}\n` +
        `      query ${JSON.stringify(q)}\n` +
        `      cited rows ${c.cited.join("; ")}\n` +
        `      notes ${c.notes.slice(0, 400)}`,
    );
  }
}
report("UNIT (scenario tree)", unit);
report("E2E lower bound (starting tree)", e2eLower);
report("E2E upper bound (final tree)", e2eUpper);
