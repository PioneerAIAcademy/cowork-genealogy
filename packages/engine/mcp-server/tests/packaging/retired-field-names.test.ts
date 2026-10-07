import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Retired schema identifiers must not survive anywhere but the frozen record
 * (issue #2524).
 *
 * `evidence_type` was renamed to `record_basis` on 2026-09-18, the first time a
 * closed enum in this repo has been renamed rather than extended. ADR-0008's
 * options table rejected a general single-value-mention lint on the grounds
 * that "a closed-enum value has been removed or renamed **zero** times", and
 * left a row saying a retired-values list plus a lint on dead mentions was
 * "cheaper to revisit than to build now — revisit if a first value removal ever
 * happens". This is that first removal, so this file is the revisit.
 *
 * ## Why an identifier and not the values
 *
 * This bans the token `evidence_type`. It deliberately does NOT ban `direct` /
 * `indirect` / `negative`, which stay live English words AND stay live values of
 * other enums — `log_outcome` has `negative`, and `docs/gps-research-flow.md`
 * uses all three in their Board-for-Certification sense, which the rename does
 * not touch. A value scan over the same tree returns ~2,600 lines and cannot be
 * made clean; ADR-0008 says so, and says the mitigation is a reviewed repo-wide
 * grep at rename time rather than a lint. That grep is recorded in the PR, and
 * this file covers the half a lint CAN hold with no false positives.
 *
 * So: a leak this file cannot see is a retired VALUE in prose with no
 * identifier near it. That limit is the reason the grep is not optional.
 *
 * ## Why `--untracked`
 *
 * `git grep` without it reads only the index, so a file added in the very
 * commit doing the rename is invisible — the silent-pass mode CLAUDE.md names
 * first, and here it failed LOUDLY in the other direction too: the stale-entry
 * arm below read every not-yet-committed allow-list entry as stale. `--untracked`
 * covers working-tree files while still honouring `.gitignore`, which a plain
 * filesystem walk would not: that would read `node_modules/`, `build/`, and
 * `packages/schema/src/enums.generated.ts`, which legitimately regenerates from
 * the schema and would be a permanent false positive.
 *
 * What remains unseen is a GITIGNORED file, which by construction ships
 * nothing — and that exclusion is load-bearing for a reason beyond build
 * output. A linked git worktree parked inside the repo (`.claude/worktrees/`,
 * ignored by `.gitignore`) holds a second full checkout, usually on some other
 * branch. One sitting on a pre-rename branch during this rename carried the
 * retired token in 33 markdown files alone. `--untracked` honours `.gitignore`
 * and skipped every one; a plain `readdir` walk would have reported all 33 as
 * leaks, on a machine where nothing was wrong. Do not "simplify" this into a
 * filesystem walk.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..", "..", "..", "..");

/** The retired identifier, and what replaced it. */
const RETIRED = "evidence_type";

/**
 * Path prefixes whose contents are a frozen record, not code.
 *
 * The trailing slash is load-bearing: without it `eval/runlogs-archive/` would
 * be exempt too, and the reach test below is what proves it.
 */
const FROZEN_PREFIXES = [
  // Committed run logs. #2552 carried the instruction not to migrate these:
  // they record what an agent did on a date, and editing them falsifies it.
  "eval/runlogs/",
] as const;

/**
 * Individual files allowed to keep the retired token, each with the reason.
 *
 * Two kinds only:
 *   - a back-compat reader that must understand the frozen corpus above
 *   - a dated record that editing would falsify
 *
 * File-scoped, not line-scoped: `measure_negative_evidence.py` carries the
 * token on four separate lines.
 */
const ALLOWED: Record<string, string> = {
  // ── The registry itself ──
  // ADR-0008's revisit row asked for the retired-values list to live with the
  // enums, so a reader learns the old spelling from the schema rather than
  // from this test. The two copies are byte-identical by enum-drift.test.ts.
  // Nothing ELSE in either schema tree may name the token — research.schema.json
  // points here instead of repeating it, which is what keeps this to one entry.
  "docs/specs/schemas/enums.schema.json":
    "the retired-identifier registry — it names the retired token by design",
  "packages/schema/schemas/enums.schema.json":
    "the retired-identifier registry — byte-identical copy of the above",

  // ── Back-compat readers of the frozen run-log corpus ──
  "eval/harness/harness/record_basis.py":
    "the back-compat reader itself — maps the retired value set onto the new one",
  "eval/harness/scripts/measure_negative_evidence.py":
    "reads the frozen run-log corpus, which still carries the retired spelling",
  "eval/harness/tests/unit/test_record_basis_compat.py":
    "tests the back-compat reader, so it must name the retired spelling",
  "packages/engine/mcp-server/dev/probe_craftnotes_uptake.py":
    "reads the frozen run-log corpus, which still carries the retired spelling",
  "packages/engine/mcp-server/src/utils/record-basis.ts":
    "the engine's back-compat reader for research.json documents written before the rename",
  "packages/engine/mcp-server/tests/utils/record-basis.test.ts":
    "tests the back-compat reader, so it must name the retired spelling",
  "packages/engine/mcp-server/tests/utils/record-persona.test.ts":
    "one case feeds the record-side projection a legacy-spelled assertion, to " +
    "prove it is still excluded from a projected persona; without the retired " +
    "spelling that case cannot be written",
  "packages/engine/mcp-server/tests/packaging/retired-field-names.test.ts":
    "this file — it names the retired token in order to ban it",

  // ── Dated records: editing them asserts something false about their date ──
  "docs/adrs/ADR-0008-sync-schema-copies-eliminate-generate-or-lint.md":
    "a dated 2026-08 decision record; its options table cites the token as it stood then",
  "docs/record-extraction-judge-audit.md":
    "a dated audit of runs graded while the field carried the retired name",
  "docs/deep-dives/record-extraction-findings-2026-08-28.md":
    "dated findings from a run corpus that used the retired name",
  "docs/deep-dives/hypothesis-tracking-findings-2026-08-31.md":
    "dated findings from a run corpus that used the retired name",
  "docs/deep-dives/conflict-resolution-findings-2026-08-27.md":
    "dated findings from a run corpus that used the retired name",
};

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: projectRoot, encoding: "utf8", maxBuffer: 1 << 28 });

