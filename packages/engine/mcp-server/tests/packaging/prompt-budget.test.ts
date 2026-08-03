import { describe, it, expect } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

// Prompt-budget lint (warn-only). Reports the byte-size delta a PR introduces
// to every SKILL.md and plugin-agent body, so reviewers see growth at review
// time — which today nothing surfaces. The unit suite cannot be the gate: it
// grades a single invocation in fresh context and blesses an addition as
// readily as a cut.
//
// Settled by the lead 2026-07-31 (issue #976):
//   - Warn-only, not blocking. Every test always passes.
//   - Delta-only. No absolute ceiling per file yet.
//   - Prose bytes, not a token estimate.
//
// Delta comparison requires the base branch to be fetched. In CI,
// engine-tests.yml fetches origin/<base-ref> before running vitest. Locally,
// `origin/main` may or may not be available — the test degrades gracefully to
// reporting absolute sizes only, no deltas.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const pluginRoot = join(repoRoot, "plugin");
const skillsDir = join(pluginRoot, "skills");
const agentsDir = join(pluginRoot, "agents");

// ---------------------------------------------------------------------------
// File discovery (same pattern as skill-description-length.test.ts)
// ---------------------------------------------------------------------------

interface PromptFile {
  /** Repo-relative path (forward slashes, for `git show`). */
  rel: string;
  /** Display-friendly short path (strips `packages/engine/plugin/`). */
  short: string;
  /** Current size in bytes, measured via `git show HEAD:` to avoid CRLF skew. */
  size: number;
}

function discoverPromptFiles(): PromptFile[] {
  const files: PromptFile[] = [];

  // skills/*/SKILL.md
  for (const name of readdirSync(skillsDir)) {
    if (!existsSync(join(skillsDir, name, "SKILL.md"))) continue;
    const rel = `packages/engine/plugin/skills/${name}/SKILL.md`;
    const size = gitBlobSize("HEAD", rel);
    if (size === null) continue; // uncommitted new file — skip
    files.push({ rel, short: `skills/${name}/SKILL.md`, size });
  }

  // agents/*.md
  for (const name of readdirSync(agentsDir)) {
    if (!name.endsWith(".md")) continue;
    const rel = `packages/engine/plugin/agents/${name}`;
    const size = gitBlobSize("HEAD", rel);
    if (size === null) continue;
    files.push({ rel, short: `agents/${name}`, size });
  }

  return files;
}

// ---------------------------------------------------------------------------
// Base-branch comparison
// ---------------------------------------------------------------------------

/** Return the resolved base-branch name, or null if the ref is not available. */
function baseRefAvailable(): string | null {
  // GITHUB_BASE_REF is set by GitHub Actions for pull_request events.
  const ref = process.env.GITHUB_BASE_REF || "main";
  try {
    execSync(`git rev-parse --verify "origin/${ref}"`, { stdio: "pipe" });
    return ref;
  } catch {
    return null;
  }
}

/**
 * Return the git-internal byte size of a file at a given ref, or null if the
 * file does not exist there or the ref is unreachable.
 *
 * Always measures via `git show` rather than `statSync` — on Windows with
 * `core.autocrlf=true` the on-disk file has CRLF while git stores LF, so
 * comparing `statSync` (current) against `git show` (base) would produce a
 * phantom positive delta on every file equal to its line count.
 */
function gitBlobSize(ref: string, repoRelPath: string): number | null {
  try {
    // execSync without `encoding` returns a Buffer; .length is byte count.
    const buf = execSync(`git show "${ref}:${repoRelPath}"`, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return buf.length;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDelta(bytes: number): string {
  const sign = bytes > 0 ? "+" : "";
  return `${sign}${formatKB(bytes)}`;
}

// ---------------------------------------------------------------------------
// Build delta list
// ---------------------------------------------------------------------------

interface Delta {
  short: string;
  before: number | null; // null = new file
  after: number;
  delta: number;
}

const allFiles = discoverPromptFiles();
const baseRef = baseRefAvailable();

const deltas: Delta[] = [];
if (baseRef) {
  for (const f of allFiles) {
    const before = gitBlobSize(`origin/${baseRef}`, f.rel);
    if (before === null) {
      // New file — always worth reporting.
      deltas.push({ short: f.short, before: null, after: f.size, delta: f.size });
    } else if (f.size !== before) {
      deltas.push({
        short: f.short,
        before,
        after: f.size,
        delta: f.size - before,
      });
    }
  }
  // Largest growth first so the biggest additions are most visible.
  deltas.sort((a, b) => b.delta - a.delta);
}

// ---------------------------------------------------------------------------
// Tests — every test always passes (warn-only)
// ---------------------------------------------------------------------------

describe("prompt-budget (warn-only)", () => {
  it("discovers prompt files to track", () => {
    // Sanity: we find skills + agents. If this drops to zero, something broke
    // in the discovery logic or the repo layout changed.
    expect(allFiles.length).toBeGreaterThan(0);
  });

  if (!baseRef) {
    // Local dev without origin/main fetched, or a push event in CI.
    // Report absolute sizes as a fallback — still useful for orientation.
    for (const f of allFiles) {
      it(`${f.short}: ${formatKB(f.size)}`, () => {
        // Informational only — always passes.
      });
    }
  } else if (deltas.length === 0) {
    it("no prompt-size changes in this changeset", () => {
      // Nothing grew or shrank — nothing to report.
    });
  } else {
    for (const d of deltas) {
      const label =
        d.before === null
          ? `${d.short}: ${formatKB(d.after)} (new file)`
          : `${d.short}: ${formatKB(d.before)} → ${formatKB(d.after)} (${formatDelta(d.delta)})`;

      it(label, () => {
        // Warn-only: the test name carries the signal; the test always passes.
      });
    }
  }
});
