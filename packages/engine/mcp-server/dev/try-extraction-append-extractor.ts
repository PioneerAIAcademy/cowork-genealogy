/**
 * Smoke test: `extraction_append` EXTRACTOR MODE, end to end, live.
 *
 * Run `dev/try-login.ts` first.
 *
 * Walks the exact path the record-extraction skill will take:
 *   1. live `record_read({ recordId, projectPath })` — `resultsRef` OMITTED, so
 *      the record is fetched and its sidecar staged;
 *   2. `research_log_append({ stagedResultsRef })` to finalize that sidecar;
 *   3. `extraction_append({ logEntryId, recordId, questionIds })`.
 *
 * Prints the extraction echo and every assertion that landed in research.json,
 * then leaves the temp project in place only long enough to read it back.
 *
 * Run: `npx tsx dev/try-extraction-append-extractor.ts [recordId]` from
 * `packages/engine/mcp-server`.
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { recordReadTool } from "../src/tools/record-read.js";
import { researchLogAppend } from "../src/tools/research-log-append.js";
import { extractionAppend } from "../src/tools/extraction-append.js";
import { LOCAL } from "../src/auth/principal.js";

const EMPTY_RESEARCH = {
  project: {
    id: "rp_001",
    objective: "extractor-mode smoke",
    status: "active",
    created: "2026-01-01",
    updated: "2026-01-01",
  },
  questions: [
    {
      id: "q_001",
      text: "Who were the members of this household?",
      status: "open",
      created: "2026-01-01",
    },
  ],
  plans: [],
  log: [],
  sources: [],
  assertions: [],
  person_evidence: [],
  conflicts: [],
  hypotheses: [],
  timelines: [],
  proof_summaries: [],
  evaluations: [],
};

async function main(): Promise<void> {
  const recordId = process.argv[2] ?? "MZGS-1BH";
  const dir = mkdtempSync(join(tmpdir(), "try-extractor-mode-"));
  writeFileSync(join(dir, "research.json"), JSON.stringify(EMPTY_RESEARCH, null, 2), {
    encoding: "utf8",
  });
  writeFileSync(
    join(dir, "tree.gedcomx.json"),
    JSON.stringify({ persons: [], relationships: [], sources: [] }, null, 2),
    { encoding: "utf8" },
  );

  try {
    // 1. LIVE read — resultsRef omitted on purpose.
    const read = (await recordReadTool(
      { recordId, projectPath: dir },
      LOCAL,
    )) as Record<string, any>;
    const stagedRef: string | undefined = read.staged?.resultsRef;
    console.log(`1. record_read staged: ${stagedRef ?? "NOTHING"}`);
    if (!stagedRef) {
      console.log(`   stagingError: ${read.stagingError}`);
      process.exitCode = 1;
      return;
    }

    // 2. Log it, finalizing the sidecar.
    const logged: any = await researchLogAppend({
      projectPath: dir,
      tool: "record_read",
      outcome: "positive",
      stagedResultsRef: stagedRef,
      query: { recordId },
      resultsAvailable: 1,
      resultsExamined: 1,
    } as any);
    const logId = logged?.logId ?? logged?.entryId;
    console.log(`2. research_log_append: ok=${logged?.ok} logId=${logId}`);
    if (!logId) {
      console.log(`   ${JSON.stringify(logged).slice(0, 400)}`);
      process.exitCode = 1;
      return;
    }

    // 3. Extractor mode.
    const out: any = await extractionAppend({
      projectPath: dir,
      logEntryId: logId,
      recordId,
      questionIds: ["q_001"],
    } as any, LOCAL);
    console.log(`3. extraction_append: ok=${out.ok}`);
    if (!out.ok) {
      for (const e of out.errors ?? []) console.log(`   ERROR ${e}`);
      process.exitCode = 1;
      return;
    }
    console.log(`   extraction: ${JSON.stringify(out.extraction, null, 1)}`);
    for (const w of out.validation?.warnings ?? []) console.log(`   warn: ${w.slice(0, 160)}`);

    const research = JSON.parse(readFileSync(join(dir, "research.json"), "utf8"));
    console.log(`\npersisted: ${research.sources.length} source(s), ${research.assertions.length} assertion(s)`);
    for (const a of research.assertions.slice(0, 8)) {
      console.log(
        `   ${a.id} ${a.record_role.padEnd(20)} ${a.fact_type.padEnd(10)} ` +
          `${JSON.stringify(a.value).padEnd(26)} ${a.record_basis.padEnd(8)} ` +
          `${a.informant_proximity}/${a.information_quality} persona=${a.record_persona_id ?? "-"}`,
      );
    }
    const src = research.sources[0];
    if (src) {
      console.log(`\nsource: ${src.id} class=${src.source_classification} repo=${src.repository}`);
      console.log(`  citation: ${String(src.citation).slice(0, 140)}`);
    }

    // Both-shapes refusal.
    const both: any = await extractionAppend({
      projectPath: dir,
      logEntryId: logId,
      recordId,
      ops: [],
    } as any, LOCAL);
    console.log(`\nboth logEntryId+ops refused: ok=${both.ok}`);
    if (!both.ok) console.log(`   ${both.errors[0].slice(0, 140)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
