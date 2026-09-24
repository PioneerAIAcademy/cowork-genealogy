import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { allToolSchemas } from "../../src/tool-schemas.js";

// Prompt-budget lint. Reports the size delta a PR introduces to every SKILL.md,
// plugin-agent body, CLAUDE.md, and MCP tool description — the four prompt
// shapes billed on every run of the thing that loads them — so reviewers see
// growth at review time.
//
// Settled by the lead 2026-07-31, amended 2026-09-24 (issue #976, #2879):
//   - The report is warn-only; the baseline file must be current (issue #2879).
//   - Delta-only. No absolute ceiling per file yet (issue #1275).
//   - Prose bytes for prompt files, characters for tool descriptions.
//
// A committed prompt-sizes.json records the current sizes at HEAD. A staleness
// test fails when the file disagrees. Regenerate with:
//   UPDATE_PROMPT_SIZES=1 npx vitest run tests/packaging/prompt-budget.test.ts
//
// Delta comparison requires the base branch to be fetched. In CI,
// engine-tests.yml fetches origin/<base-ref> before running vitest. Locally,
// `origin/main` may or may not be available — the test degrades gracefully to
// reporting absolute sizes only, no deltas.

const SKILLS_PATH = "packages/engine/plugin/skills";
const AGENTS_PATH = "packages/engine/plugin/agents";
// Loaded into every Claude Code session in this repo, and tracked by nothing
// else. The plugin artifacts above are billed per skill run; this is billed per
// session, which is why it belongs on the same report.
const ROOT_PROMPT_PATH = "CLAUDE.md";

/**
 * The three prompt shapes: `skills/<name>/SKILL.md`, `agents/<name>.md`, and
 * the repo-root `CLAUDE.md`. The last is anchored so a nested `CLAUDE.md`
 * (e.g. `eval/CLAUDE.md`, which no session loads wholesale) stays out.
 */
const TRACKED = /(^|\/)(skills\/[^/]+\/SKILL\.md|agents\/[^/]+\.md)$|^CLAUDE\.md$/;

const REGENERATE_CMD =
  "UPDATE_PROMPT_SIZES=1 npx vitest run tests/packaging/prompt-budget.test.ts";

const BASELINE_URL = new URL("./prompt-sizes.json", import.meta.url);

// ---------------------------------------------------------------------------
// Reading prompt-file sizes out of git
// ---------------------------------------------------------------------------

/**
 * Every prompt-file size comes from git's own blob length, never `statSync`.
 * On Windows with `core.autocrlf=true` the on-disk file has CRLF while git
 * stores LF, so mixing the two would report a phantom growth on every file
 * equal to its line count.
 */
function lsTree(ref: string): string | null {
  try {
    return execFileSync(
      "git",
      [
        "ls-tree",
        "-r",
        "--long",
        // --full-tree is load-bearing, NOT redundant: `git ls-tree` resolves
        // its pathspec relative to the CURRENT WORKING DIRECTORY and prints
        // paths the same way, and vitest runs with cwd
        // `packages/engine/mcp-server` (engine-tests.yml sets
        // working-directory). Without it the pathspecs below match nothing
        // from there and git still EXITS 0 — the lint would report "no
        // prompt-size changes" forever, silently. --full-tree implies
        // --full-name, anchoring both the pathspec and the printed path at
        // the repo root.
        "--full-tree",
        ref,
        "--",
        SKILLS_PATH,
        AGENTS_PATH,
        ROOT_PROMPT_PATH,
      ],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch {
    return null;
  }
}

/**
 * Parse `git ls-tree -r --long` output into path → byte size, keeping only the
 * three tracked prompt shapes.
 *
 * Row format is `<mode> <type> <sha> <size>\t<path>`, size right-aligned in a
 * fixed-width column, so split the metadata on whitespace and the path on the
 * single tab. A path may itself contain spaces; it may not contain a tab.
 */
export function parseLsTree(stdout: string): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const [, type, , size] = line.slice(0, tab).trim().split(/\s+/);
    if (type !== "blob") continue;
    const path = line.slice(tab + 1);
    if (!TRACKED.test(path)) continue;
    sizes.set(path, Number(size));
  }
  return sizes;
}

// ---------------------------------------------------------------------------
// Tool-description sizes
// ---------------------------------------------------------------------------

