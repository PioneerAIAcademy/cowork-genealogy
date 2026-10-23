# Research as a job — phase 2 status log

**Branch:** `research-as-a-job-phase2`, **closed unmerged 2026-10-23** at tag
`phase2-final`. **PR #3262 closed.**
**Last updated:** 2026-10-23. **This log is finished — the branch no longer moves.**

**Final entry.** The branch was closed rather than merged. Measured against `main` that
day, most of the 1,124 lines it still held were the PRE-REVIEW ancestors of code `main`
already carried in reviewed form, and a trial merge dropped branch lines in 12
NON-conflicted files with no conflict marker — including `validator.ts`'s whole
`supporting_assertion_ids` block, which the 232-test validation suite passed with and
without. Re-cutting what had genuinely not landed was smaller and safer than resolving
40 conflicts to reach code `main` already had.

| Landed from the branch | |
|---|---|
| #3577 | the front door, `rejected_links`, the reading experience, and the viewer's job-state half |
| #3589 | step-mode phase 0 measurements and decisions 23-25 |
| #3662 | the orphan reaper, the web-tier routes, `job_state.py` |
| #3674 | the step-mode plan scope correction |

| Re-cut from `main` afterwards | |
|---|---|
| #3794 | `tool_calls.wrote` — the writer-record unit and its migration |
| #3795 | the `person_search` probe evidence this repo's docs cite |
| #3801 | the stall backoff, and the nudge that named a retired skill |

**Not carried forward, and why:** the phase-3 decision exit (phase-3 scope — see
`docs/plan/research-as-a-job-phase3-loop.md`); `person-search-hales-namesakes.json`
(referenced by zero tests anywhere); `person-search-flynn.json`'s rework (mutates a
shared fixture's recorded values with no justification found);
`open-ask-still-a-job.json` (two `judge_context` lines that would owe a paid run); and
several stale assertions `main` has moved past. All recoverable from `phase2-final`.

**Everything this file said was blocking is now closed:** #2793 and #2927 (2026-10-03),
#3119 (2026-10-08), #2122 (2026-10-12). Nothing external gates this branch.

**What a 2026-10-12 review of this document found, and this revision fixes.** The file
contradicted itself on `sdk_stream_silence`, named four closed issues as live blockers,
undercounted the usable trigger tests, called a shipped feature "Not started" — and, worst,
its one-line summary said the only thing left was R2. That was wrong: **three clauses of
phase 2's own acceptance are unmet**, and three "deferred" items have no recorded ruling.
They are listed below rather than left implied. A status log that undercounts what is left
is worse than no status log.

**To test this branch by hand**, use
[`docs/research-as-a-job-phase2-test-plan.md`](./research-as-a-job-phase2-test-plan.md)
(2026-10-13). Most of phase 2 needs no Docker.

This is a status log, not a plan. The plan is
[`docs/plan/research-as-a-job-phase2.md`](./plan/research-as-a-job-phase2.md); the parent
is [`docs/plan/research-as-a-job-later-REVISED.md`](./plan/research-as-a-job-later-REVISED.md).

## Where we are in one line

**Phase 2 is built, and as of 2026-10-13 all seven acceptance clauses are verified
against a running stack** rather than against a passing suite. That distinction is the
main thing this file now records: three of the seven were marked built on 2026-10-12 with
green tests behind them and did not work at all. See "Phase 2's own acceptance" below.

*Before phase 2* is built; its acceptance is met except R2, which is the one genuinely
open item and is not work — it needs `AUTO_CONTINUE` turned back on, and both of the
preconditions for asking have now merged (#3372, #3393).

What is left: R2's live measurement, and the two stale eval runs (`research`,
`init-project`) to be bought at un-draft after the final main merge.

## Before phase 2 — built

