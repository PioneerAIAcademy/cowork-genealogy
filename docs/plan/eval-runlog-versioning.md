# Eval run log versioning + active/release semantics — design

> Implementation plan for a redesign of the eval test harness, CRUD UI,
> and PR review process. Supersedes parts of `docs/specs/eval-crud-ui-spec.md`
> and `docs/plan/per-pr-review-workflow.md` (see "Supersessions" below).

## Context

The current system uses ISO-timestamped per-test run logs that reference
scenarios/fixtures by name + content hash, single-annotator `.ann.json`
files keyed to PRs, and a GH Action enforcing ≤1 added run log per skill
per PR. The CRUD UI is built (Tests/Scenarios/Fixtures/Results pages,
annotation grid, cross-PR comparison) but Results is the active blocker
for junior workflow.

This redesign introduces explicit versioning (`v{N}` for released,
`v{N}_<ts>` for in-development), self-contained run logs (snapshot of
skill-side files needed to reproduce the output), an "active" state
detected by snapshot-vs-repo comparison, an "activate" action that
restores skill-side repo state from a run log, and a senior-driven
"release" action. The motivation: turn run logs from disposable
per-test artifacts into the canonical version-controlled record of
skill quality.

The intended outcome: a process where junior genealogists iterate
fast (committing as many `v{N}_<ts>` candidates as they want), seniors
review using PR diffs + the CRUD UI's cross-version comparison, and
every commit that lands on main has its eval results sitting next to
it as a self-contained, reproducible artifact.

## Decisions

1. **Model** lives as `model:` field in SKILL.md frontmatter; "activate"
   restores it from the run log's snapshot. `model:` is a documented
   Claude Code skill frontmatter field
   (`code.claude.com/docs/en/skills`) and part of the Agent Skills open
   standard. Cowork follows the standard; will verify naturally during
   end-to-end testing (any skill with `model:` set is the test).
2. **Snapshot scope (skill-only)**: inline JSON `snapshot` block holds
   `plugin/skills/<skill>/**`, `eval/tests/unit/<skill>/rubric.md`,
   `eval/tests/unit/<skill>/*.json` test files, and the referenced
   scenarios + MCP fixtures. **`judge/prompt.md` is NOT in the
   snapshot** — it's tracked via a separate `judge_prompt_hash` field
   (see §A2 for rationale). A judge-prompt drift surfaces as a
   warning, not a blocking error (§C6 Rule 2).
3. **Release** = move (rename `v{N}_<ts>.json` → `v{N}.json`).
4. **Releasable**: only full `--skill` runs are releasable. Other
   invocations (`--test`, `--all`, `--tag`) produce **scratch runs**
   that are gitignored, never released, never compared, never
   activated.
5. **`.ann.json` is sparse**: entries only for dimensions the junior
   has explicitly reviewed. GH Action enforces the latest full-skill
   run's `.ann.json` has an entry for every dimension before merge.
6. **Active detection is per-skill, lazy**: only computed when viewing
   that skill's results page. No dashboard-wide check.
7. **Score-correction view**: integrated test-centric page (trace +
   grade) replaces today's tab layout. Same UI for everyone — no
   role-based distinctions; senior reviewers leave their disagreements
   as PR comments.
8. **Trend view**: per-skill weighted-mean over versions, with test
   count and "tests changed since previous version" markers.
9. **No git integration in the CRUD UI.** Activate overwrites
   snapshot-tracked files; user manages git separately.
10. **No migration, no backward compat.** Existing run logs are
    deleted as part of the cutover.

---

## Section A — Test harness

### A1. Invocation modes

Keep all existing modes (`--test`, `--skill`, `--all`, `--tag`). Only
full `--skill` runs produce versioned, releasable run logs in
`eval/runlogs/unit/<skill>/v{N}[_<ts>].json`. All other modes produce
**scratch runs** in `eval/runlogs/unit/<skill>/scratch_<ts>.json`
which are **gitignored** — never committed, never released, never
compared, never trend-charted. Scratch runs are local-only artifacts
for the dev's own debugging; nothing in the rest of the system reads
them as authoritative.

### A2. One run log per harness invocation; snapshot scope

