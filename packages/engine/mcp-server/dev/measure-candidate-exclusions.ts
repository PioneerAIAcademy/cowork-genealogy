/**
 * Measure: what the candidate refusals (issue #4580), `record_search`'s birth
 * range refusal and `research_append`'s namesake row refusal, refuse over the
 * committed corpus. ADR-0011 owes a gate this replay before
 * merge, with every refusal read; the figures in
 * docs/specs/record-search-tool-spec-v2.md ("A birth range may not exclude a
 * candidate already found") and the guardrail-enforcement-spec.md §4 row come
 * from it. Re-run it rather than quoting them: the corpus moves.
 *
 * Three passes, each through the engine's own function, against a temporary
 * project written with the default (file) store. The tree is the scenario's, or
 * for e2e the fixture's starting tree for the calls and the run's final tree for
 * the final-state sweep:
 *
 *   CALLS. Every `record_search` a committed run log made with a `projectPath`
 *   and a birth range, judged against the project as it stood at that call, and
 *   counted apart by whether it named a `subjectId` (a call that names none is
 *   judged for the project subjects whose given name it searches): the starting state (a unit test's scenario `research.json` and
 *   its `results/`; an e2e fixture's `starting-research.json`) plus every
 *   `record_search` the run had already logged by then — a
 *   `research_log_append` op with `stagedResultsRef` and `outcome`, paired with
 *   the call that staged that handle, whose rows and `totalMatches` become the
 *   sidecar. The rows are the response's, which is the page shown (an e2e
 *   summary may keep only its first rows); an op that cannot be paired is
 *   counted and skipped, never guessed.
 *
 *   NAMESAKES. Every `namesakes` append and update a committed run log's
 *   `research_append` made, judged by `namesakeCandidateRefusals` against the
 *   same rebuilt project plus the rows the run had written by then (a refused
 *   row is not added). Links come from the starting research only, so a row a
 *   run's own later `person_evidence` would release is counted refused: read
 *   each one.
 *
 *   CANDIDATES. Every candidate the guard sees in each scenario, and in each e2e
 *   run's final reconstructed state, for each subject: every refusal the rule
 *   can make in that project is one of these. Each is listed with the subject's
 *   tree birth year and whether the natural search for the subject (its birth
 *   year +/- 5) would be refused.
 *
 * Offline; no FamilySearch session needed. Not shipped in any artifact.
 *
 * Usage:
 *   npx tsx dev/measure-candidate-exclusions.ts [--list]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjectStore } from "../src/store/project-store.js";
import { yearsIn } from "../src/utils/attached-births.js";
import {
  excludedCandidates,
  namesakeCandidateRefusals,
  type CandidateExclusionInput,
  type ExcludedCandidate,
} from "../src/utils/candidate-exclusion.js";
import { bareName, opsOf, readRunLog, repoRoot, responseOf, runLogFiles, toolCalls } from "./runlog-calls.js";

const list = process.argv.slice(2).includes("--list");

type Sidecar = { ref: string; outcome: string; query: any; total: number | undefined; rows: unknown[] };
/** `base`: the starting project's own logged sidecars; `sidecars`: those the run logged since;
 *  `namesakes`: the rows the run wrote since, which release their records. */
type State = { research: any; sidecars: Sidecar[]; tree: any | null; base?: Sidecar[]; namesakes?: any[] };

const readJson = (abs: string): any | null => {
  try {
    return JSON.parse(readFileSync(abs, "utf-8"));
  } catch {
    return null;
  }
};

/** A scenario's research.json and every sidecar its log names. */
function scenarioState(name: string): State | null {
  const dir = join(repoRoot, "eval/fixtures/scenarios", name);
  const research = readJson(join(dir, "research.json"));
  if (!research) return null;
  const sidecars: Sidecar[] = [];
  for (const e of Array.isArray(research.log) ? research.log : []) {
    if (e?.tool !== "record_search" || typeof e?.results_ref !== "string") continue;
    const s = readJson(join(dir, e.results_ref));
    if (!s?.payload) continue;
    sidecars.push({
      ref: e.results_ref,
      outcome: e.outcome,
      query: s.payload.query,
      total: s.payload.totalMatches,
      rows: Array.isArray(s.payload.results) ? s.payload.results : [],
    });
  }
  return { research, sidecars: [], tree: readJson(join(dir, "tree.gedcomx.json")), base: sidecars };
}

/** `state`'s research as the guard reads it, with the replay's sidecars and namesake rows. */
function researchOf(state: State): any {
  const all = [...(state.base ?? []), ...state.sidecars];
  const baseLog = (Array.isArray(state.research?.log) ? state.research.log : []).filter(
    (e: any) => !(e?.tool === "record_search" && typeof e?.results_ref === "string"),
  );
  const log = [
    ...baseLog,
    ...all.map((s, i) => ({ id: `log_r${i + 1}`, tool: "record_search", outcome: s.outcome, results_ref: `results/log_r${i + 1}.json` })),
  ];
  const namesakes = [...(Array.isArray(state.research?.namesakes) ? state.research.namesakes : []), ...(state.namesakes ?? [])];
  return { ...state.research, log, namesakes };
}