/**
 * The prompt cost of one MCP tool entry: tool-level description plus the
 * serialized inputSchema. Characters, not bytes — the schema is an in-memory
 * object that never hits disk in isolation.
 */
export function computeToolSize(schema: {
  description?: string;
  inputSchema?: unknown;
}): number {
  return (
    (schema.description ?? "").length +
    JSON.stringify(schema.inputSchema ?? {}).length
  );
}

function computeToolSizes(): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const schema of allToolSchemas) {
    sizes.set(`tool:${schema.name}`, computeToolSize(schema));
  }
  return sizes;
}

// ---------------------------------------------------------------------------
// Baseline I/O
// ---------------------------------------------------------------------------

interface Baseline {
  meta: { prompt_unit: string; tool_unit: string; regenerate: string };
  prompts: Record<string, number>;
  tools: Record<string, number>;
}

/**
 * Read a prompt-sizes.json baseline. Returns null on missing or corrupt file.
 */
export function readBaseline(path: string | URL): Baseline | null {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.prompts !== "object" ||
      typeof parsed.tools !== "object"
    ) {
      return null;
    }
    return parsed as Baseline;
  } catch {
    return null;
  }
}

function buildBaseline(
  promptSizes: Map<string, number>,
  toolSizes: Map<string, number>,
): Baseline {
  const prompts: Record<string, number> = {};
  for (const [k, v] of [...promptSizes.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    prompts[k] = v;
  }
  const tools: Record<string, number> = {};
  for (const [k, v] of [...toolSizes.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    tools[k] = v;
  }
  return {
    meta: {
      prompt_unit: "bytes",
      tool_unit: "chars",
      regenerate: REGENERATE_CMD,
    },
    prompts,
    tools,
  };
}

function serializeBaseline(b: Baseline): string {
  return JSON.stringify(b, null, 2) + "\n";
}

/**
 * Read the baseline from the base branch via `git show`. Returns null when
 * the base branch is unavailable or the file doesn't exist on that branch.
 */
function readBaseBaseline(baseRef: string): Baseline | null {
  try {
    const raw = execFileSync(
      "git",
      [
        "show",
        `origin/${baseRef}:packages/engine/mcp-server/tests/packaging/prompt-sizes.json`,
      ],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.prompts !== "object" ||
      typeof parsed.tools !== "object"
    ) {
      return null;
    }
    return parsed as Baseline;
  } catch {
    return null;
  }
}

/** GITHUB_BASE_REF is set by GitHub Actions for pull_request events. */
const REQUESTED_BASE_REF = process.env.GITHUB_BASE_REF || "main";

/** Return the resolved base-branch name, or null if the ref is not available. */
function baseRefAvailable(): string | null {
  try {
    execFileSync("git", ["rev-parse", "--verify", `origin/${REQUESTED_BASE_REF}`], {
      stdio: "pipe",
    });
    return REQUESTED_BASE_REF;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Display path: `packages/engine/plugin/skills/x/SKILL.md` → `skills/x/SKILL.md`. */
function short(repoRelPath: string): string {
  if (repoRelPath.startsWith("tool:")) return repoRelPath;
  return repoRelPath.replace("packages/engine/plugin/", "");
}

export function formatKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Deltas under 1 KB render in bytes.
 *
 * Rounding them to one decimal of a kilobyte printed `+0.0 KB` for anything
 * under 51 bytes — a report line whose three numbers were all identical and
 * which therefore said nothing, on every typo fix. Issue #976 named that
 * failure mode directly ("another 68-hit list nobody reads").
 */
export function formatDelta(bytes: number): string {
  const sign = bytes < 0 ? "-" : "+";
  const abs = Math.abs(bytes);
  return abs < 1024 ? `${sign}${abs} B` : `${sign}${formatKB(abs)}`;
}

function formatChars(n: number): string {
  return `${n} chars`;
}

function formatCharDelta(n: number): string {
  const sign = n < 0 ? "-" : "+";
  return `${sign}${Math.abs(n)} chars`;
}

// ---------------------------------------------------------------------------
// Delta computation
// ---------------------------------------------------------------------------

export interface Delta {
  path: string;
  /** null = added in this changeset. */
  before: number | null;
  /** null = deleted in this changeset. */
  after: number | null;
  delta: number;
}

/**
 * Union of both sides, so an added file, a deleted one, and a resized one are
 * all reported. Unchanged files are omitted — the point is what this changeset
 * did, not a census.
 */
export function computeDeltas(
  before: Map<string, number>,
  after: Map<string, number>,
): Delta[] {
  const deltas: Delta[] = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(path) ?? null;
    const a = after.get(path) ?? null;
    if (b === a) continue;
    deltas.push({ path, before: b, after: a, delta: (a ?? 0) - (b ?? 0) });
  }
  // Largest growth first so the biggest additions are most visible.
  return deltas.sort((x, y) => y.delta - x.delta);
}

function promptLabel(d: Delta): string {
  const name = short(d.path);
  if (d.before === null) return `${name}: ${formatKB(d.after!)} (new file)`;
  if (d.after === null) {
    return `${name}: ${formatKB(d.before)} → deleted (${formatDelta(d.delta)})`;
  }
  return `${name}: ${formatKB(d.before)} → ${formatKB(d.after)} (${formatDelta(d.delta)})`;
}

function toolLabel(d: Delta): string {
  const name = short(d.path);
  if (d.before === null) return `${name}: ${formatChars(d.after!)} (new tool)`;
  if (d.after === null) {
    return `${name}: ${formatChars(d.before)} → deleted (${formatCharDelta(d.delta)})`;
  }
  return `${name}: ${formatChars(d.before)} → ${formatChars(d.after)} (${formatCharDelta(d.delta)})`;
}

// ---------------------------------------------------------------------------
// Build the report
// ---------------------------------------------------------------------------

const headTree = lsTree("HEAD");
const headSizes = headTree === null ? new Map<string, number>() : parseLsTree(headTree);
const headToolSizes = computeToolSizes();

const baseRef = baseRefAvailable();

// Base-branch baseline (via git show) — the primary source for the "before"
// side of delta reporting for all four shapes.
const baseBaseline = baseRef === null ? null : readBaseBaseline(baseRef);

// Prompt deltas: prefer the baseline file; fall back to git ls-tree on the
// base branch so prompt deltas still report on the first PR before
// prompt-sizes.json exists on main.
const basePromptSizes: Map<string, number> | null = (() => {
  if (baseBaseline !== null)
    return new Map(Object.entries(baseBaseline.prompts));
  if (baseRef === null) return null;
  const tree = lsTree(`origin/${baseRef}`);
  return tree === null ? null : parseLsTree(tree);
})();

// Tool deltas: only available when the baseline exists on the base branch.
const baseToolSizes: Map<string, number> | null =
  baseBaseline === null ? null : new Map(Object.entries(baseBaseline.tools));

const promptDeltas =
  basePromptSizes === null ? [] : computeDeltas(basePromptSizes, headSizes);
const toolDeltas =
  baseToolSizes === null ? [] : computeDeltas(baseToolSizes, headToolSizes);

// ---------------------------------------------------------------------------
// Regeneration
// ---------------------------------------------------------------------------

if (process.env.UPDATE_PROMPT_SIZES) {
  const baseline = buildBaseline(headSizes, headToolSizes);
  writeFileSync(BASELINE_URL, serializeBaseline(baseline));
  process.stdout.write(
    `\nprompt-sizes.json regenerated (${headSizes.size} prompts, ${headToolSizes.size} tools)\n\n`,
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * Write the report on raw stdout, because neither of the two obvious channels
 * reaches a CI log.
 *
 * Test names do not: `npm test` runs vitest's default reporter, which collapses
 * a passing file to `✓ …/prompt-budget.test.ts (10 tests)` and prints no names.
 * `console.log` does not either: vitest 4 defaults to `silent: "passed-only"`,
 * so console output from a file whose tests all pass is discarded. This lint
 * always passes, so both of those are its normal case. `process.stdout.write`
 * is not intercepted.
 */
function emitReport(): void {
  const out: string[] = [];
  if (basePromptSizes === null && baseToolSizes === null) {
    // A silent degradation to absolute-only would hide a broken fetch step.
    // Workflow commands are parsed only at the start of a line.
    if (process.env.CI) {
      out.push(
        `::warning::prompt-budget: origin/${REQUESTED_BASE_REF} is not readable; ` +
          "reporting absolute sizes only (no deltas). " +
          "Check the 'Fetch base branch' step in engine-tests.yml.",
      );
    }
    for (const [path, size] of headSizes)
      out.push(`  ${short(path)}: ${formatKB(size)}`);
    for (const [name, size] of headToolSizes)
      out.push(`  ${name}: ${formatChars(size)}`);
  } else if (promptDeltas.length === 0 && toolDeltas.length === 0) {
    out.push("  no prompt-size changes in this changeset");
  } else {
    if (promptDeltas.length > 0) {
      out.push("  Prompt files:");
      for (const d of promptDeltas) out.push(`    ${promptLabel(d)}`);
    }
    if (toolDeltas.length > 0) {
      out.push("  Tool descriptions:");
      for (const d of toolDeltas) out.push(`    ${toolLabel(d)}`);
    }
  }
  process.stdout.write(`\nprompt-budget (warn-only)\n${out.join("\n")}\n\n`);
}

emitReport();

// ---------------------------------------------------------------------------
// Report — every test here always passes (warn-only). `emitReport` above is
// what a CI reader sees; these names repeat it for `--reporter=verbose` and
// the vitest UI.
// ---------------------------------------------------------------------------

describe("prompt-budget (warn-only)", () => {
  it("discovers prompt files to track", () => {
    // Sanity, and the only guard against a silently-empty `ls-tree`: if either
    // side comes back with nothing, every delta vanishes and the report says
    // "no prompt-size changes" while covering nothing at all.
    expect(headSizes.size).toBeGreaterThan(0);
    if (basePromptSizes !== null) expect(basePromptSizes.size).toBeGreaterThan(0);
  });

  it("discovers tools to track", () => {
    expect(headToolSizes.size).toBeGreaterThan(0);
  });

  if (basePromptSizes === null && baseToolSizes === null) {
    // Local dev without origin/main fetched, or a CI run whose fetch step
    // failed. Report absolute sizes as a fallback — still useful for
    // orientation.
    for (const [path, size] of headSizes) {
      it(`${short(path)}: ${formatKB(size)}`, () => {
        // Informational only — always passes.
      });
    }
    for (const [name, size] of headToolSizes) {
      it(`${name}: ${formatChars(size)}`, () => {
        // Informational only — always passes.
      });
    }
  } else if (promptDeltas.length === 0 && toolDeltas.length === 0) {
    it("no prompt-size changes in this changeset", () => {
      // Nothing grew or shrank — nothing to report.
    });
  } else {
    for (const d of promptDeltas) {
      it(promptLabel(d), () => {
        // Warn-only: the name carries the signal; the test always passes.
      });
    }
    for (const d of toolDeltas) {
      it(toolLabel(d), () => {
        // Warn-only: the name carries the signal; the test always passes.
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Staleness — this block DOES assert. prompt-sizes.json must match HEAD.
// ---------------------------------------------------------------------------

describe("prompt-sizes.json is current", () => {
  it("matches the sizes computed at HEAD", () => {
    const expected = buildBaseline(headSizes, headToolSizes);
    const actual = readBaseline(BASELINE_URL);

    if (actual === null) {
      expect.fail(
        `prompt-sizes.json does not exist or is corrupt. Regenerate with:\n  ${REGENERATE_CMD}`,
      );
      return;
    }

    const diffs: string[] = [];
    for (const key of new Set([
      ...Object.keys(expected.prompts),
      ...Object.keys(actual.prompts),
    ])) {
      if (expected.prompts[key] !== actual.prompts[key]) {
        diffs.push(
          `  ${short(key)}: baseline ${actual.prompts[key] ?? "missing"} → HEAD ${expected.prompts[key] ?? "deleted"}`,
        );
      }
    }
    for (const key of new Set([
      ...Object.keys(expected.tools),
      ...Object.keys(actual.tools),
    ])) {
      if (expected.tools[key] !== actual.tools[key]) {
        diffs.push(
          `  ${key}: baseline ${actual.tools[key] ?? "missing"} → HEAD ${expected.tools[key] ?? "deleted"}`,
        );
      }
    }

    if (diffs.length > 0) {
      expect.fail(
        `prompt-sizes.json is stale.\n${diffs.join("\n")}\n` +
          `Regenerate with:\n  ${REGENERATE_CMD}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Unit tests — these DO assert, and are the only part of this file that can
// fail besides the staleness test above. They cover the arithmetic, formatting,
// and baseline I/O.
// ---------------------------------------------------------------------------

describe("prompt-budget (unit)", () => {
  it("formatDelta renders a sub-KB growth in bytes", () => {
    expect(formatDelta(4)).toBe("+4 B");
  });

  it("formatDelta renders a sub-KB shrink in bytes", () => {
    expect(formatDelta(-37)).toBe("-37 B");
  });

  it("formatDelta still renders KB at and above 1 KB", () => {
    expect(formatDelta(2048)).toBe("+2.0 KB");
    expect(formatDelta(-2048)).toBe("-2.0 KB");
  });

  it("parseLsTree reads path and byte size from --long output", () => {
    const out = [
      "100644 blob 4d91252be27df1674ba0815e954117da915916eb   48539\tpackages/engine/plugin/agents/record-extractor.md",
      "100644 blob 8959947c6234ff492c5d5c1c42307c2dc241407a   17747\tpackages/engine/plugin/skills/check-warnings/SKILL.md",
      "100644 blob 2222222222222222222222222222222222222222   30000\tCLAUDE.md",
      // Not a tracked prompt shape — a skill's template, a nested CLAUDE.md no
      // session loads wholesale, and a tree entry.
      "100644 blob 0000000000000000000000000000000000000000     120\tpackages/engine/plugin/skills/check-warnings/templates/report.md",
      "100644 blob 3333333333333333333333333333333333333333    4000\teval/CLAUDE.md",
      "040000 tree 1111111111111111111111111111111111111111       -\tpackages/engine/plugin/skills/check-warnings",
    ].join("\n");

    expect(parseLsTree(out)).toEqual(
      new Map([
        ["packages/engine/plugin/agents/record-extractor.md", 48539],
        ["packages/engine/plugin/skills/check-warnings/SKILL.md", 17747],
        ["CLAUDE.md", 30000],
      ]),
    );
  });

  it("computeDeltas omits unchanged files", () => {
    const same = new Map([["a/SKILL.md", 100]]);
    expect(computeDeltas(same, new Map(same))).toEqual([]);
  });

  it("computeDeltas reports a new file at its full size", () => {
    const got = computeDeltas(new Map(), new Map([["a/SKILL.md", 100]]));
    expect(got).toEqual([{ path: "a/SKILL.md", before: null, after: 100, delta: 100 }]);
  });

  it("computeDeltas reports a file deleted in the changeset", () => {
    const got = computeDeltas(new Map([["a/SKILL.md", 100]]), new Map());
    expect(got).toEqual([{ path: "a/SKILL.md", before: 100, after: null, delta: -100 }]);
  });

  it("computeDeltas sorts largest growth first", () => {
    const before = new Map([
      ["grew/SKILL.md", 100],
      ["shrank/SKILL.md", 900],
    ]);
    const after = new Map([
      ["grew/SKILL.md", 500],
      ["shrank/SKILL.md", 100],
    ]);
    expect(computeDeltas(before, after).map((d) => d.path)).toEqual([
      "grew/SKILL.md",
      "shrank/SKILL.md",
    ]);
  });

  it("computeToolSize sums description length and stringified inputSchema length", () => {
    const schema = {
      description: "Search for a person",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    };
    const expected =
      "Search for a person".length +
      JSON.stringify(schema.inputSchema).length;
    expect(computeToolSize(schema)).toBe(expected);
  });

  it("computeToolSize handles missing description and inputSchema", () => {
    expect(computeToolSize({})).toBe(JSON.stringify({}).length);
    expect(computeToolSize({ description: "hello" })).toBe(
      5 + JSON.stringify({}).length,
    );
  });

  it("readBaseline returns null for a missing file", () => {
    expect(readBaseline("/nonexistent/prompt-sizes.json")).toBeNull();
  });

  it("readBaseline returns null for corrupt JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompt-budget-"));
    try {
      writeFileSync(join(dir, "bad.json"), "{ not json");
      expect(readBaseline(join(dir, "bad.json"))).toBeNull();

      writeFileSync(
        join(dir, "wrong.json"),
        JSON.stringify({ prompts: "not-an-object", tools: {} }),
      );
      expect(readBaseline(join(dir, "wrong.json"))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("computeDeltas reports added and removed tools", () => {
    const before = new Map([["tool:old_tool", 200]]);
    const after = new Map([["tool:new_tool", 150]]);
    const got = computeDeltas(before, after);
    expect(got).toContainEqual({
      path: "tool:new_tool",
      before: null,
      after: 150,
      delta: 150,
    });
    expect(got).toContainEqual({
      path: "tool:old_tool",
      before: 200,
      after: null,
      delta: -200,
    });
  });
});
