/**
 * MCP tool-name spellings, shared by the packaging lints that read a plugin
 * agent's or skill's tool grants: the three server prefixes a registrar can
 * put in front of a tool, and the strict prefix strip.
 *
 * One copy, for the same reason as `frontmatter.ts`: `agent-tool-names.test.ts`
 * and `ownership-manifest.test.ts` both reduce a grant to a bare tool name, and
 * two copies with different rules disagree on the one input that matters — an
 * entry whose prefix is misspelled.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mcpRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const manifest = JSON.parse(
  readFileSync(join(mcpRoot, "manifest.json"), "utf8"),
) as { display_name: string };

/** Non-alphanumeric runs collapse to a single underscore; edges trimmed. */
export function sanitizeServerSegment(name: string): string {
  return name
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export const HARNESS_PREFIX = "mcp__genealogy__";
export const BRIDGE_PREFIX = `mcp__remote-devices__${sanitizeServerSegment(manifest.display_name)}__`;
// Cowork can instead expose the bare display_name with no `remote-devices` bridge
// in front of it. Both live Cowork spellings derive from display_name; only the
// bridged one is namespaced. Which one a session exposes has been observed to move
// (bare live in #1341, absent in three later censuses — macOS and Windows on
// 2026-08-15, and a Windows session via #1732). Missing this
// third registrar was issue #1341: record-extractor was refused there, with all 16
// of its declared entries named unrecognized. An agent declaring the built-in
// `Read` bare is exempt from that refusal — `Read` always resolves, so it spawns
// holding that alone. Today that is proof-conclusion and research-exhaustiveness;
// every other agent (gps-mentor included) is MCP-only and a registrar miss
// refuses it, as it did record-extractor.
export const LOCAL_PREFIX = `mcp__${sanitizeServerSegment(manifest.display_name)}__`;

// Longest-first so that a prefix which is itself the prefix of another can never
// shadow it. Inert with today's three (none is a prefix of another — `mcp__genealogy__`
// and `mcp__Genealogy_Research__` diverge on case at index 5); kept for the next one.
export const SERVER_PREFIXES = [HARNESS_PREFIX, BRIDGE_PREFIX, LOCAL_PREFIX].sort(
  (a, b) => b.length - a.length,
);

export function bareName(entry: string): string {
  const prefix = SERVER_PREFIXES.find((p) => entry.startsWith(p));
  if (prefix === undefined) {
    // Throw rather than slice blindly. The previous form fell through to
    // `slice(HARNESS_PREFIX.length)` on anything unrecognized, which turned
    // `mcp__Genealogy_Research__image_transcribe` into `esearch__image_transcribe`
    // and reported it as a missing tool instead of a missing prefix (#1341).
    throw new Error(
      `${entry} carries no recognized server prefix. Add the registrar's spelling to ` +
        `SERVER_PREFIXES — do not let it be sliced against another prefix's length.`,
    );
  }
  return entry.slice(prefix.length);
}

/** The namespace Cowork's device bridge exposes MCP servers under. */
const DEVICE_BRIDGE = "mcp__remote-devices";

/**
 * The bare tool names one grant entry hands out.
 *
 * A built-in (`Read`, `Bash(npm run test:*)`) is itself. A server-level grant
 * — a bare server (`mcp__genealogy`), a prefix wildcard (`mcp__genealogy__*`),
 * or the device bridge (`mcp__remote-devices`, `mcp__remote-devices__*`) —
 * hands out EVERY tool the server advertises, so it is read as `all`. CLAUDE.md
 * forbids the bridge form outright (it also carries `device_bash`); reading it
 * as everything makes the guard see what it grants rather than steering the
 * reader toward adding its spelling to SERVER_PREFIXES. Anything else goes
 * through the strict `bareName`, which throws on an unrecognized prefix.
 */
export function grantedTools(entry: string, all: readonly string[]): string[] {
  if (!entry.startsWith("mcp__")) return [entry];
  if (entry.endsWith("*")) {
    // A wildcard that can reach this server is read as everything, a partial
    // one (`…__tree_*`, `mcp__gen*`) included: over-reading fails closed, and
    // under-reading fails open. One that names another server grants none of
    // these tools, so it goes through the same strict path as any other entry
    // under an unrecognized prefix rather than being read as every writer.
    const head = entry.slice(0, -1);
    const reaches = [...SERVER_PREFIXES, `${DEVICE_BRIDGE}__`].some(
      (p) => p.startsWith(head) || head.startsWith(p),
    );
    if (reaches) return [...all];
  }
  const stem = entry.replace(/__$/, "");
  if (stem === DEVICE_BRIDGE) return [...all];
  if (SERVER_PREFIXES.includes(`${stem}__`)) return [...all];
  return [bareName(entry)];
}
