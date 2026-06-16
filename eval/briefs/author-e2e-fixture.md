# Deep-Dive Brief — `author-e2e-fixture`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Greenfield — no tests, no rubric exist yet; the day's job is to stand up the first `eval/tests/unit/author-e2e-fixture/` directory + rubric + initial tests from scratch. This is a developer/maintainer tool that produces *test-corpus files*, not genealogical research, so the work is test-mechanics-heavy. The crux to grade is the **stripping logic** — does the produced starting-tree genuinely no longer contain each expected finding? Genealogical judgment is light; the dominant cost is choosing a finished-project scenario and verifying absence after the strip.
**Files:** SKILL.md (231 lines) · references ×0 · templates ×4 (`expected-findings.json`, `fixture.json`, `README.md`, `starting-research.json`) · tests ×0 (NONE) · rubric ✗ (missing — no test dir).

## What this skill does
Authors an e2e benchmark fixture: produces **five files** (`fixture.json`, `starting-research.json`, `starting-tree.gedcomx.json`, `expected-findings.json`, `README.md`) into a `<slug>/` subfolder of the working folder, ready for the user to move into `eval/tests/e2e/<slug>/`. Two paths: (1) **convert** a just-finished research project into a fixture (preferred) — snapshots the resolved state, **strips the answer** from `tree.gedcomx.json`, and records what was stripped as expected findings; (2) author **from scratch** (user provides source PID + natural-language question + findings, built from templates). Preconditions: subject must be **deceased** (FamilySearch ToS) and there must be **1–5 expected findings** only. It validates `starting-research.json` against the schema via `validate_research_schema`. Key invariant: the user's own `research.json`/`tree.gedcomx.json` are **read-only inputs**; outputs go only into the `<slug>/` subfolder, and the stripped tree must genuinely lack each finding (re-read to confirm).

## Where everything lives
- `plugin/skills/author-e2e-fixture/SKILL.md`
- `plugin/skills/author-e2e-fixture/templates/` — `fixture.json`, `starting-research.json`, `expected-findings.json`, `README.md` (no `starting-tree` template; it's copied + stripped from the live tree)
- `eval/tests/unit/author-e2e-fixture/` — **does not exist yet**; the deep-dive creates it (test JSONs + `rubric.md`).
- Scenarios available: `flynn-resolved`, `flynn-research-complete-no-proof` are candidate convert-path inputs (resolved state with proof_summaries + an answer-bearing tree).

## Current tests (0) — greenfield
> ⚠️ This skill is **unevaluated**: zero tests, no `rubric.md`, and no `eval/tests/unit/author-e2e-fixture/` directory at all. Additionally, `eval/tests/e2e/` is itself empty (`.gitkeep` only), so there is **no existing fixture to diff the output against** — the rubric must judge correctness intrinsically (files parse, findings absent from the stripped tree), not by comparison.

## Tests to author (none exist yet)
**Positive:**
- **Convert path** — finished Flynn project (`flynn-resolved`) → all five files produced; assert the parentage answer is **stripped** from `starting-tree.gedcomx.json` and recorded in `expected-findings.json`. This is the skill's core job.
- **Stripping completeness by finding type** — for each of `relationship` / `fact` / `person` / `source`, the right items are removed AND the finding is genuinely absent afterward (the spec's per-type strip rules in Step 4).
- **Scratch path** — no `research.json`/empty `proof_summaries` → skill asks for PID + question + findings and builds from templates.

**Negative (boundaries from the description):**
- → `interpret-e2e-result`: "What happened in this e2e run / why did this fixture fail?" — interpret a run, not author one.
- → `init-project`: "Start a new research project on this person." — run a project, not author a fixture.
- → developer-facing unit-test runs: "Read this unit-test JSON result." — not an e2e fixture.
- **Living-subject refusal:** subject is **living** → skill must refuse (FS ToS) before writing files.
- **>5 findings:** user names six+ findings → skill must ask which subset (1–5 only).

## ⚠️ Known issues
- **Skill cannot write to `eval/tests/e2e/`** — it only writes inside the working folder. A test must assert the `<slug>/` subfolder is produced, **not** repo placement.
- **No example fixture exists** (`eval/tests/e2e/` is `.gitkeep`-only), so there's nothing to diff against; grade output shape intrinsically.
- **Stripping is the silent failure mode** — a finding "removed" from `facts` but still implied by a relationship/source would pass a shallow check; the rubric needs a "finding genuinely absent" dimension that re-reads the stripped tree.

## Fixture work
Reusable today: `flynn-resolved` (and `flynn-research-complete-no-proof`) supply the convert-path input — a resolved `research.json` with `proof_summaries` plus an answer-bearing `tree.gedcomx.json`. Net-new: a **living-subject** scenario (or an inline living person) for the ToS-refusal test, and a scenario with **>5 candidate findings** for the subset-ask test. MCP fixtures are light/none — the only declared tool is `validate_research_schema` (read-only, no API), so no `eval/fixtures/mcp/` entries are needed.

## Definition of done
Stand up `eval/tests/unit/author-e2e-fixture/` with a first `rubric.md` grading **all five files produced + parse, stripping completeness (findings genuinely absent), deceased-precondition enforcement, natural-language question (no ARK literals), slug consistency** → add the convert-path + per-finding-type stripping + scratch-path positives → add the three neighbor negatives + the living-subject refusal + the >5-findings subset-ask → first full harness pass + CRUD grade-correction + PR.
