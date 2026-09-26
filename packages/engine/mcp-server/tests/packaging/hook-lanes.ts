/**
 * What the shipped plugin hook lets each agent write with `research_append`,
 * read out of `guard_project_files.py` rather than restated. Shared by
 * `plugin-hooks.test.ts` and `ownership-manifest.test.ts`, which both compare
 * the ownership manifest against the same two maps.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const GUARD = join(HERE, "..", "..", "..", "plugin", "hooks", "guard_project_files.py");

const OWNERSHIP_JSON = join(HERE, "..", "..", "..", "..", "..", "docs", "specs", "schemas", "ownership.json");

/**
 * The manifest's `hookRouting`: the one tool the hook routes by section, and
 * each tree row that tool writes mapped to the research.json section whose op
 * writes it. Read from the manifest so this file and
 * `writer_attribution_report.py` share one copy.
 */
const hookRouting = (
  JSON.parse(readFileSync(OWNERSHIP_JSON, "utf-8")) as {
    hookRouting?: { tool?: string; treeRowsVia?: Record<string, string> };
  }
).hookRouting;
if (typeof hookRouting?.tool !== "string" || typeof hookRouting.treeRowsVia !== "object") {
  throw new Error(`${OWNERSHIP_JSON} has no hookRouting.tool / hookRouting.treeRowsVia`);
}

/** The one tool the hook routes by section. */
export const HOOK_ROUTED_TOOL: string = hookRouting.tool;

/** Tree row → the research.json section whose `research_append` op writes it. */
export const TREE_ROW_VIA: Readonly<Record<string, string>> = hookRouting.treeRowsVia;

/**
 * `AGENT_WRITABLE_SECTIONS`: bare agent → the research.json sections it may
 * write. Throws when an entry's shape is one this reader does not handle, since
 * a dropped entry would silently widen every check reading this map.
 */
export function agentWritableSections(src: string = readFileSync(GUARD, "utf-8")): Map<string, string[]> {
  const body = src.match(/^AGENT_WRITABLE_SECTIONS\s*=\s*\{([\s\S]*?)^\}/m)?.[1];
  if (body === undefined) throw new Error(`AGENT_WRITABLE_SECTIONS not found in ${GUARD}`);
  const out = new Map<string, string[]>();
  // Whitespace is allowed around the braces: a formatter wraps a long entry as
  // `frozenset(\n    {...}\n)`, which Python reads identically.
  for (const m of body.matchAll(/^\s+["']([^"']+)["']\s*:\s*frozenset\(\s*\{([^}]*)\}\s*\)/gm)) {
    out.set(m[1], [...m[2].matchAll(/["']([^"']+)["']/g)].map((s) => s[1]));
  }
  const keys = [...body.matchAll(/^\s+["']([^"']+)["']\s*:/gm)].map((m) => m[1]);
  const unparsed = keys.filter((k) => !out.has(k));
  if (unparsed.length > 0 || out.size === 0) {
    throw new Error(
      `AGENT_WRITABLE_SECTIONS entries this reader could not parse: ${unparsed.join(", ") || "(map empty)"}`,
    );
  }
  return out;
}

/**
 * `OWNED_SECTIONS`: whole section → the bare agent the hook lets write it.
 * Field-scoped `OWNED_DECLARATIONS` are not here; they route one claim, not the
 * section.
 */
export function wholeSectionOwners(src: string = readFileSync(GUARD, "utf-8")): Record<string, string> {
  return Object.fromEntries(
    [...(src.match(/^OWNED_SECTIONS\s*=\s*\{([^}]*)\}/m)?.[1] ?? "").matchAll(
      /["']([^"']+)["']\s*:\s*["']([^"']+)["']/g,
    )].map((m) => [m[1], m[2]]),
  );
}

/**
 * Whether the hook lets `agent` (bare name) write this manifest row with
 * `research_append`: the row's section must be inside the agent's lane and not
 * routed to another agent. An agent with no lane reaches nothing the hook can
 * vouch for, so this returns false for every row — callers that need a lane
 * for every `research_append` holder check that separately.
 */
export function researchAppendReaches(
  agent: string,
  row: { artifact: string; section: string },
  lanes: Map<string, string[]>,
  owners: Record<string, string>,
): boolean {
  const via = row.artifact === "research.json" ? row.section : TREE_ROW_VIA[row.section];
  if (via === undefined) return false;
  if (owners[via] !== undefined && owners[via] !== agent) return false;
  return lanes.get(agent)?.includes(via) ?? false;
}