| Commit | What |
|---|---|
| `b7d84a0c8` | The "I need you" exit — `AskUserQuestion` ends the turn as `decision` |
| `0e82c1da6` | `make e2e-narration-figures` — derives the plan's load-bearing figures |
| `5d9c53e70` | Harness: an agent SPAWN counts toward a negative test's routing verdict; plus a `main`-red fix in `setup-feedback-case.sh` |
| `98e179f75`, `0538d487d` | `export.py` writes the feed a hosted reader saw, and its wiring is guarded |
| `7e3b9914a` | **R1** — router re-entry on every turn's system prompt. **DROPPED 2026-10-15** (lead): the Oct 8 merge of main removed it, and rather than port it the plugin's two front doors were collapsed into one. Nothing re-adds it. |
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
| One view of job state | **DONE and now VERIFIED** — rail deleted, off-plan group. The four states shipped broken: `_SELECT` fetched none of `job_state`'s three inputs, so every session read `new`. Fixed and driven through all five states against compose (`068035944`) |
| The job outlives the tab | **DONE** (`61c1c8941`) |
| Three kinds of nothing | **DEFERRED BY DESIGN** — R5 pins it to phase 3's errand; one semantic, two eval slots if split |
| Show the scans, let documents in | **DONE and now VERIFIED** — sidecars, images and uploads all served from the blob store. All three answered 500, not 404, until `479b88090`. Still not served: sandbox logs (501, deliberately) |

Supporting fixes: chips now close on the agent that produced the result
(`0b6ba0373` — 28 of 1,006 were cross-attributed), and every sub-agent event carries a
`task_id` (`f372060f3`), because attribution by description string could not tell two tasks
apart.

## What is left, and who owns it

Nothing external blocks this branch. Four things are genuinely outstanding.

### 1. Phase 2's own acceptance — all seven met and verified

Phase 2's *Acceptance* paragraph (`research-as-a-job-later-REVISED.md`, the reading-experience
section) has seven clauses. Four were met earlier. These three were the last to land, and each
has now been exercised on a running stack rather than only unit-tested:

| Clause | State |
|---|---|
| "a census page opens from the feed" | **VERIFIED 2026-10-13** — `GET .../image` returns 200, `image/jpeg`, bytes intact (`ffd8` magic) for a real scan; 404 for a missing one |
| "a PDF attached mid-run reaches the project" | **VERIFIED 2026-10-13** — `POST .../files` returns 200; re-uploading a name replaces it (one row, second body) and the superseded object is deleted (2 objects for 2 names) |
| "a session stopped at the spend bound continues on the same project in one action" | **VERIFIED 2026-10-13** — one click opens a new session on the same `project_id`, carrying the project's prior work. Works on REPLAY too, so a reader returning to a stopped session still gets it |

All seven clauses are now met **and verified against a running stack** (2026-10-13).

**Read this before trusting any "built" row above.** Three of these clauses were recorded
as built on 2026-10-12, with a green suite behind each, and **none of the three worked**.
They were found by curling the routes and clicking the UI on `make proto-up`, not by any
test:

- **All three blob routes answered 500, never 404 or 200.** `psycopg` and `PG_DSN` were
  referenced by the sidecar, image and upload handlers and neither is defined at module
  scope in that file. Every call that got past validation raised `NameError`. The route
  tests stub the client and never reach the line. Fixed in `479b88090`; the shared guard
  is `eval/harness/tests/unit/test_undefined_name_lint.py`, since this was the second
  `NameError` to reach a running tier.
- **Every session reported `job_state: "new"`.** `_SELECT` fetched none of the three
  inputs `job_state` reads, so the pure function took its `latest_outcome is None` branch
  every time. `test_session_job_state.py` passed throughout — it takes those values as
  arguments, so it cannot see that nothing supplies them. Fixed in `068035944`, with a
  pg-backed test because the defect was entirely in SQL.
- **`make proto-up` could not start at all.** The minio service still carried the
  `bitnami/minio` command, volume path and healthcheck after the image pin moved to
  `pgsty/minio`; main had it right and a merge kept the stale side. So nobody could have
  run the stack to discover the two above. Fixed in `fcc94ae3b`.

The pattern is worth naming, because it will recur: **every one was a gap between two
correct pieces.** The function was right and nothing fed it; the route was right and a
name was undefined; the image pin was right and the command was not. A unit test sees one
piece. Only running the thing sees the seam. A row in this file that says "built" on the
strength of a passing suite is an unverified claim — say which stack it was exercised on.

Three further notes on the upload path, each a near-miss caught before merge:

- **The web tier had no S3 WRITE path at all**, only `fetch_sidecar`'s read, so the
  upload was not the port it looked like. `project_blobs.put_blob` mirrors the engine's
  own `indexObject`: fresh object key, upsert the row, delete the superseded object
  only after the row is durable.
- **`python-multipart` was missing from the `proto-web` group.** `UploadFile` needs it,
  the pytest suite runs in the full `[project]` venv which has it, so the tests would
  have passed while the deployed image failed.
- **Ownership had to precede validation on both routes.** A required query param or
  body field is rejected 422 by FastAPI *before* the handler runs, so a foreign session
  learned the route exists and what it takes. The existing ownership suite caught it.

Still 501, deliberately: `.../logs`. The acceptance names images, uploads and
spend-resume and not sandbox logs, which are an operator debug surface.

The four that ARE met: paragraphs anchored to their step, identifiers linked, no wire names
or bare collection numbers in chips, a deferred search not rendering as a negative result.
Sidecar bodies are served (`f2b98b957`); a 404 now means a log genuinely has none.

### 2. The three "deferred" items — RULED and BUILT 2026-10-13

They had no ruling anywhere: zero mentions of compaction, retry or collapsed in
`research-as-a-job-decisions.md`. A deferral nobody ruled is not a deferral; it is work
that fell off the list. Put to the lead, who ruled build-it on both of the two that were
real.

- **Retry state was never deferred at all.** The chat has shown
  "●●● Reconnecting (attempt N of M)…" since PR #765. This row was simply wrong.
- **Compaction state — BUILT.** Every long run compacts, a median three times at about
  two minutes each: roughly six minutes per run during which the screen showed nothing,
  so a working pause was indistinguishable from a crash. The CLI announces it as
  `system`/`compact_boundary`; `real_agent` forwards it and the chat shows
  *"Still here — organising what I have found so far…"*. It ranks below reconnecting
  (a lost connection outranks a working pause) and is cleared by the next event,
  because the CLI announces a compaction's START and never its end.
- **Collapsed-card identity — BUILT, then fixed twice.** It shipped reading **camelCase**
  keys (`birth_place` as `birthPlace`, and so on) out of `research.json`, which is
  snake_case throughout, so five of its twelve keys never matched anything and only the
  single-word ones worked by accident. In the sample project a death search and a
  marriage search both rendered as bare "Patrick Flynn" — the exact collision the feature
  exists to prevent. Its unit tests used camelCase too, so they agreed with the
  implementation and with no real document. Fixing the casing alone was not enough:
  `birth_place`/`birth_year` are the subject's own attributes, repeated in every query
  about that person, so with three parts as the whole budget they crowded out what
  actually differs; keys are now ordered by how discriminating they are. A second pass
  added value-level de-duplication, since `place`, `jurisdiction` and `death_place` are
  all "where". Both found in a browser. A collapsed research-log row showed date, tool,
  outcome and a count, so two searches of the same tool on the same day were identical
  on screen. The row now carries a one-line identity from the query — who, then where,
  then when, capped at three parts so a row stays one line.

### 3. R2's activation measurement — the one acceptance for *Before phase 2*

R2 wants: a **new browser session** under the shipped profile, an objective whose answer was
checked absent from the live tree, **no slash command**, invoking `research` in its first turn
on **three consecutive runs**.

**The unit corpus cannot stand in for this**, and an earlier draft of this file implied it
could. Three usable `grade:trigger` tests exist — `ut_research_001`, `_004`, `_005`; a fourth,
`_h22`, carries the tag but enters with `/research` and so cannot measure triggering at all.
All three run on `mid-research-flynn`, an **active** project. They measure the #2927 trigger
flap, which is the shape R2's 3/3 bar exists for, but not R2's literal object: a new session's
first turn. **Changed 2026-10-15:** the web client no longer prefixes `OPENING_TURN`, so
init-project no longer holds call 1 by construction and `research` can genuinely be the
first call — see the reading below, which that change makes satisfiable.

So the unit run is **evidence, not acceptance**. #3119 records these tests proven 3/3 on main
on 2026-10-08; a re-run is justified only by this branch's `research/SKILL.md` differing from
the v19 snapshot.

