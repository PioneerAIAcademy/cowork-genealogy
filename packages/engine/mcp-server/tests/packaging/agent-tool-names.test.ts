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
// **No agent ships a `disallowedTools:` block any more, and that is the
// measured position rather than an oversight.** Every deny we had was on a tool
// already absent from that agent's `tools:`, and this file used to justify them
// by claiming a deny binds under `bypassPermissions` while an omission does not.
// Probed 2026-08-30 against Claude Code 2.1.251 / SDK 0.2.128
// (`make probe-agent-binding`, reproduced twice): BOTH bind. A tool merely
// omitted from `tools:` is absent from the agent exactly as a denied one is, so
// every deny was restating the line above it. (The old claim cited issue #695
// here and in six other spots; that issue is the birkeland lane breach and says
// nothing about `bypassPermissions`, denies, or omissions.) The regression a
// deny insured against — someone later adding the tool to `tools:` — is caught
// by AGENT_PERMISSIONS below, which fails on any change to either list.
//
// The rules below still apply to a deny, because one may come back for a reason
// the omission cannot serve. If it does: it needs all three spellings, since one
// naming only some silently binds nothing wherever the server carries another
// name and unlike a missing grant a missing deny fails OPEN — and it must not
// name a tool the same agent grants, which can make the runtime refuse the agent
// outright (see "never denies a tool it also grants").
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

/** Bare tool names an agent names in BOTH `tools:` and `disallowedTools:`.
 *
 * A deny is applied BEFORE the zero-tools spawn check, so an entry in both
 * lists does not merely cancel out — it can make the runtime refuse the agent
 * outright. Measured 2026-08-30 against Claude Code 2.1.251 / agent SDK 0.2.128
 * (`make probe-agent-binding`): a probe agent granting one tool under all three
 * spellings plus `ToolSearch`, and denying that same tool, was rejected with
 *
 *   Agent 'probe-b-deny' would be spawned with zero tools — refusing.
 *   Its tools list resolved to nothing: unrecognized [ToolSearch].
 *
 * The three MCP entries are not named as unrecognized: the deny had already
 * removed them. `image-reader` grants exactly one tool, so it is one entry from
 * this shape.
 *
 * No agent ships a deny today (see the header), so the per-agent arm below
 * cannot fail on the current corpus — which is why the rule is ALSO pinned
 * synthetically. A check that cannot fail reads as coverage and is worse than
 * none (`CLAUDE.md`, "A new lint must be proven to fail"); the same argument
 * and the same remedy as the denied-built-in case further down this file.
 */
function grantedAndDenied(text: string): string[] {
  const granted = new Set(extractList(text, "tools").map(bareOrBuiltin));
  return [...new Set(extractList(text, "disallowedTools").map(bareOrBuiltin))]
    .filter((t) => granted.has(t))
    .sort();
}