One file per invocation, containing all tests run. Run log shape:

```jsonc
{
  "version": 3,
  "released": false,
  "timestamp": "2026-05-18_10-30-00",
  "skill": "locality-guide",
  "harness_version": "0.4.2",
  "model": "claude-sonnet-4-6",
  "judge_prompt_hash": "sha256-...",   // not embedded; see below
  "invocation": "skill",                // "skill" | "test" | "all" | "tag"
  "releasable": true,                   // false unless invocation == "skill"
  "snapshot": {
    "plugin/skills/locality-guide/SKILL.md": "...",
    "plugin/skills/locality-guide/template.md": "...",
    "eval/tests/unit/locality-guide/rubric.md": "...",
    "eval/tests/unit/locality-guide/ut_001.json": "...",
    "eval/fixtures/scenarios/mid-research-flynn/research.json": "...",
    "eval/fixtures/scenarios/mid-research-flynn/tree.gedcomx.json": "...",
    "eval/fixtures/mcp/wikipedia-search-schuylkill-county.json": "..."
  },
  "tests": [
    { "test_id": "ut_001", "outcome": "...", "runs": [...], ... }
  ],
  "totals": { ... }
}
```

Snapshot keys are repo-root-relative paths. Values are file contents
after normalization (§A7).

**Why `judge/prompt.md` is NOT in the snapshot**: the judge prompt is
global (shared across all skills). If v1 of skill-A snapshots last
year's judge prompt and a junior later activates v1, embedding +
restoring the judge prompt would clobber every other skill's current
judge calibration. The monthly judge-prompt review
(per-pr-review-workflow.md §2.6) deliberately mutates this file.

Instead: store `judge_prompt_hash` as a non-snapshot field. Hash is
computed over the **normalized** file bytes (same `normalize()`
contract as the snapshot files — see §A7), so Python and TypeScript
agree.

The active-state check verifies the hash matches the current
`judge/prompt.md`. A mismatch produces a warning, not a fail: the
run log can still be "active" on its skill-side files, with a
"judge prompt changed since this run" note in the UI and a non-
blocking warning in the GH Action (§C6 Rule 2). Rationale: judge-
prompt edits happen on a monthly cadence and are orthogonal to
skill changes; blocking every open PR every time the judge prompt
lands on main would force coordinated re-runs across all skills
for what is essentially a separate concern.

Activating an older version restores skill-only files; the UI tells
the user that historical scores may differ from a re-run because the
judge has moved on.

**`judge_model` is removed from the run log entirely** — it's
project-global, not a per-run choice worth versioning. If we change
judge models, that's a separate decision tracked in CHANGELOG-class
files, and we accept it invalidates historical comparisons.

### A3. Path scheme

```
eval/runlogs/unit/<skill>/v3.json                              # released
eval/runlogs/unit/<skill>/v3.ann.json                          # released annotations
eval/runlogs/unit/<skill>/v4_2026-05-18_10-30-00.json          # candidate iteration of v4
eval/runlogs/unit/<skill>/v4_2026-05-18_10-30-00.ann.json      # candidate annotations
eval/runlogs/unit/<skill>/scratch_2026-05-18_09-15-00.json     # gitignored scratch run
```

Released files have no timestamp. Unreleased iterations of the same
version share a `v{N}_` prefix and differ by timestamp — these are
**candidates** (a candidate for the next release, until released or
superseded). Scratch runs use a `scratch_` prefix.

`.gitignore` addition: `eval/runlogs/unit/*/scratch_*.json` and the
matching `.ann.json` pattern.

### A4. Snapshot embedding

Inline JSON with normalized file contents (§A7). Binary files (none
expected in skill snapshots) would base64-encode; defer until first
real case.

Snapshot is computed at **run start**; one team works on a skill at a
time, so we don't worry about concurrent-edit races.

### A5. Filename format

`v{N}_{YYYY-MM-DD_HH-MM-SS}.json` for candidate iterations.
`scratch_{YYYY-MM-DD_HH-MM-SS}.json` for scratch runs. Released:
`v{N}.json`. All hyphens within the timestamp; underscore as
prefix/timestamp separator. UTC.

