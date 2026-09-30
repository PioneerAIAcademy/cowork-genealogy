# Research as a job — phase 2 status log

**Branch:** `research-as-a-job-phase2` (pushed to origin; **no PR yet, by instruction**).
**Last updated:** 2026-09-29 (R1 + R4 built, feed captured; only the stall item is left). Update this file whenever the branch moves.

This is a status log, not a plan. The plan is
[`docs/plan/research-as-a-job-phase2.md`](./plan/research-as-a-job-phase2.md); the parent
is [`docs/plan/research-as-a-job-later-REVISED.md`](./plan/research-as-a-job-later-REVISED.md).

## Where we are in one line

*Before phase 2* is built and its acceptance is met except the three-run measurement, which
is blocked on someone else. **Phase 2 is built.** Every parent item is done or deferred by design, and the only thing
left is the acceptance measurement, which is not ours.

## Before phase 2 — built

| Commit | What |
|---|---|
| `b7d84a0c8` | The "I need you" exit — `AskUserQuestion` ends the turn as `decision` |
| `0e82c1da6` | `make e2e-narration-figures` — derives the plan's load-bearing figures |
| `5d9c53e70` | Harness: an agent SPAWN counts toward a negative test's routing verdict; plus a `main`-red fix in `setup-feedback-case.sh` |
| `98e179f75`, `0538d487d` | `export.py` writes the feed a hosted reader saw, and its wiring is guarded |
| `7e3b9914a` | **R1** — router re-entry on every turn's system prompt, plus the ledger recording which callee a `Skill`/`Task` call names |
| `ed159989c`, `beeb69742` | **R4** — the `delivered` exit: outcome, hook arm, browser label, and the `research_delivered` MCP tool |
| `81b8e9041`, `4b71fdded` | When to deliver, taught in the turn prompt rather than 27 skill bodies |
| `45dcd3ff8` | `make proto-up` unbroken — minio repointed after every registry refused it |
| `ed44c3749` | **The captured feed** — 133 min, `completed`, 2,697 events |
| `74b477107` | The stall fix: a retry waits out a stall instead of retrying into it |
| `8b884bfcf` | Both bounded-request scenarios, run live and passing |
| `fa970d079`, `1167a78ae` | Two acceptance criteria settled/fixed (R10) |

Three offer-removal commits were made and **reverted** (`a262fcac0`, `9ec112c13`) — deliberate,
see findings.

## Phase 2 — the reading experience

| Parent item | State |
|---|---|
| The step is the chat's unit | **DONE** (`41a45a0c4`, `1cce268de`) — chips render where they arrived, not stacked above the prose |
| Identifiers become links | **DONE** (`f3908a47a`, `eddb86d5c`) — 193 dead ids open their card; provider hoisted above both panes |
| Tool chips in FamilySearch's words | **DONE** — labels (`13d6cf010`) and navigation (`357ddcd75`): 544 of 1,009 chips open the card they name. Still deferred: collapsed-card identity, compaction state, retry state |
| One view of job state | **DONE** (`537ebcf0a`, `b04873198`) — rail deleted, four states on the list, off-plan group |
| The job outlives the tab | **DONE** (`61c1c8941`) |
| Three kinds of nothing | **DEFERRED BY DESIGN** — R5 pins it to phase 3's errand; one semantic, two eval slots if split |
| Show the scans, let documents in | **SIDECAR BODIES DONE** (`f2b98b957`) — served from the blob store; 404 now means a log genuinely has none. Still not served: images, uploads, sandbox logs (`_NOT_IN_PROTOTYPE`) |

Supporting fixes: chips now close on the agent that produced the result
(`0b6ba0373` — 28 of 1,006 were cross-attributed), and every sub-agent event carries a
`task_id` (`f372060f3`), because attribution by description string could not tell two tasks
apart.

## What is left, and who owns it

1. **The three-run acceptance** — blocked on #2793/#2927, **Cia-3's**. R2 wants three
   consecutive runs and R3 says #2927 must be fixed first or the measurement means nothing.

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

## Findings from phase 2 itself

5. **The feed is not the screen.** `foldChatEvent` drops all sub-agent prose, so of the
   capture's 282 paragraphs only **190** reach a reader, 405 identifier occurrences are
   really **193**, and "36 sub-agents, all completed" is **32 distinct — 25 completed, 4
   stopped, 3 never closed**. The first phase-2 draft measured the feed and called it the
   screen, one day after correcting the same class of error in the parent plan.
6. **A direction heuristic for anchoring was built and rejected on the data.** Narration
   both reports and announces, in near-equal measure (158 transitions each way), but opening
   words do not separate the two — and the ground-truth burst is announced by "Running both
   checks for all 18 persons at once", which no opener list contained. Chronological order
   needs no heuristic and is what the parent plan asked for.
7. **28 of 1,006 chips were cross-attributed** — one agent's result closing another's chip
   and overwriting its summary. Now 0, with no results left unmatched.
