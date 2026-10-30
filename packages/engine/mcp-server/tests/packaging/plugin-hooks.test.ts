import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error -- plain .mjs build helper, no type declarations (tsconfig
// only compiles src/**, so this import is never typechecked).
import { resolvePython, describePythonCandidates } from "../../../../../scripts/python-interpreter.mjs";
import { extractList, frontmatterBlock, parseFrontmatter } from "./frontmatter.js";
import {
  HOOK_ROUTED_TOOL,
  TREE_ROW_VIA,
  agentWritableSections,
  researchAppendReaches,
  wholeSectionOwners,
} from "./hook-lanes.js";
import { grantedTools } from "./tool-names.js";

// The plugin's PreToolUse hook is the ONLY guardrail that reaches Cowork.
//
// A per-agent `tools:` allow-list is subtractive — it can only narrow what a
// subagent inherits — so nothing but a hook can restrain the main thread. And
// `hooks=` is an SDK argument, which the hosted control plane can set but
// Cowork cannot be made to. A plugin-shipped hooks/hooks.json is the one
// artifact that binds both (verified live in Cowork; see
// hooks/guard_project_files.py's docstring).
//
// Every failure mode below is SILENT in production — an unshipped directory, a
// command naming a script that isn't there, a script that stops denying — so
// each gets an assertion here.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..", "..");
const PLUGIN_DIR = join(REPO_ROOT, "packages", "engine", "plugin");
const HOOKS_JSON = join(PLUGIN_DIR, "hooks", "hooks.json");
const GUARD = join(PLUGIN_DIR, "hooks", "guard_project_files.py");

type HookEntry = { type: string; command?: string };
type Matcher = { matcher?: string; hooks: HookEntry[] };

function loadHooks(): Record<string, Matcher[]> {
  return JSON.parse(readFileSync(HOOKS_JSON, "utf-8")).hooks;
}

/**
 * The two tool tuples lifted out of the guard script's own source.
 *
 * Read rather than restated so the matcher test cannot drift from the script it
 * guards: the script is the one place a tool is added, and anything that must
 * stay in step with it has to derive from it. Throws rather than returning empty
 * on a miss — a silently empty tuple would make the caller's assertions pass on
 * exactly the change that breaks production.
 */
function guardToolNames(): {
  fileWriteTools: string[];
  deviceWriteTools: string[];
  delegationTools: string[];
  ownerRoutedTools: string[];
  ownedSections: string[];
} {
  const src = readFileSync(GUARD, "utf-8");
  const tuple = (constName: string): string[] => {
    const body = src.match(new RegExp(`^${constName}\\s*=\\s*\\(([^)]*)\\)`, "m"))?.[1];
    if (body === undefined) {
      throw new Error(
        `${constName} not found in ${GUARD}. If it was renamed, update this ` +
          `helper — do not hardcode the tool names back into the test.`,
      );
    }
    const names = [...body.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
    if (names.length === 0) throw new Error(`${constName} is empty in ${GUARD}.`);
    return names;
  };
  return {
    fileWriteTools: tuple("FILE_WRITE_TOOLS"),
    deviceWriteTools: tuple("DEVICE_WRITE_TOOLS"),
    delegationTools: tuple("DELEGATION_TOOLS"),
    ownedSections: ownedSections(src),
    // The caller-routed sections live in a dict, not a tuple, and the tool they
    // gate is always `research_append` — so what the matcher must cover is that
    // one name, conditional on the dict being non-empty. Read rather than
    // assumed, so emptying OWNED_SECTIONS correctly relaxes the requirement.
    ownerRoutedTools: ownedSections(src).length > 0 ? ["research_append"] : [],
  };
}

/** The section names in the guard script's `OWNED_SECTIONS` map. */
/**
 * Every research.json section the guard routes by caller, from BOTH maps.
 *
 * `OWNED_SECTIONS` routes a whole section; `OWNED_DECLARATIONS` and
 * `OWNED_FIELDS` each route one FIELD within a section, keyed on
 * `("<section>", "<field>")` — the first on a claim value, the second on
 * presence. The manifest records all three as `enforceableAt: ["hook", …]` on
 * the section's row, so a helper reading only the first map reports drift the
 * moment a field-scoped row lands — which is exactly what happened when
 * `questions` was added.
 */
function ownedSections(src: string): string[] {
  const body = src.match(/^OWNED_SECTIONS\s*=\s*\{([^}]*)\}/m)?.[1];
  if (body === undefined) {
    throw new Error(
      `OWNED_SECTIONS not found in ${GUARD}. If it was renamed, update this ` +
        `helper — do not hardcode the section names back into the test.`,
    );
  }
  const sections = [...body.matchAll(/["']([^"']+)["']\s*:/g)].map((m) => m[1]);

  const declBody = src.match(/^OWNED_DECLARATIONS\s*=\s*\{([^}]*)\}/m)?.[1];
  if (declBody === undefined) {
    throw new Error(
      `OWNED_DECLARATIONS not found in ${GUARD}. If it was renamed, update this ` +
        `helper — do not hardcode the section names back into the test.`,
    );
  }
  for (const [, section] of declBody.matchAll(/\(\s*["']([^"']+)["']\s*,/g)) {
    if (!sections.includes(section)) sections.push(section);
  }

  const fieldBody = src.match(/^OWNED_FIELDS\s*=\s*\{([^}]*)\}/m)?.[1];
  if (fieldBody === undefined) {
    throw new Error(
      `OWNED_FIELDS not found in ${GUARD}. If it was renamed, update this ` +
        `helper — do not hardcode the section names back into the test.`,
    );
  }
  for (const [, section] of fieldBody.matchAll(/\(\s*["']([^"']+)["']\s*,/g)) {
    if (!sections.includes(section)) sections.push(section);
  }

  for (const [section] of claimRoutes(src)) {
    if (!sections.includes(section)) sections.push(section);
  }

  for (const [section] of appendRoutes(src)) {
    if (!sections.includes(section)) sections.push(section);
  }
  return sections;
}

/**
 * `[section, owner]` for each entry in the guard's `OWNED_APPENDS` — a section
 * whose `op: "append"` alone is routed (`questions`).
 */
function appendRoutes(src: string): [string, string][] {
  const body = src.match(/^OWNED_APPENDS\s*=\s*\{([^}]*)\}/m)?.[1];
  if (body === undefined) {
    throw new Error(
      `OWNED_APPENDS not found in ${GUARD}. If it was renamed, update this ` +
        `helper — do not hardcode the section names back into the test.`,
    );
  }
  return [...body.matchAll(/["']([^"']+)["']\s*:\s*["']([^"']+)["']/g)].map((m) => [m[1], m[2]]);
}

/**
 * `[section, owner]` for each entry in the guard's `OWNED_CLAIMS` — a claim
 * spread over several fields of one section (`conflicts`), keyed on the
 * section name with the owning agent first in its tuple.
 */
function claimRoutes(src: string): [string, string][] {
  const body = src.match(/^OWNED_CLAIMS\s*=\s*\{([^}]*)\}/m)?.[1];
  if (body === undefined) {
    throw new Error(
      `OWNED_CLAIMS not found in ${GUARD}. If it was renamed, update this ` +
        `helper — do not hardcode the section names back into the test.`,
    );
  }
  return [...body.matchAll(/["']([^"']+)["']\s*:\s*\(\s*["']([^"']+)["']/g)].map(
    (m) => [m[1], m[2]],
  );
}

// Resolved once, not per call: probing costs a process launch each time.
// Hardcoding "python3" here made all 11 tests below fail on Windows, where the
// name is a Microsoft Store alias rather than an interpreter -- see
// scripts/python-interpreter.mjs.
const PYTHON: string[] | null = resolvePython();

/**
 * Feed the guard script on stdin the way the runtime does; return raw stdout.
 *
 * **This doubles as a stdlib-only guard.** The hook ships into the Cowork VM,
 * where a non-stdlib import is not available and fails at load — silently, from
 * the user's point of view, since a hook that raises falls through to allowing
 * the call. Nothing lints the imports; what catches them is that the tests below
 * *execute* the real script under a bare interpreter, so an added
 * `import requests` turns this file red. Keep it that way: if you stub or mock
 * the script instead of running it, this file stops enforcing the stdlib rule.
 *
 * It is not the only enforcement, so do not weaken the other one either:
 * `eval/harness/harness/context_policy.py` loads this same file by path and
 * `exec_module`s it at import, so a non-stdlib import here also reds
 * `make harness-test`. Two independent suites, one rule.
 *
 * One hole, known and accepted: `resolvePython` falls back to `uv run python`
 * when no system interpreter exists, and that one has the eval harness's
 * dependencies (`anthropic`, `jsonschema`, `pyyaml`, `mcp`, `python-dotenv`,
 * `claude-agent-sdk`). On such a machine an import of one of those six would
 * pass here and still break in the VM. Every other third-party import is
 * caught on every machine.
 */
