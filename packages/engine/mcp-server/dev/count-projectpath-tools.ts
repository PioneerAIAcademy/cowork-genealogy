/**
 * Count: how many advertised MCP tools take a `projectPath`, and how many do not
 * (search-agent prototype report, correction 5).
 *
 * Counts from the schemas, `allToolSchemas` in src/tool-schemas.ts — the list the
 * server advertises — never from files: the review's "24 and 24" was a file count
 * that included helper modules exporting no tool. A tool "takes a `projectPath`"
 * when `projectPath` is a property of its `inputSchema`; the required subset is
 * printed beside it. "Does not take one" is not "pure HTTP": several of those tools
 * make no network call either.
 *
 * To count an older commit, check it out in its own worktree, install there, and
 * run this file from that worktree's mcp-server/ (the import below resolves against
 * the commit's own src/).
 *
 * Offline; no FamilySearch session needed. Not shipped in any artifact.
 *
 * Usage:
 *   npx tsx dev/count-projectpath-tools.ts [--list]
 */
import { allToolSchemas } from "../src/tool-schemas.js";

type Schema = { name: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } };

/** Top-level `inputSchema.properties` only: a nested `projectPath` is not the tool's. */
export function partitionByProjectPath(schemas: readonly Schema[]) {
  const takes = schemas.filter((s) => Object.hasOwn(s.inputSchema?.properties ?? {}, "projectPath"));
  return {
    takes,
    required: takes.filter((s) => (s.inputSchema?.required ?? []).includes("projectPath")),
    without: schemas.filter((s) => !takes.includes(s)),
  };
}

if (process.argv[1]?.endsWith("count-projectpath-tools.ts")) {
  const schemas = allToolSchemas as unknown as Schema[];
  const { takes, required, without } = partitionByProjectPath(schemas);
  console.log(`advertised tools: ${schemas.length}`);
  console.log(`take a projectPath: ${takes.length} (required in ${required.length})`);
  console.log(`do not: ${without.length}`);
  if (process.argv.includes("--list")) {
    const names = (xs: Schema[]) => xs.map((s) => s.name).sort().join(", ");
    console.log(`\ntake: ${names(takes)}`);
    console.log(`\noptional: ${names(takes.filter((s) => !required.includes(s)))}`);
    console.log(`\ndo not: ${names(without)}`);
  }
}
