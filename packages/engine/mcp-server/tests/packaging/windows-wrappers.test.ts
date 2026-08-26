import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
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
// A leading underscore marks an internal helper (called by other .bat files)
// rather than a double-clickable entry point — so it has no Makefile target.
const EVAL_NOT_A_TARGET = new Set(["Setup.bat", "_CheckSync.bat"]);

/**
 * `.bat` files allowed to stay in `scripts/` rather than `scripts/windows/`.
 * Both take the zip or case directory as an argument, so neither wraps a make
 * target. Anything else in `scripts/` is a wrapper that escaped the directory
 * this guard reads.
 */
const SCRIPTS_ROOT_BAT = new Set([
  "reset-feedback-case.bat",
  "setup-feedback-case.bat",
]);

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

  it("every wrapper resolves the repo root, not scripts/", () => {
    const wrong = wrappers.filter((f) => {
      const cd = read(join(windowsDir, f)).match(/^cd \/d "%~dp0(.*)"/m);
      return cd !== null && cd[1] !== "..\\..";
    });
    expect(wrong).toEqual([]);
  });

  it("every sibling wrapper call goes through %~dp0", () => {
    const stale = wrappers.flatMap((f) =>
      [
        ...read(join(windowsDir, f)).matchAll(/^call\s+(?!"?%~dp0)(\S*\.bat)/gm),
      ].map((m) => `${f}: call ${m[1]}`),
    );
    expect(stale).toEqual([]);
  });

  it("no wrapper escapes into scripts/ instead of scripts/windows/", () => {
    const stray = readdirSync(join(projectRoot, "scripts"))
      .filter((f) => f.endsWith(".bat") && !SCRIPTS_ROOT_BAT.has(f))
      .sort();
    expect(stray).toEqual([]);
  });

  /**
   * `npm`/`pnpm`/`npx` resolve to `.cmd` batch files. cmd.exe REPLACES the
   * running script when one batch file invokes another without `call`, so a
   * bare `npm ci` ends the wrapper: everything below it — the errorlevel
   * check, `npm run build`, the stamp write — silently never runs. Every
   * `eval\*.bat` already uses `call` for this reason.
   */
  it("every npm/pnpm/npx invocation goes through `call`", () => {
    const bare = wrappers.flatMap((f) =>
      [
        ...read(join(windowsDir, f)).matchAll(/^\s*(?:npm|pnpm|npx)\s+\S.*$/gm),
      ].map((m) => `${f}: ${m[0].trim()}`),
    );
    expect(bare).toEqual([]);
  });

  /**
   * cmd's `shift` moves `%1` into `%0`, so ANY `%0` / `%~dp0` / `%~f0` read
   * after a `shift` yields the caller's first argument rather than the script.
   * `setup-feedback-case.bat` resolved the repo root that way and could not
   * unpack a single feedback case (issue #1876) -- and because that line sat
   * above everything else, nothing below it in the file had ever run.
   *
   * This is cmd-only. The `.sh` twin resolves SCRIPT_DIR after its parse loop
   * too and is fine, because bash's `shift` never touches `$0`. Do not carry
   * "resolve before parsing" away as a cross-shell rule.
   *
   * Scans EVERY `.bat` in the repo, not just `scripts/windows/`: the file that
   * had the bug is in `scripts/`, which the helpers above never read. REM/`::`
   * comment bodies are stripped first -- an explanatory comment naming `%~dp0`
   * sits directly above the assignment it explains, and matching the comment
   * instead of the code made the FIRST version of this guard pass on the very
   * bug it was written for (Ikennaya1's review of PR #1905).
   */
  const batFiles = (function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name === "node_modules" || e.name === ".venv" || e.name === ".git") return [];
      const full = join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.name.toLowerCase().endsWith(".bat") ? [full] : [];
    });
  })(projectRoot);

  /** Body with REM / `::` comment lines blanked, so a comment cannot match. */
  const code = (f: string) =>
    read(f)
      .split("\n")
      .map((l) => (/^\s*(?:rem\b|::)/i.test(l) ? "" : l))
      .join("\n");

  const ZERO = /%~?[dpfnx]*0\b/;
  const SHIFT = /^\s*shift\b/m;
  const rel = (f: string) => relative(projectRoot, f).split(sep).join("/");

  it("found .bat files to check (guards the reader itself)", () => {
    expect(batFiles.length).toBeGreaterThan(10);
  });

  it("a .bat still uses shift (guards the reader itself)", () => {
    const shifting = batFiles.filter((f) => SHIFT.test(code(f)));
    expect(shifting.map(rel).length).toBeGreaterThan(0);
  });

  it("a .bat still reads %0 (guards the reader itself)", () => {
    const reading = batFiles.filter((f) => ZERO.test(code(f)));
    expect(reading.map(rel).length).toBeGreaterThan(0);
  });

  it("no .bat reads %0 after it shifts", () => {
    const late = batFiles.flatMap((f) => {
      const body = code(f);
      const shift = body.search(SHIFT);
      if (shift === -1) return [];
      return [...body.matchAll(new RegExp(ZERO.source, "g"))]
        .filter((m) => (m.index ?? 0) > shift)
        .map((m) => `${rel(f)}: ${m[0]} read after shift`);
    });
    expect(late).toEqual([]);
  });
});
