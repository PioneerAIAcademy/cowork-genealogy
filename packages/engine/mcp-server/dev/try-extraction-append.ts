// Manual smoke test for extraction_append — also the dispatch check the drift
// test cannot make (a missing index.ts if-block is a runtime "Unknown tool").
//
// Default run appends one source to the project. Pass `--denied` to exercise the
// lane gate instead: it attempts a person_evidence write, which must come back
// { ok: false } naming only extraction_append and its own two sections.
//   npx tsx dev/try-extraction-append.ts <projectPath> [--denied]
import { extractionAppend } from "../src/tools/extraction-append.js";

const [projectPath, flag] = process.argv.slice(2);
if (!projectPath) {
  console.error("usage: try-extraction-append.ts <projectPath> [--denied]");
  process.exit(1);
}

const input =
  flag === "--denied"
    ? {
        projectPath,
        section: "person_evidence",
        op: "append" as const,
        entry: { assertion_id: "a_001", person_id: "I1", confidence: "confident", rationale: "probe" },
      }
    : {
        projectPath,
        // A sources append needs either sourceDescription (tool creates the
        // tree S entry and stamps the link) or an existing S id.
        sourceDescription: { title: "Smoke test source" },
        section: "sources",
        op: "append" as const,
        entry: {
          citation: "Smoke test source",
          citation_detail: {
            who: "Test",
            what: "Smoke test",
            when_created: "1850",
            when_accessed: "2026-01-01",
            where: "Schuylkill County, Pennsylvania",
            where_within: "dwelling 1",
          },
          source_classification: "original",
          repository: "NARA",
          access_date: "2026-01-01",
        },
      };

const result = await extractionAppend(input as any);
console.log(JSON.stringify(result, null, 2));
