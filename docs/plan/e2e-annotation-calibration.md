# E2E judge calibration via run-log annotations

**Status:** proposed (for review)
**Branch:** `e2e-annotation-calibration`

## Summary

Replace the standalone calibration-case system
(`eval/tests/e2e/calibration/cases/` + `seed_calibration_case.py`) with
**per-run annotation files**. A human grade becomes a small
`run-<ts>.ann.json` sibling of the run log it grades. `calibrate_judge` reads
every annotation it finds, re-runs the judge against each graded run, and
reports agreement.

This is a net **deletion** of moving parts: it removes the seeder, the separate
cases directory, and the "which cases do we calibrate against?" selection
problem — the presence of a graded annotation *is* the selection.

Two integrity rules shape the design (see "Grading integrity" below):

1. **Annotations are never auto-created.** A run does not emit one as a side
   effect. The grader asks Claude Code to create one, on demand, only for runs
   worth grading.
2. **The grader never sees the judge's labels while grading.** The human is the
   ground truth; the judge is the thing under test. This is enforced by *file
   access*: grading reads only the fixture and the run's two `final-*` siblings,
   **never `run-<ts>.json`** (where `judge_output` lives). An annotation with any
   ungraded finding is detected, warned about, and skipped — never counted.

## Background: how it works today

- `calibrate_judge.py` reads `eval/tests/e2e/calibration/cases/*.json`. Each case
  is **self-contained**: it copies `(research_question, expected_findings,
  final_tree, final_research)` plus the human's labels into one file.
- You don't author those by hand — `seed_calibration_case.py` seeds a stub from
  a real run (judge labels pre-filled in a `_judge` block, `human` block blank),
  you fill the `human` block, and commit `<slug>-<who>.json`.
- The agreement math is good and stays: `grade_case` runs the judge on one case
  and compares to the human labels; `CalibrationReport.meets_target` gates on
  **≥80% per-finding** agreement (the gating axis is recall; proof quality is
  advisory and never gates).

Three problems this plan fixes:

1. **Selection is a parallel directory you curate.** There's no clean way to say
   "calibrate against these runs" except by managing which files sit in `cases/`.
2. **Re-runs lose corrections.** The case file is named `<slug>-<who>.json` —
   no timestamp — so re-seeding after a re-run overwrites the prior grade.
3. **The guard against an un-graded grade is a whole-set hard fail.** Today a
   blank `human` block makes `load_cases` reject the *entire* set
   (`calibrate_judge.py:178-181`). Correct, but brittle for an accumulate-many
   model: one half-finished grade blocks everyone's calibration run.

## The new model

### The annotation file

`eval/runlogs/e2e/<slug>/run-<ts>.ann.json`:

```json
{
  "annotator": "alice",
  "per_finding": { "f1": "true", "f2": "partial" },
  "proof_quality_score": 2,
  "notes": { "f2": "right burial place, year-only date — date-precision call." }
}
```

- The **filename binds it to the run** — it's the `.ann.json` sibling of
  `run-<ts>.json`, so the two sort adjacent; no `run_log` pointer field needed.