function execGuard(input: string): string {
  if (!PYTHON) {
    throw new Error(
      `No Python 3 found (tried: ${describePythonCandidates()}). The plugin's ` +
        `PreToolUse hook is a Python script, so these tests cannot run without one.`,
    );
  }
  const [cmd, ...pre] = PYTHON;
  return execFileSync(cmd, [...pre, GUARD], { input, encoding: "utf-8" });
}

/** Run the guard script the way the runtime does: payload on stdin, JSON out. */
function runGuard(payload: unknown): any {
  return JSON.parse(execGuard(JSON.stringify(payload)));
}

/**
 * The guard's AGENT_ONLY_TOOLS (tool -> owning agents) and MAIN_THREAD_OK keys,
 * read by loading the script rather than by regex: the dict values are tuples
 * and strings that carry their own parentheses.
 */
function guardAgentOnlyTables(): { agentOnly: Record<string, string[]>; mainThreadOk: string[] } {
  if (!PYTHON) throw new Error(`No Python 3 found (tried: ${describePythonCandidates()}).`);
  const [cmd, ...pre] = PYTHON;
  const code =
    "import json, runpy, sys; g = runpy.run_path(sys.argv[1]); " +
    "print(json.dumps({'agentOnly': g['AGENT_ONLY_TOOLS'], 'mainThreadOk': sorted(g['MAIN_THREAD_OK'])}))";
  return JSON.parse(execFileSync(cmd, [...pre, "-c", code, GUARD], { encoding: "utf-8" }));
}

/** Every MCP tool name the server advertises, from the `.mcpb` manifest. */
function manifestToolNames(): string[] {
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, "packages", "engine", "mcp-server", "manifest.json"), "utf-8"),
  ) as { tools: { name: string }[] };
  return manifest.tools.map((t) => t.name);
}

/**
 * Which plugin files grant each MCP tool: agents through `tools:`, skills through
 * `allowed-tools:`. An agent with no `tools:` key inherits every tool.
 */
function toolHolders(): { agents: Map<string, string[]>; skillDeclared: Set<string> } {
  const all = manifestToolNames();
  const agents = new Map<string, string[]>();
  const agentsDir = join(PLUGIN_DIR, "agents");
  for (const f of readdirSync(agentsDir).filter((f) => f.endsWith(".md")).sort()) {
    const text = readFileSync(join(agentsDir, f), "utf-8");
    const block = frontmatterBlock(text);
    const inherits = block !== null && !("tools" in parseFrontmatter(block));
    const held = inherits
      ? all
      : extractList(text, "tools").flatMap((e) => grantedTools(e, all));
    for (const tool of new Set(held.filter((t) => all.includes(t)))) {
      agents.set(tool, [...(agents.get(tool) ?? []), f.slice(0, -3)]);
    }
  }
  const skillDeclared = new Set<string>();
  const skillsDir = join(PLUGIN_DIR, "skills");
  for (const d of readdirSync(skillsDir, { withFileTypes: true })) {
    const skillMd = join(skillsDir, d.name, "SKILL.md");
    if (!d.isDirectory() || !existsSync(skillMd)) continue;
    for (const e of extractList(readFileSync(skillMd, "utf-8"), "allowed-tools")) {
      for (const t of grantedTools(e, all)) skillDeclared.add(t);
    }
  }
  return { agents, skillDeclared };
}

