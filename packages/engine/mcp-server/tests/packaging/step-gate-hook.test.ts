import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, utimesSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error -- plain .mjs build helper, no type declarations.
import { resolvePython, describePythonCandidates } from "../../../../../scripts/python-interpreter.mjs";

// step_gate_hook.py: the step boundary on the connector and in Cowork (#4791,
// section I). Binding is proved only by a live session; this proves the script.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..", "..");
const HOOKS_DIR = join(REPO_ROOT, "packages", "engine", "plugin", "hooks");
const HOOK = join(HOOKS_DIR, "step_gate_hook.py");
const PYTHON: string[] | null = resolvePython();

let stateDir = "";
let env: NodeJS.ProcessEnv = {};

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "step-gate-"));
  env = { ...process.env, GENEALOGY_STEP_GATE_DIR: stateDir };
  delete env.GENEALOGY_HOSTED_PLANE;
});

function python(): [string, string[]] {
  if (!PYTHON) throw new Error(`No Python 3 found (tried: ${describePythonCandidates()}).`);
  const [cmd, ...pre] = PYTHON;
  return [cmd, pre];
}

function run(payload: object, extraEnv: NodeJS.ProcessEnv = {}): any {
  const [cmd, pre] = python();
  const out = execFileSync(cmd, [...pre, HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env: { ...env, ...extraEnv },
  });
  return JSON.parse(out);
}

function runAsync(payload: object): Promise<any> {
  const [cmd, pre] = python();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...pre, HOOK], { env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", () => resolve(JSON.parse(out)));
    child.stdin.end(JSON.stringify(payload));
  });
}

const SESSION = "sess-1";

function prompt(text: string, promptId?: string, session = SESSION) {
  return run({
    hook_event_name: "UserPromptSubmit",
    session_id: session,
    prompt: text,
    ...(promptId === undefined ? {} : { prompt_id: promptId }),
  });
}

function spawnPayload(agent: string, promptId?: string, session = SESSION, extra: object = {}) {
  return {
    hook_event_name: "PreToolUse",
    session_id: session,
    tool_name: "Agent",
    tool_input: { subagent_type: `genealogy-research:${agent}` },
    ...(promptId === undefined ? {} : { prompt_id: promptId }),
    ...extra,
  };
}

const allowed = (out: any) => JSON.stringify(out) === "{}";
const denied = (out: any) => out?.hookSpecificOutput?.permissionDecision === "deny";

describe("step_gate_hook.py is registered", () => {
  const hooks = () =>
    JSON.parse(readFileSync(join(HOOKS_DIR, "hooks.json"), "utf-8")).hooks as Record<
      string,
      { matcher?: string; hooks: { command?: string }[] }[]
    >;
  const runsGate = (e: { hooks: { command?: string }[] }) =>
    e.hooks.some((h) => (h.command ?? "").includes("/hooks/step_gate_hook.py"));

  it("on PreToolUse for every step tool, after the guard", () => {
    const pre = hooks().PreToolUse;
    expect(runsGate(pre[0]), "the guard must stay PreToolUse[0]").toBe(false);
    const entries = pre.filter(runsGate);
    expect(entries.length).toBe(1);
    const matches = (tool: string) => new RegExp(`^(${entries[0].matcher})$`).test(tool);
    for (const tool of ["Agent", "Task", "Skill"]) expect(matches(tool), tool).toBe(true);
    expect(matches("mcp__genealogy__record_search")).toBe(false);
  });

  it("on UserPromptSubmit", () => {
    expect(hooks().UserPromptSubmit.filter(runsGate).length).toBe(1);
  });
});

