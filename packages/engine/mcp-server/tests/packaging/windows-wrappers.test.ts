import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `scripts/windows/*.bat` drift.
 *
 * The wrappers reimplement Makefile recipes rather than shelling out to `make`,
 * so nothing links a wrapper to the target it claims to mirror. 45 of them
 * landed at once with zero doc references and one hand-written index; the
 * failure mode is silent in both directions — a renamed target leaves a wrapper
 * running a command that no longer exists, and a new wrapper duplicating an
 * `eval\` one gives the Windows team two entry points to the same operation.
 *
 * What this can check: that every wrapper names a real target, that the index
 * matches the directory, and that no wrapper re-adds a duplicate of a
 * genealogist-facing `eval\` script. What it cannot check is whether a
 * wrapper's *commands* still match its recipe — that is review's job.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..", "..", "..", "..");
const windowsDir = join(projectRoot, "scripts", "windows");
const evalDir = join(projectRoot, "eval");

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

/**
 * Operations whose Windows entry point is a genealogist-facing `eval\` script.
 * Those prompt for the fixture/skill name and pause; the developer wrappers
 * take arguments. Both spellings of the same operation is the duplication this
 * guards against, so a target listed here must NOT get a `scripts/windows/`
 * wrapper.
 */
const EVAL_OWNED: Record<string, string> = {
  "cowork-install": "CoworkInstall.bat",
  "e2e-calibrate": "RunCalibration.bat",
  "e2e-login": "Login.bat",
  "e2e-preflight": "CheckSetup.bat",
  "e2e-project": "SeedProject.bat",
  "e2e-run": "RunE2E.bat",
  "e2e-scratch": "ScratchResearch.bat",
  "e2e-validate": "ValidateFixture.bat",
  "e2e-view": "ViewE2E.bat",
  electron: "Viewer.bat",
  "eval-skill": "RunTests.bat",
  "eval-ui": "Start.bat",
  "gate-skill": "GateSkill.bat",
  "install-hooks": "InstallHooks.bat",
  mcpb: "BuildMcpb.bat",
  "optimize-skill": "OptimizeSkill.bat",
  plugin: "BuildPlugin.bat",
};

/**
 * `eval\` scripts that are not a Makefile target's counterpart. `Setup.bat` is
 * the fresh-machine bootstrap — it installs uv, pnpm and the Claude Code CLI
 * and prompts for API keys, none of which `make install` does. Listed so that
 * a NEW `eval\` script forces a decision here rather than silently escaping
 * the map above.
 */
const EVAL_NOT_A_TARGET = new Set(["Setup.bat"]);

const makefile = read(join(projectRoot, "Makefile"));
const makeTargets = new Set(
  [...makefile.matchAll(/^([a-zA-Z0-9_-]+):/gm)].map((m) => m[1]),
);

const wrappers = readdirSync(windowsDir)
  .filter((f) => f.endsWith(".bat"))
  .sort();

/** The target each wrapper declares in its `REM Windows equivalent of:` header. */
function declaredTarget(file: string): string | null {
  const header = read(join(windowsDir, file)).match(
    /^REM Windows equivalent of: make ([a-zA-Z0-9_-]+)/m,
  );
  return header ? header[1] : null;
}

describe("Windows wrapper drift", () => {
  it("read a Makefile with targets (guards the reader itself)", () => {
    expect(makeTargets.size).toBeGreaterThan(30);
    expect(makeTargets.has("test-all")).toBe(true);
  });

  it("found wrappers to check (guards the reader itself)", () => {
    expect(wrappers.length).toBeGreaterThan(10);
  });

  it("every wrapper declares the make target it mirrors", () => {
    const undeclared = wrappers.filter((f) => declaredTarget(f) === null);
    expect(undeclared).toEqual([]);
  });

  it("every declared target exists in the Makefile", () => {
    const dangling = wrappers
      .map((f) => [f, declaredTarget(f)] as const)
      .filter(([, t]) => t !== null && !makeTargets.has(t))
      .map(([f, t]) => `${f} -> make ${t}`);
    expect(dangling).toEqual([]);
  });

  it("every wrapper is named after the target it mirrors", () => {
    const mismatched = wrappers
      .map((f) => [f, declaredTarget(f)] as const)
      .filter(([f, t]) => t !== null && `${t}.bat` !== f)
      .map(([f, t]) => `${f} declares make ${t}`);
    expect(mismatched).toEqual([]);
  });

  it("no wrapper duplicates a genealogist-facing eval script", () => {
    const duplicates = wrappers
      .map((f) => [f, declaredTarget(f)] as const)
      .filter(([, t]) => t !== null && t in EVAL_OWNED)
      .map(([f, t]) => `scripts\\windows\\${f} duplicates eval\\${EVAL_OWNED[t!]}`);
    expect(duplicates).toEqual([]);
  });

  it("every eval script the duplicate guard names still exists", () => {
    const missing = Object.entries(EVAL_OWNED)
      .filter(([, bat]) => !existsSync(join(evalDir, bat)))
      .map(([target, bat]) => `eval\\${bat} (make ${target})`);
    expect(missing).toEqual([]);
  });

  it("every eval-owned target exists in the Makefile", () => {
    const dangling = Object.keys(EVAL_OWNED).filter((t) => !makeTargets.has(t));
    expect(dangling).toEqual([]);
  });

  it("every eval script is accounted for by the duplicate guard", () => {
    const known = new Set([...Object.values(EVAL_OWNED), ...EVAL_NOT_A_TARGET]);
    const unaccounted = readdirSync(evalDir)
      .filter((f) => f.endsWith(".bat") && !known.has(f))
      .sort();
    expect(unaccounted).toEqual([]);
  });

  it("the scripts/windows README lists exactly the wrappers on disk", () => {
    const readme = read(join(windowsDir, "README.md"));
    const listed = [
      ...readme.matchAll(/`scripts\\windows\\([a-zA-Z0-9_-]+\.bat)`/g),
    ].map((m) => m[1]);
    expect([...new Set(listed)].sort()).toEqual(wrappers);
  });

  it("the README pairs each wrapper with the target it declares", () => {
    const readme = read(join(windowsDir, "README.md"));
    const rows = [
      ...readme.matchAll(
        /^\|\s*`make ([a-zA-Z0-9_-]+)`\s*\|\s*`scripts\\windows\\([a-zA-Z0-9_-]+\.bat)`/gm,
      ),
    ];
    const mispaired = rows
      .filter(([, target, bat]) => declaredTarget(bat) !== target)
      .map(([, target, bat]) => `README says ${bat} = make ${target}`);
    expect(mispaired).toEqual([]);
    expect(rows.length).toBe(wrappers.length);
  });
});
