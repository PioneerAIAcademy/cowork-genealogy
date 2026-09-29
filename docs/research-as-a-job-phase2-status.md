# Research as a job — phase 2 status log

**Branch:** `research-as-a-job-phase2` (pushed to origin; **no PR yet, by instruction**).
**Last updated:** 2026-09-29. Update this file whenever the branch moves.

This is a status log, not a plan. The plan is
[`docs/plan/research-as-a-job-phase2.md`](./plan/research-as-a-job-phase2.md); the parent
is [`docs/plan/research-as-a-job-later-REVISED.md`](./plan/research-as-a-job-later-REVISED.md).

## Where we are in one line

*Before phase 2* is most of the way done. Phase 2 itself has not started. Two things
still block it, and one of them is not ours to close (#2927).

## Built on this branch

| Commit | What |
|---|---|
| `b7d84a0c8` | The "I need you" exit — `AskUserQuestion` ends the turn as `decision` instead of stalling |
| `0e82c1da6` | `make e2e-narration-figures` — derives the plan's load-bearing figures |
| `5d9c53e70` | Harness: an agent SPAWN now counts toward a negative test's routing verdict; plus a `main`-red fix in `setup-feedback-case.sh` |
| `28f4041a6` | `export.py` writes the feed a hosted reader saw; plan revised to the system-prompt carrier |
| `7e3b9914a` | **R1**: router re-entry on every turn's system prompt, and the ledger now records which skill was called |
| (latest) | Guard for `export`'s `main()` wiring |

Three offer-removal commits were made and then **reverted** (`a262fcac0`, `9ec112c13`) —
see findings below. That is deliberate, not unfinished work.

## What we found (each measured, none assumed)

1. **An offer at the end of a skill body can be a load-bearing STOP.** Removing the
   question let `search-full-text` write `assertions`/`sources`/tree `persons` (all
   record-extraction's), perform question-selection's task, and let
   `conflict-resolution` fabricate and resolve a conflict on a fixture that has none.
   Three tests, all green before the edit. Two wordings were tried; the second failed
   the same way. **Removing an offer needs a replacement stop — it is a design change,
   not a wording change.** Both rows are back on the ledger in
   `packages/engine/mcp-server/tests/packaging/overridden-offers.test.ts` carrying this.
2. **`sdk_stream_silence` tracks test duration.** 100% of that abort class corpus-wide is
   `research-plan`, and every test that has hit it is in that suite's top five by median
   duration (`wzk` 424s rank 1, `005` 2, `014` 3, `002` 5). **Five consecutive runs
   failed to produce a red-free `research-plan` log**, which is why that skill's offer
   removal was reverted — the gate was unreachable, not the edit wrong.
3. **Two of the parent plan's four load-bearing figures were wrong.** Paragraphs opening
   "Now…"/"Let me…" is **8.8%**, not 18% (re-measured six ways; none yields 18%).
   `research-plan` lands at **4.7 min**, not 7. The 83.5% log-write figure **holds**
   (82.4%), and the **31.6% never-yield** figure **holds** (61 of 193). The validator's
   22% refusal rate is **NOT MEASURED** and unusable until someone builds a source.
4. **A negative test's routing verdict missed agent spawns.** Four callees ship as both
   a skill and an agent, and conversion deletes the skill, so this was about to get
   worse. Fixed.

## Still to do before phase 2

| Item | State | Needs |
|---|---|---|
| R4 `delivered` outcome | Value/slot/label pinned; **carrier ruled: a second dedicated tool** | Build it |
| "Not every turn is a job" finish line | Not started | R4's tool first |
| Capture a real feed | Code half done (`export.py`) | A live hosted run; token supplied 2026-09-29 |
| `sdk_stream_silence` | Diagnosed, not fixed | Decide: retry budget or per-test cap for 400s+ suites |
| #2927 | **OPEN — blocking dependency** | `research` and `project-status` both claim "drive the workflow forward" |
| #2793 | OPEN | Replace `project-status` skill with an agent |

## Process notes worth keeping

- **`mutation-check.sh` restores from git.** Never run it in the background while
  editing; it destroyed an implementation and its tests once here. Run it to
  completion on a clean tree, alone.
- **Do not resolve "the latest run log" by mtime.** A `git checkout` of pruned logs
  rewrites timestamps; use `check_runlogs.latest_full_skill_runlog`, which is what CI uses.
- **Remaining UNPINNED hunks under `make server-test` are wrong-suite, not gaps** — the
  Makefile target, `narration_figures_report.py`, `orchestrator.py` and
  `setup-feedback-case.sh` are guarded by `make harness-test`.
