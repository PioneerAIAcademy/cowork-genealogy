import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

/** Run the guard script the way the runtime does: payload on stdin, JSON out. */
function runGuard(payload: unknown): any {
  const out = execFileSync("python3", [GUARD], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
  });
  return JSON.parse(out);
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
    const matcher = loadHooks().PreToolUse[0].matcher ?? "";
    for (const tool of ["Write", "Edit", "NotebookEdit"]) {
      expect(new RegExp(`^(${matcher})$`).test(tool)).toBe(true);
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

  it("allows the call rather than erroring on a malformed payload", () => {
    // A hook that throws would fail a tool call the user was entitled to make.
    expect(runGuard(null)).toEqual({});
    expect(
      JSON.parse(execFileSync("python3", [GUARD], { input: "not json", encoding: "utf-8" })),
    ).toEqual({});
  });
});