### A6. Versioning logic

On harness write (full-skill run only):

1. Scan `eval/runlogs/unit/<skill>/` for highest released `v{N}.json`
   (call it `R`) and highest unreleased candidate `v{M}_<ts>.json`
   (call it `U`).
2. If `R == U` (or no candidates exist above the latest release): next
   candidate is `v{R+1}_<ts>.json` (new version line).
3. If `U > R` (a candidate exists for a version higher than the
   latest release): next candidate is `v{U}_<ts>.json` (continue
   iterating the current candidate version).
4. If no run logs: `v1_<ts>.json`.

Monotonic integer versions. No semver.

### A7. Normalization contract

Both snapshot embedding and active-state comparison go through a
shared `normalize(path, bytes) → bytes` helper that produces a
canonical byte form. Same function on harness write side (Python) and
UI check side (TypeScript) — they must agree byte-for-byte.

Rules:
- **JSON files** (`.json`): parse → re-emit with sorted object keys,
  `indent=2`, trailing newline. Skip cosmetic-only fields in test JSONs
  (`name`, `description`, `tags`) so they don't trigger active-state
  drift.
- **Text files** (`.md`, `.txt`, `.yaml`, `.yml`, `.py`, etc.):
  CRLF → LF, ensure trailing newline, no other changes.
- **Anything else**: exact bytes (no normalization).

Without this contract, every active-state check would flip false on
a fresh Windows checkout of a snapshot taken on macOS. Spell out the
contract in `eval/harness/harness/snapshot.py` and
`eval/app/lib/snapshot.ts` with matching test vectors so the two
implementations can't drift.

---

## Section B — CRUD UI

### B1. Active-state detection (lazy, per-skill)

Only computed when viewing a specific skill's results page. Walk the
skill's run logs newest first; the first full-skill run log whose
snapshot matches the current repo state (file-by-file, normalized) is
the active one. Stop searching after the first match. If none match:
"no active version."

For `judge_prompt_hash`: compare against the current
`eval/harness/judge/prompt.md` hash. Mismatch flips the run log to
"not active" with a "judge prompt changed" note.

UI: per-run-log Active badge in the skill's run log list; sticky
"Active: v3" indicator at the top of the page. No dashboard-wide
view; no caching layer.

### B2. `.ann.json` schema (sparse)

`.ann.json` contains corrections only for dimensions the junior has
explicitly reviewed. Each entry is keyed by
`(test_id, dimension_source, dimension_name)`.

```jsonc
{
  "run_log": "v4_2026-05-18_10-30-00.json",
  "annotator": "team-3",
  "corrections": [
    {
      "test_id": "ut_record_extraction_001",
      "dimension_source": "rubric",
      "dimension_name": "assertion atomicity",
      "llm_score": 3,
      "corrected_score": 2,
      "comment": "Conflated head-of-household and informant."
    }
  ]
}
```

`llm_score` is the **per-dimension aggregated** score across the run
log's `runs[]` (modal across runs; ties break downward), matching the
score displayed on the run log itself. Annotations carry the
aggregated value, never per-run values — there is only one
correction per dimension regardless of how many times the test ran.

Dimensions without an entry = not reviewed (NOT the same as "agreed").
The UI's "agree with judge" one-click button creates an entry with
`corrected_score == llm_score` and no comment, marking it reviewed.

### B3. Arbitrary cross-run-log comparison

Replace the auto-pick-two-most-recent with an arbitrary pair picker.
Default: latest released + latest unreleased dev candidate.

Compare on **corrected** scores. Fall back to LLM scores when
`.ann.json` is missing, with a banner.

Three sub-views:
- Headline weighted-mean with delta + "within typical variance"
  advisory at `|Δ| < 0.3`.
- Histogram of dimension scores per side.
- Per-test comparison table — one row per test, weighted-mean per
  side, delta. Tests in only one side flagged separately.

Tests whose snapshot inputs differ between sides are auto-excluded
(same intent as today's `test_content_hash` exclusion, applied
per-test against the snapshot blocks). A "what changed" panel surfaces
which files differ between the two snapshots, with per-file diff
click-through — collapses today's "leave the UI for git diff" loop.