**The live half needs a decision, not work, and both preconditions for asking it have
now merged.** The hosted alpha has `AUTO_CONTINUE` off for cost (2026-10-12). Nothing in
the repo turns it off — `Settings.auto_continue` defaults `True` and neither
`deploy/fly.toml` nor the web client sets it — the lead turned it off on the deployment
himself, so it is an operator-set Fly secret and invisible to the codebase. The agreed
order was: land the enforcement half, have the lower nudge cap already in place, then
flip. #3372 merged 2026-10-13 and #3393 (cap 60 → 30) merged the same day, so the only
remaining step is asking for the secret to be unset. Recorded in
`research-as-a-job-decisions.md`.

### 4. Eval-run debt

Two stale snapshots, confirmed by running `check_runlogs.py` on 2026-10-13 rather than
from memory: **`research` (`v21.json`, 2 files differ)** and **`init-project` (`v17.json`,
6 files differ)**. Both are staled by this branch's own edits — `agents/init-project.md`,
four `person-search-*` mcp fixtures, and two unit-test JSONs.

Buy both **once, at un-draft, after the final main merge**. The ordering is not advice:
#3372 cost a run twice by ignoring it. Its `research` log was bought, then PR #3243 landed
on main touching `locality-guide.md` and research's own delegation line, which re-staled
it before it could merge — and `main`'s ruleset sets
`strict_required_status_checks_policy`, so a branch cannot merge while behind. **Merge main
first, then run, then merge promptly.** The window between the run and the merge is the
whole risk.

Note `research` is at **v21**, not the v19 this file used to say: #3372 released v20 and
then v21 when v20 staled, and both reached main.

(A third violation, a hand-deleted `init-project` candidate, was restored 2026-10-12.)

## What changed under this branch while it sat

Re-verify before trusting the "built" rows above: `#3140` moved tree building into
`project_create` and rewrote `init-project/SKILL.md`; `#3092` converted project-status from a
skill to an agent; `#3187` landed the bounded/job router decision, taught BOTH hosted planes
the `delivered` signal, and forced delegations to the foreground; `#3077` changed
`person-read-driscoll-attached-sources.json`, which `research/v8.json` embeds — so the
research suite owes a re-run (warn-only today).

Harness change worth knowing here: the negative-routing short-circuit now resolves an AGENT
spawn, not only a `Skill` call. Before that, a negative test whose callee had been converted
to an agent could never resolve — which is how `ut_init_project_009` broke silently for three
days after project-status converted.

## What we found (each measured, none assumed)

0. **Six defects in one afternoon of running the thing, none caught by ~15,700 passing
   tests.** The branch's suites were green before and after each. In order found:
   `entryIdentity` reading camelCase from a snake_case document; the mock agent minting
   duplicate ids on a seeded project (React: rows "may be duplicated and/or omitted");
   `make proto-up` dead on a stale minio service; `entryIdentity` printing one value
   twice; all three blob routes answering 500 on an undefined name; and every session
   reporting `job_state: "new"`.

   **Every one was a seam between two correct pieces** — the function right and nothing
   feeding it, the route right and a name undefined, the image pin right and the command
   stale. A unit test sees one piece; only running it sees the seam. Three of the six
   were behind rows in this very file that said "built".

   The one that generalises has a guard now: undefined names were the second `NameError`
   to reach a running tier, so ruff F821 went repo-wide
   (`eval/harness/tests/unit/test_undefined_name_lint.py`) rather than being fixed twice.
   The rest are the argument for the manual plan in
   `research-as-a-job-phase2-test-plan.md`.