function overlapMessage(file: string, overlap: string[]): string {
  return (
    `${file} both grants and denies: ${overlap.join(", ")}. The deny wins and is ` +
    `applied before the spawn check, so if it strips every entry that would have ` +
    `resolved, the runtime refuses to spawn this agent at all. Drop it from one ` +
    `list — omitting a tool from tools: already keeps it out of the agent ` +
    `(measured under bypassPermissions, 2026-08-30).`
  );
}

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

  it("record-extractor cannot reach the broad writer", () => {
    // The lane ADR-0006 defines. It used to be asserted on record-extractor's
    // `disallowedTools:` block; that block is gone, because the deny only ever
    // restated the omission (see the header). So assert the thing that actually
    // binds: `research_append` is absent from the agent's `tools:`.
    //
    // This is not redundant with AGENT_PERMISSIONS below. That snapshot fails on
    // ANY change to the list and says only "the surface moved"; this one names
    // the invariant, so a reviewer reading a red suite is told which rule broke.
    const granted = extractList(
      readFileSync(join(agentsDir, "record-extractor.md"), "utf8"),
      "tools",
    ).map(bareOrBuiltin);
    expect(
      granted,
      `record-extractor must not hold the broad research_append — it writes only ` +
        `sources + assertions, through extraction_append (ADR-0006). A tool omitted ` +
        `from tools: is absent from the agent even under bypassPermissions ` +
        `(measured 2026-08-30, \`make probe-agent-binding\`); adding it here is what ` +
        `would hand this agent every section.`,
    ).not.toContain("research_append");
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

      it("never denies a tool it also grants", () => {
        expect(grantedAndDenied(text), overlapMessage(file, grantedAndDenied(text))).toEqual([]);
      });

      it("ships no disallowedTools block", () => {
        // Not a style rule — the position the probe settled. Every deny we had
        // named a tool already absent from `tools:`, and an omission binds
        // (header). Re-adding one is allowed, but it should be a decision with
        // a reason the omission cannot serve, not a reflex; this is what makes
        // a reviewer look at it.
        expect(
          extractList(text, "disallowedTools"),
          `${file} declares disallowedTools. Denies were removed 2026-08-30 as ` +
            `restatements of the omission above them (\`make probe-agent-binding\`). ` +
            `If this one earns its place, say why in the frontmatter, give it all ` +
            `three spellings, keep it clear of tools:, and update this test.`,
        ).toEqual([]);
      });
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

// A plugin agent's permission surface is frozen here, per agent, as the set of
// BARE tool names it grants and denies.
//
// The assertions above check the SHAPE of each entry — that it names a real
// tool under all three server spellings. Nothing checked the CONTENT: adding a
// tool to `tools:`, or dropping one from `disallowedTools:`, was green. That is
// the change most worth seeing, because no CI job can verify what a grant
// actually binds to at runtime (only a live Cowork session can, in the run mode
// being tested), and a missing deny fails OPEN — record-extractor silently
// regains the broad `research_append` rather than erroring.
//
// This does not judge whether a permission is correct. It makes a change to one
// impossible to land invisibly: the snapshot below has to be edited in the same
// commit, where a reviewer sees it as a diff instead of as one more line in a
// 50-line frontmatter block.
//
// Built-in tools that are not MCP tools (`Read`) stay bare and are pinned here
// too — a widening to `Bash` or `Write` would otherwise slip past the
// `mcp__`-only filter the assertions above use.
//
// Widening one of these is ordinary work. Editing the snapshot is how you say
// you meant it.
const AGENT_PERMISSIONS: Record<string, { tools: string[]; denies: string[] }> = {
  "gps-mentor.md": {
    tools: [
      "Read",
      "collections_search",
      "external_links_search",
      "place_distance",
      "place_search",
      "project_context",
      "research_append",
      "research_query",
      "validate_research_schema",
      "wiki_place_page",
      "wiki_search",
    ],
    denies: [],
  },
  // The only caller permitted to write research.json's proof_summaries; the
  // plugin PreToolUse hook denies that section to everyone else. It holds the
  // BROAD research_append, which is what the hook's caller check — not this
  // list — is doing the work of restricting.
  "proof-conclusion.md": {
    tools: [
      "Read",
      "merge_tree_persons",
      "merge_warnings",
      "project_context",
      "research_append",
      "research_query",
      "source_attachments",
      "tree_correct",
      "tree_edit",
    ],
    denies: [],
  },
  "image-reader.md": {
    tools: ["image_transcribe"],
    denies: [],
  },
  "record-extractor.md": {
    tools: [
      "extraction_append",
      "place_search",
      "place_search_all",
      "project_context",
      "record_person_matches",
      "record_read",
      "record_record_matches",
      "research_log_append",
    ],
    denies: [],
  },
  // The only caller permitted to set `exhaustive_declaration.declared: true`;
  // the plugin PreToolUse hook denies that claim to everyone else. Like
  // proof-conclusion it holds the BROAD research_append, and the hook's caller
  // check — not this list — is what restricts it.
  //
  // Every tree writer is denied, not just `tree_edit`. This agent writes one
  // field on one question and must never reach the tree; a deny naming one of
  // five writers fails open on the other four, silently, and no CI job sees it.
  "research-exhaustiveness.md": {
    tools: ["Read", "project_context", "research_append", "research_query"],
    denies: [],
  },
};

/** Bare name for an MCP entry; non-MCP built-ins (`Read`) pass through as-is. */
function bareOrBuiltin(entry: string): string {
  return entry.startsWith("mcp__") ? bareName(entry) : entry;
}

describe("plugin agent permission surface", () => {
  it("pins every agent that ships", () => {
    // Without this, adding a NEW agent — the easiest way to introduce a broad
    // grant — adds no snapshot and the per-agent loop below simply never runs
    // for it.
    expect(
      Object.keys(AGENT_PERMISSIONS).sort(),
      "an agent was added or removed: update AGENT_PERMISSIONS to match",
    ).toEqual([...agentFiles].sort());
  });

  for (const file of agentFiles) {
    const expected = AGENT_PERMISSIONS[file];
    if (!expected) continue; // reported by the test above

    describe(file, () => {
      const text = readFileSync(join(agentsDir, file), "utf8");
      const granted = [...new Set(extractList(text, "tools").map(bareOrBuiltin))].sort();
      const denied = [...new Set(extractList(text, "disallowedTools").map(bareOrBuiltin))].sort();

      it("grants exactly the pinned tools", () => {
        expect(
          granted,
          `${file}'s tools: no longer matches AGENT_PERMISSIONS. If you meant to widen ` +
            `what this agent can call, update the snapshot in the same commit so the ` +
            `change is reviewable as a diff.`,
        ).toEqual([...expected.tools].sort());
      });

      it("denies exactly the pinned tools", () => {
        expect(
          denied,
          `${file}'s disallowedTools: no longer matches AGENT_PERMISSIONS. A deny removed ` +
            `here fails OPEN and silently — the agent regains the tool with no error ` +
            `anywhere. Update the snapshot only if that is what you intend.`,
        ).toEqual([...expected.denies].sort());
      });
    });
  }
});

// A built-in (non-MCP) tool named in an agent BODY must be a tool that agent can
// actually call — i.e. it is GRANTED in the agent's `tools:` frontmatter
// (issue #1635).
//
// `disallowedTools:` is NOT a second source of permission. A deny binds even
// under `bypassPermissions` (CLAUDE.md § "Dual-spelled tool names"), so a body
// naming a denied built-in is the same defect as naming an ungranted one —
// billed on every invocation, never executable. No agent denies a built-in
// today, so this flags nothing in the current corpus; the synthetic case below
// is what holds the rule, since a corpus with no instance cannot.
//
// `check_rubric_tool_drift.py` already does the MCP-name side of this for agent
// bodies and is CI-wired, but its vocabulary is the .mcpb manifest's MCP tool
// names, so a BUILT-IN named in a body — `ToolSearch`, `Glob`, `Bash` — is
// checked by nothing, and the closest check is warn-only. The defect that proved
// the gap: record-extractor.md instructed the agent to recover a deferred
// persistence tool "via ToolSearch", a built-in it does not hold and its
// MCP-only `tools:` list cannot carry — billed on every invocation of the
// most-invoked agent, never executable, and green in CI.
//
// Vocabulary is built-in names that are NOT ordinary English, so a bare mention
// is a real tool reference. `Read` / `Write` / `Edit` / `Task` are EXCLUDED —
// they are verbs in these bodies ("Read exactly ONE image per invocation",
// "Write the narrative markdown") — mirroring COMMON_WORD_EXEMPTIONS in
// check_rubric_tool_drift.py. Bare occurrences are matched, not only backticked
// ones: the motivating defect carries no backticks. No "imperative context"
// classifier — measured at 7a30786b this vocabulary matched exactly one line
// across all six bodies, so a plain mention rule is already precise and a
// classifier would only ever fit the one defect it was written against.
//
// Scope is agent bodies only. `skills/*/SKILL.md` is out: `allowed-tools` is a
// grant not a restriction, the main thread holds every tool, and the two skill
// bodies naming ToolSearch are correct.
const BUILTIN_TOOL_VOCAB = [
  "ToolSearch",
  "Glob",
  "Grep",
  "Bash",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "TodoWrite",
  "SlashCommand",
  "AskUserQuestion",
  "MultiEdit",
] as const;

/** 1-based line where frontmatter closes, or 0 if none. Scan the BODY only —
 *  a granted built-in legitimately appears in the `tools:` block above. */
function agentBodyStart(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return i + 1;
  }
  return 0; // unterminated — treat the whole file as body rather than skip it
}

// Built-in body mentions that existed when this lint landed, keyed on
// (agent file, trimmed line text) — never a line number; these files move by
// dozens of lines a week (the reasoning is spelled out in no-issue-refs.test.ts).
// This is not an escape hatch for an inconvenient lint: a new mention gets the
// tool granted or the line removed, not a row here.
const BUILTIN_BODY_ALLOWLIST: { file: string; word: string; text: string; reason: string }[] = [
  {
    file: "record-extractor.md",
    word: "ToolSearch",
    text: "net. If a persistence tool shows as deferred, load it via ToolSearch",
    reason:
      "ruled 2026-08-23, folded into #1666 (deep dive: record-extraction), which pays that " +
      "directory's eval run; the row leaves in that PR when it deletes the passage. Editing " +
      "record-extractor.md here would flip its run log inactive and force a paid re-run.",
  },
];

interface BuiltinHit {
  file: string;
  lineNo: number;
  word: string;
  text: string;
}

/** Split from the disk read so the non-vacuity guard below can drive the real
 *  scanner over a synthetic body. Testing the vocabulary in isolation would not
 *  cover `agentBodyStart`, the held-set, or the match wiring. */
function builtinHitsInText(file: string, text: string): BuiltinHit[] {
  // `tools:` ONLY. A deny is not a grant — it binds even under
  // `bypassPermissions` — so a body naming a DENIED built-in is the same defect
  // as naming an ungranted one, and must flag too.
  const held = new Set(extractList(text, "tools").map(bareOrBuiltin));
  const lines = text.split(/\r?\n/);
  const hits: BuiltinHit[] = [];
  for (let i = agentBodyStart(lines); i < lines.length; i++) {
    for (const word of BUILTIN_TOOL_VOCAB) {
      if (held.has(word)) continue; // the agent holds it — a body mention is fine
      if (new RegExp(`\\b${word}\\b`).test(lines[i])) {
        hits.push({ file, lineNo: i + 1, word, text: lines[i].trim() });
      }
    }
  }
  return hits;
}

function builtinHitsInAgent(file: string): BuiltinHit[] {
  return builtinHitsInText(file, readFileSync(join(agentsDir, file), "utf8"));
}

const allBuiltinHits = agentFiles.flatMap(builtinHitsInAgent);

function isAllowedBuiltinHit(h: BuiltinHit): boolean {
  // Keyed on `word` as well as file+text: one line can name two built-ins, and
  // without this a row excusing the first silently excuses the second too.
  return BUILTIN_BODY_ALLOWLIST.some(
    (a) => a.file === h.file && a.text === h.text && a.word === h.word,
  );
}

describe("plugin agent bodies name no built-in tool the agent cannot call", () => {
  it("the grant/deny overlap rule still detects an overlap", () => {
    // Same anti-silent-zero argument as the canary below, and it bites harder
    // here: no agent ships a deny at all now, so the per-agent arm has NOTHING
    // to fail on and would report coverage it does not have. Drives the real
    // `grantedAndDenied` over a synthetic frontmatter so the parse, the
    // bare-name mapping and the set intersection are all covered.
    const head = ["---", "name: probe", "tools:", "  - mcp__genealogy__record_read"];
    const clean = [...head, "---", "", "body"].join("\n");
    const overlapping = [
      ...head,
      "disallowedTools:",
      "  - mcp__Genealogy_Research__record_read",
      "---",
      "",
      "body",
    ].join("\n");

    expect(grantedAndDenied(clean), "a deny-free agent must not report an overlap").toEqual([]);
    expect(
      grantedAndDenied(overlapping),
      "the overlap rule no longer fires — the per-agent arm passes vacuously, and " +
        "nothing would catch a deny that makes the runtime refuse an agent",
    ).toEqual(["record_read"]);
  });

  it("the scanner still detects a built-in mention", () => {
    // The anti-silent-zero guard that OUTLIVES the allow-list. The canary below
    // proves the scanner fires — but only while a row exists, and that row leaves
    // with #1666. Measured before this guard: with the row removed AND
    // BUILTIN_TOOL_VOCAB emptied, the whole file passed 75/75 — green, zero
    // coverage. Drives the REAL scanner over a synthetic body, so it covers the
    // vocabulary, the word-boundary regex, `agentBodyStart` and the held-set
    // together; asserting on the vocabulary alone would miss the wiring.
    // Corpus-independent on purpose, so no agent-body edit can retire it.
    const probe = [
      "---",
      "name: probe",
      "tools:",
      "  - mcp__genealogy__record_read",
      "---",
      "",
      "If a persistence tool shows as deferred, load it via ToolSearch.",
    ].join("\n");
    expect(
      builtinHitsInText("probe.md", probe).map((h) => h.word),
      "the built-in scanner no longer detects an ungranted body mention — every " +
        "offenders check below would pass vacuously",
    ).toContain("ToolSearch");

    // The other direction: a GRANTED built-in must not be flagged, or the lint
    // would fire on every legitimate mention and get muted.
    const granted = probe.replace(
      "  - mcp__genealogy__record_read",
      "  - mcp__genealogy__record_read\n  - ToolSearch",
    );
    expect(builtinHitsInText("probe.md", granted).map((h) => h.word)).not.toContain("ToolSearch");

    // A DENIED built-in must flag: a deny binds even under `bypassPermissions`,
    // so the agent cannot call it and the prose is unexecutable either way. No
    // agent denies a built-in today, so nothing in the corpus exercises this —
    // which is exactly why it is pinned synthetically rather than left to a
    // future body edit to discover.
    const denied = probe.replace(
      "---\n\nIf a persistence tool",
      "disallowedTools:\n  - ToolSearch\n---\n\nIf a persistence tool",
    );
    expect(
      builtinHitsInText("probe.md", denied).map((h) => h.word),
      "a body naming a DENIED built-in is no longer flagged — a deny is not a grant",
    ).toContain("ToolSearch");
  });

  it("scans a non-empty body in every agent", () => {
    // The anti-silent-zero guard, and it must NOT be `agentFiles.length > 0`:
    // that only repeats "finds the plugin agents" above and proves nothing about
    // the body scanner. A frontmatter-boundary bug that made agentBodyStart
    // return past end-of-file would scan zero lines, every offenders check would
    // pass vacuously, and CI would stay green — the exact failure mode this lint
    // exists to catch, reproduced in the lint itself. Assert real body lines were
    // available to scan, independent of the allow-list canary below (which is
    // temporary — it leaves when #1666 deletes record-extractor's ToolSearch line).
    for (const file of agentFiles) {
      const lines = readFileSync(join(agentsDir, file), "utf8").split(/\r?\n/);
      expect(
        lines.length - agentBodyStart(lines),
        `${file}: no body below the frontmatter for the built-in lint to scan`,
      ).toBeGreaterThan(0);
    }
  });

  it("names no built-in tool the agent's tools: does not grant", () => {
    const offenders = allBuiltinHits
      .filter((h) => !isAllowedBuiltinHit(h))
      .map(
        (h) =>
          `${h.file}:${h.lineNo} names built-in ${h.word}, which its tools: does not ` +
          `grant (a deny is not a grant) — ${h.text}`,
      );
    expect(
      offenders,
      "an agent body instructs the agent to use a built-in tool its tools: does not grant " +
        "(a deny is not a grant — it binds even under bypassPermissions). It is billed on " +
        "every invocation and can never execute. Grant the tool in tools:, remove the " +
        "mention, or add a reasoned allow-list entry if pre-existing.",
    ).toEqual([]);
  });

  describe("allow-list entries are still needed", () => {
    for (const { file, word, text, reason } of BUILTIN_BODY_ALLOWLIST) {
      it(`${file} still contains its allowed line (${reason})`, () => {
        const stillMatches = allBuiltinHits.some(
          (h) => h.file === file && h.text === text && h.word === word,
        );
        expect(
          stillMatches,
          `allow-list entry for ${file} no longer matches any body line — the prose was ` +
            "removed or reworded (or the tool was granted), so delete the stale entry",
        ).toBe(true);
      });
    }
  });
});
