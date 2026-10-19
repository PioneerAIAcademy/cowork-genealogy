/**
 * Measure: how often `research_log_append` refuses a `query` claiming a filter
 * its staged search never sent (research-log-editor-spec.md §8.3), over every
 * committed run log.
 *
 * For each research_log_append op that names a staged handle and carries an
 * explicit `query`, finds the record_search / fulltext_search call in the same
 * file whose response staged that handle, and judges the op with the real
 * `neverSentFilterClaims` against that call's ARGS. The args, not the response's
 * `query`: production's staged `query` is `echoQuery(input)`, i.e. the args, but
 * a unit run log recorded before the eval mock echoed them holds the fixture's
 * canned query instead. Unpaired ops are counted, not guessed.
 *
 * Re-run rather than quoting the figures forward: a re-run of a skill REPLACES
 * its run log, so the corpus moves in both directions.
 *
 * Offline; no FamilySearch session needed. Not shipped in any artifact.
 *
 * Usage:
 *   npx tsx dev/measure-log-query-claims.ts [--list]
 */
import { execFileSync } from "node:child_process";
import { neverSentFilterClaims } from "../src/tools/research-log-append.js";
import { stripQueryPlumbing } from "../src/utils/results-staging.js";
import { bareName, opsOf, readRunLog, repoRoot, responseOf, runLogFiles, toolCalls } from "./runlog-calls.js";

const list = process.argv.includes("--list");
const PRODUCERS = new Set(["record_search", "fulltext_search"]);

type Judged = { file: string; testId: string; tool: string; ref: string; claims: { key: string; value: unknown }[]; query: unknown; sent: unknown };

const files = runLogFiles();
let candidates = 0;
let unpaired = 0;
const judged: Judged[] = [];

for (const f of files) {
  const doc = readRunLog(f) as any;
  if (doc === undefined) continue;
  // Walk per test where the file has tests, so a refusal names its test id.
  const units: { testId: string; node: unknown }[] = Array.isArray(doc?.tests)
    ? doc.tests.map((t: any) => ({ testId: String(t?.test_id ?? "?"), node: t }))
    : [{ testId: "-", node: doc }];
  for (const { testId, node } of units) {
    for (const run of Array.isArray((node as any)?.runs) ? (node as any).runs : [node]) {
      // An e2e log records each call in more than one place; judge each once.
      const seen = new Set<string>();
      const calls = [...toolCalls(run)].filter((c) => {
        const k = JSON.stringify([c.tool, c.args, c.response ?? c.response_summary ?? null]);
        return seen.has(k) ? false : (seen.add(k), true);
      });
      const sentByRef = new Map<string, { tool: string; args: any }>();
      for (const c of calls) {
        const name = bareName(c);
        if (!PRODUCERS.has(name)) continue;
        const ref = responseOf(c)?.staged?.resultsRef;
        if (typeof ref === "string") sentByRef.set(ref, { tool: name, args: c.args });
      }
      for (const c of calls) {
        if (bareName(c) !== "research_log_append") continue;
        for (const op of opsOf(c.args)) {
          if (!PRODUCERS.has(op?.tool) || typeof op?.stagedResultsRef !== "string") continue;
          if (op.query === undefined || op.query === null) continue;
          candidates++;
          const producer = sentByRef.get(op.stagedResultsRef);
          if (!producer || producer.tool !== op.tool) {
            unpaired++;
            continue;
          }
          let query = op.query;
          if (typeof query === "string") {
            try {
              query = JSON.parse(query);
            } catch {
              /* judged as-is: the tool refuses unparseable text for another reason */
            }
          }
          const sent = stripQueryPlumbing(producer.args);
          judged.push({ file: f, testId, tool: op.tool, ref: op.stagedResultsRef, query, sent, claims: neverSentFilterClaims(op.tool, query, sent) });
        }
      }
    }
  }
}

const refused = judged.filter((j) => j.claims.length > 0);
const head = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], { cwd: repoRoot, encoding: "utf-8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "eval/runlogs"], { cwd: repoRoot, encoding: "utf-8" }).trim();
console.log(`HEAD ${head}${dirty ? " (eval/runlogs has uncommitted changes)" : ""}; ${files.length} run-log files`);
console.log(`\n${candidates} staged record_search/fulltext_search ops with an explicit query; ${judged.length} paired, ${unpaired} unpaired`);
const distinct = new Set(refused.map((r) => JSON.stringify([r.file, r.testId, r.query, r.sent]))).size;
console.log(
  `refused: ${refused.length} of ${judged.length} paired (${distinct} distinct; a repeat is a re-sent call), ` +
    `in ${new Set(refused.map((r) => r.file)).size} run-log file(s)`,
);
const byCorpus = new Map<string, [number, number]>();
for (const j of judged) {
  const c = j.file.split("/")[2];
  const [n, r] = byCorpus.get(c) ?? [0, 0];
  byCorpus.set(c, [n + 1, r + (j.claims.length > 0 ? 1 : 0)]);
}
console.log(`by corpus (refused/paired): ${[...byCorpus].map(([c, [n, r]]) => `${c} ${r}/${n}`).join(", ")}`);
const byKey = new Map<string, number>();
for (const r of refused) for (const c of r.claims) byKey.set(c.key, (byKey.get(c.key) ?? 0) + 1);
console.log(`by key: ${[...byKey].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`);
if (list) {
  for (const r of refused) {
    console.log(`\n- ${r.file} ${r.testId} (${r.tool})`);
    console.log(`  claims: ${r.claims.map((c) => `${c.key}=${JSON.stringify(c.value)}`).join(", ")}`);
    console.log(`  logged: ${JSON.stringify(r.query)}`);
    console.log(`  sent:   ${JSON.stringify(r.sent)}`);
  }
}
