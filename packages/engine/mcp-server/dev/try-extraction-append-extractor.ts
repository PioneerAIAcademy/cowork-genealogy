/**
 * Smoke test: `extraction_append({ recordIds })`, end to end, live.
 *
 * Run `dev/try-login.ts` first.
 *
 * One call does what the search skills do: it reads the record live, stages and
 * logs the read, and extracts it in code. Prints the per-record outcome and
 * summary and every assertion that landed in research.json, then resends the
 * same id to show the skip. The temp project is removed afterwards.
 *
 * Run: `npx tsx dev/try-extraction-append-extractor.ts [recordId]` from
 * `packages/engine/mcp-server`.
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { extractionAppend } from "../src/tools/extraction-append.js";
import { LOCAL } from "../src/auth/principal.js";

const EMPTY_RESEARCH = {
  project: {
    id: "rp_001",
    objective: "recordIds smoke",
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
  const dir = mkdtempSync(join(tmpdir(), "try-extraction-records-"));
  writeFileSync(join(dir, "research.json"), JSON.stringify(EMPTY_RESEARCH, null, 2), {
    encoding: "utf8",
  });
  writeFileSync(
    join(dir, "tree.gedcomx.json"),
    JSON.stringify({ persons: [], relationships: [], sources: [] }, null, 2),
    { encoding: "utf8" },
  );

  try {
    // The whole path is one call: it reads the record live, logs the read and
    // extracts it in code.
    const out = await extractionAppend({ projectPath: dir, recordIds: [recordId], questionIds: ["q_001"] }, LOCAL);
    console.log(`extraction_append: ok=${out.ok}`);
    for (const e of out.errors ?? []) console.log(`   ERROR ${e}`);
    for (const o of out.records) {
      console.log(`   ${o.status} src=${o.srcId ?? "-"} log=${o.logId ?? "-"}`);
      console.log(`   summary: ${o.summary}`);
      for (const w of o.warnings ?? []) console.log(`   warn: ${w.slice(0, 160)}`);
    }
    if (!out.ok) {
      process.exitCode = 1;
      return;
    }

    const research = JSON.parse(readFileSync(join(dir, "research.json"), "utf8"));
    console.log(`
persisted: ${research.log.length} log entr(ies), ${research.sources.length} source(s), ${research.assertions.length} assertion(s)`);
    for (const a of research.assertions.slice(0, 8)) {
      console.log(
        `   ${a.id} ${a.record_role.padEnd(20)} ${a.fact_type.padEnd(10)} ` +
          `${JSON.stringify(a.value).padEnd(26)} ${a.record_basis.padEnd(8)} ` +
          `${a.informant_proximity}/${a.information_quality} persona=${a.record_persona_id ?? "-"}`,
      );
    }
    const src = research.sources[0];
    if (src) {
      console.log(`
source: ${src.id} class=${src.source_classification} repo=${src.repository}`);
      console.log(`  citation: ${String(src.citation).slice(0, 140)}`);
    }

    // A resend is skipped before any read, and names the source.
    const again = await extractionAppend({ projectPath: dir, recordIds: [recordId] }, LOCAL);
    console.log(`
resend: ${again.records[0]?.status} — ${again.records[0]?.summary}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