/** Every tracked file that still contains the retired token. */
function filesContainingRetired(): string[] {
  // `git grep -l --untracked`: the working tree minus `.gitignore`. No
  // filesystem walk, so no node_modules and no generated output.
  let out = "";
  try {
    out = git("grep", "-l", "--untracked", "--fixed-strings", RETIRED, "--", ".");
  } catch (err: any) {
    // git grep exits 1 with no output when nothing matches — that is the
    // success case here, not an error.
    if (err?.status === 1 && !err?.stdout?.toString().trim()) return [];
    throw err;
  }
  return out.split("\n").filter(Boolean);
}

const isFrozen = (p: string) => FROZEN_PREFIXES.some((prefix) => p.startsWith(prefix));

describe("retired schema identifiers", () => {
  const hits = filesContainingRetired();

  it("finds the frozen corpus, proving the scan actually reaches the repo", () => {
    // A scan that matches nothing reads as coverage. The run-log corpus is
    // large, committed and deliberately never migrated, so it is the one thing
    // guaranteed to be there — if this is empty the scan is broken, not clean.
    const frozen = hits.filter(isFrozen);
    expect(
      frozen.length,
      `no tracked file under ${FROZEN_PREFIXES.join(", ")} contains "${RETIRED}" — ` +
        `the scan is not reaching the repository`,
    ).toBeGreaterThan(0);
  });

  it(`no live file still names "${RETIRED}"`, () => {
    const leaked = hits
      .filter((p) => !isFrozen(p))
      .filter((p) => !(p in ALLOWED))
      .sort();
    expect(
      leaked,
      `"${RETIRED}" was renamed to "record_basis" (#2524). These tracked files still ` +
        `name it. Rename them, or — only for a back-compat reader or a dated record — ` +
        `add the path to ALLOWED in this file with its reason:\n` +
        leaked.map((p) => `  - ${p}`).join("\n"),
    ).toEqual([]);
  });

  it("has no stale entries in the allow-list", () => {
    // An allow-list entry whose file no longer contains the token is a hole
    // held open for nothing: the next real leak in that file passes silently.
    // Both sibling lints assert this — tool-schema-enums.test.ts ("every
    // exemption still corresponds to a real literal") and
    // field-render-drift.test.ts ("has no stale entries in the exemption list").
    const live = new Set(hits);
    const stale = Object.keys(ALLOWED)
      .filter((p) => !live.has(p))
      .sort();
    expect(
      stale,
      `these ALLOWED entries name files that no longer contain "${RETIRED}" — ` +
        `delete them, or the next leak in one of these files passes silently:\n` +
        stale.map((p) => `  - ${p}`).join("\n"),
    ).toEqual([]);
  });

  it("every allow-list entry carries a reason", () => {
    const blank = Object.entries(ALLOWED)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([p]) => p);
    expect(blank, `these ALLOWED entries have no usable reason`).toEqual([]);
  });

  it("records the rename in enums.schema.json so the schema itself says so", () => {
    // The allow-list above is this file's private knowledge. A reader opening
    // the schema needs to learn the old name maps to the new one without
    // finding this test first, and ADR-0008's revisit row asked for exactly
    // this list to live with the enums.
    const schema = readFileSync(
      join(projectRoot, "docs", "specs", "schemas", "enums.schema.json"),
      "utf8",
    );
    expect(
      schema,
      `enums.schema.json must carry a $comment recording that ${RETIRED} was ` +
        `renamed to record_basis, so the rename is discoverable from the schema`,
    ).toContain("record_basis");
    expect(schema).toContain("2026-09-18");
  });
});

