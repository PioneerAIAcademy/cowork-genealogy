import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allToolSchemas } from "../../src/tool-schemas.js";

// Plugin-agent `tools:` / `disallowedTools:` frontmatter must name every MCP
// tool under ALL THREE server spellings.
//
// The MCP server's name is chosen by whoever registers it, and the plugin —
// which ships into the Cowork VM — cannot control that choice:
//
//   - `.mcp.json`, the unit harness (skill_runner's `mcp_servers={"genealogy": …}`),
//     the e2e orchestrator, and the hosted web control plane all register it
//     under the key `genealogy`      → mcp__genealogy__<tool>
//   - Cowork IN THE CLOUD reaches the host-installed .mcpb through a
//     remote-device bridge, which namespaces the manifest's display_name
//                                    → mcp__remote-devices__Genealogy_Research__<tool>
//   - Cowork ON THE USER'S OWN COMPUTER reaches the same .mcpb directly, so the
//     display_name segment appears with no bridge in front of it
//                                    → mcp__Genealogy_Research__<tool>
//
// Run mode is a per-task setting nothing in the plugin can see, so both Cowork
// spellings are required. Missing the on-computer one is issue #1341:
// record-extractor was refused there, naming all 16 of its declared entries as
// unrecognized, and this test stayed green because it derived its expected
// prefixes from the two registrars we knew about.
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
// `research_append`. A deny naming only some spellings silently fails to bind
// wherever the server is registered under another name — and unlike a missing
// grant, a missing deny fails OPEN.
//
// Listing every spelling is the only form that resolves everywhere. A
// server-level prefix grant cannot substitute: Cowork's `remote-devices`
// namespace also carries device_bash / device_commit_files /
// project_memory_write, so `mcp__remote-devices` would hand a read-only agent
// shell access to the host.
//
// Both Cowork spellings derive from manifest.display_name, so renaming the
// extension would silently re-break production. That is what this test catches.
// What it CANNOT catch is whether a granted tool actually binds at runtime
// (#1084/#1085) — only a live Cowork session can, in the run mode being tested.

const here = dirname(fileURLToPath(import.meta.url));
const mcpRoot = join(here, "..", "..");
const pluginRoot = join(mcpRoot, "..", "plugin");
const agentsDir = join(pluginRoot, "agents");
const repoRoot = join(mcpRoot, "..", "..", "..");

// Every place the MCP server is registered, and how each spells the key.
//
// The bridge prefix is derived from manifest.display_name, so renaming the
// extension fails loudly below. The OTHER prefix — `mcp__genealogy__` — had no
// such guard: it was a constant here and a claim in the comment above, while
// the actual key lives in five files across two languages. Rename it in any one
// of them and this suite stays green while that environment's agents spawn
// with zero matching tools and the runtime refuses them ("would be spawned with
// zero tools — refusing"). That is #650/#698 approached from the other side:
// those broke because the agents were qualified against the wrong key; this
// would break because a key moved out from under correctly-qualified agents.
//
// Grepping source for a dict key is brittle by nature. It is the pragmatic
// option because these sites span TypeScript, JSON and Python and mostly share
// no importable constant; the robust fix is a single shared MCP_SERVER_KEY that
// all of them read. If these patterns start missing, fix the pattern — do not
// delete the assertion.
//
// The e2e site is the one that now has that constant. Since #941 the e2e
// harness registers via `genealogy_mcp_config()` in eval/harness/e2e/
// mcp_health.py — shared by orchestrator.py and preflight.py precisely so a
// preflight cannot prove a different config than the run uses — so the key is a
// named constant there rather than a literal inside a `mcp_servers={...}`
// block, and this site reads the constant. That is the shape the paragraph
// above recommends; the remaining sites still inline it.
const SERVER_KEY_SITES: { file: string; pattern: RegExp; what: string }[] = [
  { file: ".mcp.json", pattern: /"mcpServers"\s*:\s*\{\s*"([^"]+)"/, what: "Claude Code project config" },
  {
    file: "apps/server/app/agent/real_agent.py",
    pattern: /mcp_servers\s*=\s*\{\s*"([^"]+)"/,
    what: "hosted web control plane",
  },
  {
    file: "eval/harness/e2e/mcp_health.py",
    pattern: /GENEALOGY_SERVER_NAME\s*=\s*"([^"]+)"/,
    what: "e2e harness",
  },
  {
    file: "eval/harness/harness/skill_runner.py",
    pattern: /mcp_servers\s*=\s*\{\s*"([^"]+)"/,
    what: "unit harness",
  },
  {
    file: "eval/harness/harness/mock_mcp.py",
    pattern: /create_sdk_mcp_server\(\s*name\s*=\s*"([^"]+)"/,
    what: "unit harness mock server",
  },
];

/** The server key each registration site actually uses, or null if unreadable. */
function registeredServerKey(site: (typeof SERVER_KEY_SITES)[number]): string | null {
  let text: string;
  try {
    text = readFileSync(join(repoRoot, site.file), "utf8");
  } catch {
    return null;
  }
  return site.pattern.exec(text)?.[1] ?? null;
}

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
// Cowork running ON THE USER'S COMPUTER reaches the .mcpb directly, with no bridge,
// so the display_name segment appears with no `remote-devices` in front of it. Both
// live Cowork spellings derive from display_name; only the bridged one is namespaced.
// Missing this third registrar is issue #1341: record-extractor was refused there,
// with all 16 of its declared entries named unrecognized. gps-mentor is the
// exception — its bare `Read` always resolves, so it would spawn holding that alone.
const LOCAL_PREFIX = `mcp__${sanitizeServerSegment(manifest.display_name)}__`;

