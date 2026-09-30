# Research as a job — phase 2 status log

**Branch:** `research-as-a-job-phase2` (pushed to origin; **no PR yet, by instruction**).
**Last updated:** 2026-09-29 (R1 + R4 built, feed captured; only the stall item is left). Update this file whenever the branch moves.

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
| `0538d487d` | Guard for `export`'s `main()` wiring |
| `c7b63b350` | R4 carrier ruled (user): a second dedicated tool; build spec pinned |
| `ed159989c` | **R4 worker half** — `delivered` outcome, hook arm, browser label |
| `beeb69742` | **R4 engine half** — the `research_delivered` MCP tool + spec |

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
| R1 router re-entry | **BUILT** — per-turn system prompt, plus the ledger recording which callee a Skill/Task call names | Nothing |
| R4 `delivered` outcome | **BUILT** end to end — tool, hook arm, outcome, label, spec | Nothing. No skill body instructs its use yet (the enforcement half) |
| "Not every turn is a job" finish line | Not started | R4's tool first |
| Capture a real feed | **DONE 2026-09-29** — `docs/captures/2026-09-29-mcandrew-children/`. 133 min, outcome `completed`, 2,697 events, 282 narration paragraphs | Nothing |
| `sdk_stream_silence` | Diagnosed, not fixed | Decide: retry budget or per-test cap for 400s+ suites |
| #2927 | **OPEN — do NOT fix here.** Its own board note says it is moot once #2793 lands, and the small patch would edit the file #2793 deletes | Cia-3 (asked to prioritise 2026-09-29) |
| #2793 | OPEN, **assigned to Cia-3**, must land serially with #2792 and #2798 | Cia-3 |

## Before-phase-2 acceptance scorecard (R2/R3), measured against the capture

Everything is BUILT. The acceptance is a separate bar and is **not** met yet — R2 requires
**three consecutive runs**, not one, because the behaviour it measures is known to flap.

| Criterion | State |
|---|---|
| New browser session, shipped profile, no slash command | **met** — `docs/captures/2026-09-29-mcandrew-children/` |
| Objective checked not on the live tree *before* the run | **met** — the five children were confirmed present, and the question asks past them |
| Ends `completed` or `decision`, never `budget`/`no_progress` | **met** — `completed` |
| Its feed committed to the repo | **met** — 2,697 events, 282 paragraphs |
| No body ends a reply with an offer the run overrides | **met** — 0 offers in 282 paragraphs |
| Invokes `research` in its first turn | **met** — settled 2026-09-29: it means DURING the first turn, not AS the first call. `init-project` always holds call 1 because the web client prefixes `OPENING_TURN`, so the strict reading is unsatisfiable by construction. The router was entered at call 6 of 42, within the run's single turn |
| **Three consecutive runs** | **NOT met** — one run |
| "…but leave it at that" ends with the delivered outcome | **met** — `delivered`, a rendered `pl_001`, and zero research-log entries (`docs/captures/2026-09-29-bounded-requests/`). The criterion itself is fixed (R10) to name an identifiable subject |
| "where are we?" ends after the answer, delivered, no new log entry | **met** — `delivered` in 1 minute, no new log entry |
| #2927 fixed first, or the measurement means nothing | **NOT met** — open, Cia-3 |

`project-status` was NOT chosen in the captured run, so the #2927 coin flip did not land badly
here — but one run cannot show that it won't, which is exactly why R2 asks for three.

**Two defects this scoring found, neither in the code:**

1. ~~**R2's own example cannot test what it intends.**~~ **FIXED (R10).** "Create a research
   plan for Mary Hales" carries no date, place or id and matches 35,921 FamilySearch people,
   so the agent never reached the bounded-request path. The criterion now names
   Mary E. McAndrew (G13G-P68), which passed every clause. The #2932 *citation* elsewhere in
   the plan is deliberately left as quoted — it is a real researcher's words and the evidence
   the complaint happened; editing a citation to fit a test would misquote the issue.
2. **The agent stalls where it should ask.** Facing that ambiguity it had the decision exit
   and did not use it: one nudge, no tool call, outcome `no_progress` — the researcher reads
   "the agent stopped making progress" where the truth was "which Mary Hales?". This is the
   **compliance half** of R1/R4 that the plan defers as unmeasured. Now measured once: the
   delivery rule was followed in both runs that could act on it; the decision exit was not
   reached in the one run that needed it. One observation, not a rate.

## The one item still open and owned here

~~`sdk_stream_silence`~~ — **FIXED** (`74b477107`). The threshold was not the defect: in
successful runs the non-API gap peaks at 58.7s against a 180s window. The RETRY was — a
1s→2s→4s backoff put all three attempts within ~7s of a three-minute stall, straight back
into the same dead upstream. A stall now waits out a meaningful fraction of the window that
declared it.

Nothing else here is owned by this branch. What remains is the acceptance above, and it is
gated on #2927 (Cia-3).

## Process notes worth keeping

- **`mutation-check.sh` restores from git.** Never run it in the background while
  editing; it destroyed an implementation and its tests once here. Run it to
  completion on a clean tree, alone.
- **Do not resolve "the latest run log" by mtime.** A `git checkout` of pruned logs
  rewrites timestamps; use `check_runlogs.latest_full_skill_runlog`, which is what CI uses.
- **`make proto-up` needs rootless Docker on a machine whose user is not in the `docker`
  group**, and the first rootless run doubles as a clean-machine test — its empty image store
  is what exposed the broken `minio/minio` pull. Ask before setting it up.
- **Remaining UNPINNED hunks under `make server-test` are wrong-suite, not gaps** — the
  Makefile target, `narration_figures_report.py`, `orchestrator.py` and
  `setup-feedback-case.sh` are guarded by `make harness-test`.
