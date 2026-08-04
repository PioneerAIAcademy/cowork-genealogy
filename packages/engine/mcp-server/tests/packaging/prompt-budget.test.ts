import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

// Prompt-budget lint (warn-only). Reports the byte-size delta a PR introduces
// to every SKILL.md and plugin-agent body, so reviewers see growth at review
// time — which today nothing surfaces. The unit suite cannot be the gate: it
// grades a single invocation in fresh context and blesses an addition as
// readily as a cut.
//
// Settled by the lead 2026-07-31 (issue #976):
//   - Warn-only, not blocking. Every test always passes.
//   - Delta-only. No absolute ceiling per file yet (issue #1275).
//   - Prose bytes, not a token estimate.
//
// Delta comparison requires the base branch to be fetched. In CI,
// engine-tests.yml fetches origin/<base-ref> before running vitest. Locally,
// `origin/main` may or may not be available — the test degrades gracefully to
// reporting absolute sizes only, no deltas.

const SKILLS_PATH = "packages/engine/plugin/skills";
const AGENTS_PATH = "packages/engine/plugin/agents";

/** The two prompt shapes: `skills/<name>/SKILL.md` and `agents/<name>.md`. */
const TRACKED = /(^|\/)(skills\/[^/]+\/SKILL\.md|agents\/[^/]+\.md)$/;

// ---------------------------------------------------------------------------
// Reading sizes out of git
// ---------------------------------------------------------------------------

/**
 * Every size on both sides comes from git's own blob length, never `statSync`.
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
      ],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch {
    return null;
  }
}

/**
 * Parse `git ls-tree -r --long` output into path → byte size, keeping only the
 * two tracked prompt shapes.
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

/** Return the resolved base-branch name, or null if the ref is not available. */
function baseRefAvailable(): string | null {
  // GITHUB_BASE_REF is set by GitHub Actions for pull_request events.
  const ref = process.env.GITHUB_BASE_REF || "main";
  try {
    execFileSync("git", ["rev-parse", "--verify", `origin/${ref}`], {
      stdio: "pipe",
    });
    return ref;
  } catch {
    // In CI this means the fetch step failed or was skipped — surface it so a
    // silent degradation to absolute-only doesn't hide a broken fetch.
    if (process.env.CI) {
      console.log(
        `::warning::prompt-budget: origin/${ref} is not available; ` +
          "reporting absolute sizes only (no deltas). " +
          "Check the 'Fetch base branch' step in engine-tests.yml.",
      );
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Display path: `packages/engine/plugin/skills/x/SKILL.md` → `skills/x/SKILL.md`. */
function short(repoRelPath: string): string {
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

function label(d: Delta): string {
  const name = short(d.path);
  if (d.before === null) return `${name}: ${formatKB(d.after!)} (new file)`;
  if (d.after === null) {
    return `${name}: ${formatKB(d.before)} → deleted (${formatDelta(d.delta)})`;
  }
  return `${name}: ${formatKB(d.before)} → ${formatKB(d.after)} (${formatDelta(d.delta)})`;
}

// ---------------------------------------------------------------------------
// Build the report
// ---------------------------------------------------------------------------

const headTree = lsTree("HEAD");
const headSizes = headTree === null ? new Map<string, number>() : parseLsTree(headTree);

const baseRef = baseRefAvailable();
const baseTree = baseRef === null ? null : lsTree(`origin/${baseRef}`);
const baseSizes = baseTree === null ? null : parseLsTree(baseTree);

const deltas = baseSizes === null ? [] : computeDeltas(baseSizes, headSizes);

// ---------------------------------------------------------------------------
// Report — every test here always passes (warn-only)
// ---------------------------------------------------------------------------

describe("prompt-budget (warn-only)", () => {
  it("discovers prompt files to track", () => {
    // Sanity, and the only guard against a silently-empty `ls-tree`: if either
    // side comes back with nothing, every delta vanishes and the report says
    // "no prompt-size changes" while covering nothing at all.
    expect(headSizes.size).toBeGreaterThan(0);
    if (baseSizes !== null) expect(baseSizes.size).toBeGreaterThan(0);
  });

  if (baseSizes === null) {
    // Local dev without origin/main fetched, or a push event in CI.
    // Report absolute sizes as a fallback — still useful for orientation.
    for (const [path, size] of headSizes) {
      it(`${short(path)}: ${formatKB(size)}`, () => {
        // Informational only — always passes.
      });
    }
  } else if (deltas.length === 0) {
    it("no prompt-size changes in this changeset", () => {
      // Nothing grew or shrank — nothing to report.
    });
  } else {
    for (const d of deltas) {
      it(label(d), () => {
        // Warn-only: the test name carries the signal; the test always passes.
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Unit tests — these DO assert, and are the only part of this file that can
// fail. They cover the arithmetic and formatting that the warn-only report
// above renders but never checks.
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
      // Not a tracked prompt shape — a skill's template, and a tree entry.
      "100644 blob 0000000000000000000000000000000000000000     120\tpackages/engine/plugin/skills/check-warnings/templates/report.md",
      "040000 tree 1111111111111111111111111111111111111111       -\tpackages/engine/plugin/skills/check-warnings",
    ].join("\n");

    expect(parseLsTree(out)).toEqual(
      new Map([
        ["packages/engine/plugin/agents/record-extractor.md", 48539],
        ["packages/engine/plugin/skills/check-warnings/SKILL.md", 17747],
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
});
