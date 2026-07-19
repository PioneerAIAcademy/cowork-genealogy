import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allToolSchemas } from "../../src/tool-schemas.js";

// Plugin-agent `tools:` / `disallowedTools:` frontmatter must name every MCP
// tool under BOTH server spellings.
//
// The MCP server's name is chosen by whoever registers it, and the plugin —
// which ships into the Cowork VM — cannot control that choice:
//
//   - `.mcp.json`, the unit harness (skill_runner's `mcp_servers={"genealogy": …}`),
//     the e2e orchestrator, and the hosted web control plane all register it
//     under the key `genealogy`      → mcp__genealogy__<tool>
//   - Cowork reaches the host-installed .mcpb through a remote-device bridge,
//     which namespaces it by the manifest's display_name
//                                    → mcp__remote-devices__Genealogy_Research__<tool>
//
// Entries are matched EXACTLY, with no prefix fallback and no inherit-on-miss.
// When every `tools:` entry misses, the runtime refuses to spawn the agent
// outright ("would be spawned with zero tools — refusing"). That is how
// #650/#698 broke all three agents in Cowork while CI stayed green: they were
// qualified against the test harness's arbitrary dict key rather than the
// product's name.
//
// `disallowedTools:` needs the same treatment for a sharper reason. A deny is
// enforced even under `bypassPermissions` (the hosted path — issue #695), so
// it is the last line of defence keeping record-extractor off the broad
// `research_append`. A deny naming only one spelling silently fails to bind
// wherever the server is registered under the other name.
//
// Listing both spellings is the only form that resolves everywhere. A
// server-level prefix grant cannot substitute: Cowork's `remote-devices`
// namespace also carries device_bash / device_commit_files /
// project_memory_write, so `mcp__remote-devices` would hand a read-only agent
// shell access to the host.
//
// The bridge spelling derives from manifest.display_name, so renaming the
// extension would silently re-break production. That is what this test catches.

const here = dirname(fileURLToPath(import.meta.url));
const mcpRoot = join(here, "..", "..");
const pluginRoot = join(mcpRoot, "..", "plugin");
const agentsDir = join(pluginRoot, "agents");

const manifest = JSON.parse(
  readFileSync(join(mcpRoot, "manifest.json"), "utf8"),
) as { display_name: string };

/** Non-alphanumeric runs collapse to a single underscore; edges trimmed. */
function sanitizeServerSegment(name: string): string {
  return name
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

const HARNESS_PREFIX = "mcp__genealogy__";
const BRIDGE_PREFIX = `mcp__remote-devices__${sanitizeServerSegment(manifest.display_name)}__`;

/** Parse a named block-sequence out of YAML frontmatter. */
function extractList(text: string, key: string): string[] {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!frontmatter) throw new Error("no YAML frontmatter");

  const lines = frontmatter[1].split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (start === -1) return [];

  const items: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i]) && !/^\s*#/.test(lines[i])) break; // next top-level key
    const item = /^\s*-\s+(.+?)\s*$/.exec(lines[i]);
    if (item) items.push(item[1]);
  }
  return items;
}

function bareName(entry: string): string {
  return entry.startsWith(BRIDGE_PREFIX)
    ? entry.slice(BRIDGE_PREFIX.length)
    : entry.slice(HARNESS_PREFIX.length);
}

const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
const knownTools = new Set(allToolSchemas.map((s) => s.name));

describe("plugin agent tool names", () => {
  it("finds the plugin agents", () => {
    expect(agentFiles.length).toBeGreaterThan(0);
  });

  it("derives the bridge prefix from manifest.display_name", () => {
    // Pinned so a display_name rename fails loudly here, next to the
    // explanation, rather than as a mystery spawn failure in Cowork.
    expect(BRIDGE_PREFIX).toBe("mcp__remote-devices__Genealogy_Research__");
  });

  for (const file of agentFiles) {
    describe(file, () => {
      const text = readFileSync(join(agentsDir, file), "utf8");

      for (const key of ["tools", "disallowedTools"] as const) {
        const entries = extractList(text, key).filter((t) => t.startsWith("mcp__"));
        if (key === "disallowedTools" && entries.length === 0) continue;

        describe(key, () => {
          it("parses at least one MCP entry", () => {
            // Guards the assertions below against passing vacuously if the
            // frontmatter parser stops matching the block-sequence form.
            expect(entries.length).toBeGreaterThan(0);
          });

          it("uses only recognized server prefixes", () => {
            for (const entry of entries) {
              expect(
                entry.startsWith(HARNESS_PREFIX) || entry.startsWith(BRIDGE_PREFIX),
                `${entry} uses an unrecognized server prefix`,
              ).toBe(true);
            }
          });

          it("names only tools the server actually registers", () => {
            for (const entry of entries) {
              expect(
                knownTools.has(bareName(entry)),
                `${entry} is not in allToolSchemas`,
              ).toBe(true);
            }
          });

          it("lists every MCP tool under both spellings", () => {
            for (const bare of new Set(entries.map(bareName))) {
              expect(entries, `missing harness spelling for ${bare}`).toContain(
                `${HARNESS_PREFIX}${bare}`,
              );
              expect(entries, `missing Cowork bridge spelling for ${bare}`).toContain(
                `${BRIDGE_PREFIX}${bare}`,
              );
            }
          });
        });
      }
    });
  }
});

describe("plugin agent/skill bodies", () => {
  // The deferred-schema fallback path. Cowork defers the ~40 genealogy tool
  // schemas (both harnesses set ENABLE_TOOL_SEARCH=true to avoid this; Cowork
  // offers no such control), so ToolSearch IS the load path there — and a
  // hardcoded `select:mcp__genealogy__…` query resolves to nothing. Bodies
  // must search by bare tool name instead.
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : e.name.endsWith(".md")
          ? [join(dir, e.name)]
          : [],
    );
  }

  it("never hardcodes a qualified tool name in a ToolSearch select query", () => {
    const offenders: string[] = [];
    for (const path of walk(pluginRoot)) {
      for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
        if (/select:\s*mcp__/.test(line)) offenders.push(`${path}: ${line.trim()}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
