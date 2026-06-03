/**
 * Pull a scenario's research.json + tree.gedcomx.json out of a run-log
 * snapshot so the score-review screen can render the scenario offline.
 *
 * The run-log snapshot bundles every referenced scenario's files (see
 * docs/specs/schemas/run-log.schema.json `snapshot`), keyed by repo-relative
 * path under `eval/fixtures/scenarios/<name>/`. No network/API call is needed.
 */

export interface ScenarioSnapshotData {
  research: Record<string, unknown>;
  /** null when the scenario has no tree.gedcomx.json or it failed to parse. */
  gedcomx: Record<string, unknown> | null;
}

function tryParseObject(s: string | undefined): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Returns the parsed research + gedcomx for `scenarioName`, or null when the
 * test has no scenario or its research.json is missing/unparseable. A missing
 * tree.gedcomx.json is tolerated (gedcomx: null) — the viewer degrades to the
 * research-only sections.
 */
export function findScenarioData(
  snapshot: Record<string, string>,
  scenarioName: string,
): ScenarioSnapshotData | null {
  const base = `eval/fixtures/scenarios/${scenarioName}`;
  const research = tryParseObject(snapshot[`${base}/research.json`]);
  if (!research) return null;
  return { research, gedcomx: tryParseObject(snapshot[`${base}/tree.gedcomx.json`]) };
}