### B4. Activate

"Mark active" copies every file from the run log's snapshot back into
the repo. Scope: snapshot-tracked files only (skill files, tests,
rubric, scenarios, fixtures). **Not the judge prompt.**

Confirmation modal lists the paths that will change. No git check —
the user manages git separately. The CRUD UI doesn't read git state
or refuse based on uncommitted changes.

When the run log's `judge_prompt_hash` doesn't match the current judge
prompt, the modal also says: "the judge prompt has moved on since this
version was tested; re-running the harness against this version will
produce different scores than the historical ones."

Only full-skill run logs (candidates or releases) are activatable.
Scratch runs (`--test`, `--all`, `--tag`) lack a complete snapshot.

### B5. Release

Visible only when the run log is full-skill, has a `.ann.json` with
complete corrections (every dimension reviewed), and is currently
active. Effect: rename `v{N}_<ts>.json` → `v{N}.json` and the
matching `.ann.json`. Atomic rename via `lib/fs/atomic.ts`.

Releasing a non-latest candidate requires activating it first.

### B6. Trend view

Per-skill (`/results/<skill>/trend`): X = version number, Y =
weighted-mean of corrected scores across all tests in the released
version. Point markers sized by test count. Hover surfaces version,
release date, weighted mean, test count, and a "tests changed since
v{N-1}" line: "+3 added, 1 removed, 2 modified." Diff is computed
from snapshot file lists.

Without test-count surfacing, a trend showing v1 (5 tests, mean 2.4)
→ v5 (20 tests, mean 2.7) can hide regressions — easy tests get added,
the mean rises, the chart lies. The marker size + tooltip prevents this.

Skill selector dropdown. No cross-skill aggregate view in v1.

### B7. Delete candidate iterations

Per-run-log delete button on `v{N}_<ts>.json` files (candidates).
Released `v{N}.json` files cannot be deleted from the UI. Simple
`unlink` of both the `.json` and any sibling `.ann.json`.

If the deleted run log was active, the "active" indicator disappears
or moves to the next matching candidate. Surface this in the modal.

### B8. Score-correction view (integrated, replaces tabs)

One scrollable page per test:

**Header**: test name, tags, expected outcome, input prompt
(`user_message` as markdown), scenario card (README excerpt + collapsible
`research.json` / `tree.gedcomx.json` viewers, sourced from the
snapshot).

**Trace** (chronological):
- Each MCP tool call: tool name, arguments, matched fixture name,
  fixture response body (inline, collapsible).
- File writes: diff view against scenario starting state.
- Final `text_response`.