describe("step_gate_hook.py", () => {
  it("denies question-selection in a turn init-project opened, offering choosing the question", () => {
    prompt("Research KWCJ-RN4's parents.", "p1");
    expect(allowed(run(spawnPayload("init-project", "p1")))).toBe(true);
    const out = run(spawnPayload("question-selection", "p1"));
    expect(denied(out)).toBe(true);
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("choosing the question");
    expect(out.continue).toBeUndefined();
    expect(out.stopReason).toBeUndefined();
  });

  it("denies a second out-of-group spawn and never halts", () => {
    prompt("Continue.", "p1");
    expect(allowed(run(spawnPayload("research-plan", "p1")))).toBe(true);
    for (const agent of ["search-records", "person-evidence"]) {
      const out = run(spawnPayload(agent, "p1"));
      expect(denied(out), agent).toBe(true);
      expect(out.continue, agent).toBeUndefined();
      expect(out.stopReason, agent).toBeUndefined();
    }
  });

  it("starts a new turn on a researcher message with no prompt_id", () => {
    prompt("Continue.");
    expect(allowed(run(spawnPayload("research-plan")))).toBe(true);
    expect(denied(run(spawnPayload("search-records")))).toBe(true);
    prompt("Continue.");
    expect(allowed(run(spawnPayload("search-records")))).toBe(true);
  });

  it("leaves a subagent's own calls alone", () => {
    prompt("Continue.", "p1");
    expect(allowed(run(spawnPayload("research-plan", "p1")))).toBe(true);
    expect(allowed(run(spawnPayload("search-records", "p1", SESSION, { agent_id: "a1" })))).toBe(true);
  });

  it("has no opinion under GENEALOGY_HOSTED_PLANE", () => {
    const hosted = { GENEALOGY_HOSTED_PLANE: "1" };
    run({ hook_event_name: "UserPromptSubmit", session_id: SESSION, prompt: "Continue.", prompt_id: "p1" }, hosted);
    expect(allowed(run(spawnPayload("research-plan", "p1"), hosted))).toBe(true);
    expect(allowed(run(spawnPayload("search-records", "p1"), hosted))).toBe(true);
    expect(readdirSync(stateDir)).toEqual([]);
  });

  it("allows the call when its state cannot be read", () => {
    prompt("Continue.", "p1");
    expect(allowed(run(spawnPayload("research-plan", "p1")))).toBe(true);
    writeFileSync(join(stateDir, `${SESSION}.json`), "{not json", "utf-8");
    expect(allowed(run(spawnPayload("search-records", "p1")))).toBe(true);
  });

  it("admits research-plan then person-evidence in a Wrap it up. turn", () => {
    prompt("Wrap it up.", "p1");
    expect(allowed(run(spawnPayload("research-plan", "p1")))).toBe(true);
    expect(allowed(run(spawnPayload("person-evidence", "p1")))).toBe(true);
    expect(denied(run(spawnPayload("research-plan", "p1")))).toBe(true);
  });

  it("does not reopen the gate on a hand-back carrying the same prompt_id", () => {
    prompt("Continue.", "p1");
    expect(allowed(run(spawnPayload("research-plan", "p1")))).toBe(true);
    prompt('<agent-message from="research-plan">Plan written.</agent-message>', "p1");
    expect(denied(run(spawnPayload("search-records", "p1")))).toBe(true);
    prompt("Some text the runtime relays", "p1");
    expect(denied(run(spawnPayload("search-records", "p1")))).toBe(true);
  });

  it("does not end a wrap-up turn on a hand-back", () => {
    prompt("Wrap it up.", "p1");
    expect(allowed(run(spawnPayload("research-plan", "p1")))).toBe(true);
    prompt('<agent-message from="research-plan">Disposed.</agent-message>', "p1");
    expect(allowed(run(spawnPayload("person-evidence", "p1")))).toBe(true);
    // Only a wrap-up admits conflict-resolution after person-evidence.
    expect(allowed(run(spawnPayload("conflict-resolution", "p1")))).toBe(true);
  });

  it("lets only one of several concurrent out-of-group spawns in an init-project turn pass", async () => {
    // Several sessions at once, so an unlocked read-modify-write races in at least one.
    const sessions = ["c1", "c2", "c3", "c4", "c5", "c6"];
    for (const session of sessions) {
      run({ hook_event_name: "UserPromptSubmit", session_id: session, prompt: "Research KWCJ-RN4.", prompt_id: "p1" });
      expect(allowed(run(spawnPayload("init-project", "p1", session)))).toBe(true);
    }
    const agents = ["search-records", "person-evidence", "conflict-resolution", "proof-conclusion", "timeline", "tree-edit"];
    const outs = await Promise.all(
      sessions.flatMap((session) => agents.map((a) => runAsync(spawnPayload(a, "p1", session)).then((o) => [session, o] as const))),
    );
    for (const session of sessions) {
      const mine = outs.filter(([s]) => s === session).map(([, o]) => o);
      expect(mine.filter(allowed).length, `${session}: ${JSON.stringify(mine)}`).toBe(1);
      const state = JSON.parse(readFileSync(join(stateDir, `${session}.json`), "utf-8"));
      expect(state.steps.length, session).toBe(2);
    }
  }, 30_000);

  it("breaks a planted stale lock", () => {
    prompt("Continue.", "p1");
    expect(allowed(run(spawnPayload("research-plan", "p1")))).toBe(true);
    const lock = join(stateDir, `${SESSION}.lock`);
    writeFileSync(lock, "", "utf-8");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    expect(denied(run(spawnPayload("search-records", "p1")))).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });
});
