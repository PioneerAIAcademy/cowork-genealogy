/**
 * Smoke test: run the code extractor over a live FamilySearch record.
 *
 * One-shot, against the live API. Run `dev/try-login.ts` first.
 *
 * Fetches the record through `record_read` (which stages its sidecar), reads
 * that sidecar back, and runs `extractRecord` over it — the exact path
 * `extraction_append`'s extractor mode takes. Prints the detected record type,
 * the roles assigned, every assertion, and anything that fell to a defaulted
 * classification.
 *
 * Run: `npx tsx dev/try-record-extract.ts [recordId]` from
 * `packages/engine/mcp-server`. Default is an 1870 US census household — no
 * relationship column, so it exercises the positional rule and the
 * no-relationship-assertion guard together.
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { recordReadTool } from "../src/tools/record-read.js";
import { LOCAL } from "../src/auth/principal.js";
import { extractRecord } from "../src/utils/record-extract.js";

const EMPTY_RESEARCH = {
  project: {
    id: "rp_001",
    objective: "extractor smoke",
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
  const dir = mkdtempSync(join(tmpdir(), "try-extract-"));
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
    const ref: string | undefined = result.staged?.resultsRef;
    if (!ref) {
      console.log(`NO SIDECAR (${result.stagingError ?? "no projectPath?"})`);
      process.exitCode = 1;
      return;
    }
    const element = JSON.parse(readFileSync(join(dir, ref), "utf8")).payload.results[0];

    const out = extractRecord(element, {
      logEntryId: "l_001",
      questionIds: ["q_001"],
    });

    console.log(`record:      ${recordId}`);
    console.log(`recordType:  ${out.recordType}`);
    if (out.censusStatesRelationships !== undefined) {
      console.log(`statesRels:  ${out.censusStatesRelationships}`);
    }
    console.log(`assertions:  ${out.assertions.length}`);

    const byRole = new Map<string, number>();
    for (const a of out.assertions) {
      byRole.set(a.record_role, (byRole.get(a.record_role) ?? 0) + 1);
    }
    console.log(`\nroles assigned:`);
    for (const [r, n] of byRole) console.log(`   ${String(n).padStart(3)}  ${r}`);

    console.log(`\nassertions:`);
    for (const a of out.assertions) {
      const bits = [
        a.date ? `date=${a.date}` : "",
        a.place ? `place=${a.place}` : "",
      ].filter(Boolean).join(" ");
      console.log(
        `   ${a.record_role.padEnd(20)} ${a.fact_type.padEnd(12)} ` +
          `${JSON.stringify(a.value).padEnd(28)} ${a.record_basis.padEnd(8)} ` +
          `${a.informant_proximity}/${a.information_quality} ${bits}`,
      );
    }

    const rels = out.assertions.filter((a) => a.fact_type === "relationship");
    console.log(`\nrelationship assertions: ${rels.length}`);

    console.log(`\ndefaulted classifications: ${out.defaultedClassifications.length}`);
    for (const d of out.defaultedClassifications) console.log(`   - ${d}`);
    console.log(`\nnotes: ${out.notes.length}`);
    for (const n of out.notes) console.log(`   - ${n}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