**Grade** (per dimension):
- Dimension name + source (base / rubric / criteria).
- Rubric definition inline (from snapshot's `rubric.md`).
- LLM score (1–3) + judge rationale.
- Correction widget (1–3 segmented) + comment.
- Reviewed badge once an entry is in `.ann.json`.
- Per-dimension save indicator.

**Per-test controls**: "agree with all" button (one-click reviews
every dimension of this test). Keyboard shortcuts: `1`/`2`/`3` set
score on focused dimension, `Tab` moves between dimensions,
`Cmd/Ctrl+Enter` jumps to next test, `?` opens shortcut help.

**Per-dimension "copy as PR comment" button** (📋 icon next to each
correction widget): clicking copies a markdown block to the clipboard
that a senior can paste into a GitHub PR comment. Format:

```
**`<test_id>`** — `<dimension_source>` / `<dimension_name>`
LLM: 3 → Junior: 2

> <judge rationale, blockquoted>

Junior: <comment>
```

This is the only senior-workflow concession in the UI. There is no
senior-specific view; seniors use the same scoring page everyone else
uses, and the button gives them a quick way to surface a disagreement
into GitHub without manually retyping context. The button is visible
to all users — juniors might use it to flag their own uncertain
corrections for senior attention.

**Multi-run handling**: today's run log has `runs[]` for flakiness
detection. The trace shows the first run by default with a "run 1 of
3" selector. Score aggregation stays per-dimension.

**Progress sidebar**: test list with `reviewed/total` per test;
overall `8/12 graded` summary. Refresh restores cursor position from
`eval/app/.local/scoring-position.json`.

Same UI for juniors and seniors. Seniors who disagree with junior
corrections write their disagreements as PR comments using an
external editor — no in-UI senior workflow.

---

## Section C — PR process

### C1. Junior workflow

Juniors commit `v{N}_<ts>.json` and matching `.ann.json` files. They
do not create `v{N}.json` files (release is the senior's action via
the CRUD UI).

Juniors don't have to review every dimension on every candidate
iteration. They only need every dimension reviewed on the **final**
candidate of the version they want to ship (enforced by the GH
Action; see C6 rule 3).

### C2. Senior review

1. **GitHub diff** for skill files, scenarios, fixtures, rubric.
2. **Latest timestamped run log** in CRUD UI — see corrected scores
   and read the trace where they disagreed with the judge.
3. **Cross-comparison** in CRUD UI of latest timestamped vs previous
   released (`v{N-1}.json`).
4. Disagreements → PR comments via external editor (no in-UI senior
   tooling).

Senior needs the PR branch checked out locally with the CRUD UI
running against it. Worth a senior-onboarding note.

### C3. Senior release flow

Click **Release** in CRUD UI on the active, fully-corrected run log.
Files renamed locally. Senior commits the renames, pushes to PR
branch, approves the PR.

### C4. Merge

Project owner merges.

### C5. Gitignore + candidate retention

`.gitignore` additions:
```
eval/runlogs/unit/*/scratch_*.json
eval/runlogs/unit/*/scratch_*.ann.json
```

Scratch runs (`--test`, `--all`, `--tag`) live on disk for local
debugging but never enter version control.

**Candidate iterations (`v{N}_<ts>.json`) are not auto-pruned.**
When the senior releases the final candidate via the CRUD UI, only
that file is renamed to `v{N}.json`; earlier `v{N}_<ts1>.json`,
`v{N}_<ts2>.json` candidates stay where they are.

The junior decides which earlier candidates are worth keeping as
history (useful for "we tried X, it didn't work, we backed out")
and which are noise (typo runs, immediate retries). Pruning happens
in the CRUD UI via the per-run-log delete button (§B7). The GH
Action does not require pruning.

### C6. GitHub Action enforcement

`.github/workflows/check-runlogs.yml` enforces three rules per skill
changed in the PR:

**Rule 1**: At most one **newly added or renamed-into-place**
`v{N}.json` file per skill subdirectory. Detection uses
`git diff --name-status --diff-filter=AR origin/main..HEAD` — `A`
catches new files, `R` catches the dev → released rename. Filtering
on `--diff-filter=A` alone (today's pattern) misses every renamed
release; this is the fix.

**Rule 2 (blocking)**: The latest full-skill run log (released
`v{N}.json` if added in this PR, else the highest `v{N}_<ts>.json`
from this PR or main) is **active on skill-side files** — its
snapshot matches the current PR-branch state of all snapshot-tracked
files, normalized per §A7.

**Rule 2b (warn-only)**: The same run log's `judge_prompt_hash`
matches the current `judge/prompt.md` (normalized). A mismatch
produces a warning annotation on the PR but does not block merge.
Rationale: judge-prompt edits are project-wide events on a separate
cadence; we don't want every open PR to fail every time the monthly
judge review lands. The active state still applies to skill-side
files; the warning just notes that a re-run today would score
differently than the historical numbers.

**Rule 3**: The latest full-skill run log's `.ann.json` is
**complete** — has an entry for every `(test_id, dimension_source,
dimension_name)` triple present in the run log.

Scratch runs (`scratch_*.json`) are gitignored and never reach the
action. Implementation is a Python script that loads the latest run
log's snapshot and diffs vs working tree, using the same
`normalize()` contract as the harness.

---

## Supersessions

This plan changes parts of `docs/plan/per-pr-review-workflow.md`:

- **§2.4 (per-test `test_content_hash`)** — replaced by the
  whole-snapshot model. The per-test hash field goes away; equivalence
  is now snapshot-vs-snapshot at the file level.
- **§2.8 (GH Action: ≤1 added run log per skill)** — replaced by the
  three-rule check in C6. The "≤1 added" rule becomes "≤1 added
  released," and gains the active + completeness rules.
- **§2.10 (auto-pick two most recent for cross-PR comparison)** —
  replaced by the arbitrary pair picker (B3).

The per-PR workflow doc will be updated in the same PR with explicit
"Superseded by docs/plan/eval-runlog-versioning.md" notes on each of
those sections so future readers know which doc is authoritative.

---

## Critical files

**Harness (Python)**:
- `eval/harness/run_tests.py` — invocation classification, version
  resolution, partial vs full handling.
- `eval/harness/harness/runlog.py` — new schema (multi-test envelope,
  snapshot block, version, released, releasable; drop
  `judge_model`, drop per-test `test_content_hash`).
- `eval/harness/harness/snapshot.py` (new) — `build_snapshot(skill)`,
  `normalize(path, bytes) → bytes`. Replaces `content_hash.py`.
- `eval/harness/harness/versioning.py` (new) — `next_version_for(skill)`,
  `is_releasable_invocation(mode)`.

**CRUD UI (TypeScript / Next.js)**:
- `eval/app/lib/snapshot.ts` (new) — `normalize()` matching the
  Python contract; snapshot diff helper.
- `eval/app/lib/fs/runlogs.ts` — reader for `v{N}` / `v{N}_<ts>`
  naming; lazy active-state detection.
- `eval/app/lib/fs/annotations.ts` — sparse-entries semantics;
  completeness check helper.
- `eval/app/lib/compare.ts` — arbitrary pair, snapshot-aware
  exclusion, corrected-score based, "what changed" snapshot diff.
- `eval/app/lib/activate.ts` (new) — write snapshot files back to
  repo; skill-only scope.
- `eval/app/lib/release.ts` (new) — rename `v{N}_<ts>` → `v{N}`.
- `eval/app/app/results/[skill]/page.tsx` — version list with active /
  released badges; activate / release / delete actions.
- `eval/app/app/results/[skill]/[version]/page.tsx` — integrated
  test-centric view (B8); replaces tabbed layout.
- `eval/app/app/results/[skill]/compare/page.tsx` — arbitrary pair
  picker.
- `eval/app/app/results/[skill]/trend/page.tsx` (new) — per-skill
  trend view with test-count markers.
- API routes: `/api/runlogs/[skill]/[version]/activate`,
  `/api/runlogs/[skill]/[version]/release`,
  `/api/runlogs/[skill]/[version]/delete`,
  `/api/runlogs/[skill]/trend`.

**Tooling**:
- `.github/workflows/check-runlogs.yml` — three-rule check
  (`--diff-filter=AR`, active, complete).
- `.gitignore` — add `eval/runlogs/unit/*/scratch_*.json` and
  `*/scratch_*.ann.json`.

**Specs / docs**:
- `docs/specs/eval-crud-ui-spec.md` — overhaul Results section.
- `docs/specs/eval-runlog-versioning-spec.md` (new) — schema,
  naming, normalization contract, active / releasable / complete
  rules.
- `docs/plan/per-pr-review-workflow.md` — superseded notes on
  §2.4, §2.8, §2.10.

**Reuse existing**:
- `eval/app/lib/fs/atomic.ts` — atomic temp+rename for all writes.
- `eval/harness/harness/judge.py` — unchanged; 1–3 scoring stays.

---

## Open items

1. **Cowork honors `model:` frontmatter** — documented as part of the
   Agent Skills standard; verified naturally on first end-to-end run
   of a skill with `model:` set. No dedicated smoke test needed.
2. **Senior-onboarding note** — write a short doc explaining the
   senior's review path (checkout PR branch → run CRUD UI → review
   + compare → PR comments → release in UI → commit + push +
   approve). Not blocking implementation; nice-to-have once one
   senior is ramping.

---

## Verification

End-to-end test once implemented:

1. From scratch: harness `--skill wiki-lookup` → produces
   `v1_<ts>.json` with snapshot. CRUD UI lists it, marks it active.
2. Junior reviews some (not all) dimensions → `v1_<ts>.ann.json` has
   partial entries.
3. Junior edits `SKILL.md`. CRUD UI shows "no active version."
4. Junior re-runs harness → `v1_<ts2>.json` (same version line; v1
   not yet released). UI marks new one active. Old `.ann.json` is
   irrelevant (different run log).
5. Junior reviews **all** dimensions on the new run log.
6. Junior pushes PR. GH Action: rule 1 ✓ (0 released added), rule 2
   ✓ (latest active), rule 3 ✓ (complete annotations).
7. Senior reviews in CRUD UI, clicks Release. `v1_<ts2>` → `v1`,
   matching `.ann.json` renamed. Senior commits renames, pushes,
   approves.
8. GH Action re-checks: rule 1 ✓ (1 released added — note the
   `--diff-filter=AR` correctly catches the rename), rule 2 ✓,
   rule 3 ✓. Owner merges.
9. Next iteration: harness produces `v2_<ts>.json`. Trend chart shows
   v1 → v2 candidate with test count markers.
10. Activate v1 (rollback): CRUD UI confirms list of files, overwrites
    skill files / tests / scenarios / fixtures from `v1.json`
    snapshot. SKILL.md `model:` reverts. Judge prompt unchanged.
    Next harness run produces fresh `v2_<ts>.json`.
11. Run harness `--test ut_001` → produces `scratch_<ts>.json`
    (gitignored). Doesn't show in trend, doesn't qualify for active
    state, can't be released.

**Pre-commit-1 sanity check**: run `build_snapshot()` against the
largest current skill (likely `record-extraction` given its fixture
count) and confirm the resulting JSON is in the expected range. If a
single snapshot is >500KB, surface it before committing — not because
size is a hard concern, but because surprising numbers usually mean
the normalization or scope is wrong.

Tests: Vitest for `lib/snapshot.ts`, `lib/activate.ts`, `lib/release.ts`,
`lib/compare.ts`. Pytest for `snapshot.py`, `versioning.py`, the new
runlog assembly. Shared test vector for the `normalize()` contract so
Python and TypeScript implementations stay in sync.

**Playwright E2E** covering the verification scenario above (steps
1–11) is written alongside commit 2's UI work and serves as the
ship gate.

---

## Rollout

Single PR. Three commits inside, each landing with its own tests so
nothing depends on later commits to be correct in isolation:

1. **Harness schema + versioning + snapshot.** New runlog shape;
   `snapshot.py`, `versioning.py`; harness writes new format. Old run
   logs deleted in this commit. Pytest covers `snapshot.py`
   (normalization round-trip, scope inclusion, judge-prompt
   exclusion), `versioning.py` (next-version logic across the four
   cases in §A6), and runlog assembly (releasable flag set
   correctly per invocation mode). Pre-commit sanity check on the
   largest skill's snapshot size.
2. **CRUD UI — read + view.** New reader; lazy active detection;
   integrated test-centric view replaces tabs; sparse-`.ann.json`
   semantics; arbitrary pair compare; trend view. Vitest covers
   `lib/snapshot.ts` (normalization matches Python via shared
   vectors), `lib/fs/runlogs.ts` (active detection walks newest-
   first, halts on first match, treats partials as ineligible),
   `lib/compare.ts` (snapshot-aware exclusion, fallback to LLM
   scores when `.ann.json` missing). Playwright E2E covers the
   review/scoring path (scenario steps 1–5).
3. **CRUD UI writes + GH Action.** Activate / release / delete API
   routes; three-rule `check-runlogs.yml` (with the `--diff-filter=AR`
   fix and warn-only judge hash); `.gitignore` additions; superseded
   notes in `per-pr-review-workflow.md`. Vitest covers `lib/activate.ts`
   (skill-only scope, modal-payload shape), `lib/release.ts` (atomic
   rename of both `.json` and `.ann.json`). Playwright E2E covers the
   release path (scenario steps 6–11). GH Action gets a self-test
   fixture exercising all three rules.

Each commit's tests stay green before the next is started. Bugs found
during human testing get fixed in place rather than triggering
rollback — the tests prevent regressions.

Goal: coding complete same-day; user tests end-to-end before
presenting to genealogists.
