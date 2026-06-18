# Deep-Dive Brief — `research`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Greenfield — no tests, no rubric exist yet; the day's job is to stand up the first `eval/tests/unit/research/` directory + rubric + initial routing tests from scratch. This is a router, so the work is test-mechanics-heavy (crafting a research.json state per routing-table row) plus one net-new rubric dimension (Routing Correctness) the other skills don't have. Genealogical judgment is light — you grade *which sub-skill was picked*, not genealogical output.
**Files:** SKILL.md (189 lines) · references ×0 (none) · tests ×0 (NONE) · rubric ✗ (missing — no test dir).

## What this skill does
The thin **orchestrator** for the full GPS workflow. It reads `research.json` state and routes to the right sub-skill (question-selection → research-plan → search-records → record-extraction → assertion-classification → person-evidence → conflict-resolution → hypothesis-tracking → research-exhaustiveness → proof-conclusion), iterating until all questions resolve. It **writes nothing directly** — every write is delegated to the sub-skill it routes to; between steps it calls `validate_research_schema` (read-only). It has an `--autonomous` mode (no clarifying questions; log decisions and rationale to the audit trail) and three `gps-mentor` subagent checkpoints (pre-exhaustiveness, conclusion-readiness, proof-critique) with a four-verdict handling protocol (`looks_solid` / `consider_addressing` / `address_first` / `refused`) that **branches between interactive and autonomous mode**. The only side-channel writes during a run come from the mentor subagent, which writes verdict files under `evaluations/`. Key invariant: it never introduces GPS logic, never skips steps, and never auto-routes past an `address_first` verdict in interactive mode.

## Where everything lives
- `plugin/skills/research/SKILL.md`
- references: none
- `eval/tests/unit/research/` — **does not exist yet**; the deep-dive creates it (test JSONs + `rubric.md`).
- Scenarios available to reuse: `empty-project-just-created`, `mid-research-flynn`, `flynn-census-exhausted`, `flynn-research-complete-no-proof`, `flynn-resolved` map onto routing-table rows; mentor-checkpoint tests may need an `evaluations/` verdict fixture added to a scenario.

## Current tests (0) — greenfield
> ⚠️ This skill is **unevaluated**: zero tests, no `rubric.md`, and no `eval/tests/unit/research/` directory at all. There is nothing to harden — the deep-dive stands up the first test directory, authors the first rubric (including a Routing Correctness dimension), and lands the initial tests below.

## Tests to author (none exist yet)
**Positive (one routing test per major routing-table row — assert the right next sub-skill is chosen):**
- **objective, no questions → `question-selection`** (use `empty-project-just-created` extended with an objective).
- **question, no plan → `research-plan`**.
- **plan not executed → `search-records`** (use `mid-research-flynn`).
- **all plan items done, analysis complete → `research-exhaustiveness`** (use `flynn-census-exhausted`).
- **`exhaustive_declared`, no `proof_summaries` entry → `proof-conclusion`** (use `flynn-research-complete-no-proof`).
- **all questions `resolved`, `project.status == "completed"` → stop** (use `flynn-resolved`).
- **Mentor checkpoint — `address_first` verdict:** interactive mode *asks the user* before routing; autonomous mode routes to the first `must_address` item's `suggested_skill`. Two tests (or one per mode), each needing an `evaluations/<focus>-<target>-*.json` verdict fixture in the scenario.

**Negative (boundaries from the description):**
- → `question-selection` / `research-plan` / `search-records` (etc.): "Just do the research-plan step on q_001." — driving a *specific* step directly must NOT trigger the orchestrator.
- → `project-status`: "Give me a status summary of where this project stands." — status-only, no routing.
- → `init-project`: a prompt against a folder with **no `research.json`** — must defer to init-project, not route.

## ⚠️ Known issues
- **Routing tests collide with neighbor skills' descriptions.** Each sub-skill's own `description` competes for the same prompt; the `research` negative tests and the neighbor skills' negatives must be authored in coordination so they don't contradict.
- **No Routing Correctness rubric dimension exists.** Grading "did it pick the right next sub-skill" needs a dimension the other skills don't have — author it as part of standing up `rubric.md`.
- **Mentor checkpoint invokes a real subagent (`@plugin:gps-mentor`).** Decide up front whether the harness can exercise the subagent or whether the test only asserts the orchestrator *reached* the checkpoint and handled the verdict — the latter is the safer first cut.

## Fixture work
Light on MCP fixtures — the only declared tool is `validate_research_schema` (read-only, no API), so no `eval/fixtures/mcp/` entries are needed. The fixture cost is **scenario state**: most routing-table rows already have a representative scenario (listed above), but the mentor-checkpoint tests need a net-new `evaluations/` verdict file dropped into the chosen scenario. The "objective, no questions" row may need `empty-project-just-created` extended with an objective.

## Definition of done
Stand up `eval/tests/unit/research/` with a first `rubric.md` (add the Routing Correctness dimension) → add one positive routing test per major routing-table row reusing existing scenarios → add the `address_first` mentor-checkpoint test(s) with an `evaluations/` verdict fixture → add the three "drive a step directly / status-only / no-research.json" negatives (coordinated with neighbor skills) → first full harness pass + CRUD grade-correction + PR.