1. **An offer at the end of a skill body can be a load-bearing STOP.** Removing the
   question let `search-full-text` write `assertions`/`sources`/tree `persons` (all
   record-extraction's), perform question-selection's task, and let
   `conflict-resolution` fabricate and resolve a conflict on a fixture that has none.
   Three tests, all green before the edit. Two wordings were tried; the second failed
   the same way. **Removing an offer needs a replacement stop — it is a design change,
   not a wording change.** Both rows are back on the ledger in
   `packages/engine/mcp-server/tests/packaging/overridden-offers.test.ts` carrying this.
2. **`sdk_stream_silence` is a risk that rises with duration — NOT a predictor.**
   ~~"tracks test duration … every test that has hit it is in that suite's top five by
   median duration"~~ **— refuted 2026-09-30 by the re-run, and both halves of the
   original claim were wrong.**

   Medians over all 8 committed runs plus the re-run: `wzk` 451s rank 1, `014` 397s
   rank 2, `005` 393s rank 3 — the three longest, which is what the claim saw. But
   **`r3d` is rank 11 of 23 (271s)** and aborted, so "every test that has hit it is in
   the top five" is false. And in that run **`wzk`, rank 1, passed on attempt 1** while
   ranks 14 and 15 of that run's durations aborted. Length raises the odds; it does not
   say which test goes.

   The second half was stale too: ~~"five consecutive runs failed to produce a red-free
   log"~~ — `v2.json` and its candidate are both red-free (21 pass, 1 partial, and one
   `fail` that is a declared `xfail`). A red-free `research-plan` log exists and is
   released.

   What holds: the threshold stays at 180s (successful runs peak at a 58.7s gap), the
   30s stall backoff works (7 transient retries rescued 4 tests; `wzk` and `014` both
   recovered), and the residual costs **0–2 tests per run** with `ut_research_plan_005`
   the repeat offender — the only test aborting in both runs that ever aborted.
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
| R1 router re-entry | **DROPPED** (lead, 2026-10-15) — not ported. The real problem was two front doors: init-project's description claimed the same first messages as research. R1 and the web opener both patched that server-side and neither reached Cowork. `research` is now the only front door. | Nothing |
| R4 `delivered` outcome | **BUILT and MERGED** end to end — tool, hook arm, outcome, label, spec | The enforcement half, #3372, merged 2026-10-13. Note the gap it closes was NOT "no instruction": `DELIVERY_GUIDANCE` named the tool on both hosted planes all along. The router body said "end your turn" at the same moment and the nearer instruction won — a conflict, not an absence |
| "Not every turn is a job" finish line | **BUILT and fully merged**, across #3147 (the exit), #3187 (the bounded/job decision), #3235 (save what the turn finds), #3286 (compound asks) and #3372 (the enforcement half, merged 2026-10-13) | Nothing. The "in review" qualifier this row carried is discharged |
| Capture a real feed | **DONE 2026-09-29** — `docs/captures/2026-09-29-mcandrew-children/`. 133 min, outcome `completed`, 2,697 events, 282 narration paragraphs | Nothing |
| `sdk_stream_silence` | **Retry fixed** (`74b477107`) — the threshold was never the defect; a 1s/2s/4s backoff put all three attempts inside ~7s of a three-minute stall. **Residual upstream flake remains**: the 2026-09-30 re-run records 0–2 aborts per run, `ut_research_plan_005` the repeat offender | Nothing here. Do not write a bare "fixed" — the retry is fixed, the flake is not |
| #2927 | **CLOSED 2026-10-03** | Nothing |
| #2793 | **CLOSED 2026-10-03** | Nothing |

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
| Invokes `research` in its first turn | **met** — settled 2026-09-29 as DURING the first turn, not AS the first call, because `init-project` then held call 1 by construction: the web client prefixed `OPENING_TURN`. The router was entered at call 6 of 42, within the run's single turn. **The construction is gone (2026-10-15)**: nothing is prefixed, `research` is the only front door, and the strict reading is now satisfiable. `ut_research_r2` measures it directly |
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

## `sdk_stream_silence` — what was fixed, and what was not

~~`sdk_stream_silence`~~ — **FIXED** (`74b477107`). The threshold was not the defect: in
successful runs the non-API gap peaks at 58.7s against a 180s window. The RETRY was — a
1s→2s→4s backoff put all three attempts within ~7s of a three-minute stall, straight back
into the same dead upstream. A stall now waits out a meaningful fraction of the window that
declared it.

**The flake it was blamed for is not gone.** The 2026-09-30 re-run records 0-2 aborts per
run with `ut_research_plan_005` the repeat offender. The retry is fixed; the upstream
instability is not, and "FIXED" alone over-claimed it.