- No `who` in the filename — `annotator` is an optional field (git blame on the
  committed `.ann.json` is the provenance fallback when it's omitted).
- `per_finding` is **the only required field.** Its **keys** are the fixture's
  finding ids — objective fixture data, so Claude Code fills them from
  `expected-findings.json` (the human doesn't hand-copy ids and risk a typo). Its
  **values** are the human's recall labels (`true` / `partial` / `false`).
- `proof_quality_score` (advisory axis) and `notes` are optional. A `null` or
  absent `proof_quality_score` is a *complete* grade — proof quality only applies
  when the run wrote a proof summary worth grading. `notes` is a **sparse
  per-finding map** (`{finding_id: text}`, keys ⊆ `per_finding` keys), so each
  note is surfaced on *its* finding's disagreement line — finding-scoped, which
  is what you actually tune the judge prompt from.
- **No `verdict` field.** The per-run verdict is derived (below), not authored.
- **A grade is incomplete** iff any `per_finding` value is `null`. Incomplete
  annotations are skipped, never counted.

Everything else the judge needs — `research_question`, `expected_findings`,
`final_tree`, `final_research` — is read from the run-log siblings and the
fixture at calibration time. The annotation carries only the human's judgment.

### Grading integrity

This is the load-bearing change, so it gets its own section.

- **No auto-creation.** A fixture run never writes a `.ann.json`. The grader asks
  Claude Code to grade a specific `run-<ts>.json`. Skipped / no-tree runs
  (`judge_output: {}`, `verdict: "skipped"` — `orchestrator.py:497-501`) simply
  don't get annotated; there's nothing to grade.
- **Grade blind, enforced by file access.** To grade, Claude Code reads **only**
  the fixture (`expected-findings.json`, `fixture.json`) and the run's two
  siblings (`final-tree.gedcomx.json`, `final-research.json`). It **does not open
  `run-<ts>.json`**, so the judge's `verdict` / `per_finding` are never in view at
  grade time. It shows the human, per finding, the **expected finding** and the
  **agent's evidence** (the relevant tree facts + any `proof_summaries`); the
  human labels each `true` / `partial` / `false` from that alone.

  Why blind: `calibrate_judge` re-runs the judge, possibly with a *changed*
  prompt. A grader anchored on the *old* judge's labels would make "agreement"
  measure the new judge against a human biased toward the old one — a directional
  bias that hides judge regressions. Disagreements are the *output* of
  calibration (`print_report`), discovered later, never an input to grading.

  This is a default-flow guarantee, not an absolute one: a grader can still open
  the run log by hand. The point is that nothing in the normal flow surfaces the
  judge's conclusion, so grades are independent unless someone goes out of their
  way to peek.
- **Incomplete never counts.** An annotation with any `null` `per_finding` value
  is "not yet graded": `calibrate_judge` warns (naming the file) and excludes it.
  A committed-but-unfinished grade contributes nothing — it cannot inflate the
  number.

### Lifecycle

```
1. RUN       make e2e-run TEST=<slug>            → run-<ts>.{json,transcript.md,
                                                    final-tree.gedcomx.json,
                                                    final-research.json}
2. GRADE     ask Claude Code to grade run-<ts>   → run-<ts>.ann.json
               reads fixture + final-tree +        (judge labels never opened;
               final-research (NOT run-<ts>.json);  you label each finding from
               you answer each finding's label      the agent's evidence)
3. VALIDATE  calibrate_judge --dry-run            (no API calls; classifies every
                                                    annotation — see tree below)
4. COMMIT    the run-<ts>.ann.json
5. CALIBRATE (maintainer, when the judge prompt/model changes)
               calibrate_judge                     (re-runs judge vs. every GRADED
                                                    annotation; reports agreement
                                                    + per-slug split)
```

Scaffolding and grading are one interactive step — there is no write-nulls-then-
return-later ceremony. The all-`null` shape exists only as the loader's
definition of "incomplete," which catches a half-finished or abandoned grade.

### Why re-runs never lose corrections

Annotations are keyed to the **immutable, timestamped run log**. A re-run writes
a fresh `run-<ts2>.json` that starts unannotated and cannot collide with
`run-<ts1>.ann.json`. Corrections are append-only and **accumulate** — never
carried forward (a re-run produced a different tree, so the old grade doesn't
apply) and never overwritten. Each graded run is a permanent
`(tree, expected, human-label)` calibration point that stays valid across judge
changes — which is exactly what re-running `calibrate_judge` after a judge edit
replays.

## Implementation

### Core insight (keeps churn small)

Preserve the internal "case" object shape that `grade_case` /
`CalibrationReport` already consume. Only change its **source**: from a committed
case file to an object **assembled at load time** from `(annotation + run-log
siblings + fixture)`. `grade_case`, `CaseResult`, `CalibrationReport`, and their
math tests are untouched. The rewrite is contained to the loader, `print_report`
(drop the per-run verdict line, keep the proof-quality line, add the per-slug
block), the CLI args, and the docstring.

The internal case the loader assembles (what `grade_case` reads — unchanged):

```python
{
  "id": f"{slug}/{stem}",                 # traceable: names the run in disagreements
  "research_question": <fixture.researcher_question>,
  "expected_findings": <expected-findings.json>,
  "final_tree": <run-<ts>.final-tree.gedcomx.json>,   # required
  "final_research": <run-<ts>.final-research.json>,    # optional → None
  "human": {
    "verdict": <derived from per_finding + required flags>,   # see below
    "per_finding": <ann.per_finding>,
    # "proof_quality_score": <ann.proof_quality_score>,       # only if present
  },
}
```

The annotation file is flat and verdict-free; the loader nests the recall/proof
fields under `human` and **derives** `human["verdict"]` so `grade_case` (which
reads `human["verdict"]`, `human["per_finding"]`, `"proof_quality_score" in
human`) needs no change. `annotator` / `notes` are carried for messages only.

**Verdict derivation** (one small helper; the judge's own rule, spec §7.2;
`required` is a mandatory field per §3.4, so no default-handling): `pass` if every
`required` finding is `true`; `fail` if no `required` finding is `true` or
`partial`; `partial` otherwise. With the human verdict derived this way,
`run_agreement` compares the judge's *emitted* verdict to the rule applied to the
*human's* labels — largely a coarsened restatement of the per-finding agreement
we already report, plus a little sensitivity to the judge contradicting its own
findings. It adds no clean independent signal, so we keep computing it (math +
tests untouched) but **stop printing it** (see the report below). Per-finding —
fully human-authored on both sides — remains the gate.

### Data flow

```
                  calibrate_judge → load_annotated_runs(runlog_root, fixtures_root)
                            │
          glob  eval/runlogs/e2e/*/run-*.ann.json
                            │
              for each annotation file:
                stem = "run-<ts>"   slug = parent dir name
                            │
        ┌───────────────────┼────────────────────────┐
        ▼                   ▼                          ▼
 <stem>.final-       <stem>.final-          eval/tests/e2e/<slug>/
 tree.gedcomx.json   research.json          ├─ expected-findings.json (ids + required)
 (required)          (optional → None)      └─ fixture.json (researcher_question)
        └───────────────────┼────────────────────────┘
                            ▼
                   classify (decision tree below)
                            │
   INCLUDE → derive verdict → assemble internal case → grade_case  ◄── UNCHANGED
                            │
              CalibrationReport → print_report  (+ per-slug breakdown)
```

### Loader classification (one place, the full tree)

`load_annotated_runs` walks every `run-<ts>.ann.json`, classifies it, and
**never aborts mid-walk**. It returns `(included_cases, problems)`, where each
problem is `{file, severity, message}`. Every problem *excludes* its one file;
the only difference between the two severities is the exit code:

- **WARN** — benign, expected (an incomplete grade). Exit stays 0.
- **ERROR** — needs action. Exit non-zero, file named. The sweep still completes
  and reports agreement for the valid set, so one bad file can't blank the run.

Order matters — an *incomplete* file is inert and must never hard-fail on a
problem in its surroundings, so the null-check sits above every check except
"can we even parse / read the shape":

```
run-<ts>.ann.json
   ├─ invalid JSON / not an object ─────────────► ERROR  (can't classify)
   ├─ unknown key, or no `per_finding` ─────────► ERROR  (structural typo, e.g.
   │                                                `proof_quality` for the score)
   ├─ any per_finding value null ───────────────► WARN + SKIP  (incomplete; inert)
   ├─ fixture / expected-findings unreadable ───► ERROR  (orphaned filled grade)
   ├─ <stem>.final-tree.gedcomx.json missing ───► ERROR  (ungradeable filled grade)
   ├─ per_finding keys ≠ fixture finding ids ───► ERROR  (drift — fixture changed,
   │                                                re-grade or delete)
   ├─ bad enum (label / proof_quality_score) ───► ERROR
   └─ valid, keys match ────────────────────────► INCLUDE  (derive verdict)
```

Allowed keys: `per_finding` (required), `annotator`, `proof_quality_score`,
`notes`. `notes`, if present, is a `{finding_id: string}` map whose keys must be
⊆ `per_finding` keys — a note for an unknown finding is an ERROR (typo guard).
Enum domains (checked only on filled values): each `per_finding` value ∈
{true, partial, false}; `proof_quality_score` ∈ {1, 2, 3, null}.

Rationale for the non-obvious branches:

- **Incomplete → warn + skip, and above orphaned/missing-tree/drift.** An
  unfinished grade is "not done yet," never an error — and that must hold
  regardless of whether its fixture changed or its tree went missing in the
  meantime. So every hard-fail below is reserved for a *filled* grade that is
  genuinely unusable. (Restores today's "null = not graded" guard, per-file, so
  one unfinished grade can't block the sweep.)
- **Drift → hard fail (not skip).** A *filled* grade whose keys no longer match
  the fixture means `expected-findings.json` was edited after grading. Silently
  skipping it would let the calibration set quietly collapse toward empty after a
  fixture edit. The set-equality check stays loud; `--dry-run` surfaces it at PR
  time ("annotation X is stale — re-grade or delete").

### Per-slug breakdown (count-skew visibility)

`print_report` gains an additive per-slug block (group `CalibrationReport.results`
by the `<slug>` prefix of each case `id`): per slug, its graded count and
per-finding agreement. Micro-aggregation still drives the gate; the breakdown is
the **detector** for the deferred macro-average's trigger ("if one fixture starts
dominating") — you can't see domination without it. Cheap; no new aggregation
type.

```
=== Judge calibration ===
per-finding agreement: 86% (12/14)   target ≥80%
proof-quality agreement (advisory, not gating): 80% (4/5)
  by slug:
    kenneth-quass-death     100% (2/2)   1 graded run
    smith-1850-parents       83% (10/12) 4 graded runs
disagreements (inspect each):
  - smith-1850-parents/run-2026-06-12_.../f2: human=partial judge=true
      note: right burial place, year-only date — date-precision call.
ungraded (skipped): 1
  - smith-1850-parents/run-2026-06-18_09-00-00.ann.json
```

(No per-run verdict line — that axis is computed but, per the verdict-derivation
note above, no longer printed. The proof-quality line stays: the human authors
`proof_quality_score`, so it's a genuine human-vs-judge axis.)

### File-by-file changes

| File | Change |
|---|---|
| `eval/harness/e2e/calibrate_judge.py` | Replace `load_cases(cases_dir)` with `load_annotated_runs(runlog_root, fixtures_root)` returning `(included_cases, problems)`: glob `*/run-*.ann.json`; derive stem + slug (parent dir name); load `<stem>.final-tree.gedcomx.json` (required) + `<stem>.final-research.json` (optional) + the fixture's `expected-findings.json` / `researcher_question`; **classify** (tree above, never abort mid-walk); on INCLUDE derive `human["verdict"]` and assemble the internal case with `id = "<slug>/<stem>"`. **Define** `DEFAULT_RUNLOG_ROOT` / `DEFAULT_FIXTURES_ROOT` locally from `REPO_ROOT`. (They mirror `orchestrator.py:45-46`, but we deliberately do *not* import from orchestrator: it pulls in `claude_agent_sdk` at import time, and calibration must stay offline-importable / `--dry-run` must do zero API work. With the seeder deleted, only two trivial path copies remain.) Swap `--cases-dir` for `--runlog-root` + `--fixtures-root`, mirroring `run_e2e`. Drop the per-case `model` field: judge model = `--model` ‖ `DEFAULT_JUDGE_MODEL`. `main`: print every problem (warnings + errors), grade the included set, print the report; exit non-zero if any ERROR problem (or, full run, below target). Update the not-found / help strings (they currently name `e2e.seed_calibration_case`). In `print_report`: **drop the per-run verdict line, keep the proof-quality agreement line, add the per-slug block**, and append each finding's `notes[fid]` to its disagreement line. Update the docstring. **Keep all agreement math** (`run_agreement` stays computed for the math tests, just unprinted). |
| `eval/harness/e2e/seed_calibration_case.py` | **Delete.** Sibling-resolution logic moves into the loader. Delete together with its test (below) in one step. |
| `eval/harness/tests/unit/test_e2e_calibrate_judge.py` | Keep the `grade_case` / `CalibrationReport` math tests (they build case dicts directly — unaffected). Rewrite the loader tests for `load_annotated_runs` (cases listed below). |
| `eval/harness/tests/unit/test_e2e_seed_calibration_case.py` | **Delete** in the same step as the seeder. |
| `eval/tests/e2e/calibration/` (`cases/`, `.gitkeep`, `EXAMPLE-kenneth-quass-death.json`) | **Delete the tree.** The worked human-vs-judge disagreement example (incl. its `notes`) moves into the guide. |
| `docs/specs/e2e-test-spec.md` | §8: add the optional fifth artifact `run-<ts>.ann.json` (present only when a human grades the run; not auto-emitted). §7.3 → expand into a short "Judge calibration": the annotation shape (no `verdict` field — derived), no-auto-create, grade-blind-by-file-access, presence-of-a-*graded*-annotation = inclusion, incomplete → warn+skip, drift → hard fail, the ≥80% per-finding gate, micro-aggregation today with per-slug visibility / macro-average-over-slug as the documented de-skew if one fixture dominates. |
| `docs/plan/e2e-skills.md` | Rewrite "Judge calibration set" (≈165–188): annotation model + relocated loader, no cases dir, no seeder. The DoD line (≈262) asserts the seeder as a shipped deliverable ("*(Done.)*") — **strike it through / mark superseded** by this plan rather than silently rewriting (a reviewer should see the deliverable was retired, not that it never existed). Update "Current state". |
| `docs/e2e-testing-guide.md` | Rewrite "Judge calibration" (≈710–827), setup step 6 (≈96–108), "Team workflow", the `make`/`.bat` lists (≈478, 484), related-docs. Add the **annotation template** (the JSON above) as the single documented source of the shape. New grade flow = "ask Claude Code to grade `run-<ts>.json`: it reads the fixture + the two `final-*` siblings (**not** the run log itself), shows you each expected finding + the agent's evidence, you enter labels → `calibrate_judge --dry-run` → commit." Spell out **avoid-finding grading** (spec §3.4.1): for a `polarity:"avoid"` finding the helper presents the *absence* of the wrong candidate as the evidence, and the grader labels `true` when that candidate is absent or present only as a rejected hypothesis, `false` when the agent over-claimed it. Include the relocated worked disagreement example. These sections should come out **shorter** than what they replace. |
| `Makefile` | Remove `e2e-seed` (268–271). Keep `e2e-calibrate` (274) unchanged. |
| `eval/SeedCalibrationCase.bat` | **Delete.** |
| `eval/RunCalibration.bat` | Keep; update the help text (annotations, not cases). |
| `eval/README.md` | Remove the `SeedCalibrationCase.bat` line (36); keep `RunCalibration.bat`. |

### Loader test cases (rewrite of the loader tests)

Offline; the judge call is injected as today. Cover:

- **Glob discovery** finds `*/run-*.ann.json` across multiple slug dirs and does
  **not** match the run log or its non-`.ann.json` siblings.
- **Assembly + derived verdict:** `id == "<slug>/<stem>"`; `research_question` /
  `expected_findings` / `final_tree` populated; `final_research` missing → `None`;
  `human["verdict"]` derived correctly (all-`true` required → `pass`; mixed →
  `partial`; all-`false` required → `fail`).
- **Incomplete → warn + skip:** one `per_finding` value null; file named in the
  warning, excluded, no error — *even when* its fixture is also missing or its
  tree is gone (incomplete wins; ordering test).
- **Drift → error:** filled grade whose `per_finding` keys ≠ fixture ids (extra
  key *and* missing key); message names the file.
- **Orphaned → error:** fixture dir / `expected-findings.json` unreadable.
- **Missing final-tree on a filled grade → error.**
- **Unknown key / missing `per_finding` → error** (catches `proof_quality`
  vs `proof_quality_score` typo).
- **Bad enum on a filled value → error** (per_finding label, proof_quality_score).
- **Invalid JSON / non-object → error naming the file.**
- **Exclude-not-abort:** a directory with one drift error, one incomplete, and
  one valid → loader returns the one valid case + both problems; the sweep still
  grades and reports the valid one.
- **proof_quality_score null/absent is still a complete grade** → INCLUDE.
- **Notes** carried as a per-finding map and appended to the matching
  disagreement line; a `notes` key not in `per_finding` → error.
- **Verdict derivation is polarity-agnostic:** an `avoid` finding labeled `true`
  (correctly avoided) rolls up toward `pass` exactly like a recovered finding.
- **Zero graded** (all incomplete or none found): `--dry-run` exits 0 with a
  clear "nothing graded yet" summary; the full path exits non-zero with the same
  message.

## Grading integrity, end to end (why this holds)

```
auto-created?      NO   → a scaffold exists only because a human asked for one
judge labels seen  NO   → grade flow reads fixture + final-* siblings only;
                          run-<ts>.json (judge_output) is never opened
incomplete file?   any per_finding null → detected → WARN + SKIP → contributes 0
                          (cannot inflate the agreement number)
fixture edited?    keys ≠ fixture on a filled grade → ERROR in --dry-run
                          (set never silently shrinks)
```

So the agreement number measures the judge against an independently arrived-at
human label, or it measures nothing (skipped) — not the judge against itself
(barring a grader who deliberately opens the run log).

## Simplifications applied in review

Cut or collapsed because each added surface, ceremony, or a field without a
present need:

- **No new `e2e-ann.schema.json`.** One consumer — the Python loader. The
  documented template (the guide) + the Python classifier is the single source of
  truth; a JSON Schema file would be a second one to keep in sync for no one.
- **No `EXAMPLE*`-skip logic in the loader.** The worked example lives in the
  guide as a fenced block, not a live file under `runlogs/`.
- **No `run_log` pointer field.** The filename binds the annotation to the run.
- **No `verdict` field — derived from `per_finding` + `required`.** Removes a
  human field, a null-check, an enum-check, and human verdict/per-finding
  inconsistency; the gate (per-finding) is unaffected. The derived verdict stays
  in the math (untouched) but is no longer printed — a coarsened echo of
  per-finding agreement.
- **Scaffold + grade are one step.** Blind grading writes the completed file in
  one interactive pass; the all-`null` shape survives only as the loader's
  "incomplete" definition.
- **One `(included, problems)` return; every problem just excludes its file.**
  Warn vs error is only the exit code; the sweep never aborts mid-walk. Strictly
  less brittle than today's whole-set raise.
- **One set-equality check** covers completeness-of-keys and drift on a filled
  grade.
- **Per-slug breakdown reuses existing results** — groups `results` by the
  `<slug>` prefix of `id`; no new aggregation type.
- **Worked example in one place** — the guide carries the full disagreement
  example; the spec carries only the minimal shape + rules.

## Deferred (documented, not built)

- **Macro-average over slugs.** Keep micro-aggregation now; the per-slug
  breakdown makes skew visible. Document the switch (group by slug, average within
  then across) as the fix *if* one fixture starts dominating. Not "last"/"random"
  — those discard the hardest cases and (random) make the gate non-reproducible.
- **Multi-grader per run.** One `.ann.json` per run. Two graders on one run would
  conflict on the file — accepted; the ≥80% bar is a reference, not computed from
  duplicate gradings.
- **CI `--dry-run` check.** A job running `calibrate_judge --dry-run` on PRs that
  touch `runlogs/e2e/**` would catch drifted / malformed annotations and flag
  committed-but-incomplete ones. Worth adding once annotations exist. With the
  integrity rules above the structural holes are closed in the tool itself, so
  this is a backstop, not the only guard.

## Notes for the reviewer

- E2e `.ann.json` live under `runlogs/e2e/` and **must be committed** (they are
  the calibration data). Verified: `eval/runlogs/e2e/**` is git-tracked, and
  `.gitignore` scopes `scratch_*` patterns to `runlogs/unit/**`, so the e2e files
  are neither ignored nor caught by the unit GH action
  (`.github/workflows/check-runlogs.yml` `paths:` = `eval/runlogs/unit/**`).
- The deletions touch files this author did not create, and other agents work
  this repo concurrently — each deletion gets per-file sign-off before removal.

## Rollout order

1. `calibrate_judge.py` loader (`load_annotated_runs` + classifier + verdict
   derivation) + CLI args + `print_report` per-slug block + docstring + error
   strings; rewrite its loader tests; run the harness unit suite green offline
   (the judge call is injected). The seeder + its test still exist here, so the
   suite stays green.
2. Spec / plan / guide prose (incl. the relocated worked example and the
   annotation template); strike the stale DoD bullet in `e2e-skills.md`.
3. Tooling: Makefile, `.bat`, README.
4. Deletions, **as units**: `seed_calibration_case.py` **and**
   `test_e2e_seed_calibration_case.py` together (deleting one without the other
   reds the suite); then the `calibration/` tree. Last, after the replacement is
   green.
