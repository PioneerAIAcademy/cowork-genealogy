# Deep-Dive Brief — `research`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** **Skill-body review, not unit-test authoring.** research is the one skill whose deep-dive does **not** stand up `eval/tests/unit/research/`. It's a thin orchestrator with no isolatable unit: the harness stages every sub-skill into `.claude/skills/` and grants the `Skill` tool, so any "routing" run cascades into the full sub-skill chain (mocked MCP) — a slow mini-e2e that grades the chain, not the router, over a `Skill`-tool mechanism Cowork production doesn't have (`docs/specs/skill-architecture-spec.md` §92: "Cowork lacks programmatic skill invocation"). A green unit suite would bless a routing path that can't occur in production. So the day's job is to **review and tighten the SKILL.md** (routing table, `--autonomous` contract, gps-mentor verdict protocol, stop conditions); the **e2e GPS fixtures are the regression floor**. Genealogical judgment is light — you're checking orchestration/routing logic, not genealogical output.

**Files:** SKILL.md (227 lines) · references ×0 (none) · tests ×0 (**by design — no unit directory, see Effort profile**) · rubric ✗ (intentionally none).

## What this skill does
The thin **orchestrator** for the full GPS workflow. It reads `research.json` state and routes to the right sub-skill (question-selection → research-plan → search-records → record-extraction → assertion-classification → person-evidence → conflict-resolution → hypothesis-tracking → research-exhaustiveness → proof-conclusion), iterating until all questions resolve. It **writes nothing directly** — every write is delegated to the sub-skill it routes to. It does **not** run periodic `validate_research_schema` passes between steps: each writer tool (`research_append`, `research_log_append`, `tree_edit`) validates the whole project before persisting, so the orchestrator only calls `validate_research_schema` to confirm an external/manual edit. It has an `--autonomous` mode (no clarifying questions; log decisions and rationale to the audit trail) and three `gps-mentor` subagent checkpoints (pre-exhaustiveness, conclusion-readiness, proof-critique) with a four-verdict handling protocol (`looks_solid` / `consider_addressing` / `address_first` / `refused`) that **branches between interactive and autonomous mode**. The only side-channel writes during a run come from the mentor subagent, which writes verdict files under `evaluations/`. Key invariant: it never introduces GPS logic, never skips steps, and never auto-routes past an `address_first` verdict in interactive mode.

## Where everything lives
- `packages/engine/plugin/skills/research/SKILL.md`
- references: none
- `eval/tests/unit/research/` — **intentionally absent** (see Effort profile). No test JSONs, no `rubric.md`, no `test_research.py` validator.
- Regression coverage lives in the **e2e framework**: the GPS fixtures under `eval/tests/e2e/` (e.g. `eval/tests/e2e/kenneth-quass-death/`) drive the full autonomous loop. Treat those as research's floor.

## Why no unit suite (don't author one)
> ⚠️ research has **no unit tests and no `rubric.md` by design** — not a gap to be filled. A unit run here degenerates into a mocked mini-e2e (the harness stages all sub-skills and grants the `Skill` tool) and exercises a routing mechanism production lacks. Review the SKILL.md directly and lean on the e2e fixtures.

Two facts make the orchestrator un-unit-testable on the same footing as the other skills:
- **No isolatable unit.** A routing run cascades through the whole sub-skill chain, so you'd be grading the chain (slow, redundant with the real e2e framework), not the routing decision.
- **Fictional mechanism.** That cascade runs over the harness's `Skill` tool; Cowork has no programmatic skill-to-skill invocation, so its production routing is prose auto-discovery. For every other skill this divergence is minor; for the orchestrator it *is* the behavior.

## How to review it (no unit run to lean on)
- **Routing table** — walk each `research.json` state row and confirm the next sub-skill is correct, and that exhaustiveness stays the last gate before proof-conclusion. The representative scenarios (`empty-project-just-created`, `mid-research-flynn`, `flynn-census-exhausted`, `flynn-research-complete-no-proof`, `flynn-resolved`) map onto rows and are useful as **read-through reference**, not unit fixtures.
- **`--autonomous` contract** — confirm the keep-going-in-one-turn rule and audit-trail logging read correctly; the e2e runs depend on it.
- **gps-mentor verdict protocol** — confirm the interactive-vs-autonomous branching and the `address_first` "never auto-route in interactive mode" rule still match the spec (`docs/specs/gps-mentor-agent-spec.md`).
- **Stop conditions** — the real stops (`project.status == "completed"`, user halt, genuine logged blocker).
- **Route-out boundaries** — drive a specific step → that sub-skill; status-only → project-status; no `research.json` → init-project. These live in the frontmatter `description` and are **description-triggering** concerns: exercise them through the description-optimizer's triggering set, not a unit rubric here.

## ⚠️ Known issues
- **Mentor checkpoint invokes a real subagent (`@plugin:gps-mentor`).** Its verdict branching is specced but only exercised end-to-end — confirm the prose still matches `docs/specs/gps-mentor-agent-spec.md` during review.
- **Route-out boundaries are undefended.** With no negative tests here, the only thing keeping research from grabbing single-step / status-only / no-research.json prompts is the frontmatter `description`. Any future hardening of those boundaries belongs to the description-optimizer, not this directory.

## Definition of done
Review and tighten the SKILL.md — routing table (every row), `--autonomous` contract, gps-mentor verdict protocol, stop conditions — keeping the orchestration semantics intact (no unit harness will catch a regression). Confirm an e2e GPS fixture still drives the full autonomous loop without yielding mid-chain and with the mentor gates firing. **No `eval/tests/unit/research/`, no `rubric.md`** — intentionally omitted for the orchestrator. PR the SKILL.md changes per the usual cadence.
