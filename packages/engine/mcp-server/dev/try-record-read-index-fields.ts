/**
 * Smoke test: does a live `record_read` stage its per-persona index fields?
 *
 * One-shot, against the live FamilySearch API. Run `dev/try-login.ts` first.
 *
 * Verifies the §A.2 lift of issue #2937 end to end: fetch a record, stage it,
 * read the staged sidecar back off disk, and print what each persona carries.
 * The assertion that matters is that EVERY persona has index fields — a search
 * sidecar gives them for one, which is the whole reason the extractor takes a
 * `record_read` sidecar.
 *
 * Run: `npx tsx dev/try-record-read-index-fields.ts [recordId]` from
 * `packages/engine/mcp-server`. Default record is an 1870 US census household
 * (`dev/probe-census-persona-fields.ts` observed `PR_RELATIONSHIP_TO_HEAD=Head`
 * on its first person).
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { recordReadTool } from "../src/tools/record-read.js";
import { LOCAL } from "../src/auth/principal.js";

const EMPTY_RESEARCH = {
  project: {
    id: "rp_001",
    objective: "index-fields smoke",
    status: "active",
    created: "2026-01-01",
    updated: "2026-01-01",
  },
  questions: [],
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
  const dir = mkdtempSync(join(tmpdir(), "try-index-fields-"));
  writeFileSync(join(dir, "research.json"), JSON.stringify(EMPTY_RESEARCH, null, 2), {
    encoding: "utf8",
  });
  writeFileSync(
    join(dir, "tree.gedcomx.json"),
    JSON.stringify({ persons: [], relationships: [], sources: [] }, null, 2),
    { encoding: "utf8" },
  );

  try {
    const result = (await recordReadTool(
      { recordId, projectPath: dir },
      LOCAL,
    )) as Record<string, any>;

    console.log(`record: ${recordId}`);
    console.log(`staged: ${JSON.stringify(result.staged)}`);
    if (result.stagingError) console.log(`stagingError: ${result.stagingError}`);
    const ref: string | undefined = result.staged?.resultsRef;
    if (!ref) {
      console.log("NO SIDECAR — nothing to check.");
      process.exitCode = 1;
      return;
    }

    const sidecar = JSON.parse(readFileSync(join(dir, ref), "utf8"));
    const element = sidecar.payload.results[0];
    console.log(`staged element keys: ${Object.keys(element).join(", ")}`);

    const personIds: string[] = (element.gedcomx?.persons ?? []).map(
      (p: any) => p?.id,
    );
    const indexFields: Record<string, any> = element.indexFields ?? {};
    console.log(`\npersons in staged gedcomx: ${personIds.length}`);
    console.log(`personas carrying indexFields: ${Object.keys(indexFields).length}`);

    for (const id of personIds) {
      const f = indexFields[id];
      console.log(`\n  ${id}`);
      if (!f) {
        console.log("     (no index fields)");
        continue;
      }
      for (const [k, v] of Object.entries(f)) console.log(`     ${k}=${JSON.stringify(v)}`);
    }

    const missing = personIds.filter((id) => !indexFields[id]);
    console.log(
      `\n>>> ${personIds.length - missing.length}/${personIds.length} personas carry index fields`,
    );
    if (missing.length > 0) {
      console.log(`>>> MISSING on: ${missing.join(", ")}`);
      process.exitCode = 1;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