// ── exhaustive_declaration → search_stop (issue #2539, 2026-10-07) ─────────
//
// `exhaustive_declaration` was the top-level field on a question that held a
// `declared: boolean` and the stop-criteria object. It was replaced by
// `search_stop` which has a `stopped_because` enum (five values, three of
// which are stop-gate values) and `not_reached[]`. Unlike the evidence_type
// rename above, this is a FIELD rename rather than a value rename, so the
// frozen corpus (eval/runlogs/) legitimately carries the old spelling for
// every run before this date — and back-compat readers exist for legacy
// research.json documents.
//
// The FROZEN_PREFIXES2 set adds the dated-doc directories (ADRs, deep-dives)
// because editing them would falsify their dates. That prefix policy is
// load-bearing for the reach test: if the dated-doc corpus were to stop
// carrying the token, the reach test would fail before the ban test,
// surfacing the config gap rather than silently passing.

const RETIRED2 = "exhaustive_declaration";

const FROZEN_PREFIXES2 = [
  // Run logs: record what an agent did on a date, editing falsifies it.
  "eval/runlogs/",
  // Dated decision records and deep-dive findings: written at a point in
  // time; the field name in them records what was true then.
  "docs/adrs/",
  "docs/deep-dives/",
] as const;

const ALLOWED2: Record<string, string> = {
  // ── The retirement registry ──
  "docs/specs/schemas/enums.schema.json":
    "the retirement registry — its $comment names the retired field by design",
  "packages/schema/schemas/enums.schema.json":
    "the retirement registry — byte-identical copy of the above",

  // ── Back-compat readers for legacy research.json documents ──
  "packages/engine/mcp-server/src/tools/research-append.ts":
    "claimedConflictResolution() falls back to the retired shape for documents written before #2539",
  "packages/engine/mcp-server/src/utils/question-stop.ts":
    "isStopGateSatisfied() accepts the legacy exhaustive_declaration.declared=true shape via LEGACY_STOP_GATE",
  "packages/viewer-ui/src/components/sections/QuestionsSection.tsx":
    "the viewer falls back to the legacy shape for documents written before #2539",
  "packages/viewer-ui/src/components/sections/__tests__/QuestionsSection.test.tsx":
    "tests the legacy-document fallback path, so it must construct the retired shape",

  // ── Dated attribution comments — editing them falsifies the attribution ──
  "packages/engine/mcp-server/tests/packaging/doc-links.test.ts":
    "a dated 2026-10 attribution: the line-number-cite ban grew from a drifted exhaustive_declaration cite",
  "packages/engine/mcp-server/tests/packaging/readme-catalog.test.ts":
    "a dated 2026-10 attribution: lists exhaustive_declaration as an example of inverse-check false positives",
  "packages/engine/mcp-server/tests/packaging/repo-paths.ts":
    "a dated 2026-10 attribution: explains why the line-number cite style is banned",
  "packages/viewer-ui/src/components/ErrorBoundary.tsx":
    "a dated comment recording that a question missing exhaustive_declaration previously caused a render throw",
  "packages/engine/mcp-server/tests/packaging/retired-field-names.test.ts":
    "this file — it names the retired field in order to ban it",

  // ── Test function names — renaming would break CI attribution and coverage ──
  "eval/harness/tests/unit/test_skill_invocation.py":
    "two test function names (test_exhaustive_declaration_true_owned_by_research_exhaustiveness, " +
    "test_flags_exhaustive_declaration_with_no_research_exhaustiveness_invocation) retain the old name for attribution",
  "eval/harness/tests/unit/test_e2e_context_block.py":
    "two test function names (test_exhaustive_declaration_claim_is_blocked, " +
    "test_exhaustive_declaration_claim_is_allowed) retain the old name for attribution",
  "eval/harness/validators/test_question_selection.py":
    "one test function name (test_new_question_exhaustive_declaration_unstarted) retains the old name for attribution",
  "eval/harness/validators/test_research_exhaustiveness.py":
    "one test function name (test_no_exhaustive_declaration) retains the old name for attribution",

  // ── Rename attribution comments — cite the old name to document the rename ──
  "eval/harness/e2e/guardrail_shadow_report.py":
    "carries a rename-attribution comment '# renamed from exhaustive_declaration (#2539)'",

  // ── Active live specs that name the retired field in rename-note prose ──
  // These specs retain the old name only in '→ renamed …' attribution notes.
  "docs/specs/research-append-tool-spec.md":
    "contains rename-note attribution strings that cite the old field name (e.g. '(renamed from exhaustive_declaration)')",
  "docs/specs/research-schema-spec.md":
    "contains rename-note attribution strings citing the old field name",
  "docs/specs/guardrail-enforcement-spec.md":
    "contains rename-note attribution strings citing the old field name",
  "docs/specs/schemas/ownership.json":
    "carries a rename-note comment in the questions row citing the old field name",
  "docs/specs/schemas/research.schema.json":
    "carries a rename-note comment citing the old field name",
  "packages/schema/schemas/research.schema.json":
    "byte-identical copy of docs/specs/schemas/research.schema.json — same rename note",
  "packages/engine/mcp-server/src/validation/validator.ts":
    "carries a rename-note comment citing the old field name in the RESEARCH_SHAPES entry",
  "packages/engine/plugin/hooks/guard_project_files.py":
    "carries a rename-note comment citing the old field name in OWNED_DECLARATIONS",

  // ── Dated records and captures ──
  "eval/harness/tests/fixtures/gh_issues_slurp_capture.json":
    "a verbatim capture of a GitHub issue body as returned by the API; editing it falsifies the capture",
  "docs/lead-themes-2026-09-05.md":
    "a dated 2026-09-05 leadership themes document recording the field name as it stood then",
  "docs/skill-to-agent-pair-conversion.md":
    "a dated conversion log recording the field name as it stood at migration time",
  "docs/specs/skill-rewrites-for-persistence-tools-spec.md":
    "a dated spec whose acceptance criteria reference the field name as it stood when the spec was written",
  "docs/testing-guides/gps-mentor-agent-testing-guide.md":
    "a dated testing guide written before the rename",
};

