// The two debug-hold variables `extraction_append` reads (tools/research-append.ts;
// docs/specs/research-append-tool-spec.md §11.5), named here so the hosted entrypoint can
// report a forgotten hold at start-up. tests/http/debug-holds.test.ts holds this list to the
// names research-append.ts actually reads.

export const DEBUG_HOLD_ENV = [
  "GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS",
  "GENEALOGY_DEBUG_HOLD_AFTER_COMMIT_MS",
] as const;

/** One stderr line naming each hold variable that is set (non-empty) and its value, or
 *  null when neither is. */
export function debugHoldStartupLine(env: NodeJS.ProcessEnv): string | null {
  const set = DEBUG_HOLD_ENV.filter((name) => (env[name] ?? "").trim() !== "");
  if (set.length === 0) return null;
  const named = set.map((name) => `${name}=${JSON.stringify(env[name])}`).join(", ");
  return `debug holds set (never in production): ${named}\n`;
}
