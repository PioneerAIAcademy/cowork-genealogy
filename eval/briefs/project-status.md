# Deep-Dive Brief — `project-status`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Mostly fixture-craft, lightly genealogical. The skill calls no MCP tools, so there are no MCP fixtures — but the headline broken-foreign-key detection can't fire on the clean Flynn scenarios, so the dominant cost is **crafting a scenario with a deliberately dangling reference** (same shape as check-warnings needing impossible data). The judgment side is reporting-fidelity, not analysis.

**Files:** SKILL.md (376 lines) · references ×2 (216 lines) · tests ×4 · rubric ✓ (27 lines). No `validation-protocol.md` (read-only skill). No `allowed-tools` — calls **no** MCP tools.

## What this skill does
The "resume project" skill. Reads **all** sections of both `research.json` and `tree.gedcomx.json` and produces **two** summaries: a detailed GPS-state report for experienced genealogists (question status, GPS-element progress, log diversity, exhaustiveness level, conclusion readiness, proof tiers) and a plain-language narrative for casual users. It checks integrity — broken foreign keys (orphan IDs / dangling references across `person_evidence`, `sources`, `subject_person_ids`, `timelines`) and stale plans — then walks a 10-branch decision tree to a specific recommended next step. **Key invariants: read-only (writes nothing), surface warnings at the top, always produce both summaries, and a completed project reads as a summary not a to-do list.**

## Where everything lives
- `plugin/skills/project-status/SKILL.md`
- `references/conclusion-readiness.md` (116 — the four readiness conditions + proof-vehicle signals), `project-exhaustiveness.md` (100 — the four exhaustiveness levels)
- `eval/tests/unit/project-status/` — `mid-project-summary.json`, `completed-project-summary.json`, `blocked-by-conflicts.json`, `negative-proof-writing.json`, `rubric.md`
- Scenarios: `mid-research-flynn`, `flynn-resolved`, `flynn-multi-conflict` (all internally consistent — no dangling references by design)

## Current tests (4)
| id | covers | type |
|----|--------|------|
| ut_project_status_001 | Summarize mid-research status; complete coverage of GPS elements | positive |
| ut_project_status_002 | Summarize a completed (proved-tier) project — completion confirmation, not a to-do list | positive |
| ut_project_status_003 | Status report when progress is blocked by unresolved conflicts | positive |
| ut_project_status_004 | "Write the proof statement" → routes to proof-conclusion | negative |

> **The headline integrity feature is untested.** Three lifecycle states (mid / completed / blocked) are covered, but **broken-foreign-key detection — named in the description — never fires**: no scenario has a dangling reference. Like check-warnings, the detection logic needs purpose-built corrupt data to exercise it.

## Gaps — new tests to add
**Positive:**
- **Broken foreign key** (the missing headline) — craft a scenario where, e.g., `person_evidence.person_id` points at an `I9` that no longer exists in `tree.gedcomx.json` (matches the skill's own warning example), and assert the warning is surfaced **at the top**. Add variants for `subject_person_ids` and `timelines.person_ids` dangling.
- **Stale plan** — a scenario where an active plan's newest item predates the newest log entry/assertion for its question; assert the "plan predates recent findings" recommendation.
- **Both-summary contract** — assert the run produces the detailed GPS report **and** the plain-language narrative (confirm the rubric grades both, not just one).

**Negative (boundaries from the description):**
- → `proof-conclusion`: "Write the proof statement." — **already covered** (ut_004).
- → `init-project`: user points at an **empty** folder ("where are we?") with no `research.json` — should route to init-project, not summarize. Untested.
- → `question-selection`: "What should the next research question be?" / "choose the next question" — formulating a question is question-selection's job, not a status report. Untested.
- → (execute a specific step) → the appropriate skill directly: e.g. "search the 1870 census now" should hand off, not narrate status. Optional fourth negative.

## ⚠️ Known issues
- **No corrupt-data scenario exists**, so the integrity branch (broken FKs, stale plans) is structurally untestable today — this is the gating fix, not a polish item.
- **Two-audience grading unconfirmed** — verify the 27-line rubric actually scores *both* the detailed and user-friendly summaries; if it grades only completeness/accuracy/actionability of one, the dual-output invariant is ungraded.
- **Two of three named neighbors untested** — only proof-conclusion has a negative; the init-project (empty folder) and question-selection boundaries are open.

## Fixture work
No MCP fixtures — the skill calls no tools. The cost is **scenario authoring**: at least one net-new scenario with a deliberately dangling reference (broken FK) and one with a stale plan; these cannot be made by editing the clean Flynn scenarios in place without breaking other tests, so they're net-new directories. Negative routing tests reuse existing scenarios (or an empty folder for the init-project boundary) — content is irrelevant to routing.

## Definition of done
Build the broken-FK + stale-plan scenarios and their detection tests → add the both-summaries assertion → add the init-project (empty-folder) and question-selection negatives → confirm/extend the rubric to grade both summaries → full harness pass + CRUD review + PR.