const isFrozen2 = (p: string) => FROZEN_PREFIXES2.some((prefix) => p.startsWith(prefix));

function filesContainingRetired2(): string[] {
  let out = "";
  try {
    out = git("grep", "-l", "--untracked", "--fixed-strings", RETIRED2, "--", ".");
  } catch (err: any) {
    if (err?.status === 1 && !err?.stdout?.toString().trim()) return [];
    throw err;
  }
  return out.split("\n").filter(Boolean);
}

describe("retired field names (exhaustive_declaration → search_stop, #2539)", () => {
  const hits2 = filesContainingRetired2();

  it("finds the frozen corpus, proving the scan reaches the repo", () => {
    const frozen = hits2.filter(isFrozen2);
    expect(
      frozen.length,
      `no tracked file under ${FROZEN_PREFIXES2.join(", ")} contains "${RETIRED2}" — ` +
        `the scan is not reaching the repository`,
    ).toBeGreaterThan(0);
  });

  it(`no live file still names "${RETIRED2}" outside the allow-list`, () => {
    const leaked = hits2
      .filter((p) => !isFrozen2(p))
      .filter((p) => !(p in ALLOWED2))
      .sort();
    expect(
      leaked,
      `"${RETIRED2}" was renamed to "search_stop" (#2539). These tracked files still ` +
        `name it. Rename them, or — only for a back-compat reader or a dated record — ` +
        `add the path to ALLOWED2 in this file with its reason:\n` +
        leaked.map((p) => `  - ${p}`).join("\n"),
    ).toEqual([]);
  });

  it("has no stale entries in the allow-list", () => {
    const live = new Set(hits2);
    const stale = Object.keys(ALLOWED2)
      .filter((p) => !live.has(p))
      .sort();
    expect(
      stale,
      `these ALLOWED2 entries name files that no longer contain "${RETIRED2}" — ` +
        `delete them:\n` +
        stale.map((p) => `  - ${p}`).join("\n"),
    ).toEqual([]);
  });

  it("every allow-list entry carries a reason", () => {
    const blank = Object.entries(ALLOWED2)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([p]) => p);
    expect(blank, `these ALLOWED2 entries have no usable reason`).toEqual([]);
  });

  it("records the rename in enums.schema.json", () => {
    const schema = readFileSync(
      join(projectRoot, "docs", "specs", "schemas", "enums.schema.json"),
      "utf8",
    );
    expect(
      schema,
      `enums.schema.json must carry a $comment recording that ${RETIRED2} was renamed to search_stop`,
    ).toContain("search_stop");
    expect(schema).toContain("2026-10-07");
  });
});