describe("plugin hooks are packaged and wired", () => {
  it("ships the hooks directory in the zip", () => {
    // Without "hooks" in INCLUDE the directory is silently absent from the
    // artifact, which looks exactly like Cowork refusing to load it.
    const packager = readFileSync(join(REPO_ROOT, "scripts", "package-plugin.mjs"), "utf-8");
    const include = packager.match(/const INCLUDE = \[(.*?)\];/s)?.[1] ?? "";
    expect(include).toContain('"hooks"');
  });

  it("names a command that exists in the plugin", () => {
    for (const matcher of loadHooks().PreToolUse) {
      for (const hook of matcher.hooks) {
        expect(hook.type).toBe("command");
        // ${CLAUDE_PLUGIN_ROOT} is the only portable way to reference a
        // bundled script; a relative path resolves against the session's cwd.
        expect(hook.command).toContain("${CLAUDE_PLUGIN_ROOT}");
        // Each use must sit inside double quotes: the root is a user path, and
        // an unquoted one with a space ("C:\Users\First Last\...") splits
        // into two arguments, so the hook errors and blocks every Write.
        const uses = hook.command!.split("${CLAUDE_PLUGIN_ROOT}").length - 1;
        const quoted = [...hook.command!.matchAll(/"\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/g)];
        expect(quoted.length, `unquoted \${CLAUDE_PLUGIN_ROOT} in: ${hook.command}`).toBe(uses);
        for (const [, rel] of quoted) {
          expect(existsSync(join(PLUGIN_DIR, rel))).toBe(true);
        }
      }
    }
  });


  it("routes exactly the sections the ownership manifest declares hook-enforced", () => {
    // Three places stated this fact independently: the plugin hook, the e2e
    // harness, and the manifest. The harness copy is gone — it reads the hook's
    // map through `_guard`. This closes the last pair.
    //
    // The manifest cannot be read at runtime: the hook runs in the VM, where
    // `cwd` is the sandbox and the connected folder is not mounted, so the
    // script has to carry its own literal. Comparing them here is what keeps
    // the two honest — and Phase 4 adds three more sections, which is when a
    // silent drift would start costing paid runs to diagnose.
    const { ownedSections } = guardToolNames();
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, "docs", "specs", "schemas", "ownership.json"), "utf-8"),
    );
    const declared = manifest.rows
      .filter((r: any) => (r.enforceableAt ?? []).includes("hook"))
      .map((r: any) => r.section)
      .sort();

    expect(declared.length).toBeGreaterThan(0);
    expect(ownedSections.sort()).toEqual(declared);

    // And every agent the script routes a row to is named in that row's
    // hookCallers. All five maps: a field-scoped row's owner lives in
    // OWNED_DECLARATIONS, keyed on the (section, field) tuple, so reading only
    // OWNED_SECTIONS leaves the owner `undefined` and the assertion fails on a
    // row that is in fact correct. A section can have more than one route
    // (`questions`: its stop claim and its appends), so owners is a list.
    const src = readFileSync(GUARD, "utf-8");
    const owners: Record<string, string[]> = {};
    const add = (section: string, owner: string) => (owners[section] ??= []).push(owner);
    for (const [section, owner] of Object.entries(wholeSectionOwners(src))) add(section, owner);
    for (const m of (src.match(/^OWNED_DECLARATIONS\s*=\s*\{([^}]*)\}/m)?.[1] ?? "").matchAll(
      /\(\s*["']([^"']+)["']\s*,\s*["'][^"']+["']\s*\)\s*:\s*["']([^"']+)["']/g,
    )) {
      add(m[1], m[2]);
    }
    for (const m of (src.match(/^OWNED_FIELDS\s*=\s*\{([^}]*)\}/m)?.[1] ?? "").matchAll(
      /\(\s*["']([^"']+)["']\s*,\s*["'][^"']+["']\s*\)\s*:\s*["']([^"']+)["']/g,
    )) {
      add(m[1], m[2]);
    }
    for (const [section, owner] of claimRoutes(src)) add(section, owner);
    for (const [section, owner] of appendRoutes(src)) add(section, owner);
    for (const row of manifest.rows) {
      if (!(row.enforceableAt ?? []).includes("hook")) continue;
      const fromManifest = (row.hookCallers ?? [])
        .filter((c: string) => c.startsWith("agent:"))
        .map((c: string) => c.slice("agent:".length));
      expect(owners[row.section], `${row.section}: the script routes it to no agent`).toBeDefined();
      for (const owner of owners[row.section]) {
        expect(fromManifest, `${row.section}: manifest hookCallers omits ${owner}`).toContain(owner);
      }
    }
  });

  it("gives every hook-routed agent a lane row", () => {
    // The gap that shipped with the person-evidence pair and was caught only by
    // breaking the guard by hand. `owner_denied` gates its out-of-lane arm on
    // `writable is not None`, so an agent the manifest routes to but the lane
    // map omits skips that check ENTIRELY — it could write any section
    // unchecked, which is the 2026-08-19 proof-conclusion incident. Every other
    // test in this file stayed green with the row deleted.
    //
    // Per-agent behavioural tests catch it one agent at a time and are easy to
    // forget on the next conversion; this catches the CLASS, so a future pair
    // that adds a hookCallers row without a lane reddens here.
    const laneKeys = [...agentWritableSections().keys()];
    expect(laneKeys.length).toBeGreaterThan(0);

    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, "docs", "specs", "schemas", "ownership.json"), "utf-8"),
    );
    const routed = new Set<string>();
    for (const row of manifest.rows) {
      if (!(row.enforceableAt ?? []).includes("hook")) continue;
      for (const c of row.hookCallers ?? []) {
        if (typeof c === "string" && c.startsWith("agent:")) routed.add(c.slice("agent:".length));
      }
    }
    expect(routed.size).toBeGreaterThan(0);
    for (const agent of routed) {
      expect(
        laneKeys,
        `agent \`${agent}\` is routed a section by ownership.json but has no ` +
          `AGENT_WRITABLE_SECTIONS row — the out-of-lane check is skipped for it entirely`,
      ).toContain(agent);
    }
  });

  it("names every agent on each section the hook lets it write", () => {
    // The converse of the lane-row check above. The hook's lane map says which
    // research.json sections an agent may write; the manifest must name the
    // agent on each of those rows, or the manifest under-states who writes it.
    // `proof-conclusion` resolved `questions` and stamped `project` with no row
    // naming it, and the actual-writer guard stayed green through its
    // per-tool union — it is `hookCallers` on `proof_summaries`, which lists
    // `research_append` too.
    const lanes = agentWritableSections();
    expect(lanes.size).toBeGreaterThan(0);

    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, "docs", "specs", "schemas", "ownership.json"), "utf-8"),
    );
    const missing: string[] = [];
    for (const [agent, sections] of lanes) {
      expect(sections.length, `${agent}: lane parsed with no sections`).toBeGreaterThan(0);
      for (const section of sections) {
        const row = manifest.rows.find(
          (r: { artifact: string; section: string }) =>
            r.artifact === "research.json" && r.section === section,
        );
        // Named for `research_append` specifically — the one tool whose
        // `section` the hook routes. An `agentCallers` entry naming the agent
        // for some other tool would pass a name-only check while saying it
        // never writes the section the hook lets it write.
        const id = `agent:${agent}`;
        const permitted = [...(row?.callers ?? []), ...(row?.hookCallers ?? [])].includes(id);
        const observed = (row?.agentCallers ?? []).some(
          (a: { agent: string; tools: string[] }) =>
            a.agent === id && a.tools.includes("research_append"),
        );
        if (!permitted && !observed) missing.push(`research.json#${section}: ${id}`);
      }
    }
    expect(
      missing,
      "the hook lets these agents `research_append` these sections, and the " +
        "manifest row does not name them for it — add the agent to that row's " +
        "`agentCallers` with `research_append` in its `tools`",
    ).toEqual([]);
  });

  it("pairs an agent with research_append only where the hook lets it reach", () => {
    // The other direction of the check above. The hook refuses a laned agent
    // outside its lane, and any agent but the owner on a section
    // `OWNED_SECTIONS` routes; the tree is reached only through the two
    // sections in TREE_ROW_VIA. An `agentCallers` entry pairing the tool with a
    // row outside that records a write the hook refuses.
    const lanes = agentWritableSections();
    const owners = wholeSectionOwners();
    expect(Object.keys(owners).length, "OWNED_SECTIONS parsed empty").toBeGreaterThan(0);
    expect(Object.keys(TREE_ROW_VIA).length).toBeGreaterThan(0);
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, "docs", "specs", "schemas", "ownership.json"), "utf-8"),
    );
    const bad: string[] = [];
    for (const row of manifest.rows) {
      for (const a of (row.agentCallers ?? []) as { agent: string; tools: string[] }[]) {
        if (!a.tools.includes("research_append")) continue;
        const name = a.agent.slice("agent:".length);
        if (!researchAppendReaches(name, row, lanes, owners)) {
          bad.push(`${row.artifact}#${row.section}: ${a.agent} (lane: ${(lanes.get(name) ?? []).join(", ") || "none"})`);
        }
      }
    }
    expect(
      bad,
      "these agentCallers entries pair research_append on a row the hook never " +
        "lets that agent reach — drop research_append from the entry's `tools`",
    ).toEqual([]);
  });

  it("routes by section the one tool the manifest's hookRouting names", () => {
    // `hookRouting.tool` is what the actual-writer guard and the corpus report
    // treat as the section-routed writer. It must be the tool owner_denied
    // actually gates, or both read the lanes against the wrong tool.
    const src = readFileSync(GUARD, "utf-8");
    const gated = [...src.matchAll(/_basename\([^)]*\)\)\s*!=\s*["']([a-z_]+)["']/g)].map((m) => m[1]);
    expect(gated.length, "owner_denied's tool gate was not found in the guard script").toBeGreaterThan(0);
    expect([...new Set(gated)]).toEqual([HOOK_ROUTED_TOOL]);
  });

  it("gives every agent granted research_append a lane", () => {
    // Without a lane the hook confines an agent's `research_append` to no
    // section, so which rows it reaches is not decidable from the shipped files
    // and the ownership manifest cannot be checked against it.
    const lanes = agentWritableSections();
    const agentsDir = join(PLUGIN_DIR, "agents");
    // An agent with no `tools:` key inherits every tool, research_append
    // included — the same reading ownership-manifest.test.ts gives it.
    const holdsRoutedTool = (text: string): boolean => {
      const block = frontmatterBlock(text);
      if (block === null) return false; // reported by ownership-manifest.test.ts
      if (!("tools" in parseFrontmatter(block))) return true;
      return extractList(text, "tools")
        .flatMap((e) => grantedTools(e, [HOOK_ROUTED_TOOL]))
        .includes(HOOK_ROUTED_TOOL);
    };
    const holders = readdirSync(agentsDir)
      .filter((f) => f.endsWith(".md"))
      .filter((f) => holdsRoutedTool(readFileSync(join(agentsDir, f), "utf-8")))
      .map((f) => f.slice(0, -3));
    expect(holders.length, "no agent holds research_append — the scan read nothing").toBeGreaterThan(0);
    expect(
      holders.filter((a) => !lanes.has(a)).sort(),
      "these agents hold research_append and have no AGENT_WRITABLE_SECTIONS lane " +
        "in guard_project_files.py — give each one the sections it writes",
    ).toEqual([]);
  });

  it("matches every tool the guard script itself denies", () => {
    // A matcher that omits a tool the script would have caught is a hole the
    // script can never close — the hook is not invoked at all.
    //
    // The tool names are READ OUT OF THE SCRIPT, never hardcoded here. This
    // test previously listed Write/Edit/NotebookEdit inline, so when the script
    // grew its DEVICE_WRITE_TOOLS arm the matcher was never widened and this
    // test — the one whose name promises exactly that check — stayed green.
    // That shipped the device-bridge route open while the predicate, its three
    // copies, and their parity vectors all said it was closed.
    const matcher = loadHooks().PreToolUse[0].matcher ?? "";
    const { fileWriteTools, deviceWriteTools, delegationTools, ownerRoutedTools } =
      guardToolNames();

    // The extraction is load-bearing: an empty list makes every assertion below
    // vacuously true, which is the same false green in a new costume.
    expect(fileWriteTools.length).toBeGreaterThan(0);
    expect(deviceWriteTools.length).toBeGreaterThan(0);
    expect(delegationTools.length).toBeGreaterThan(0);
    expect(ownerRoutedTools.length).toBeGreaterThan(0);

    // Anchored full match — the strictest reading of how a matcher is applied.
    // Passing under `^(…)$` also passes under a substring search, so proving it
    // here proves it under either form (ADR-0005: "both matcher forms bind").
    const matches = (tool: string) => new RegExp(`^(${matcher})$`).test(tool);

    for (const tool of fileWriteTools) {
      expect(matches(tool), `matcher does not cover ${tool}`).toBe(true);
    }
    for (const tool of delegationTools) {
      // Built-in tools, so bare: no server prefix to vary.
      expect(matches(tool), `matcher does not cover ${tool}`).toBe(true);
    }
    for (const tool of deviceWriteTools) {
      // Both spellings: Cowork namespaces the bridge tools under
      // `remote-devices` and the plugin cannot control the prefix, so a matcher
      // naming only the bare tail never fires in the environment that matters.
      for (const spelling of [tool, `mcp__remote-devices__${tool}`]) {
        expect(matches(spelling), `matcher does not cover ${spelling}`).toBe(true);
      }
    }
    const agentOnlyTools = Object.keys(guardAgentOnlyTables().agentOnly);
    expect(agentOnlyTools.length).toBeGreaterThan(0);
    for (const tool of [...ownerRoutedTools, ...agentOnlyTools]) {
      // An MCP tool, so all THREE server spellings — the same rule agent
      // frontmatter follows, and for the same reason: the server's name is
      // chosen by whoever registers it and the plugin cannot control that.
      for (const spelling of [
        `mcp__genealogy__${tool}`,
        `mcp__remote-devices__Genealogy_Research__${tool}`,
        `mcp__Genealogy_Research__${tool}`,
      ]) {
        expect(matches(spelling), `matcher does not cover ${spelling}`).toBe(true);
      }
    }
  });

  it("names, on exactly one list, every tool only agents hold, with its real owners", () => {
    // AGENT_ONLY_TOOLS is hand-kept, not derived (lead, 2026-10-20): a person
    // decides whether the main thread may call a tool only agents hold. This is
    // what makes the decision unavoidable — a tool granted to an agent and to no
    // skill must be denied (AGENT_ONLY_TOOLS) or allowed with a reason
    // (MAIN_THREAD_OK), and the deny must name every agent that can take the step.
    const { agentOnly, mainThreadOk } = guardAgentOnlyTables();
    const { agents, skillDeclared } = toolHolders();
    const heldOnlyByAgents = [...agents.keys()].filter((t) => !skillDeclared.has(t)).sort();
    // A scan that read no frontmatter would make every assertion below vacuous.
    expect(heldOnlyByAgents.length, "no tool is held only by agents — the scan read nothing").toBeGreaterThan(20);

    const listed = new Set([...Object.keys(agentOnly), ...mainThreadOk]);
    expect(
      heldOnlyByAgents.filter((t) => !listed.has(t)),
      "these tools are held only by agents and are on neither AGENT_ONLY_TOOLS nor " +
        "MAIN_THREAD_OK in hooks/guard_project_files.py. Add each to one: to the deny " +
        "map with its owning agents (and to hooks.json's matcher), or to MAIN_THREAD_OK " +
        "with the legitimate main-thread call that keeps it there.",
    ).toEqual([]);
    expect(
      [...listed].filter((t) => !heldOnlyByAgents.includes(t)).sort(),
      "these tools are listed but are no longer held only by agents — a skill now " +
        "declares them, or no agent holds them. Remove them from the guard's lists.",
    ).toEqual([]);
    expect(
      mainThreadOk.filter((t) => t in agentOnly),
      "a tool is both denied and allowed on the main thread",
    ).toEqual([]);
    for (const [tool, owners] of Object.entries(agentOnly)) {
      expect(
        [...owners].sort(),
        `AGENT_ONLY_TOOLS["${tool}"] does not name the agents whose tools: grant it, ` +
          "so the deny would send the model to the wrong agent or miss one",
      ).toEqual(agents.get(tool) ?? []);
    }
  });
});

