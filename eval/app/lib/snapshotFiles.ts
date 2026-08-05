/**
 * Pull per-test JSON and MCP fixture bodies out of a run log's snapshot
 * files, for the score-review screen's trace pane.
 *
 * The map these take is the *on-disk content* of the paths the snapshot
 * names (`readSnapshotFiles` in lib/fs/runlogs.ts), not the snapshot itself:
 * from `schema_version` 3 the snapshot stores sha256 digests, so it has no
 * bytes to parse. Sibling of `findScenarioData` in lib/scenarioSnapshot.ts.
 *
 * Both return null rather than throwing on a missing or malformed file — the
 * pane renders "nothing to show" instead of breaking the whole review screen.
 * That silence is why they are here and not inline in the page: it makes the
 * failure mode invisible, so it needs test coverage.
 */

/** Find the test JSON for `test_id` among the snapshot's on-disk files. */
export function findTestJson(
  files: Record<string, string>,
  skill: string,
  test_id: string,
): Record<string, unknown> | null {
  const prefix = `eval/tests/unit/${skill}/`;
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith(prefix) || !path.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(content);
      if (parsed?.test?.id === test_id) return parsed;
    } catch {
      // skip malformed entries
    }
  }
  return null;
}

/** The `response` body of a named MCP fixture, or the whole file if untagged. */
export function findFixtureResponse(
  files: Record<string, string>,
  fixtureName: string,
): unknown {
  const content = files[`eval/fixtures/mcp/${fixtureName}.json`];
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    return parsed?.response ?? parsed;
  } catch {
    return null;
  }
}