**"Nothing else here is owned by this branch" was wrong**, and this section's heading with
it — this was never the one item still open. See "What is left" above: three phase-2
acceptance clauses are unbuilt (images, uploads, spend-resume), three items are deferred with
no ruling, and R2 remains. #2927 closed on 2026-10-03 and gates nothing.

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

## The research-plan re-run: the fix held, my diagnosis did not

Run 2026-09-30, 23 tests, $7.90, skill runner on the subscription. **20 pass, 1
partial, 2 aborted** — both `sdk_stream_silence`.

**The stall fix works.** `ut_research_plan_wzk`, which the orchestrator comment named
as the test that burns all three attempts, passed on **attempt 1**;
`ut_research_plan_014`, which aborted on wall clock in the run that motivated this work,
passed on attempt 3. Seven transient retries rescued four tests.

**But the duration diagnosis is refuted.** It held that `sdk_stream_silence` tracks test
duration, because `wzk` was the longest of the 23 and the affected tests were in the top
five. This run says otherwise:

| rank by duration | test | outcome |
|---|---|---|
| 1 (548s) | `wzk` | **pass** |
| 2 (444s) | `014` | pass, 3 attempts |
| … | | |
| 14 (229s) | `005` | **aborted** |
| 15 (201s) | `r3d` | **aborted** |

The longest test passed and the aborts came from the middle of the pack. What actually
predicts trouble is `skill_attempts`: every test at 3 attempts is either an abort or a
rescued pass, and every test at 1 attempt passed.

**What is left is an upstream flake, not a threshold error.** An aborted test has been
silent for 180s on three separate attempts 30s apart, which is a genuine stall — and the
threshold must stay where it is, since the non-API gap in successful runs peaks at 58.7s.
It costs **0–2 tests per run**: zero in `v2.json` and its candidate, two in
`v1_2026-09-17`, two here. `ut_research_plan_005` is the repeat offender — the only test
aborting in **both** runs that aborted at all.

**Nothing was committed from it.** A run log may not carry a red (rule 6), so the log is
kept outside the tree as evidence and `v2.json` — released, zero aborts — stays the
current one. `check_runlogs` confirms research-plan's snapshot is **active**, so no
re-run is owed for CI; this one was the confirmation owed from the stall work, and it
gave its answer.

**A further run is a dice roll, not a fix.** The aborting tests move between runs, so
~$8 buys a chance at a clean log rather than a change in behaviour. The thing that would
actually help is making `005` reproducible, which is measurement design, not a re-run.

## Where init-project's eval stands, and what it is waiting on

**Decided (owner, 2026-09-30): do NOT annotate v6 yet — annotate last.** An annotation is
bound to one run log by its `run_log` field, so any later skill edit forces a fresh paid
run and makes the annotation moot. Annotating now risks paying for the run twice.

Two things make this concrete rather than cautious:

- **Issue #1962's PR 5 was scheduled to edit `init-project/SKILL.md`'s "Obvious error
  detection" section** (drop
  three items from "Obvious error detection"), and that card prices its own cost as one
  `make eval-skill SKILL=init-project` plus an annotation pass. A known, planned change
  — **superseded 2026-10-08**: the lead cancelled that PR, and the blocker is now #2122,
  which deletes `skills/init-project/` outright.
  to this exact skill is pending.
- `ut_init_project_vqx` — the one partial — is failing on precisely what PR 5 addresses,
  so the run that supersedes v6 is also the run that should clear it.

**The annotation itself is not blocked on anyone.** `docs/per-pr-review-workflow.md` §2.2:
the `.ann.json` is "written by the team submitting the PR. No second-junior annotation."
Mercy authored v4's and v5's because she was on those PRs, not because it needs a
specialist. §2.3: "The CRUD UI generates the file; humans never hand-author it" — the UI
(`eval/app`, `npm run dev`) pre-fills every `corrected_score` with the judge's and the
annotator changes only what they disagree with.

**Scope when the time comes: 6 tests, 43 scored dimensions** — the run log already picked
the sample (seed 2232): `001`, `011`, `012`, `j4n`, `q7b`, `vqx`.



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