describe("the guard script's decisions", () => {
  it.each(["Agent", "Task"])("denies a fork through %s and names the way out", (tool_name) => {
    const out = runGuard({
      tool_name,
      tool_input: { subagent_type: "fork", description: "d", prompt: "p" },
    });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("named plugin agent");
    // No stopReason: the model can delegate to a named agent instead.
    expect(out.stopReason).toBeUndefined();
  });

  it.each([
    ["Agent", { subagent_type: "record-extractor", prompt: "p" }],
    ["Agent", { subagent_type: "genealogy-research:record-extractor", prompt: "p" }],
    ["Task", { subagent_type: "general-purpose", prompt: "p" }],
    ["Agent", { prompt: "p" }],
    ["Agent", { subagent_type: null, prompt: "p" }],
    ["Agent", { subagent_type: ["fork"], prompt: "p" }],
    ["mcp__genealogy__record_read", { subagent_type: "fork" }],
  ])("has no opinion on %s %j", (tool_name, tool_input) => {
    expect(runGuard({ tool_name, tool_input })).toEqual({});
  });

  it.each([
    ["Write", "/project/research.json"],
    ["Edit", "/project/tree.gedcomx.json"],
    ["NotebookEdit", "research.json"],
    // Windows separators: splitting on "/" alone made the e2e copy of this
    // rule a silent no-op on the platform the genealogist team runs.
    ["Write", "C:\\Users\\Dell\\project\\research.json"],
  ])("denies %s on %s", (tool, file_path) => {
    const out = runGuard({ tool_name: tool, tool_input: { file_path } });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    // The reason is the model's only feedback, so it must name the way out.
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("research_append");
    // No stopReason — a denied write is recoverable and the turn continues.
    expect(out.stopReason).toBeUndefined();
  });

  it.each([
    ["Write", "/project/external-collections.json"],
    ["Edit", "C:\\Users\\Dell\\project\\external-collections.json"],
  ])("denies %s on %s and names the tool that writes it", (tool, file_path) => {
    const out = runGuard({ tool_name: tool, tool_input: { file_path } });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain(
      "external-collections.json is written only by external_links_search",
    );
  });

  it.each([
    ["Read", { file_path: "/project/research.json" }],
    ["mcp__genealogy__research_append", { file_path: "/project/research.json" }],
    ["Bash", { command: "cat /project/research.json" }],
    ["Write", { file_path: "/project/results/log_001.json" }],
    ["Write", { file_path: "/project/research.json.bak" }],
    ["Write", {}],
  ])("has no opinion on %s", (tool_name, tool_input) => {
    expect(runGuard({ tool_name, tool_input })).toEqual({});
  });

  it.each([
    // The route the ordinary onboarding path actually took (measured live
    // 2026-08-15). Run through the real script, not just the predicate, because
    // the predicate's parity vectors were green while this route shipped open.
    ["mcp__remote-devices__device_commit_files", { files: ["/Users/g/p/research.json"] }],
    ["device_commit_files", { files: [{ path: "/Users/g/p/tree.gedcomx.json", content: "{}" }] }],
  ])("denies %s", (tool_name, tool_input) => {
    const out = runGuard({ tool_name, tool_input });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("project_create");
  });

  it.each([
    // A user's own files in a connected folder are not this guard's business.
    ["mcp__remote-devices__device_commit_files", { files: ["/Users/g/p/notes.md"] }],
    // Content that MENTIONS a protected file is not a write to one.
    [
      "mcp__remote-devices__device_commit_files",
      { files: [{ path: "notes.md", content: "see research.json for the log" }] },
    ],
    // device_bash is deliberately not covered — see the guardrail spec.
    ["mcp__remote-devices__device_bash", { command: "cat > research.json" }],
  ])("has no opinion on %s", (tool_name, tool_input) => {
    expect(runGuard({ tool_name, tool_input })).toEqual({});
  });

  // ── caller-routed sections: research_append + proof_summaries ──
  //
  // The only test that runs the real script against this arm. No harness binds
  // a plugin hook, so nothing else exercises it before a live Cowork session.
  const OWNER = "genealogy-research:proof-conclusion";

  it.each([
    ["append, no agent_id (main thread)", { section: "proof_summaries", op: "append", entry: {} }, {}],
    // The re-conclusion path. SKILL.md updates ps_NNN in place on every repeat
    // invocation; an arm that saw only appends would leave this dead.
    ["update in place, no agent_id", { section: "proof_summaries", op: "update", entryId: "ps_001", fields: {} }, {}],
    ["batched ops form", { ops: [{ section: "questions", op: "update" }, { section: "proof_summaries", op: "append" }] }, {}],
    // agent_type WITHOUT agent_id is the `--agent` main thread, not a subagent.
    ["agent_type present but agent_id absent", { section: "proof_summaries", op: "append" }, { agent_type: OWNER }],
    // A different agent is still not the owner.
    ["a different agent", { section: "proof_summaries", op: "append" }, { agent_id: "a1", agent_type: "general-purpose" }],
  ])("denies research_append on proof_summaries — %s", (_label, tool_input, extra) => {
    const out = runGuard({ tool_name: "mcp__genealogy__research_append", tool_input, ...extra });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    // The refusal must name the way out, or it reproduces the bypass this
    // guardrail exists to stop.
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("@plugin:proof-conclusion");
    expect(out.stopReason).toBeUndefined();
  });

  // `project.status` is FIELD-scoped, not section-scoped: `project` is
  // co-written (init-project authors it, every skill pings `updated`), so a
  // section rule would deny both. These run the real SCRIPT rather than calling
  // `owner_denied`, because that is the only plane where the failure mode shows:
  // `main()` wraps `json.loads` but not `decision()`, so a rule tag with no
  // branch raises `KeyError` there and the script exits 1 with empty stdout
  // (measured). A PreToolUse hook exiting non-zero other than 2 is a
  // non-blocking error, so the write it was meant to deny proceeds. A test
  // calling `owner_denied` directly sees the correct triple and passes.
  it.each([
    ["main thread, fields", { section: "project", op: "update", fields: { status: "completed" } }, {}],
    ["main thread, entry", { section: "project", op: "append", entry: { status: "completed" } }, {}],
    // The empty-dict shape that defeated the declaration arm until it read both keys.
    ["empty fields beside a populated entry", { section: "project", op: "append", fields: {}, entry: { status: "completed" } }, {}],
    ["a different agent", { section: "project", op: "update", fields: { status: "completed" } }, { agent_id: "a1", agent_type: "genealogy-research:record-extractor" }],
    // Presence is the key, so a FALSY value is still the claim. A rule written
    // `if payload_obj.get(field):` lets both of these through — which is why
    // they are here and not left to the truthy row above.
    ["a null status", { section: "project", op: "update", fields: { status: null } }, {}],
    ["an empty-string status", { section: "project", op: "update", fields: { status: "" } }, {}],
    // The batched form. `_ops` normalises it, and the §4 spec row claims this
    // arm fires "in either the single-op or `ops[]` form".
    ["batched ops form", { ops: [{ section: "project", op: "update", fields: { status: "completed" } }] }, {}],
    // agent_id present but agent_type null resolves to an empty caller, which
    // is not the owner either.
    ["agent_id with a null agent_type", { section: "project", op: "update", fields: { status: "completed" } }, { agent_id: "a1", agent_type: null }],
    // The realistic non-`completed` value: the committed corpus is almost all
    // `completed` with exactly one `active`. Subsumed by the falsy rows above against a
    // `== "completed"` implementation, but it is the value a reader expects to
    // see covered, and it costs one line.
    ["main thread, an active status", { section: "project", op: "update", fields: { status: "active" } }, {}],
  ])("denies research_append on project.status — %s", (_label, tool_input, extra) => {
    const out = runGuard({ tool_name: "mcp__genealogy__research_append", tool_input, ...extra });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("@plugin:proof-conclusion");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("status");
    expect(out.stopReason).toBeUndefined();
  });

  it.each([
    ["the owner, namespaced", { section: "project", op: "update", fields: { status: "completed" } }, { agent_id: "a1", agent_type: OWNER }],
    ["the owner, bare", { section: "project", op: "update", fields: { status: "completed" } }, { agent_id: "a1", agent_type: "proof-conclusion" }],
    // The co-written rest of the section stays open to everyone.
    ["the `updated` activity ping on the main thread", { section: "project", op: "update", fields: { updated: "2026-09-24" } }, {}],
    ["init-project authoring the section", { section: "project", op: "update", fields: { objective: "x" } }, {}],
    // An empty `fields` carries no `status` key, so presence-keying must let it
    // through from either caller.
    ["an empty fields ping on the main thread", { section: "project", op: "update", fields: {} }, {}],
    ["an empty fields ping from the owner", { section: "project", op: "update", fields: {} }, { agent_id: "a1", agent_type: OWNER }],
    // project_create writes the whole section at project start and is gated by
    // `owner_denied`'s research_append check, not by this arm. Low-information
    // by design — it pins that the gate stays tool-scoped. From init-project,
    // its only holder: on the main thread project_create is an agent-only tool.
    ["project_create setting status at creation", { section: "project", op: "update", fields: { status: "active" } }, { tool_name: "mcp__genealogy__project_create", agent_id: "a1", agent_type: "init-project" }],
  ])("allows research_append on project — %s", (_label, tool_input, extra) => {
    const out = runGuard({ tool_name: "mcp__genealogy__research_append", tool_input, ...extra });
    expect(out.hookSpecificOutput).toBeUndefined();
  });

  it.each([
    ["namespaced agent_type, as production reports it", OWNER],
    ["bare agent_type", "proof-conclusion"],
  ])("permits the owning agent — %s", (_label, agent_type) => {
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: { section: "proof_summaries", op: "append", entry: {} },
      agent_id: "agent-1",
      agent_type,
    });
    expect(out).toEqual({});
  });

  it("denies the owning agent a section outside its own lane", () => {
    // The real 2026-08-19 failure, replayed. Blocked from concluding by an
    // unresolved conflict, the agent resolved that conflict itself — status,
    // weighing_analysis, independence_analysis — and then concluded. It held
    // the right tool; it used it on a section conflict-resolution owns.
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: {
        section: "conflicts",
        op: "update",
        entryId: "c_001",
        fields: { status: "resolved", weighing_analysis: "..." },
      },
      agent_id: "agent-1",
      agent_type: OWNER,
    });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    // Names the lane, and says not to clear its own path.
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("outside your lane");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("proof_summaries");
  });

  it("denies it inside a batch too, where the other ops are legitimate", () => {
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: {
        ops: [
          { section: "conflicts", op: "update", entryId: "c_001", fields: { status: "resolved" } },
          { section: "proof_summaries", op: "append", entry: {} },
        ],
      },
      agent_id: "agent-1",
      agent_type: OWNER,
    });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  // ── caller-routed sections: research_append + person_evidence (issue #1853) ──
  //
  // Same section-scoped shape as proof_summaries above. Mirrored rather than
  // folded into the same it.each because the two arms fail differently: this
  // section's owner holds the BROAD research_append and the lane check below is
  // the only thing keeping it to one section.
  const PE_OWNER = "genealogy-research:person-evidence";

  it.each([
    ["append, no agent_id (main thread)", { section: "person_evidence", op: "append", entry: {} }, {}],
    ["update in place, no agent_id", { section: "person_evidence", op: "update", entryId: "pe_001", fields: {} }, {}],
    ["agent_type present but agent_id absent", { section: "person_evidence", op: "append" }, { agent_type: PE_OWNER }],
    ["a different agent", { section: "person_evidence", op: "append" }, { agent_id: "a1", agent_type: "record-extractor" }],
  ])("denies research_append on person_evidence — %s", (_label, tool_input, extra) => {
    const out = runGuard({ tool_name: "mcp__genealogy__research_append", tool_input, ...extra });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("@plugin:person-evidence");
    expect(out.stopReason).toBeUndefined();
  });

  it.each([
    ["namespaced agent_type, as production reports it", PE_OWNER],
    ["bare agent_type", "person-evidence"],
  ])("permits the person-evidence agent — %s", (_label, agent_type) => {
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: { section: "person_evidence", op: "append", entry: {} },
      agent_id: "agent-1",
      agent_type,
    });
    expect(out).toEqual({});
  });

  it("denies the person-evidence agent a section outside its own lane", () => {
    // Without its AGENT_WRITABLE_SECTIONS row this agent's `writable` is None
    // and the out-of-lane arm is skipped ENTIRELY — it could write any section
    // unchecked. That is the 2026-08-19 proof-conclusion failure with a
    // different actor, and nothing else in this suite would notice: removing
    // the row leaves every other test green. This is that row's only guard.
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: {
        section: "conflicts",
        op: "update",
        entryId: "c_001",
        fields: { status: "resolved" },
      },
      agent_id: "agent-1",
      agent_type: PE_OWNER,
    });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("outside your lane");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("person_evidence");
  });

  // ── caller-routed sections: research_append + namesakes (issue #3363) ──
  //
  // Section-scoped like person_evidence. The owner also writes plan_items, so a
  // row batched with its plan item's status is the case its lane must admit.
  const NS_OWNER = "genealogy-research:search-records";

  it.each([
    ["append, no agent_id (main thread)", { section: "namesakes", op: "append", entry: {} }, {}],
    ["update in place, no agent_id", { section: "namesakes", op: "update", entryId: "ns_001", fields: {} }, {}],
    ["agent_type present but agent_id absent", { section: "namesakes", op: "append" }, { agent_type: NS_OWNER }],
    ["a general-purpose stand-in", { section: "namesakes", op: "append" }, { agent_id: "a1", agent_type: "general-purpose" }],
    ["the person-evidence agent", { section: "namesakes", op: "append" }, { agent_id: "a1", agent_type: PE_OWNER }],
  ])("denies research_append on namesakes — %s", (_label, tool_input, extra) => {
    const out = runGuard({ tool_name: "mcp__genealogy__research_append", tool_input, ...extra });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("namesakes");
  });

  it("names search-records as the route out of a main-thread namesakes write", () => {
    const out = runGuard({ tool_name: "mcp__genealogy__research_append", tool_input: { section: "namesakes", op: "append", entry: {} } });
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("@plugin:search-records");
  });

  it.each([
    ["a row", { section: "namesakes", op: "append", entry: {} }],
    [
      "a row batched with its plan item's status",
      {
        ops: [
          { section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_001", fields: { status: "completed" } },
          { section: "namesakes", op: "append", entry: {} },
        ],
      },
    ],
  ])("permits the search-records agent — %s", (_label, tool_input) => {
    const out = runGuard({ tool_name: "mcp__genealogy__research_append", tool_input, agent_id: "agent-1", agent_type: NS_OWNER });
    expect(out).toEqual({});
  });

  // ── caller-routed sections: research_append + evaluations (issue #3191) ──
  //
  // Section-scoped like proof_summaries and person_evidence. What this route
  // uniquely closes is the MAIN-THREAD write: the out-of-lane rule fires only
  // for callers carrying an agent_id, and the one committed non-owner write
  // was a main thread recording its own mentor verdict before gps-mentor was
  // spawned (katalin-horak-son, tool_calls[93]/[94]) — a second opinion issued
  // by the thread whose work it reviews.
  const GM_OWNER = "genealogy-research:gps-mentor";

  it.each([
    ["append, no agent_id (main thread)", { section: "evaluations", op: "append", entry: {} }, {}],
    // The superseded_by retirement is an update; an arm that saw only appends
    // would leave that path open.
    ["update in place, no agent_id", { section: "evaluations", op: "update", entryId: "ev_001", fields: { superseded_by: "ev_002" } }, {}],
    // agent_type WITHOUT agent_id is the `--agent` main thread, not a subagent.
    ["agent_type present but agent_id absent", { section: "evaluations", op: "append" }, { agent_type: GM_OWNER }],
    ["a general-purpose stand-in", { section: "evaluations", op: "append" }, { agent_id: "a1", agent_type: "general-purpose" }],
    // Another owning agent is still not THIS owner.
    ["the proof-conclusion agent", { section: "evaluations", op: "append" }, { agent_id: "a1", agent_type: OWNER }],
    // A main-thread batch mixing a legitimate plan_items status update with an
    // evaluations append is denied whole — research_append is all-or-nothing.
    ["batched with a legitimate plan_items update", { ops: [
      { section: "plan_items", op: "update", entryId: "pli_009", fields: { status: "completed" } },
      { section: "evaluations", op: "append", entry: {} },
    ] }, {}],
    // research_append decodes a stringified `ops` (coerceJsonArg) and applies
    // it, so the hook must read the same shape (PR #3036's `_decoded`).
    ["stringified ops", { ops: JSON.stringify([{ section: "evaluations", op: "append", entry: {} }]) }, {}],
  ])("denies research_append on evaluations — %s", (_label, tool_input, extra) => {
    const out = runGuard({ tool_name: "mcp__genealogy__research_append", tool_input, ...extra });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("@plugin:gps-mentor");
    expect(out.stopReason).toBeUndefined();
  });

  it.each([
    ["namespaced agent_type, as production reports it", GM_OWNER],
    ["bare agent_type", "gps-mentor"],
  ])("permits the gps-mentor agent its real call — %s", (_label, agent_type) => {
    // The shape the agent emits: the verdict body as the top-level `verdict`
    // argument, the pointer append, and the superseded_by update on the prior
    // entry for the same focus + target. One call or two (the committed m2r
    // run splits the update into a second call) — both shapes pass the route.
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: {
        verdict: { focus: "proof-critique", target_id: "ps_001", verdict: "address_first" },
        ops: [
          { section: "evaluations", op: "append", entry: { focus: "proof-critique", target_id: "ps_001", superseded_by: null } },
          { section: "evaluations", op: "update", entryId: "ev_001", fields: { superseded_by: "ev_002" } },
        ],
      },
      agent_id: "agent-1",
      agent_type,
    });
    expect(out).toEqual({});
  });

  it("denies the gps-mentor agent a section outside its own lane", () => {
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: { section: "hypotheses", op: "append", entry: {} },
      agent_id: "agent-1",
      agent_type: GM_OWNER,
    });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("outside your lane");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("evaluations");
  });

  it("still has no opinion on a main-thread plan_items status update", () => {
    // The evaluations route must not touch the status flip the plans row
    // blesses for the main-thread skill callers.
    expect(runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: { section: "plan_items", op: "update", entryId: "pli_009", fields: { status: "completed" }, planId: "pl_001" },
    })).toEqual({});
  });

  // ── claim-routed: conflicts (issue #1852) ──
  //
  // CLAIM-scoped over several fields, not section-scoped: six skills open a
  // conflict with only the schema's required fields, and proof-conclusion
  // re-opens one, so a section route would deny every one of them. The claim is
  // the analytical product — a resolve, or any analysis field set truthy.
  const CR_OWNER = "genealogy-research:conflict-resolution";
  const SKELETON = {
    conflict_id: "c_001",
    subject_person_id: "I1",
    fact_type: "birth_date",
    competing_assertion_ids: ["a_001", "a_002"],
    status: "unresolved",
  };

  it.each([
    ["a main-thread skeleton open, append", { section: "conflicts", op: "append", entry: SKELETON }],
    ["a main-thread re-open", { section: "conflicts", op: "update", entryId: "c_001", fields: { status: "unresolved" } }],
    // Falsy claim fields claim nothing: clearing a stale winner on a re-open.
    ["a re-open clearing the winner", { section: "conflicts", op: "update", entryId: "c_001", fields: { status: "unresolved", preferred_assertion_id: null } }],
  ])("allows research_append on conflicts — %s", (_label, tool_input) => {
    const out = runGuard({ tool_name: "mcp__genealogy__research_append", tool_input });
    expect(out.hookSpecificOutput).toBeUndefined();
  });

  it.each([
    ["a resolve, fields", { status: "resolved" }],
    ["independence_analysis alone", { independence_analysis: "..." }],
    ["weighing_analysis alone", { weighing_analysis: "..." }],
    ["preferred_assertion_id alone", { preferred_assertion_id: "a_001" }],
    ["resolution_rationale alone", { resolution_rationale: "..." }],
    ["resolution_kind alone", { resolution_kind: "tree" }],
    ["resolved_value alone", { resolved_value: "1850" }],
    // What moves a question from conflict-resolution to ending on an unsettled
    // conflict. Unrouted, the main thread could stamp it onto an analysed
    // conflict and end the research without a weighing.
    ["weighed_log_entry_ids alone", { weighed_log_entry_ids: ["log_1"] }],
    // The only moot the tool accepts carries a rationale, so a moot is the
    // agent's too. Pinned so nobody "fixes" the hook to let one through.
    ["a moot, with the rationale the tool requires", { status: "moot", resolution_rationale: "a different Patrick" }],
  ])("denies the main thread a conflict claim — %s", (_label, fields) => {
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: { section: "conflicts", op: "update", entryId: "c_001", fields },
    });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("@plugin:conflict-resolution");
    expect(out.stopReason).toBeUndefined();
  });

  it.each([
    ["a resolved append in entry", { section: "conflicts", op: "append", entry: { ...SKELETON, status: "resolved" } }],
    // The empty-dict shape that defeated the declaration arm until it read both keys.
    ["empty fields beside a claiming entry", { section: "conflicts", op: "append", fields: {}, entry: { ...SKELETON, weighing_analysis: "..." } }],
    ["inside a batch whose other op is a skeleton", { ops: [
      { section: "conflicts", op: "append", entry: SKELETON },
      { section: "conflicts", op: "update", entryId: "c_002", fields: { status: "resolved" } },
    ] }],
  ])("denies the main thread a conflict claim — %s", (_label, tool_input) => {
    const out = runGuard({ tool_name: "mcp__genealogy__research_append", tool_input });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  // `research_append` parses a stringified `ops`, `entry` or `fields`
  // (coerceJsonArg) and applies it, so the hook must read the same shape — a
  // guard that only walks lists and dicts lets the identical write through.
  it.each([
    ["stringified fields", { section: "conflicts", op: "update", entryId: "c_001", fields: JSON.stringify({ status: "resolved" }) }],
    ["stringified entry", { section: "conflicts", op: "append", entry: JSON.stringify({ ...SKELETON, weighing_analysis: "..." }) }],
    ["stringified ops", { ops: JSON.stringify([{ section: "conflicts", op: "update", entryId: "c_001", fields: { status: "resolved" } }]) }],
    ["stringified proof_summaries ops", { ops: JSON.stringify([{ section: "proof_summaries", op: "append", entry: {} }]) }],
  ])("denies a stringified argument — %s", (_label, tool_input) => {
    const out = runGuard({ tool_name: "mcp__genealogy__research_append", tool_input });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it.each([
    ["a stringified skeleton open", { section: "conflicts", op: "append", entry: JSON.stringify(SKELETON) }],
    // Does not parse: matches nothing, and the script must still answer.
    ["unparseable fields", { section: "conflicts", op: "update", entryId: "c_001", fields: "{status: resolved" }],
    ["unparseable ops", { ops: "[{" }],
  ])("allows, without raising — %s", (_label, tool_input) => {
    const out = runGuard({ tool_name: "mcp__genealogy__research_append", tool_input });
    expect(out.hookSpecificOutput).toBeUndefined();
  });

  it.each([
    ["namespaced agent_type, as production reports it", CR_OWNER],
    ["bare agent_type", "conflict-resolution"],
  ])("permits the conflict-resolution agent a resolve — %s", (_label, agent_type) => {
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: {
        section: "conflicts",
        op: "update",
        entryId: "c_001",
        fields: { status: "resolved", resolution_kind: "tree", weighing_analysis: "...", independence_analysis: "...", resolution_rationale: "..." },
      },
      agent_id: "agent-1",
      agent_type,
    });
    expect(out).toEqual({});
  });

  // init-project (issue #2122) is laned, not routed: nothing is routed to it,
  // and the lane is what keeps it out of `questions`, which it wrote on
  // `ut_init_project_q4v` and `_vqx` (v10) while it was still a skill on the
  // main thread, where no lane applies.
  const IP_AGENT = "genealogy-research:init-project";

  it("denies the init-project agent a research question", () => {
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: { section: "questions", op: "append", entry: {} },
      agent_id: "agent-1",
      agent_type: IP_AGENT,
    });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("outside your lane");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("researcher_profile");
  });

  it("denies the init-project agent a hand-written source: project_create writes the memories", () => {
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: { section: "sources", op: "append", entry: {} },
      agent_id: "agent-1",
      agent_type: IP_AGENT,
    });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("outside your lane");
  });

  it("denies the init-project agent the project status, which proof-conclusion owns", () => {
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: { section: "project", op: "update", fields: { status: "completed" } },
      agent_id: "agent-1",
      agent_type: IP_AGENT,
    });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("@plugin:proof-conclusion");
  });

  it.each([
    ["project (its objective)", { section: "project", op: "update", fields: { objective: "x" } }],
    ["researcher_profile", { section: "researcher_profile", op: "update", fields: {} }],
    ["both in one batch", {
      ops: [
        { section: "project", op: "update", fields: { objective: "x" } },
        { section: "researcher_profile", op: "update", fields: {} },
      ],
    }],
  ])("permits the init-project agent its own lane — %s", (_label, tool_input) => {
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input,
      agent_id: "agent-1",
      agent_type: IP_AGENT,
    });
    expect(out).toEqual({});
  });

  it("denies the conflict-resolution agent a section outside its own lane", () => {
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: { section: "hypotheses", op: "append", entry: {} },
      agent_id: "agent-1",
      agent_type: CR_OWNER,
    });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("outside your lane");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("conflicts");
  });

  it("permits the owning agent's real shape — summary + resolve in ONE batch", () => {
    // This is what the agent actually emits: the conclusion and its question
    // resolution as one all-or-nothing write. A permit proven only against the
    // single-op form would leave the shipped call path untested.
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: {
        ops: [
          { section: "proof_summaries", op: "append", entry: {} },
          { section: "questions", op: "update", entryId: "q_001", fields: { status: "resolved" } },
        ],
      },
      agent_id: "agent-1",
      agent_type: OWNER,
    });
    expect(out).toEqual({});
  });

  it.each([
    // Every other section is untouched — only this one is routed.
    ["assertions on the main thread", { section: "assertions", op: "append" }],
    ["a batch with no owned section", { ops: [{ section: "questions", op: "update" }] }],
  ])("has no opinion on research_append — %s", (_label, tool_input) => {
    expect(runGuard({ tool_name: "mcp__genealogy__research_append", tool_input })).toEqual({});
  });

  it("routes under every server spelling, since the prefix is not ours to pick", () => {
    for (const name of [
      "mcp__genealogy__research_append",
      "mcp__remote-devices__Genealogy_Research__research_append",
      "mcp__Genealogy_Research__research_append",
    ]) {
      const out = runGuard({ tool_name: name, tool_input: { section: "proof_summaries", op: "append" } });
      expect(out.hookSpecificOutput?.permissionDecision, `${name} was not denied`).toBe("deny");
    }
  });

  it("allows the call rather than erroring on a malformed payload", () => {
    // A hook that throws would fail a tool call the user was entitled to make.
    expect(runGuard(null)).toEqual({});
    expect(JSON.parse(execGuard("not json"))).toEqual({});
  });

  // ── caller-routed CLAIM: research_append + search_stop ──
  //
  // Field-scoped, not section-scoped, and the difference is the whole design.
  // `search_stop` is a REQUIRED property of every question, so
  // `question-selection` writes it on every question it creates — with
  // `stopped_because: null`. A section rule, or a
  // presence-keyed field rule, denies all of those. The hook only fires when
  // `stopped_because` is a stop-gate value.
  const EXH_OWNER = "genealogy-research:research-exhaustiveness";
  // Appends come from question-selection: a main-thread append is refused
  // earlier, by the append route, before this claim is read.
  const QS_CALLER = { agent_id: "a1", agent_type: "genealogy-research:question-selection" };
  const DECLARE = { stopped_because: "question_answered", log_entry_ids: ["log_001"], stop_criteria: null, not_reached: [] };

  it.each([
    ["update, no agent_id (main thread)",
      { section: "questions", op: "update", entryId: "q_001", fields: { search_stop: DECLARE } }, {}],
    ["append carrying a gate-value declaration",
      { section: "questions", op: "append", entry: { search_stop: DECLARE } }, QS_CALLER],
    // An append carrying BOTH keys. research_append's op schema declares
    // `entry` and `fields`, and applyOne ignores `fields` on an append — so a
    // check that read `fields` first and fell back only when it was not a dict
    // saw an empty dict, found no declaration, and let the write land. This is
    // the only plane that binds in Cowork; a missing deny fails open silently.
    ["append carrying both entry and an empty fields",
      { section: "questions", op: "append",
        entry: { search_stop: DECLARE }, fields: {} }, QS_CALLER],
    ["batched ops form",
      { ops: [{ section: "plan_items", op: "update" },
              { section: "questions", op: "update", entryId: "q_001", fields: { search_stop: DECLARE } }] }, {}],
    // agent_type WITHOUT agent_id is the `--agent` main thread, not a subagent.
    ["agent_type present but agent_id absent",
      { section: "questions", op: "update", fields: { search_stop: DECLARE } }, { agent_type: EXH_OWNER }],
    // Another owning agent is still not THIS owner: proof-conclusion may write
    // `questions`, but not the exhaustiveness claim.
    ["the proof-conclusion agent",
      { section: "questions", op: "update", fields: { search_stop: DECLARE } },
      { agent_id: "a1", agent_type: "genealogy-research:proof-conclusion" }],
    // Non-gate values are also routed: ruling 2026-09-30 routes ALL non-null
    // `stopped_because`, because the agent applies the criteria that justify
    // the claim (stop-gate OR early-termination) — not the main thread.
    ["non-gate early termination from main thread (stopped_because: resources_spent)",
      { section: "questions", op: "update", entryId: "q_001",
        fields: { search_stop: { stopped_because: "resources_spent", log_entry_ids: ["log_001"], stop_criteria: null, not_reached: [] } } }, {}],
  ])("denies a non-null stopped_because — %s", (_label, tool_input, extra) => {
    const out = runGuard({ tool_name: "mcp__genealogy__research_append", tool_input, ...extra });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("@plugin:research-exhaustiveness");
    expect(out.stopReason).toBeUndefined();
  });

  it.each([
    ["the owning agent, namespaced", { agent_id: "a1", agent_type: EXH_OWNER }],
    ["the owning agent, bare", { agent_id: "a1", agent_type: "research-exhaustiveness" }],
  ])("permits the owner to declare — %s", (_label, extra) => {
    expect(runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: { section: "questions", op: "update", entryId: "q_001", fields: { search_stop: DECLARE } },
      ...extra,
    })).toEqual({});
  });

  it.each([
    // The vector a SECTION-scoped route would have broken, and the one a
    // presence-keyed field rule would have broken too: question-selection
    // creating a question. `stopped_because: null` is not a stop-gate value.
    ["question-selection creating a question (stopped_because: null)",
      { section: "questions", op: "append",
        entry: { question: "Who were the parents?", search_stop: { stopped_because: null, log_entry_ids: [], stop_criteria: null, not_reached: [] } } },
      QS_CALLER],
    // An unrelated question edit from the main thread.
    ["a status-only update",
      { section: "questions", op: "update", entryId: "q_001", fields: { status: "in_progress" } }, {}],
  ])("has no opinion on %s", (_label, tool_input, extra) => {
    expect(runGuard({ tool_name: "mcp__genealogy__research_append", tool_input, ...extra })).toEqual({});
  });

  // Question appends (issue #3548): creating a question is question-selection's
  // step; updating one is shared with research-exhaustiveness and
  // proof-conclusion.
  const QS_AGENT = "genealogy-research:question-selection";
  const NEW_QUESTION = {
    section: "questions",
    op: "append",
    entry: { question: "Who were Ann's parents?", search_stop: { stopped_because: null } },
  };

  it.each([
    ["the main thread", {}],
    ["the main thread, in a batch beside a legitimate op", null],
    ["the main thread of an --agent session (agent_type, no agent_id)", { agent_type: QS_AGENT }],
  ])("routes a new question from %s to question-selection", (_who, caller) => {
    const tool_input =
      caller === null
        ? { ops: [{ section: "plans", op: "append", entry: {} }, NEW_QUESTION] }
        : NEW_QUESTION;
    const out = runGuard({ tool_name: "mcp__genealogy__research_append", tool_input, ...(caller ?? {}) });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("invoke `@plugin:question-selection`");
  });

  it.each([
    ["proof-conclusion, whose lane holds questions for its resolve", "proof-conclusion"],
    ["research-exhaustiveness, whose lane holds questions for its stop", EXH_OWNER],
    // Not laned at all: the general-purpose stand-in a failed spawn falls back to.
    ["an unlaned subagent", "general-purpose"],
  ])("tells %s to hand a new question off, since it cannot invoke an agent", (_who, agent_type) => {
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: NEW_QUESTION,
      agent_id: "a1",
      agent_type,
    });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("hand off");
    expect(out.hookSpecificOutput.permissionDecisionReason).not.toContain("invoke `@plugin:");
  });

  it("leaves an agent whose lane lacks questions to the lane arm", () => {
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: NEW_QUESTION,
      agent_id: "a1",
      agent_type: "genealogy-research:research-plan",
    });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("outside your lane");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("`plan_items`");
  });

  it("routes a new question sent as a stringified ops batch", () => {
    // research_append runs coerceJsonArg on `ops`, so a string is applied there.
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: { ops: JSON.stringify([NEW_QUESTION]) },
    });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("@plugin:question-selection");
  });

  it("permits question-selection's own new question", () => {
    expect(
      runGuard({
        tool_name: "mcp__genealogy__research_append",
        tool_input: NEW_QUESTION,
        agent_id: "a1",
        agent_type: QS_AGENT,
      }),
    ).toEqual({});
  });

  it.each([
    ["the main thread moving a question in progress", {}, { status: "in_progress" }],
    ["proof-conclusion resolving it", { agent_id: "a1", agent_type: "proof-conclusion" }, { status: "resolved", resolved: true }],
  ])("leaves question updates alone: %s", (_who, caller, fields) => {
    expect(
      runGuard({
        tool_name: "mcp__genealogy__research_append",
        tool_input: { section: "questions", op: "update", entryId: "q_001", fields },
        ...caller,
      }),
    ).toEqual({});
  });

  it("holds the exhaustiveness agent to its own lane", () => {
    // The out-of-lane arm, for the agent this PR adds. Its lane is `questions`
    // and nothing else — deliberately excluding `plan_items`, so it cannot
    // clear the in-flight-plan refusal it meets in research_append by flipping
    // the blocking item itself (issue #1821).
    const out = runGuard({
      tool_name: "mcp__genealogy__research_append",
      tool_input: { section: "plan_items", op: "update", entryId: "pli_009", fields: { status: "completed" } },
      agent_id: "a1",
      agent_type: EXH_OWNER,
    });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("`questions`");
  });

});

