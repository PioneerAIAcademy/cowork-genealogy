# Survivor's-claim cue for the posthumous-mention arm — plan

> **Status: §0 FAILED (2026-09-07) — this plan does not fix issue #2210. Do
> not implement it as written; do not open a PR.** The session log shows
> `check-warnings` never ran: no `person_warnings` call, no `hasEventAfterDeath1`
> anywhere in 36 entries. The tester's sentence came from `init-project`'s
> step-5 pedigree analysis flagging a `Pension` fact dated after death —
> an error type its own closed list at `init-project/SKILL.md:225` forbids it
> from flagging ("birth after death" is the list's only after-death item).
> Evidence and recommendation posted on #2210 and #2167 (2026-09-07). The
> cue-list gap this plan addresses is real but is **not** this defect; it needs
> its own issue so its paid run is spent deliberately. Two premises this plan
> inherited from the issue are also wrong: the real facts are day-precision
> (450-day gap, so the tag *would* fire), and the fact type is `Pension`, not
> `Military` — legal, because `gedcomx_fact_type_recommended` is an open enum.
>
> Below is retained as the record of what was built and verified, since the
> lead may want the cue-list half split out rather than discarded. Commit
> `f1dbaa376` reverts cleanly.
>
> **Previously — partially implemented (2026-09-07).** Built: all four prose
> sites (§1), the `flynn-widow-pension`
> scenario, the MCP fixture, `ut_check_warnings_v4m`, and the §2e validator
> (proven to fire — six cases, real `pytest.skip`, under the harness venv).
> Free checks green: `make engine-test` (122 files, 2863 passed) and
> `make harness-test` (3210 passed, 5 skipped), with `flynn-widow-pension`
> confirmed collected by name in all three `test_scenario_fixtures.py` lints.
> Not done: §0's session-log check (the bundle is not on this machine) and
> §3 steps 6–10, including the paid run. If §0 fails, this branch is discarded
> — no paid run has been spent on it.
>
> One edit the plan did not anticipate, made during implementation:
> `warnings-as-identity-signals.md:87-93` prescribed unlink for the **whole**
> posthumous category and `:99-101` for any record "about someone else where
> the deceased is merely named" — both of which a survivor's claim satisfies,
> so the new cue contradicted them. Scoped with a two-clause carve-out; the
> no-split half still holds for every cue. This is why §1's four-copy census
> was necessary but not sufficient: the *action* prose is a fifth site, and it
> lives only in that file.
>
> Originally proposed (2026-09-07), **revised after plan-critic round 1**
> (all 8 findings verified against the code and applied; no blocking findings)
> **plus a self-review pass** that added §0b (the ADR-0011 lane question, which
> round 1 did not raise and the plan owed), the `S6` source entry in §2b, and
> the token-discipline bar in §1a,
> issue #2210 (`genealogist`, `reviewed`),
> branch `2210-a-widows-pension-filed-the-year-after-death-is-reported-as-a-date-conflict-survivor-pensions-are-missing-from-the-posthumous-mention-cues`
> (currently identical to `origin/main` at `fe65f1d7c`). Delete this file when
> the PR merges; fold anything durable into
> `docs/specs/person-warnings-tool-spec.md` or the skill's rubric.

Issue #2210's reviewed body is the brief. This plan records what I verified
against the code before writing anything, the four corrections the plan makes
to that body, and the order of operations the paid gate forces.

---

## 0. Blocking prerequisite: the bundle is not on this machine

Step 0 of the issue is a stop-gate, and it cannot start yet.

- The bundle it names — `feedback-2026-09-01T23-13-45-501927Z.zip` — is **not
  in `~/Downloads`** and **not unpacked under `~/feedback/`**. The only bundle
  on this box is `feedback-2026-08-26T21-23-06-618Z`, a different submission.
  It has to be pulled from the Drive link in the issue body first.
- `make feedback-case` shells out to `scripts/setup-feedback-case.sh`
  (`Makefile:803-811`). On this Windows box run
  `scripts\setup-feedback-case.bat` instead — the Makefile's own comment
  (`Makefile:809`) says so.

**Why the gate is real, not ceremonial — the arithmetic checks out.** I
verified the three code sites the issue cites:

- `hasEventAfterDeath` fires on `diff > days` with `days = 365`
  (`packages/engine/mcp-server/src/tools/person-warnings.ts:309-319`), via
  `factDaysDiffLatestLatest` = `latest(any) − latest(death-like)`
  (`packages/engine/mcp-server/src/utils/fact-helpers.ts:421-435`).
- A year-only date resolves to its late edge, 31 December
  (`maxDayNum`, `packages/engine/mcp-server/src/utils/date-helpers.ts:181`).

So a **year-only 1889 death against a year-only 1890 filing is exactly 365
days, and `365 > 365` is false** — the tag does not fire on the tester's dates
as stated. Either their tree carried finer-grained dates, or the sentence they
saw came from a different surface. That is exactly what the session log has to
settle, and it is why no prose may be edited before reading it.

**Candidate other surfaces, if the tag is absent from the log** — name these
when reporting rather than leaving the search open:

- `packages/engine/plugin/skills/conflict-resolution/SKILL.md:100-103` lists
  "an event dated after death" under **Identity conflicts**. It defers the
  classification to check-warnings but can still frame a pair of dates as one
  being wrong.
- `packages/engine/plugin/skills/timeline/` is **ruled out as an edit site**
  and I confirmed why: `timeline/SKILL.md:215-233` and
  `references/timeline-analysis-guide.md:132-141` both route the question to
  check-warnings and restate no cues. (It could still be the *narration*
  surface the tester saw, which is a report, not an edit.)

**Stop rule (unchanged from the issue):** if `hasEventAfterDeath1` is absent
from `_feedback/session-log.jsonl`, post what the log shows on #2210 and
#2167 and edit no skill body. Precedent: feedback case #1536 / PR #2165.
The log may be trimmed from its oldest entries, so "absent" means absent from
a log whose window actually covers the turn that produced the sentence — say
which when reporting.

---

## 0b. Which lane this is, and why the rule is prose at all

CLAUDE.md's lane rule and ADR-0011's "read before you" list both bind here —
ADR-0011 names "answer a compliance failure by strengthening a `SKILL.md`
sentence" and "decide where a new *this must always hold* rule lives", and it
says to apply the ruling and cite it rather than escalate. Cite this section in
the PR.

The change is **two rules in two lanes**, and they answer differently:

- **The cue itself is lane 3** — record-type craft, which belongs in the
  record-type guidance. That is what the issue says and it is right.
- **The action ("not unlink") is lane 4** — doctrine. So it owes ADR-0011's
  first question: *can this be decided by reading the project documents alone?*

**Answer: yes in principle, and it still cannot bind at a write boundary here.**
The source title ("Widow's pension application") is in the project documents, so
a precondition is *conceivable* — a gate on the detach path refusing to drop a
source whose title matches a survivor's-claim shape while the person's death
predates it. It is the wrong instrument for this defect for a reason that is not
about difficulty: **`check-warnings` is read-only and no write occurs in the
reported flow.** The harm the tester reported was a *sentence* — the workbench
told them one of two correct dates was wrong. No `tree_forget`, no
`research_append`, nothing for a precondition to refuse. A gate on the detach
path would be a different (and defensible) piece of work aimed at a different
failure, and it would not have changed one word of what the tester saw.

**§2e is not a gate, and the "production beats eval-only" ruling does not reach
it.** That ruling (ADR-0011, "Rulings that generalize", 2026-09-02, #2030) says
a *gate* that could bind at the writer tool does not ship as a harness validator
instead. §2e refuses nothing and blocks no user; it is the **test instrument**
for a prose rule whose enforcement point does not exist, which is the same role
`test_source_evaluation.py` plays for #1606's detach doctrine. Say this in the
PR body — a reviewer following ADR-0011's read-before list lands on that row and
it looks like a violation until the distinction is drawn.

What follows from the split: the cue is written where record-type craft lives
(§1), and the durable rationale for the action goes to
`docs/specs/person-warnings-tool-spec.md` (§385-397 already owns the mechanism
— fact type is the trigger, not the date), **not** into the skill body.

## 1. The cue list has **four** copies, not three

The issue names three sites. PR #1896's own words were "all four copies of the
cause list agree", and the fourth is real — I grepped every occurrence of the
list's distinctive `city director` token across the plugin:

| # | Site | What it is |
|---|---|---|
| 1 | `packages/engine/plugin/skills/check-warnings/SKILL.md:98` | canonical `hasEventAfterDeath1` posthumous-mention bullet (Cue + Recommended action) |
| 2 | **`.../check-warnings/SKILL.md:120-131`** | the cue list restated inside the **example output** block — *missed by the issue* |
| 3 | `.../check-warnings/references/warnings-as-identity-signals.md:63-78` | the "Examples:" list under "posthumous mentions are NOT identity signals" |
| 4 | `.../check-warnings/references/warning-checks.md:47-56` | the `hasEventAfterDeath1` catalog entry's Cause bullet |

Nothing lints their agreement. Site 2 gets the addition too, phrased as the
example's rendered report would phrase it; leaving it out is how the fifth
copy of this drift starts.

**No fifth copy in the specs.** `docs/specs/person-warnings-tool-spec.md`
carries the *mechanism* (`:385-397`, "the fact type is the trigger, not the
date") and names the three causes in its tag table (`:430`), but enumerates no
cues — checked, so the four-site census stands and the spec needs no cue edit.

Four further hits exist for the token — `conflict-resolution/SKILL.md:307`
(a "continued residence" example), `locality-guide/references/locality-survey-methodology.md:128`,
and `research-plan/references/record-type-guide.md:14` and `:18`. All are
record-type tables or examples, none restates the cue list. No edit.

### 1a. Wording (craft, not a jurisdiction list)

ADR-0012 governs: state the general shape, let the wiki carry per-country
record-type enumerations. Item 2 of the original issue body (bounty-land
applications, US survivors' claims) is withdrawn by the review, and this plan
does not reinstate it.

Site 1 — extend the existing `Cue:` sentence with one clause:

> …, or a survivor's or dependent's benefit claim where the claimant is the
> survivor and the deceased is named to establish the entitlement — the death
> creates the claim, so a filing dated after it is the expected sequence
> rather than evidence against either date.

Site 1 — add a **nested** bullet under the same posthumous-mention bullet, so
the survivor's-claim action is stated without touching the existing action
clause:

> - On the survivor's-claim cue the action is **not** unlink. Keep the source
>   — it is evidence for the deceased — correct the fact it was attached as
>   (the period the file documents, or the survivor's own event), and offer
>   neither the recorded death date nor the filing date as suspect.

**Every clause above is an instruction, not a reason.** CLAUDE.md: no
explanatory prose in a `SKILL.md` — every line is a billed prompt token on
every invocation. An earlier draft of that bullet explained *why* the file is
evidence for the deceased ("documenting the service, the death and the marriage
the claim rests on"); that belongs in the spec (§0b), not the body. Hold the
same bar on sites 2–4 and on the review of this diff.

Sites 2–4 get the same shape, compressed to each site's register (a clause in
the example's parenthetical; one `Examples:` bullet; one clause on the Cause
bullet's list of posthumous records).

**Do not touch** the existing `"Unlink it and treat it as a reference"` clause
at site 1. PR #1896 records it as a protected region owned by issue #1606.
Note for the reviewer: **nothing mechanically protects it** — I grepped for a
protected-region lint and there is none. What exists is
`eval/harness/validators/test_source_evaluation.py:12,84,128`, which asserts
#1606's detach-reservation doctrine from the *other* side. So this is
discipline plus review, and the plan states it rather than relying on a guard.

### 1b. The new cue is an instance of a rule the skill already has

`references/warning-checks.md:40-46` already says: read the date of the
**event** the record describes, not the date the record was created. A widow's
pension file attached as a Military fact dated to its *filing* is precisely
that error. Saying so keeps the addition craft-shaped and short — it names a
new cue for an existing rule rather than introducing a new doctrine.

---

## 2. The unit test

### 2a. Test id — **not** `ut_check_warnings_020`

`docs/specs/unit-test-spec.md:552` and `:350`: ids are the skill name plus a
**random 3-character suffix** from lowercase alphanumerics minus `0`/`o`/`1`/`l`
— sequential ids collide when two people add a test in parallel, and a
duplicate id silently merges two tests' annotations. The corpus is mid-migration
(`ut_check_warnings_001`…`_019` are legacy numerics; `ut_check_warnings_s6v`
is the new shape). The new test takes a random suffix. Uniqueness across the
whole corpus is CI rule 4 in `check_runlogs.py`.

### 2b. Scenario — keep 1908, move the filing to 1909

The issue asks for "a `Military` fact dated 1890 … and a `Death` fact early in
1889". **Deviation, deliberate:** copy
`eval/fixtures/scenarios/flynn-posthumous-residence/` to
`eval/fixtures/scenarios/flynn-widow-pension/` and keep Patrick Flynn's
existing `Death` fact `1908-03-12` (already day-precision). Two edits to
`tree.gedcomx.json`, not one:

1. `F3` → `type: "Military"`, `date: "1909-11-04"`, `sources[0].ref: "S6"`
   with a `page` naming it as the widow's pension application (the existing
   `page` text describes an obituary and must go).
2. **A new `S6` entry in the tree's top-level `sources[]`** — a widow's
   pension application file. Easy to leave out, and nothing would catch it:
   `validate_tree_gedcomx_json` is jsonschema only
   (`eval/harness/harness/schema_validator.py`), with no referential check
   that a fact's `sources[].ref` resolves, so a dangling `S6` lints clean and
   lands as a half-built fixture. The scenario's `research.json` keeps its own
   `sources` namespace and needs no edit.

Leave `S5` in place (the copied scenario's obituary, now unreferenced by any
fact) or drop it — either is consistent, but say which in the README.

Why: "1908" occurs 14 times across that scenario's `research.json` — the
objective, the questions, the log notes and the proof summary. Re-dating the
death to 1889 means rewriting all of it for no eval signal.

**What the day-precision requirement is actually for here.** The issue's "day
precision on both, or the tag will not fire" is a constraint on the **live**
tool at Step 0. In the test it fires nothing: the harness serves every
`person_warnings` call from the MCP fixture, which is exactly why MCP source is
not snapshot-tracked (`eval/harness/harness/snapshot.py:146-153`). So day
precision is here to keep the scenario **internally consistent with the canned
response** — `1908-03-12` → `1909-11-04` is 602 days, which is what a live tool
would have to see to return the tag the fixture returns. A scenario the real
tool would score silent is a fixture contradiction, which is the class of
defect the branch immediately upstream of this one spent a commit closing.

`Military` is a valid simplified-GedcomX fact type
(`docs/specs/simplified-gedcomx-spec.md:362`) and is **not** in the death-like
family, so it cannot raise the anchor and hide itself.

The scenario README must state the Death fact, the Military fact, and that
`S6` is the widow's pension application — the judge is explicitly told it
cannot read `research.json` or `tree.gedcomx.json` and may use only the README
and the tool responses (`eval/tests/unit/check-warnings/rubric.md`, "Grading
constraints"). A cue the judge cannot see is a cue it cannot grade. State no
`- **Label:** N` count bullets in the README — the count lint
(`eval/harness/tests/unit/test_scenario_fixtures.py:126-163`) pins any it finds
to the matching `research.json` array. (It has no purchase on the scenario as
copied: that README states no count bullets at all, so it is a forward-looking
caution, not a constraint the copy already satisfies.)

### 2c. MCP fixture

New `eval/fixtures/mcp/person-warnings-widow-pension.json`. The **response
envelope** is copied verbatim from `person-warnings-posthumous-residence.json`
— `tool`, `args.personId: "I1"`, `response.warningCount`,
`response.warnings[0]` with `scoreType`, `issueType`, `severity`, `personId`,
`personName`, `factIds: ["F1","F2","F3"]`, `message` — same `factIds`, since
the tag cites every fact the person has. That envelope is also what
`packages/engine/mcp-server/tests/packaging/mcp-fixture-shape.test.ts` checks:
it validates the `response` against `person_warnings`' declared return type
derived from source, so copying is the safe route.

**`description` is rewritten, not copied.** The source fixture's reads "a
Residence fact dated 1925 … the obituary of his daughter Mary (Flynn) Brennan …
Used by ut_check_warnings_013." Nothing lints that field and the judge never
sees it, so copying it verbatim lands a fixture silently documenting the wrong
scenario and the wrong test. Rewrite it to name the Military fact, the pension
source `S6`, and the new test id.

### 2d. `judge_context` — one phrasing trap to avoid

The issue's item 4 asks the report to offer "neither date as possibly
incorrect". Stated flatly that contradicts item 3's action, which *is* a date
correction. Precise form:

- names the survivor's-claim cue (a pension claim filed by the widow, in which
  the deceased is named to establish entitlement) as the reason the sequence is
  expected;
- calls neither the recorded **death** date nor the **filing** date wrong — the
  filing date is correct *as a filing date*; what is wrong is its use as the
  date of one of the deceased's own events;
- recommends **keeping** the source and correcting the fact it was attached as;
- recommends **neither** an identity split / same-name-merge rebuild **nor** a
  detach;
- calls `person_warnings` with `personId: "I1"` and treats the tool as the
  source of truth, and says nothing about FamilySearch quality (`I1` is a
  synthetic id — the rubric's quality dimension makes any mention a `partial`).

The rubric has **no** dimension for posthumous-mention cause classification
(confirmed: its four dimensions are Detection accuracy, Severity
classification, Actionability, FamilySearch quality reporting). That gap is
issue #1965 and this plan does not close it. So the judge is not the primary
instrument — §2e is.

### 2e. A deterministic validator, not "read the rationale"

The repo already has the instrument for exactly this doctrine class, from the
same lead ruling (#1606 / PR #2165):
`eval/harness/validators/test_source_evaluation.py`, whose
`test_index_discrepancy_does_not_recommend_detaching` (`:90-133`) splits the
text response on blank lines and asserts no detach term appears in a paragraph
that also names the declared source. Its own docstring says the rule "must not
be left to a judge's mood." `eval/harness/validators/test_check_warnings.py`
today holds only two read-only-enforcement checks.

Add `test_survivor_claim_action_is_not_unlink` there, modelled on that
paragraph-scoped scan:

- **Gate on a `survivor-claim` tag** in the test's `tags`, the way
  `_requires_index_discrepancy` (`:64-68`) gates on `index-discrepancy`. Tags
  reach the validator already — the `test` dict is `spec.raw["test"]` plus a
  named whitelist (`eval/harness/harness/orchestrator.py:548-576`), and `tags`
  lives inside the inner block.
- **Scope the scan** to paragraphs naming the pension source (`S6`, or the
  word "pension"), not the whole reply. The source-evaluation docstring records
  why: an unscoped detach assertion "could never fail" against a corpus that
  legitimately contains a misattached source, and a hedged reply passed a guard
  the rubric graded `partial`.
- **Negative arm only.** Assert the absence of unlink/detach near the pension
  paragraph. Leave "recommends keeping and correcting the fact" to the judge —
  positive text matching on phrasing is the brittle direction.

Two things this deliberately does not do. It does **not** add a top-level test
field: the `index_error_source` pattern would need a line in that orchestrator
whitelist, a `docs/specs/unit-test-spec.md` §5 entry, and a harness test —
worth it at a second survivor-claim test, not at the first. And it costs
nothing against the runlog gate: `eval/harness/validators/` is **not** in
`build_snapshot` (`snapshot.py:158-187` embeds the skill dir, `@plugin:` agents,
`eval/tests/unit/<skill>/**`, referenced scenarios and referenced MCP fixtures
— no validators), so it is free to iterate in the `--test` loop and does not
invalidate the paid run.

---

## 3. Order of operations — the paid gate forces it

Every file this plan touches is snapshot-tracked. `build_snapshot`
(`eval/harness/harness/snapshot.py:122-187`) covers the **whole** skill
directory (so both `references/` files), the whole
`eval/tests/unit/check-warnings/**` (so the rubric and the new test), each
referenced scenario directory, and each referenced MCP fixture. Rule 2 of
`.github/workflows/check-runlogs.yml` blocks the PR unless the latest run
log's snapshot matches the branch. **So the paid run is last, after the final
byte of prose.**

1. Step 0 (§0). Gate. If it fails, stop and report.
2. Prose edits, all four sites (§1).
3. Scenario, fixture, test file (§2).
4. The validator in `test_check_warnings.py` (§2e), and break it once to watch
   it fail — CLAUDE.md, "A new lint must be proven to fail."
5. Free checks: `make harness-test` (picks up `test_scenario_fixtures.py`) and
   `make engine-test` — **not `make test-js`**, which is `pnpm test` over the
   pnpm workspace (`Makefile:308`), and `pnpm-workspace.yaml` negates
   `!packages/engine/**`. `deathlike-family-docs.test.ts` lives under
   `packages/engine/mcp-server/tests/packaging/` and runs from
   `make engine-test` (`scripts/test.sh:74`). It matters here specifically:
   that test extracts the death-like list from both `references/` files by
   regex and fails loudly if the passage was reworded, so it is the check that
   proves the doc lint has not gone vacuous. I confirmed its anchors sit at
   `warnings-as-identity-signals.md:112-113` and at the first `That family is`
   in `warning-checks.md` — both outside the paragraphs being edited — so the
   edits *should* be safe; run it rather than trust that. Then `make test-all`.
6. Cheap single-test validation, no run log committed:
   `cd eval/harness && uv run python run_tests.py --test ut_check_warnings_<sfx> --concurrency 1`.
   Iterate the `judge_context` here, not on the full suite.
7. **In the same free loop, re-run the two tests the wording can collide
   with:** `--test ut_check_warnings_013` and `--test ut_check_warnings_004`.
   013 (`detect-posthumous-residence.json:20`) *requires* the action "unlink it
   from Patrick's own events" — at the same SKILL.md bullet where §1a adds "on
   the survivor's-claim cue the action is **not** unlink." They are separable by
   source type, but that separation now has to survive as prose the model reads.
   004 is the ambiguous-cause test over the same bullet. Both score **3 on all
   seven dimensions** in the current log, so any slip is unambiguous — and a
   slip to `partial` pulls the test into `review_sample`, buying a second $1.76
   run plus a hand annotation. Catch it for free here.
8. The paid full-suite run, **once**:
   `make eval-skill SKILL=check-warnings CONCURRENCY=1`.
9. Annotate through `make eval-ui` only (rule 3), with the branch checked out
   — the UI reads the working tree and will otherwise offer the next-newest
   run.
10. `make test-all` again, PR.

### Cost, reproduced

The issue's figures check out. From the newest committed log,
`eval/runlogs/unit/check-warnings/v1_2026-09-01_12-01-38.json`: **$1.756**,
**1,166,432 ms wall clock (19.4 min)**, **20 tests**, **5** in `review_sample`
(`003`, `005`, `006`, `007`, `016`). The new test makes 21.

Two corrections to the budget as the issue states it:

- **`CONCURRENCY=1` is mandatory on this box and the 19 min is a floor, not
  an estimate.** The harness default is RAM-aware — ~1 slot per 2 GiB, floor
  **1**, cap 8 (`_MIN_AUTO_CONCURRENCY`/`_MAX_AUTO_CONCURRENCY`,
  `run_tests.py:283-285`) — so a 7.9 GiB box resolves to **3**, which hangs
  here and produces phantom regressions. Serial execution of 21 tests will
  take materially longer than the 19 min measured; cost is unaffected.
  (`Makefile:428-429`'s help comment says "floor 4, cap 8". The code is the
  measurement and the comment disagrees with it; #1026's own comment at
  `run_tests.py:281-282` says the floor "must NOT override the RAM measurement
  upward." Worth a one-line correction to that comment while in the tree, or
  flagging in the PR body if out of scope.)
- **`review_sample` can exceed 5.** It is 3 rotation + 1 targeted + 1 random
  **plus every test that failed or scored 1–2 on any dimension**
  (`docs/specs/unit-test-spec.md:1115`), so a new test that grades badly
  enlarges its own annotation bill. Median across the corpus is 6, max 11.

---

## 4. Acceptance

- `_feedback/session-log.jsonl` shows a `person_warnings` response carrying
  `hasEventAfterDeath1` for the tester's person — **or** the work stops at §0
  with a report on #2210 and #2167.
- All four cue-list copies carry the survivor's-claim cue; the
  `"Unlink it and treat it as a reference"` clause is byte-identical to `main`.
- **`test_survivor_claim_action_is_not_unlink` passes on the new test and was
  observed to fail once** against a reply that recommends unlinking (§2e).
  This, not the judge score, is the primary instrument.
- The new test passes on the committed run log, and its judge rationale names
  the survivor's-claim cue rather than reaching the right verdict by another
  route (read the rationale, not just the score).
- `ut_check_warnings_013` and `ut_check_warnings_004` still score 3 on
  Correctness and Completeness, and 013's recommended action is still unlink.
  **One caveat before attributing a slip to this change:** 013's FamilySearch
  quality dimension scored 3 on a reply whose narration was *not* silent about
  the synthetic id, which the rubric's own text grades a `partial`. That
  dimension can move on a re-run for reasons this PR does not touch — read the
  rationale before calling it a regression.
- `make test-all` green; `check-runlogs` rules 1, 2 and 3 green.

## 5. Out of scope, stated so it is not silently dropped

- **No lint for the four-copy agreement.** Writing one is a `nothing-checks`
  developer task, not this PR: it needs a shared token the four sites can be
  keyed on, and three of the four are prose in different registers. Flag it in
  the PR body; the lead decides whether it gets filed.
- **Issue #1965** (no rubric dimension for posthumous-mention cause) stays
  open.
- **Land before issue #2118** (convert `check-warnings` to a skill-agent
  pair), which folds or deletes `references/`.
- **`**Touches:**` on #2210** gains the two `references/` files, per the
  reviewed body.
- **Emailing the tester** (identified in the bundle's `_feedback/feedback.json`
  — the issue author is the lead's account, not the tester) is outward-facing
  and happens after merge, on the lead's say-so.
