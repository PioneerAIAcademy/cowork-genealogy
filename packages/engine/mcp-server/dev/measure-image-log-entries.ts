/**
 * Measure: how often `research_log_append` refuses an image-tool entry no image
 * call stands behind (search-result-staging-spec.md §6.1), over every committed
 * run log.
 *
 * Judges each `image_transcribe` / `image_read` op (its tool name read as the
 * check reads it, `canonicalToolName`) of every recorded `research_log_append`
 * call with the real `imageToolEntryRefusal`, the args as the call sent them.
 * For each refusal it names the page call behind it: an earlier
 * `image_transcribe` in the same run reading a page the entry names (by ARK,
 * image id, file, or an id in a page list, any ARK form read by `arkToBareId`), and
 * whether that call returned a `staged` ref. A call made inside a subagent the run did not capture, or a
 * response stripped from an old e2e log, reads as no call or no `staged`.
 *
 * A run log records each call in more than one place, so calls are de-duplicated
 * per run. A log entry written by a call the run did not capture is not seen;
 * compare the final states with a walk of `log[]` before quoting a total.
 *
 * Offline; no FamilySearch session needed. Not shipped in any artifact.
 *
 * Usage:
 *   npx tsx dev/measure-image-log-entries.ts [--list]
 */
import { execFileSync } from "node:child_process";
import { canonicalToolName, imageToolEntryRefusal } from "../src/tools/research-log-append.js";
import { arkToBareId } from "../src/utils/ark.js";
import { bareName, opsOf, readRunLog, repoRoot, responseOf, runLogFiles, toolCalls } from "./runlog-calls.js";

const list = process.argv.includes("--list");
const IMAGE_TOOLS = new Set(["image_transcribe", "image_read"]);

/** Page identifiers a query or a call's args name, normalized for matching. */
function pages(o: unknown): Set<string> {
  const out = new Set<string>();
  let q = o;
  if (typeof q === "string") {
    try {
      q = JSON.parse(q);
    } catch {
      return out;
    }
  }
  if (!q || typeof q !== "object" || Array.isArray(q)) return out;
  const add = (v: unknown) => {
    if (typeof v !== "string") return;
    out.add(arkToBareId(v.trim()));
    // A model sometimes wraps a DGS image id in an ARK prefix
    // (`ark:/61903/3:1:004514823_00106`), which `arkToBareId` cuts at the `_`;
    // read the id itself too, so the page still matches the call that read it.
    const dgs = /(\d+_\d+)$/.exec(v.trim());
    if (dgs) out.add(dgs[1]);
  };
  for (const k of ["imageArk", "ark", "imageId", "file"]) add((q as Record<string, unknown>)[k]);
  for (const k of ["imageIds", "imageIdsExamined", "pagesRead"]) {
    const v = (q as Record<string, unknown>)[k];
    if (Array.isArray(v)) v.forEach(add);
  }
  return out;
}

type Refused = {
  file: string;
  testId: string;
  tool: string;
  outcome: unknown;
  examined: unknown;
  query: unknown;
  behind: string;
  message: string;
};

const files = runLogFiles();
let judged = 0;
const refused: Refused[] = [];
const byCorpus = new Map<string, [number, number]>();

for (const f of files) {
  const doc = readRunLog(f) as any;
  if (doc === undefined) continue;
  const units: { testId: string; node: unknown }[] = Array.isArray(doc?.tests)
    ? doc.tests.map((t: any) => ({ testId: String(t?.test_id ?? "?"), node: t }))
    : [{ testId: "-", node: doc }];
  const corpus = f.split("/")[2];
  for (const { testId, node } of units) {
    for (const run of Array.isArray((node as any)?.runs) ? (node as any).runs : [node]) {
      const seen = new Set<string>();
      const calls = [...toolCalls(run)].filter((c) => {
        const k = JSON.stringify([c.tool, c.args, c.response ?? c.response_summary ?? null]);
        return seen.has(k) ? false : (seen.add(k), true);
      });
      const reads: { pages: Set<string>; staged: boolean | undefined }[] = [];
      for (const c of calls) {
        const name = bareName(c);
        if (name === "image_transcribe") {
          const r = responseOf(c);
          reads.push({ pages: pages(c.args), staged: r === undefined ? undefined : typeof r?.staged?.resultsRef === "string" });
          continue;
        }
        if (name !== "research_log_append") continue;
        for (const op of opsOf(c.args)) {
          if (!op || typeof op !== "object" || !IMAGE_TOOLS.has(canonicalToolName(op.tool) ?? "")) continue;
          judged++;
          const [n, r] = byCorpus.get(corpus) ?? [0, 0];
          const refusal = imageToolEntryRefusal(op);
          byCorpus.set(corpus, [n + 1, r + (refusal ? 1 : 0)]);
          if (!refusal) continue;
          const mine = pages(op.query);
          const match = reads.filter((x) => [...mine].some((p) => x.pages.has(p)));
          const behind =
            match.length === 0
              ? "no captured image_transcribe of this page"
              : match.some((x) => x.staged === true)
                ? "a call that returned staged"
                : match.some((x) => x.staged === undefined)
                  ? "a call whose response is not readable"
                  : "a call that staged nothing";
          refused.push({
            file: f,
            testId,
            tool: op.tool,
            outcome: op.outcome,
            examined: op.resultsExamined,
            query: op.query,
            behind,
            message: refusal,
          });
        }
      }
    }
  }
}

const head = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], { cwd: repoRoot, encoding: "utf-8" }).trim();
const dirty = (path: string) =>
  execFileSync("git", ["status", "--porcelain", path], { cwd: repoRoot, encoding: "utf-8" }).trim() !== "";
const notes = [
  dirty("eval/runlogs") ? "eval/runlogs has uncommitted changes" : "",
  dirty("packages/engine/mcp-server/src/tools/research-log-append.ts") ? "the check has uncommitted changes" : "",
].filter(Boolean);
console.log(`HEAD ${head}${notes.length ? ` (${notes.join("; ")})` : ""}; ${files.length} run-log files`);
console.log(`\n${judged} image_transcribe/image_read ops judged; refused ${refused.length}`);
console.log(`by corpus (refused/judged): ${[...byCorpus].map(([c, [n, r]]) => `${c} ${r}/${n}`).join(", ")}`);
const byBehind = new Map<string, number>();
for (const r of refused) byBehind.set(r.behind, (byBehind.get(r.behind) ?? 0) + 1);
console.log(`refused, by what stands behind: ${[...byBehind].map(([b, n]) => `${b} ${n}`).join("; ") || "none"}`);
const hinted = refused.filter((r) => /tool: "image_search"/.test(r.message)).length;
console.log(`refused and told image_search (a browse): ${hinted}`);
if (list) {
  for (const r of refused) {
    console.log(`\n- ${r.file} ${r.testId} (${r.tool}, ${String(r.outcome)}, examined ${JSON.stringify(r.examined)})`);
    console.log(`  query: ${JSON.stringify(r.query)}`);
    console.log(`  behind: ${r.behind}`);
    if (/tool: "image_search"/.test(r.message)) console.log("  told image_search");
  }
}