/** Write `state` to a fresh temporary project and run `fn` there. */
async function inProject<T>(state: State, fn: (dir: string, research: any) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "cand-excl-"));
  try {
    const store = getProjectStore();
    const all = [...(state.base ?? []), ...state.sidecars];
    const research = researchOf(state);
    await store.writeJson(dir, "research.json", research);
    if (state.tree) await store.writeJson(dir, "tree.gedcomx.json", state.tree);
    for (const [i, s] of all.entries()) {
      await store.writeJson(dir, `results/log_r${i + 1}.json`, {
        payload: { query: s.query, ...(typeof s.total === "number" ? { totalMatches: s.total } : {}), results: s.rows },
      });
    }
    return await fn(dir, research);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Write `state` to a fresh temporary project and run the guard there. */
async function judge(state: State, input: Omit<CandidateExclusionInput, "projectPath">): Promise<ExcludedCandidate[]> {
  return inProject(state, (dir) => excludedCandidates({ projectPath: dir, ...input }));
}

function subjectBirth(tree: any, id: string): number | undefined {
  const p = (Array.isArray(tree?.persons) ? tree.persons : []).find((x: any) => x?.id === id);
  const birth = (Array.isArray(p?.facts) ? p.facts : []).find((f: any) => f?.type === "Birth");
  return birth ? yearsIn(birth.standard_date ?? birth.date)[0] : undefined;
}

let rangedCalls = 0;
let unnamedCalls = 0;
const unnamedRefusals: string[] = [];
let namesakeWrites = 0;
const namesakeRefusals: string[] = [];
let unpairedOps = 0;
const refusals: string[] = [];
const candidateLines: string[] = [];
let candidateCount = 0;
let naturalRefused = 0;

/** Replay one test's or run's calls in order from `start`; return the final state. */
async function replayCalls(label: string, file: string, node: unknown, start: State) {
  const state: State = { ...start, sidecars: [...start.sidecars], namesakes: [] };
  const staged = new Map<string, { query: any; total: number | undefined; rows: unknown[] }>();
  for (const call of toolCalls(node)) {
    const name = bareName(call);
    if (name === "record_search") {
      const a = call.args ?? {};
      if (typeof a.projectPath === "string" &&
          (typeof a.birthYearFrom === "number" || typeof a.birthYearTo === "number")) {
        const named = typeof a.subjectId === "string";
        if (named) rangedCalls++;
        else unnamedCalls++;
        const hit = await judge(state, {
          subjectId: named ? a.subjectId : undefined, givenName: a.givenName, givenNameAlt: a.givenNameAlt,
          birthYearFrom: a.birthYearFrom, birthYearTo: a.birthYearTo,
          fatherGivenName: a.fatherGivenName, fatherSurname: a.fatherSurname,
          motherGivenName: a.motherGivenName, motherSurname: a.motherSurname,
          parentGivenName: a.parentGivenName, parentSurname: a.parentSurname,
        });
        if (hit.length > 0) {
          (named ? refusals : unnamedRefusals).push(
            `${label} ${file}\n      call ${JSON.stringify({ ...a, projectPath: undefined })}\n      excludes ` +
              hit.map((c) => `${c.personName} (${c.recordId}) b. ${c.birthYear} from ${c.logId}`).join("; "),
          );
        }
      }
      const r = responseOf(call);
      const ref = r?.staged?.resultsRef;
      const rows = Array.isArray(r?.results) ? r.results : r?.results?._first_n;
      if (typeof ref === "string" && Array.isArray(rows)) staged.set(ref, { query: a, total: r?.totalMatches, rows });
    } else if (name === "research_log_append") {
      for (const op of opsOf(call.args ?? {})) {
        if (op?.tool !== "record_search" || typeof op?.stagedResultsRef !== "string") continue;
        const s = staged.get(op.stagedResultsRef);
        if (!s) {
          unpairedOps++;
          continue;
        }
        state.sidecars.push({ ref: op.stagedResultsRef, outcome: op.outcome, ...s });
      }
    } else if (name === "research_append") {
      for (const op of opsOf(call.args ?? {})) {
        if (op?.section !== "namesakes") continue;
        const rows = state.namesakes!;
        let row: any;
        if (op.op === "append") {
          row = { id: `ns_r${rows.length + 1}`, ...decode(op.entry) };
        } else if (op.op === "update") {
          const prior = rows.find((r) => r.id === op.entryId) ??
            (Array.isArray(state.research?.namesakes) ? state.research.namesakes : []).find((r: any) => r?.id === op.entryId);
          if (!prior) continue;
          row = { ...prior, ...decode(op.fields) };
        } else continue;
        if (typeof row?.person_id !== "string") continue;
        namesakeWrites++;
        const hit = await inProject(state, async (dir, research) =>
          namesakeCandidateRefusals(dir, research, research, state.tree, [{ opIndex: 0, row }]),
        );
        if (hit.length > 0) {
          namesakeRefusals.push(`${label} ${file}\n      row ${JSON.stringify(row)}\n      ${hit[0].message}`);
          continue;
        }
        if (op.op === "append") rows.push(row);
        else {
          const at = rows.findIndex((r) => r.id === row.id);
          if (at >= 0) rows.splice(at, 1, row);
          else rows.push(row);
        }
      }
    }
  }
  return state;
}

/** An op field the model may have sent as a JSON string. */
function decode(v: unknown): any {
  if (typeof v !== "string") return v ?? {};
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
}

/** Every candidate in `state`, per subject the logged searches named. */
async function sweep(label: string, state: State) {
  const subjects = new Set<string>();
  for (const s of [...(state.base ?? []), ...state.sidecars]) {
    if (typeof s.query?.subjectId === "string") subjects.add(s.query.subjectId);
  }
  for (const subjectId of subjects) {
    // A range no year reaches: every candidate with a birth year is "excluded".
    const all = await judge(state, { subjectId, birthYearFrom: 9999 });
    const born = subjectBirth(state.tree, subjectId);
    for (const c of all) {
      candidateCount++;
      const natural = born !== undefined && (c.birthYear < born - 5 || c.birthYear > born + 5);
      if (natural) naturalRefused++;
      candidateLines.push(
        `[${natural ? "REFUSES subject+/-5" : born === undefined ? "no subject birth" : "inside subject+/-5"}] ${label} ` +
          `${subjectId} (b. ${born ?? "?"}): ${c.personName} (${c.recordId}) b. ${c.birthYear} from ${c.logId}`,
      );
    }
  }
}

const scenarioCache = new Map<string, State | null>();
const scenario = (n: string) => {
  if (!scenarioCache.has(n)) scenarioCache.set(n, scenarioState(n));
  return scenarioCache.get(n) ?? null;
};

const files = runLogFiles().filter((f) => !f.endsWith(".gedcomx.json") && !f.endsWith(".final-research.json"));
for (const file of files) {
  const doc: any = readRunLog(file);
  if (doc === undefined) continue;
  if (file.startsWith("eval/runlogs/e2e/")) {
    const slug = file.split("/")[3];
    const research = readJson(join(repoRoot, `eval/tests/e2e/${slug}/starting-research.json`)) ?? { log: [] };
    const startTree = readJson(join(repoRoot, `eval/tests/e2e/${slug}/starting-tree.gedcomx.json`));
    const finalTree = readJson(join(repoRoot, file.replace(/\.json$/, ".final-tree.gedcomx.json")));
    const final = await replayCalls(slug, file, doc, { research, sidecars: [], tree: startTree ?? finalTree });
    await sweep(`e2e ${slug} ${file.split("/").pop()} (final)`, { ...final, tree: finalTree ?? startTree });
  } else if (Array.isArray(doc?.tests)) {
    for (const test of doc.tests) {
      const name = typeof test?.scenario === "string" ? test.scenario : undefined;
      const start = name ? scenario(name) : null;
      if (!start) continue;
      await replayCalls(String(test?.test_id), file, test, start);
    }
  }
}
const scenarios = readdirSync(join(repoRoot, "eval/fixtures/scenarios")).filter((n) =>
  existsSync(join(repoRoot, "eval/fixtures/scenarios", n, "research.json")),
);
for (const n of scenarios) {
  const s = scenario(n);
  if (s) await sweep(`scenario ${n}`, s);
}

const head = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], { cwd: repoRoot, encoding: "utf-8" }).trim();
console.log(`HEAD ${head}; ${files.length} run-log files; ${scenarios.length} scenarios`);
console.log(`CALLS: record_search calls with subjectId, projectPath and a birth range: ${rangedCalls}; refused: ${refusals.length}`);
console.log(`  with no subjectId (judged for the subjects whose given name they search): ${unnamedCalls}; refused: ${unnamedRefusals.length}`);
console.log(`  logged record_search ops whose staged search could not be paired (skipped): ${unpairedOps}`);
console.log(`NAMESAKES: namesakes appends and updates replayed: ${namesakeWrites}; refused: ${namesakeRefusals.length}`);
console.log(`CANDIDATES: ${candidateCount} (scenarios + e2e final states); the subject's own +/-5 range would be refused by ${naturalRefused}`);
if (list) {
  console.log("\nREFUSED CALLS");
  for (const r of refusals) console.log(`  - ${r}`);
  console.log("\nREFUSED CALLS WITH NO subjectId");
  for (const r of unnamedRefusals) console.log(`  - ${r}`);
  console.log("\nREFUSED NAMESAKE ROWS");
  for (const r of namesakeRefusals) console.log(`  - ${r}`);
  console.log("\nCANDIDATES");
  for (const l of [...new Set(candidateLines)]) console.log(`  - ${l}`);
}
