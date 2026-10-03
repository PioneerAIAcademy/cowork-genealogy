// Manual smoke test for extraction_append's `documents` shape — also the
// dispatch check the drift test cannot make (a missing server.ts arm is a
// runtime "Unknown tool").
//
// Default run extracts one structured obituary into the project. Pass
// `--refused` to send the retired hand-built form instead, which must come back
// { ok: false } naming the three call shapes and writing nothing.
//   npx tsx dev/try-extraction-append.ts <projectPath> [--refused]
import { LOCAL } from "../src/auth/principal.js";
import { extractionAppend } from "../src/tools/extraction-append.js";

const [projectPath, flag] = process.argv.slice(2);
if (!projectPath) {
  console.error("usage: try-extraction-append.ts <projectPath> [--refused]");
  process.exit(1);
}

const input =
  flag === "--refused"
    ? { projectPath, section: "sources", op: "append", entry: { citation: "Smoke test source" } }
    : {
        projectPath,
        documents: [
          {
            recordId: "capture:smoke-obituary",
            document: {
              recordType: "obituary",
              documentForm: "verbatim_transcript",
              source: { title: "Obituary of Ann Lee, Smoke Gazette, 2 May 1990", repository: "Smoke Gazette" },
              persons: [
                {
                  id: "p1",
                  principal: true,
                  gender: "female",
                  names: [{ given: "Ann", surname: "Lee" }],
                  facts: [{ type: "death", date: "30 April 1990", place: "Logan, Cache, Utah" }],
                },
                { id: "p2", gender: "male", statedRelation: "son", names: [{ given: "Tom", surname: "Lee" }], facts: [] },
              ],
              relationships: [{ type: "parent_child", person1: "p1", person2: "p2" }],
            },
          },
        ],
      };

const result = await extractionAppend(input as any, LOCAL);
console.log(JSON.stringify(result, null, 2));
