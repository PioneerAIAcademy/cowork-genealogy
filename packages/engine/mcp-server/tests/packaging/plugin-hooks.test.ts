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
function guardToolNames(): { fileWriteTools: string[]; deviceWriteTools: string[] } {
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
  };
}

// Resolved once, not per call: probing costs a process launch each time.
// Hardcoding "python3" here made all 11 tests below fail on Windows, where the
// name is a Microsoft Store alias rather than an interpreter -- see
// scripts/python-interpreter.mjs.
const PYTHON: string[] | null = resolvePython();

/** Feed the guard script on stdin the way the runtime does; return raw stdout. */
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
    const { fileWriteTools, deviceWriteTools } = guardToolNames();

    // The extraction is load-bearing: an empty list makes every assertion below
    // vacuously true, which is the same false green in a new costume.
    expect(fileWriteTools.length).toBeGreaterThan(0);
    expect(deviceWriteTools.length).toBeGreaterThan(0);

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

  it("allows the call rather than erroring on a malformed payload", () => {
    // A hook that throws would fail a tool call the user was entitled to make.
    expect(runGuard(null)).toEqual({});
    expect(JSON.parse(execGuard("not json"))).toEqual({});
  });
});