8. **The progress rail showed all-green on a looping run.** Every one of its six stages reads
   `completed` on the captured project, because a stage is done forever once its section is
   non-empty. Deleted; the plan items already carry the real state.

## Decisions asked and answered

Every question put to the product owner during this work, their answer verbatim, and what
each one changed: [`docs/research-as-a-job-decisions.md`](./research-as-a-job-decisions.md).
Read it before re-opening a settled question — several were answered once and are easy to
re-litigate from a diff alone.

## Phase 4 acceptance: the init-project suite is green on three separate causes

`ut_init_project_012` (the new non-decisive-pick test) failed on its first run, and
chasing it surfaced two older reds nobody had separated. All three are now closed, and
none of the three was a defect in the skill:

9. **012 was an eval defect, not a skill defect.** The run behaved exactly as phase 4
   specifies -- `person_search` only, no `person_read`, `AskUserQuestion` raised, no
   project built, and no judge dimension below 3. Two validators failed it for having no
   project files. Their premise, stated in `test_both_project_files_created`'s own
   docstring, was that *every* opening question is non-blocking, "so a positive test
   always completes in one pass". Phase 4 made one question blocking: when the search
   cannot pick, building a project on the wrong person is the failure the ask exists to
   prevent. Both rules now stand down **only** when the run asked AND produced nothing --
   never for a run that merely produced nothing, so "did nothing" cannot pass as "asked".
