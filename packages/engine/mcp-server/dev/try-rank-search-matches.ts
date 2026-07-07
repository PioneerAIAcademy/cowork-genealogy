/// <reference types="node" />
/**
 * Smoke test for rank_search_matches — runs a real record_search (which
 * auto-omits inline gedcomx and stages host-side) and then re-ranks the staged results by
 * match score against a known tree subject, end-to-end against live FamilySearch.
 *
 * Requires a valid FS session (run `login` first) and a project directory that
 * already contains a tree.gedcomx.json holding the subject person.
 *
 * Usage:
 *   npx tsx dev/try-rank-search-matches.ts <projectPath> <subjectId> <surname> [givenName]
 *
 * Example (the spec's validated case):
 *   npx tsx dev/try-rank-search-matches.ts /path/to/project KNS4-P6W Quass Kenneth
 */
import { recordSearchTool } from "../src/tools/record-search.js";
import { rankSearchMatches } from "../src/tools/rank-search-matches.js";

const projectPath = process.argv[2];
const subjectId = process.argv[3];
const surname = process.argv[4] ?? "Quass";
const givenName = process.argv[5] ?? "Kenneth";

if (!projectPath || !subjectId) {
  console.error(
    "Usage: npx tsx dev/try-rank-search-matches.ts <projectPath> <subjectId> <surname> [givenName]",
  );
  process.exit(1);
}

const search = await recordSearchTool({
  projectPath,
  surname,
  givenName,
  count: 50,
});

console.log("record_search →");
console.log(
  JSON.stringify(
    {
      returned: search.returned,
      totalMatches: search.totalMatches,
      staged: search.staged,
      stagingError: search.stagingError,
      firstResultHasGedcomx: search.results[0]?.gedcomx !== undefined,
    },
    null,
    2,
  ),
);

if (!search.staged) {
  console.error("No staged.resultsRef — cannot rank. (nil search or staging failure)");
  process.exit(1);
}

const ranked = await rankSearchMatches({
  projectPath,
  stagedResultsRef: search.staged.resultsRef,
  subjectId,
  checkAttachments: true,
});

console.log("\nrank_search_matches →");
console.log(JSON.stringify(ranked, null, 2));