// Longest-first so that a prefix which is itself the prefix of another can never
// shadow it. Inert with today's three (none is a prefix of another — `mcp__genealogy__`
// and `mcp__Genealogy_Research__` diverge on case at index 5); kept for the next one.
const SERVER_PREFIXES = [HARNESS_PREFIX, BRIDGE_PREFIX, LOCAL_PREFIX].sort(
  (a, b) => b.length - a.length,
);

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

  it("derives the on-computer prefix from manifest.display_name", () => {
    // Same pin for the un-bridged spelling: display_name with no bridge segment,
    // which is what an on-computer Cowork task exposes (#1341).
    expect(LOCAL_PREFIX).toBe("mcp__Genealogy_Research__");
  });

  it("record-extractor still denies the broad writer, under every spelling", () => {
    // Pinned by name, deliberately, because the per-agent loop below SKIPS
    // `disallowedTools` when the block parses empty — correct for the agents that
    // have no denies, but it means deleting record-extractor's block entirely is
    // green. Verified: removing it leaves the suite at 289 passing.
    //
    // That block is the last line keeping this agent off the broad `research_append`
    // under `bypassPermissions` (the hosted path, #695), and a missing deny fails
    // OPEN. So its existence is asserted here rather than only its shape.
    const denies = extractList(
      readFileSync(join(agentsDir, "record-extractor.md"), "utf8"),
      "disallowedTools",
    );
    for (const prefix of SERVER_PREFIXES) {
      expect(
        denies,
        `record-extractor must deny ${prefix}research_append. A deny that names no ` +
          `spelling the session recognizes denies nothing, and unlike a missing grant ` +
          `it fails open and silently.`,
      ).toContain(`${prefix}research_append`);
    }
  });

  describe("harness prefix vs. the keys the environments actually register", () => {
    for (const site of SERVER_KEY_SITES) {
      it(`${site.file} (${site.what}) still registers under a readable key`, () => {
        expect(
          registeredServerKey(site),
          `could not read an MCP server key out of ${site.file}. Either the file moved ` +
            `or its registration form changed; fix the pattern in SERVER_KEY_SITES rather ` +
            `than dropping the site — an unchecked site is one that can silently rename.`,
        ).not.toBeNull();
      });
    }

    it("all five environments agree on one key", () => {
      const found = SERVER_KEY_SITES.map((s) => ({ file: s.file, key: registeredServerKey(s) })).filter(
        (r): r is { file: string; key: string } => r.key !== null,
      );
      const distinct = [...new Set(found.map((r) => r.key))];
      expect(
        distinct.length,
        `the MCP server is registered under more than one key: ` +
          found.map((r) => `${r.file} → "${r.key}"`).join(", ") +
          `. Agent tools: entries name ONE harness spelling, so whichever environment ` +
          `disagrees will spawn its agents toolless.`,
      ).toBe(1);
    });

    it("HARNESS_PREFIX matches the registered key", () => {
      const key = registeredServerKey(SERVER_KEY_SITES[0]);
      expect(
        HARNESS_PREFIX,
        `agent frontmatter is qualified against "${HARNESS_PREFIX}" but the environments ` +
          `register the server as "${key}". Every agent's tools: list would miss, and the ` +
          `runtime refuses to spawn an agent whose entries all miss.`,
      ).toBe(`mcp__${key}__`);
    });
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
                SERVER_PREFIXES.some((p) => entry.startsWith(p)),
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

          it("lists every MCP tool under all three spellings", () => {
            for (const bare of new Set(entries.map(bareName))) {
              expect(entries, `missing harness spelling for ${bare}`).toContain(
                `${HARNESS_PREFIX}${bare}`,
              );
              expect(entries, `missing Cowork bridge spelling for ${bare}`).toContain(
                `${BRIDGE_PREFIX}${bare}`,
              );
              expect(
                entries,
                `missing Cowork on-computer spelling for ${bare} — ` +
                  (key === "disallowedTools"
                    ? `this deny binds NOTHING when the task runs on the user's own computer, ` +
                      `and unlike a missing grant it fails OPEN`
                    : `an agent whose entries all miss is refused outright when the task runs ` +
                      `on the user's own computer`),
              ).toContain(`${LOCAL_PREFIX}${bare}`);
            }
          });
        });
      }
    });
  }
});

describe("plugin agent/skill bodies", () => {
  // The deferred-schema fallback path. Cowork defers the genealogy tool schemas
  // above a size threshold and offers no control over it, so ToolSearch IS the
  // load path there — and a hardcoded `select:mcp__genealogy__…` query resolves
  // to nothing. Bodies must search by bare tool name instead.
  //
  // (Both harnesses set ENABLE_TOOL_SEARCH=true, which *enables* deferral rather
  // than avoiding it — see CLAUDE.md and issue #1110. Either way this rule holds.)
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