10. **`ut_init_project_001`'s xfail marker was stale, and an xpass is exit-1.** The marker
   (issue #1689) waited on init-project "reliably" writing no source entry for an
   untranscribed memory. The fixture still carries that headstone, the rule is stated
   unconditionally at SKILL.md line 227, and `sources` is empty in all four committed runs
   v3-v6 -- mechanism, not just outcome. The failing run the marker cites,
   `v4_2026-09-25_16-03-09`, is not in the record at all; the released v4 is a later run
   and passes. Marker removed. Issue #1689 stays open -- this closes one symptom of it.
11. **`ut_init_project_vqx` was a judge-context gap, both halves.** The judge docked
   Correctness to 2 for (a) "fabricating" a first research question and (b) "inventing"
   that a census source was never read directly. Both are instructed, supported behaviour:
   SKILL.md's closing step is to *name* the first research question and go on to it
   (line 299), and `person_read` populates `text` only when it transcribed a source -- no
   source in this fixture has one. The run persisted the user's own words as the objective
   and wrote no research-question entry, which is correct. Two judge_context lines added,
   each also pinning the converse (persisting a question is still wrong; claiming a source
   *was* examined is still wrong) so the context cannot excuse a real regression.

12. **`rejected_links` shipped with three of its documentation sites missing.** The full
   harness suite (not `-x`) turned up two reds in `test_ownership_manifest.py` that the
   phase 3 item 3 commit had left: a new section is a *declaration*, and that module
   deliberately reddens on any addition so a widening has to be written down. Fixing it
   showed the section had also never reached `docs/specs/research-schema-spec.md` at all —
   no ownership-table row, no §5 section schema, no cross-reference map entry — though
   `ownership.json`, both schema trees, the validator, the web mirror, the hook and
   `research_query` were all correct. CLAUDE.md's new-section site list names the prose
   table; the commit followed the code half of the list and not the prose half.

   The declaration also needed a *kind* the module did not have. `NEWLY_ENFORCED` means a
   row already in the frozen table that was never evaluated; `rejected_links` did not exist
   when the table was frozen. Added as `ADDED`, separate so the failure message still says
   which kind of change moved, and `test_the_only_newly_enforced_section_is_localities` was
   renamed — it asserted two things while its name claimed one.

**A skip inside a validator silently disarms `pytest.raises` in its unit test.** Adding the
ask exemption gave `validators/test_init_project.py` a `pytest.skip` path, and a skip raised
inside a validator propagates out of the calling test -- so pytest marks that test *skipped*
rather than failed, and every `with pytest.raises(AssertionError)` in
`tests/unit/test_init_project_validator.py` stopped asserting. Mutation M1 (exemption always
fires) survived because of it. Replaced with a `must_fail` helper that turns a skip into an
explicit failure; all four mutations now die.

## Phase 4 is built

All three steps and all four acceptance items are done; the plan
(`docs/plan/research-as-a-job-phase4-cold-start.md`) carries the per-item annotations
and is marked BUILT. `person_search` returns `pick { decisive, tiedAtTop, reason }`,
`init-project` asks instead of guessing when it is not decisive, and a line before the
first search says what to expect. Eval green: 14 pass, 1 partial, zero reds.

13. **The rule was tested exhaustively and the WIRING not at all.** Deleting
   `pick: decisiveness(results)` from `person-search.ts` left all 48 tests in both
   person-search files green — 10 unit tests plus an 8-query live-probe corpus all
   exercised the pure helper, and nothing asserted the tool put the field on its
   response, while `init-project/SKILL.md` branches on `pick.decisive`. The feature
   could have been deleted silently. Closed by `person-search.test.ts` 21a-21d.

   The general shape is worth carrying: **a pure helper with a thorough unit suite is
   the easiest place to mistake rule coverage for feature coverage.** The helper tests
   look like the feature's tests and are not.

14. **A guard must be broken in the direction that wrongly BLOCKS, too.** The new
   fixture-agreement check compared `pick` with `JSON.stringify`, which compares key
   ORDER — so a fixture reserialized with the same values by any tool would have redded
   the build. Caught only because the legitimate-variant mutation was run alongside the
   four defect ones. Now compared field by field.

15. **The phase-4 spec sites the first build missed.** The plan named four sites in
   `person-search-tool-spec.md`; the build updated the response-fields table and left
   the worked example, the Mapping Logic top-level list and the two no-match rows of
   the behaviour table. The example a reader would copy carried no `pick`.

16. **The deferred "candidate cards" item is smaller than the parent plan thought, and
   measured now.** `dev/probe-candidate-distinguishability.ts`, four live queries: every
   flood query returned birth/death facts on **5 of 5** top candidates, distinguishable
   4/5 (hales), 2/5 (smith), 5/5 (hales-year-place). So lifespan and places need no
   enrichment — `person_search` already carries them and the ask is answerable today.
   Only parents and spouse are genuinely absent. The parent's "its top candidate had
   almost no distinguishing data" was right about that one candidate and wrong as a
   generalisation. Also: `tiedAtTop` is **20** in a real flood, not 5 — the tool returns
   20 by default and all 20 share the top score.

   **And the flood fixture was unrealistic — now FIXED.**
   `person-search-hales-namesakes.json` gave its five tied candidates no facts at all,
   so `ut_init_project_012` measured an ask over five identical blank options. Replaced
   with a **live capture used verbatim**: 20 tied (not 5), 8 distinct given names, 10 of
   20 with a birth date, 17 with a residence, and **0 of 20 with no facts at all**. The
   fixture's own description had claimed its values were "taken from a live probe rather
   than invented" — true of the scores, false of the candidates. It is true now.

   It never changed the rule under test — decisiveness is computed from scores — only
   the realism of what the agent then presents. The judge_context moved with it: the
   "five candidates" line now says twenty, and three lines were added covering what the
   reply must do with a result set too large for AskUserQuestion's four options.

17. **The realistic fixture changed what the run demonstrates, and for the better.**
   `v6_2026-09-30_14-36-09.json`: 14 pass, 1 partial, zero reds — same headline as
   before, different substance. Against 20 tied candidates `ut_init_project_012` now
   shows the agent doing work the five-blank stand-in could not test:

   - It **narrowed 20 to 4**, which `AskUserQuestion`'s four-option limit forces and the
     old fixture never exercised.
   - It **skipped `LBF1-LHF`** — the *top-scoring* candidate, whose only fact is a bare
     `{type: Death}` — in favour of four carrying birth dates, places and deaths. Ranking
     by recognisability over score is exactly the judgement the ask exists to get right,
     and nothing in the skill spells it out.
   - It reported the real 35,921 and the real reason ("all 20 returned candidates share
     the same score"), asked for the five details that would narrow it, called no
     `person_read`, and created no project files.

   Worth keeping as a general point: **a fixture that makes a task trivial hides whether
   the agent can do it.** The rule under test (decisiveness) passed either way; what was
   invisible was everything downstream of the rule.

## Where init-project's eval stands, and what it is waiting on

`v6_2026-09-30_13-45-44.json` is **green** — 14 pass, 1 partial, zero reds — and
committed as a **candidate**. It is not released, and releasing it is not mine to do:
`v5.ann.json` and `v4.ann.json` each carry a real genealogist's address, and every
release commit in this repo (`7e79d0d97`, `eeff413a0` — the latter is this
workstream's own phases 0-1) lands `v{N}.json` and `v{N}.ann.json` **together**. So
the annotation pass comes first.

`check_runlogs.py` therefore still reports one violation — "latest full-skill run log
`v5.json` is NOT active". That is expected and resolves at release, not before:
`latest_full_skill_runlog` prefers ANY released `v{N}.json` over every candidate
(`if released: ... elif candidates:`), so a branch that edits a skill cannot clear it
until its candidate is released. No PR is open, so nothing is blocked meanwhile.

**Two run-log rules worth knowing before the next run.** A run log may not carry a
red — rule 6 is explicit, and the red `v6_2026-09-30_13-13-47.json` was committed
once and had to come back out. And removing a log **re-opens the prune window**: the
harness had pruned to the newest 5 while the red one still counted, so dropping it
made `v2_2026-09-21_13-41-40.json`'s deletion stop being a prune. The checker caught
it; restoring was the fix.

`ut_init_project_vqx` stays `partial` and is now attributable to **issue #1962**
alone — its two older judge complaints were eval defects and are fixed, which is what
isolates it. Measurement posted to that card rather than fixed here: its PR 2 is the
mechanical check, and landing it alone would turn vqx from `partial` into `fail`
until its PR 5 changes the skill's catalog. Issue #1962 stays open.

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