describe("the main thread is denied the tools only agents hold", () => {
  const SPELLINGS = (tool: string) => [
    `mcp__genealogy__${tool}`,
    `mcp__remote-devices__Genealogy_Research__${tool}`,
    `mcp__Genealogy_Research__${tool}`,
  ];

  // The raw-write deny reaches the main session too, so every writer tool it
  // names that the main session cannot call must come with an agent that can.
  it("the protected-file deny names, for each agent-only writer it suggests, an agent holding it", () => {
    const { agentOnly } = guardAgentOnlyTables();
    const reason = runGuard({ tool_name: "Write", tool_input: { file_path: "/project/research.json" } })
      .hookSpecificOutput.permissionDecisionReason as string;
    const named = Object.keys(agentOnly).filter((t) => new RegExp(`\\b${t}\\b`).test(reason));
    expect(named).toEqual(expect.arrayContaining(["project_create", "tree_edit", "external_links_search"]));
    for (const tool of named) {
      expect(agentOnly[tool].some((a) => reason.includes(`\`@plugin:${a}\``)), tool).toBe(true);
    }
  });

  it.each(SPELLINGS("census_children_gap"))(
    "denies a main-thread %s and names both agents that hold it",
    (tool_name) => {
      const out = runGuard({ tool_name, tool_input: { personId: "I1" } });
      expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
      const reason: string = out.hookSpecificOutput.permissionDecisionReason;
      // The route out, in the wording owner_denied uses, naming both holders.
      expect(reason).toMatch(/invoke `@plugin:[a-z-]+`/);
      expect(reason).toContain("`@plugin:check-warnings`");
      expect(reason).toContain("`@plugin:question-selection`");
      // Recoverable: the turn continues so the model can delegate.
      expect(out.stopReason).toBeUndefined();
    },
  );

  it("names every one of a tool's agents, however many there are", () => {
    const reason: string = runGuard({ tool_name: "mcp__genealogy__place_search", tool_input: {} })
      .hookSpecificOutput.permissionDecisionReason;
    for (const agent of guardAgentOnlyTables().agentOnly.place_search) {
      expect(reason).toContain(`\`@plugin:${agent}\``);
    }
  });

  it.each([
    ["the namespaced agent_type production reports", { agent_id: "a1", agent_type: "genealogy-research:check-warnings" }],
    ["the bare agent_type the harnesses report", { agent_id: "a1", agent_type: "question-selection" }],
  ])("lets the same call through from an agent: %s", (_how, caller) => {
    expect(
      runGuard({ tool_name: "mcp__genealogy__census_children_gap", tool_input: { personId: "I1" }, ...caller }),
    ).toEqual({});
  });

  it("still denies a session started with --agent, which carries agent_type without agent_id", () => {
    const out = runGuard({
      tool_name: "mcp__genealogy__census_children_gap",
      tool_input: { personId: "I1" },
      agent_type: "research",
    });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it.each([
    // The router reads the person itself; a skill declares it.
    "person_read",
    // research/SKILL.md delivers a bounded transcription itself (issue #2490).
    "image_transcribe",
    "sidecar_read",
    "record_read",
    "research_log_append",
  ])("has no opinion on a main-thread %s", (tool) => {
    expect(runGuard({ tool_name: `mcp__genealogy__${tool}`, tool_input: {} })).toEqual({});
  });

  it("leaves a main-thread research_append to the section rules", () => {
    // MAIN_THREAD_OK: a plan_items status update is no section's routed claim.
    expect(
      runGuard({
        tool_name: "mcp__genealogy__research_append",
        tool_input: { section: "plan_items", op: "update", entryId: "pli_001", fields: { status: "completed" } },
      }),
    ).toEqual({});
  });

  it("does not deny image_read, which no agent holds", () => {
    expect(runGuard({ tool_name: "mcp__genealogy__image_read", tool_input: {} })).toEqual({});
  });
});
