import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error -- plain .mjs build helper, no type declarations (tsconfig
// only compiles src/**, so this import is never typechecked).
import { resolvePython, describePythonCandidates } from "../../../../../scripts/python-interpreter.mjs";

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
 * `OWNED_SECTIONS` routes a whole section; `OWNED_DECLARATIONS` routes one FIELD
 * within a section, keyed on `("<section>", "<field>")`. The manifest records
 * both as `enforceableAt: ["hook", …]` on the section's row, so a helper reading
 * only the first map reports drift the moment a field-scoped row lands — which
 * is exactly what happened when `questions` was added.
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
  return sections;
}

// Resolved once, not per call: probing costs a process launch each time.
// Hardcoding "python3" here made all 11 tests below fail on Windows, where the
// name is a Microsoft Store alias rather than an interpreter -- see
// scripts/python-interpreter.mjs.
const PYTHON: string[] | null = resolvePython();

/**
 * Feed the guard script on stdin the way the runtime does; return raw stdout.
 *
 * **This doubles as the stdlib-only guard, and it is the only one.** The hook
 * ships into the Cowork VM, where a non-stdlib import is not available and
 * fails at load — silently, from the user's point of view, since a hook that
 * raises falls through to allowing the call. Nothing lints the imports; what
 * catches them is that every test below *executes* the real script under a
 * bare interpreter, so an added `import requests` turns this file red. Keep it
 * that way: if you ever stub or mock the script instead of running it, the
 * stdlib rule loses its only enforcement and nothing will tell you.
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
        const rel = hook.command!.split("${CLAUDE_PLUGIN_ROOT}/")[1]?.trim();
        expect(existsSync(join(PLUGIN_DIR, rel))).toBe(true);
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

    // And the agent each row names is the one the script routes to. Both maps
    // again: a field-scoped row's owner lives in OWNED_DECLARATIONS, keyed on
    // the (section, field) tuple, so reading only OWNED_SECTIONS leaves the
    // owner `undefined` and the assertion fails on a row that is in fact
    // correct.
    const src = readFileSync(GUARD, "utf-8");
    const owners: Record<string, string> = Object.fromEntries(
      [...(src.match(/^OWNED_SECTIONS\s*=\s*\{([^}]*)\}/m)?.[1] ?? "").matchAll(
        /["']([^"']+)["']\s*:\s*["']([^"']+)["']/g,
      )].map((m) => [m[1], m[2]]),
    );
    for (const m of (src.match(/^OWNED_DECLARATIONS\s*=\s*\{([^}]*)\}/m)?.[1] ?? "").matchAll(
      /\(\s*["']([^"']+)["']\s*,\s*["'][^"']+["']\s*\)\s*:\s*["']([^"']+)["']/g,
    )) {
      owners[m[1]] = m[2];
    }
    for (const row of manifest.rows) {
      if (!(row.enforceableAt ?? []).includes("hook")) continue;
      const fromManifest = (row.hookCallers ?? [])
        .filter((c: string) => c.startsWith("agent:"))
        .map((c: string) => c.slice("agent:".length));
      expect(fromManifest, `${row.section}: manifest names no hookCallers agent`).toContain(
        owners[row.section],
      );
    }
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
    const { fileWriteTools, deviceWriteTools, ownerRoutedTools } = guardToolNames();

    // The extraction is load-bearing: an empty list makes every assertion below
    // vacuously true, which is the same false green in a new costume.
    expect(fileWriteTools.length).toBeGreaterThan(0);
    expect(deviceWriteTools.length).toBeGreaterThan(0);
    expect(ownerRoutedTools.length).toBeGreaterThan(0);

    // Anchored full match — the strictest reading of how a matcher is applied.
    // Passing under `^(…)$` also passes under a substring search, so proving it
    // here proves it under either form (ADR-0005: "both matcher forms bind").
    const matches = (tool: string) => new RegExp(`^(${matcher})$`).test(tool);

    for (const tool of fileWriteTools) {
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
    for (const tool of ownerRoutedTools) {
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
});

describe("the guard script's decisions", () => {
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

  // ── caller-routed CLAIM: research_append + exhaustive_declaration ──
  //
  // Field-scoped, not section-scoped, and the difference is the whole design.
  // `exhaustive_declaration` is a REQUIRED property of every question, so
  // `question-selection` writes it on every question it creates from the main
  // thread — 197 of the 392 corpus ops carrying the field are exactly those.
  // A section rule, or a presence-keyed field rule, denies all of them.
  const EXH_OWNER = "genealogy-research:research-exhaustiveness";
  const DECLARE = { declared: true, log_entry_ids: ["log_001"] };

  it.each([
    ["update, no agent_id (main thread)",
      { section: "questions", op: "update", entryId: "q_001", fields: { exhaustive_declaration: DECLARE } }, {}],
    ["append carrying a true declaration",
      { section: "questions", op: "append", entry: { exhaustive_declaration: DECLARE } }, {}],
    // An append carrying BOTH keys. research_append's op schema declares
    // `entry` and `fields`, and applyOne ignores `fields` on an append — so a
    // check that read `fields` first and fell back only when it was not a dict
    // saw an empty dict, found no declaration, and let the write land. This is
    // the only plane that binds in Cowork; a missing deny fails open silently.
    ["append carrying both entry and an empty fields",
      { section: "questions", op: "append",
        entry: { exhaustive_declaration: DECLARE }, fields: {} }, {}],
    ["batched ops form",
      { ops: [{ section: "plan_items", op: "update" },
              { section: "questions", op: "update", entryId: "q_001", fields: { exhaustive_declaration: DECLARE } }] }, {}],
    // agent_type WITHOUT agent_id is the `--agent` main thread, not a subagent.
    ["agent_type present but agent_id absent",
      { section: "questions", op: "update", fields: { exhaustive_declaration: DECLARE } }, { agent_type: EXH_OWNER }],
    // Another owning agent is still not THIS owner: proof-conclusion may write
    // `questions`, but not the exhaustiveness claim.
    ["the proof-conclusion agent",
      { section: "questions", op: "update", fields: { exhaustive_declaration: DECLARE } },
      { agent_id: "a1", agent_type: "genealogy-research:proof-conclusion" }],
  ])("denies a true exhaustive_declaration — %s", (_label, tool_input, extra) => {
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
      tool_input: { section: "questions", op: "update", entryId: "q_001", fields: { exhaustive_declaration: DECLARE } },
      ...extra,
    })).toEqual({});
  });

  it.each([
    // The vector a SECTION-scoped route would have broken, and the one a
    // presence-keyed field rule would have broken too: question-selection
    // creating a question. The schema makes the field required, so every
    // creation carries it.
    ["question-selection creating a question (declared: false)",
      { section: "questions", op: "append",
        entry: { question: "Who were the parents?", exhaustive_declaration: { declared: false, log_entry_ids: [] } } }],
    // The owning skill's own honest early-termination path. It claims nothing,
    // so it is not routed.
    ["an honest early termination (declared: false)",
      { section: "questions", op: "update", entryId: "q_001",
        fields: { exhaustive_declaration: { declared: false, log_entry_ids: ["log_001"] } } }],
    // An unrelated question edit from the main thread.
    ["a status-only update",
      { section: "questions", op: "update", entryId: "q_001", fields: { status: "in_progress" } }],
  ])("has no opinion on %s", (_label, tool_input) => {
    expect(runGuard({ tool_name: "mcp__genealogy__research_append", tool_input })).toEqual({});
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
