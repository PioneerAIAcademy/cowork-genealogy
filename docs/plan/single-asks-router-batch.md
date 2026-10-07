# Issue #2813 items 1, 4 and 6: the router's bounded/job decision

**Status:** CODE LANDED on `2813-router-bounded-decision` (items 1, 4, 6); **acceptance is
unbought.** The paid `research` unit-eval run named at "Done when" has NOT been run — the
newest log is `eval/runlogs/unit/research/v7`, which predates this branch — so the three
"Provable today" bullets below are not yet proven. The run is deliberately held: #3087 owes a
`research` run on the same snapshot and this work can ride it, which is the difference between
two paid runs and one. Items 3 and 7 remain unbuilt and are blocked as described below. Rewritten after plan-critic returned
five blocking findings on the first draft; what changed is listed at the end.

**Throughout, `main` means `origin/main`.** The local `main` ref in this checkout is ~281
commits behind it.

## Why these three together, and nothing else from #2813

## What a `research` eval run actually costs

The first draft said "~$8-12, 45-65 min", lifted from `docs/specs/task-review-spec.md:210`,
a generic figure for any `make eval-skill`. Measured instead from all twelve committed
`research` run logs (`totals.total_cost_usd`, `totals.wall_clock_ms`):

| | |
|---|---|
| median | **$3.24** |
| range | **$0.58 (5 tests) to $6.09 (15 tests)** |
| per test | **~$0.28 median** |
| wall clock | 3.6 to 55.8 min, median ~15 |

A counter-figure of "$1-2" circulated in review; it came from `v6`/`v7`, which ran **5**
tests each. For a 10-13 test suite the honest expectation is **~$3-4 and ~15-30 minutes**.

**The saving from batching is ~$6.50** (two avoided runs at ~$3.24), not $10 — $10 is the
gross cost of three runs. Plus the break-test runs below, ~$1-2 more via `--only`.

## Why batch, on the corrected number

Three items edit `packages/engine/plugin/skills/research/SKILL.md`, inside the `research`
eval snapshot (`eval/harness/harness/snapshot.py:145-157`). Each separate PR buys its own
run, so three PRs cost ~$6.50 more than one.

**That is a real saving but no longer the main argument.** The stronger one is coherence:
items 1, 4 and 6 are three clauses of one behaviour — decide the request is bounded, start
from what is attached, report candidates rather than a verdict. Split across three PRs, each
lands a rule whose neighbours do not exist yet, and the file's contradictions (below) have
to be re-resolved three times.

**If the reviewer prefers three independent review rounds for ~$6.50, that is defensible and
this plan should be split.** Named here so the call is made on the measured number.

The other three #2813 items are deliberately NOT here:

- **Item 2** (end a bounded turn at its deliverable) **SHIPPED** in PR #3147, merged
  2026-10-05 as `39a1c7ac7`. The `delivered` exit, `research_delivered` and
  `DELIVERY_GUIDANCE` are on `main`.
- **Item 5** (save what the turn finds) is **dropped for THREE of its four clauses, which are
  already built elsewhere. The fourth is not built anywhere** — see below.
  `search-records` already owns this: it **holds `research_log_append`** in its own
  frontmatter (`:21`), calls it once per search (`:586`), defines the required log-entry
  fields (`:600`), **logs the nil result with `outcome: "negative"` (`:651`)** and carries
  the browse-only pivot rule (`:667`). (Review first cited `:575/:626/:643`; PR #3099
  rewrote this file and moved them. Both sets above were re-verified on this branch.) And "a found record goes
  in as a source through
  `record-extraction`" is already routing-table row `research/SKILL.md:186`. The router also
  **holds no tool that writes `research.json` or the tree** (`research/SKILL.md:15-19` grants
  four: `validate_research_schema`, `research_query`, `person_read`, `source_attachments`;
  `:196` states the rule). Stated precisely because `person_read` is NOT read-only in general
  — given a `projectPath` it saves retained memories under `images/` and stages a results
  sidecar (`src/tools/person-read.ts:300-316`, `:137-145`). It is absent from
  `PROJECT_WRITER_TOOLS` (`eval/harness/validators/test_universal.py:1151-1159`), which is the
  set this argument actually rests on, and the easy place to over-read it as "read-only", so item 5 as drafted contradicted its own
  frontmatter. The remaining gap it names, the single-ask path entering neither skill,
  belongs to item 3 and the router re-entry.
- **Item 3** (lightweight project: `init-project` stops after its report on a bounded ask)
  is a different snapshot AND is coordinated with Gennecis on issue #2122, whose conversion
  folds the Step 5 bullet into the agent body so only one line needs making conditional.
  Whichever of #2813-item-3 and #2122 lands second carries the other's edit and re-runs
  `make eval-skill SKILL=init-project`.
- **Item 7** (viewer) costs no eval run at all — `packages/viewer-ui/` is in no snapshot —
  but #2813 says to build it with phase 2's "One view of job state", which is **DONE on the
  unmerged `research-as-a-job-phase2` branch** (29 viewer files, including the `offPlan.ts`
  group item 7 names), not on `main`. It is independent of this batch and should be planned
  separately, against whichever base that work ends up on.

## Blocking dependency

1. ~~PR #3147~~ **MERGED 2026-10-05.** The exit is on `main`.
2. **The router re-entry, still unbuilt.** #2813 item 1 says to put the decision in "the
   router every hosted turn re-enters **under your Before phase 2 section**". That re-entry
   does not exist: `apps/server/app/agent/continue_policy.py:175-181` still carries
   `CONTINUE_REASON`, whose text is "invoke the next GPS sub-skill now" with no router
   re-entry, and the default web path
   never enters the router at all — `apps/web/src/components/chatEvents.ts:114` prefixes
   every new session's first message with `OPENING_TURN`, so `init-project` runs and nothing
   in that chain invokes `research`.

**Consequence for acceptance:** on the web path a bounded FIRST message never reaches this
file. Only a **`/research` entry** (and the e2e orchestrator) provably enters the router — a
second message on an existing project does NOT, because the router's contracts "hold only if
the model happens to choose it", and issue #2927 measured it skipped about half the time.
Acceptance is scoped to `/research` entry alone.

**Cowork is out of scope, and that is consistent.** The router's own `description` says not
to use it when the user targets one step only, so in Cowork a bounded ask routes straight to
`search-records` and never reads these sections. That matches the delivered exit being
prototype-only. Pricing a description change is a separate decision, not taken here.

**The fifth stop condition has to be worded carefully.** PR #3147 deliberately kept
`research_delivered` out of skill bodies, so the new stop condition can only say "end your
turn" — it must NOT name the tool. On the hosted path a toolless voluntary stop is vetoed
and nudged with `CONTINUE_REASON` ("invoke the next GPS sub-skill now"), which contradicts
the rule being added mid-run. The pairing works only because the per-turn `DELIVERY_GUIDANCE`
names the tool; the prototype-worker acceptance bullet is what catches it if the two drift.

## The one design question to settle BEFORE writing prose

CLAUDE.md's lane rule and ADR-0011 both say prose is the **last** resort, and ADR-0011's
first question is: *can this be decided by reading the project documents alone?* If yes, it
is a writer-tool precondition, where it binds everywhere and cannot be argued with.

Apply that question to each item honestly:

- **Item 4 — DECIDED, not deferred.** The first draft floated this and left it to the
  reviewer; that was ducking, because ADR-0011 is a decision *procedure*, and the draft ran
  it, reached an answer, then handed the answer over. The decision:
  - **Item 4 ships as prose here**, labelled guidance per ADR-0011's layer map.
  - **A refusal on the search tools is REJECTED**, under ADR-0011 limit 1 (`:311`): a semantic gate
    must prefer a false allow to a false deny, and refusing a search because a same-type
    source is already attached false-denies a second record, a re-search after a correction,
    and a verification pass. `record_search` also writes nothing, so there is no state
    transition for a writer-tool precondition to own.
  - **What IS a genuine step-1 fit** is ADR-0011's bridge (`:129`): the duplicate lands as a
    `research_append` source op, and "this source is already attached to this person" is
    decidable from `research.json` alone. **But that lands in open issue #2475's territory**
    (the parent card for `research_append` preconditions), so per CLAUDE.md's ladder this is
    a **step 3 — comment on the issue that already covers it**, not a fresh card. The
    implementing PR must actually post it; "names a separate card" discharges nothing.
  - **Scope limit, stated:** that precondition can only see *project-local* duplicates.
    Item 4's evidence case is a source attached **on FamilySearch**, readable only through
    `person_read`/`source_attachments` over the network, which no writer-tool precondition
    can reach. The card complements item 4; it does not enforce it.
- **Item 1** (is this request bounded?) is a routing judgment about the user's *message*,
  not about project state. No tool can read it. Prose is correct here.
- **Item 6** (candidates not verdicts) is judgment about how to report. Prose is correct.

## Where each edit goes, read from the pre-change file (457 lines; 527 after this branch)

### Item 1 — the bounded/job decision

New section immediately **before** `## What to do` (line 77), after
`## Direct user requests name a destination, not a shortcut` (line 61). That placement is
load-bearing: #2813 says "the router's **first** decision", and `## What to do` step 1 is
currently `research_query`. The new section must say the decision happens before that query,
because a bounded ask should not pay for a routing survey it will not use.

Content, from the issue verbatim:
- **Bounded:** one deliverable — finding a record, reviewing a person's attached sources,
  same-person/merge, a hint verdict, a transcription, where the records are for a place and
  period, a research plan, or a records-request letter.
- **A job:** everything else, routed exactly as today.

**Four sections of this file contradict the new rules outright.** The first draft named
only `## Direct user requests`, the weakest of them:

| line | current text | collision |
|---|---|---|
| 35 | "This is how every run behaves; **it is not a mode and no flag turns it on**." | a bounded/job split is exactly a mode |
| 58 | "The user can type at any time... **Neither is something you stop and wait for**." | item 6 requires an offer the run waits for |
| 418 | "**These four are the *only* stop conditions.**" | item 1's bounded exit is a fifth |
| 61-66 | naming a destination means "drive the routing table forward to that outcome" | a bounded ask also names a destination |

The last is real but understated in the draft: *"Create a research plan for Mary Hales but
leave it at that"* both names a destination and is bounded. That is PR #3147's own
acceptance case. Resolve it by name: naming a destination says *where* to end; bounded says
*whether to continue past it*.

### Item 4 — start from what is attached

Inside `## What to do`, as a step before any search routing. Pending the design question
above, the prose form is: before routing to a search skill, read the subject's attached
sources and relatives (`person_read`, `source_attachments`).

### Item 5 — save what the turn finds

Inside `## What to do`'s routing table region. A found record routes to `record-extraction`;
a search that found nothing writes a negative `research_log_append` entry naming collection,
place, years and names searched. The reply then names what was saved and where.

**CORRECTION (2026-10-06), after re-checking rather than re-asserting.** This plan dropped item
5 whole, on the claim that it is "already implemented in `search-records/SKILL.md`". That holds
for three clauses: the record-extraction route, the negative log entry, and the reply naming
what was saved (`search-records/SKILL.md:686`, "Summarize what was searched and what was
found"). It does **not** hold for the fourth:

> An extraction that gets interrupted is either finished or named in the reply as unsaved.

`grep -rn interrupted packages/engine/plugin/skills/ packages/engine/plugin/agents/` returns
**nothing**. That clause is implemented in no skill and no agent. It is not in this PR either,
and this PR never claimed it: item 5 is out of scope here. What was wrong was the *reason*
given for dropping it, which would have told the next reader there was nothing left to do.

Whoever picks item 5 up should also decide where it belongs, which is not obvious: the clause
is a property of the REPLY, and the orchestrator writes the reply while `record-extraction`
owns the extraction. Note that the foreground-delegation arm added in this PR narrows the
window — a delegation now completes before the turn moves on — but it does not close it, since
a turn can still be cut by the patron or by a timeout.

### Item 6 — candidates, not verdicts

New subsection under `## When to stop` (line 394), because it is a stopping rule: give each
candidate with match strength and what was searched, never declare the question answered on
a name match, and end with an offer to research it fully.

## Tests

`research`'s own unit suite is `eval/tests/unit/research/`. On `main` it holds:
`autonomous-handoff.json`, `negative-indexed-search.json`, `negative-no-project.json`,
`negative-research-plan.json`, `route-no-questions.json`.

**Those test files are themselves inside the snapshot**, so adding tests costs nothing
extra once the run is already being bought — but it does mean the tests must be written
BEFORE the run, not after, or the run grades a tree the tests are not in.

`eval/tests/unit/research/README.md` opens: *"This suite grades **a single routing decision
in fresh context**."* Every callee is stubbed — `route-no-questions.json` carries nine
`stub_skills` entries. That rules out three of the first draft's five tests:

- item 4's "no `record_search` call" — `search-records` is stubbed, so the assertion passes
  whether or not the rule exists. **Non-falsifiable here.**
- item 6's "candidates with match strength" — the reporting happens downstream of a stub.
- item 5's test goes with item 5.

Also: `research_delivered` is **not advertised in the unit harness at all**
(`eval/harness/harness/mock_mcp.py`, absent from `LIVE_TOOLS`), so "the turn ends
`delivered`" is unobservable here and must not appear in a unit-test description.

**Keep in `eval/tests/unit/research/` — two tests:**
1. a bounded ask routes to its deliverable, not into the plan/question chain;
2. an open ask ("find the parents of `<PID>`") still routes as a job.

   **Careful about why this matters.** The real risk — `DELIVERY_GUIDANCE` riding every
   turn so only the model's judgment stops a job ending itself `delivered` — can only
   manifest on the **prototype worker**; the guidance is appended in
   `proto/worker/options.py` and the unit harness never sees it. What this unit test
   actually guards is narrower and still worth having: that the new prose does not
   over-classify an open ask as bounded.

**Item 4 gets no in-batch test.** ~~Both its candidates moved to e2e~~ **SUPERSEDED during
implementation:** item 4 is covered in-batch by `ut_research_021`, deterministically. The
premise here was wrong. It assumed the unit harness could not drive `person_read` /
`source_attachments` because neither is in `mock_mcp.LIVE_TOOLS`; in fact `mock_mcp.py:1094`
registers a non-`LIVE_TOOLS` tool for any test that declares a fixture for it, so the gap was
one fixture wide.

Both are routing assertions needing a `routes-to:` tag and `test_routes_to_expected_skill`,
**not a judge line**: `route-no-questions.json`'s own `judge_context` says "ROUTING IS NOT
YOURS TO GRADE".

~~**Move to the e2e corpus:** item 4's already-attached case and item 6's candidate
reporting.~~ **Both landed in the unit suite instead** — see the superseded note above and
item 13 of "What changed".

`eval/tests/unit/research/README.md` is itself in the snapshot and must be updated — it
tracks test IDs, the `routes-to:` convention and a "what is NOT covered" register that two
new tests make wrong.

## Verification

- `make harness-test` **from the REPO ROOT**. The target exists only in the root
  `Makefile` (:778) and does the `cd eval/harness` itself; there is no Makefile under
  `eval/harness/`. The rule that needs the cd is **bare pytest**: run from the root it
  fails `test_calibrate_judge_does_not_import_agent_sdk` with "No module named 'e2e'"
  (its subprocess inherits the cwd), an artifact that reads exactly like a regression.
  An earlier draft stated this backwards.
- `npx vitest run tests/packaging` in `packages/engine/mcp-server` — `prompt-budget` will
  red until `prompt-sizes.json` is regenerated, because SKILL.md's byte count changes.
  **Regenerate with `UPDATE_PROMPT_SIZES=1`, never by hand.**
- `~/.claude/projects/-home-praise-cowork-genealogy/mutation-check.sh` with the suite that
  GUARDS these files (the harness suite, not the engine one). **It lives outside the repo**,
  so a `git grep` for it returns nothing — review flagged it as non-existent on exactly that
  basis. It is real and was used earlier in this workstream.
- **Break each new rule in BOTH directions** (CLAUDE.md: a guard fails two ways). Revert each
  rule, confirm its paired test reds; then confirm a legitimate variant still passes.
- **The paid run is the acceptance.** `make eval-skill SKILL=research`, once. ~$3-4.

## Done when

Each bullet names the environment that checks it, because none holds everywhere.

**Provable today:**
- **(unit)** a bounded ask entering via `/research` routes to its deliverable and does not
  enter the question/plan chain.
- **(unit)** "find the parents of `<PID>`" still routes as a job.
- **(prototype worker)** a bounded turn ends `delivered`. Not observable in Cowork, in e2e,
  or in the unit harness.
- **(feedback-bundle replay)** `make feedback-case ZIP=feedback-2026-09-22T15-47-39…zip`
  then `/compare-state`: each of its four single asks leaves a source or a scoped negative
  in `research.json`. **This is #2813's own Done-when bullet** and it uses an artifact that
  already exists — unlike the two below.

**Needs a fixture that does not exist yet, and is therefore NOT acceptance for this batch:**
- a lookup whose answer is already attached answered from that source;
- an identity ask returning candidates with match strength.

**SUPERSEDED. No card was filed and none is needed.** The reasoning above reached for
CLAUDE.md step 4 because this plan said "card", and never re-tested its own premise. Both
rules are now covered in the unit suite, in the PR that implements them, which is step 1:

- item 4 -> `ut_research_021` (`attached-before-searching.json`), **deterministic**, graded off
  the MCP call log and the hand-off list by `test_reads_attachments_before_searching`.
- item 6 -> `ut_research_022` (`candidates-not-verdicts.json`), **judge-graded on purpose**,
  because every part of that rule is a property of the reply and a deterministic check there
  could only assert something that cannot fail.

What the e2e corpus would still add is a LIVE subject rather than a fixture one. That is a
genuine difference and it is written into `eval/tests/unit/research/README.md`, but it is not
a coverage hole and does not need a card to hold it.

**What item 5's drop loses, recorded so it is not silently gone:** item 5 also carried a
reply contract — "the reply names what was saved and where", and "an interrupted extraction
is either finished or named in the reply as unsaved". That exists nowhere in
`search-records` and is not covered by this batch.

Dropped from the first draft: *"a bounded first message creates a project with no questions
and no plans"* — that is **item 3's** acceptance, because the web path's first message never
reaches this file.

## What changed from the first draft

1. **Cost corrected** from an inflated generic figure to the measured median ($3.24), and
   the batch re-argued on coherence rather than money.
2. **Item 5 dropped** — three of its four clauses are already implemented in
   `search-records/SKILL.md` (the fourth is implemented nowhere; see the correction under
   "Item 5"), and the router
   holds no writer tool.
3. **Three of five tests moved** to e2e; non-falsifiable in a suite that stubs every callee.
4. **Four colliding sections named**, where the draft named one.
5. **Item 4 decided** rather than deferred, with the search-tool refusal rejected under
   ADR-0011 limit 1 and a `research_append` precondition named as a separate card.
6. **The router re-entry added** as the live blocking dependency; #3147 has merged.
7. **`mutation-check.sh` kept, with its real path** — review called it non-existent on a
   `git grep` that could not see outside the repo.
8. **The hosted alpha taught the `delivered` signal**, which this plan did not call for.
   Found by the open-break pass: the section tells the model to stop when a bounded request
   is met, and `real_agent.py` vetoed exactly that stop and injected `CONTINUE_REASON` — so
   on a LIVE plane the new rule produced the thrash it exists to end. The scope ruling that
   kept the alpha on phase-1 behaviour rested on no caller needing it, and item 1 is that
   caller, so the premise lapsed. Re-ruled 2026-10-06 on the lead's own Done-when; the struck ruling was his (496566c29). `DELIVERED_TOOL`,
   `DELIVERED_REASON` and `DELIVERY_GUIDANCE` all moved into `continue_policy.py` so the two
   planes cannot drift apart. The guidance move was a second catch on the same work: the
   first cut wired the alpha's halt arm but not its prompt, and an arm the model is never
   told to trigger is inert in exactly the way the arm was added to fix.
9. **A delegation edge registered.** Sending a bounded transcription to
   `@plugin:image-reader` created `research -> image-reader`, which
   `agent-delegation-framing.test.ts` requires be declared with the sentence that keeps the
   caller's expectation out of the hand-off. Caller side is exempt (the delegation names a
   destination and nothing about content); the agent-side anti-slant pin carries it.
10. **A pre-existing red fixed in passing** — `scripts/setup-feedback-case.sh` reported an
   empty `feedback.json` as "the tester left blank", because `jq -er` exits 0 on an empty
   file. Found while running `make feedback-case`, which this plan names only as a Done-when
   bullet. CLAUDE.md step 1: fixed in the PR that found it rather than filed.
11. **Item 6 gained a clause the content list did not carry** — "never an offer to extract,
   attach, or link". Added to resolve a cross-file tension with `search-records/SKILL.md:435`,
   which forbids offering extraction while an identity is unsettled. The offer this skill
   makes is to *research* further, and saying so is what keeps the two files consistent.
12. **Item 4 was briefly narrowed to bounded requests and is now back to the issue's scope.**
   Issue #2813 item 4 says "Before **any** search"; the first cut scoped the rule to bounded
   requests only, which would have left a job re-searching records already attached — the
   exact waste the item targets. Caught by drift-critic against this plan.
13. **The two "move to e2e" items came back into the unit suite**, and no card was filed.
   `ut_research_021` covers item 4 deterministically; `ut_research_022` covers item 6 as an
   openly judge-graded reply test. The plan's premise for deferring them was wrong:
   `mock_mcp.py:1094` registers a tool outside `LIVE_TOOLS` for any test that declares a
   fixture, so item 4's rule was one fixture away from testable, not one paid e2e run away.
   Item 4's fixture also had to be NEW — the existing `person-read-driscoll-attached-sources`
   predicate requires `sourceDescriptions: true`, and `matches()` demands every predicate key
   be present, so a router omitting that optional argument would have been refused rather than
   answered, which is the wrong failure for this test.
14. **`ut_research_019`'s subject changed** from `GJ72-9WD` to "Patrick Flynn". The scenario it
   runs on is `empty-project-just-created`, whose objective is Patrick Flynn and whose tree
   holds `I1`; `GJ72-9WD` appears nowhere in it, so the router was being asked about a stranger
   and could red the test by reasonably asking who that was. Raised by open-break as 019's one
   soft spot.
15. **Delegations forced to the foreground on the hosted alpha** — not in this plan, and added
   because the lead reported two live incidents on #2813 while the branch was open (alpha
   feedback #3156 and #3159). The Stop hook nudges a turn that is waiting on its own background
   subagent, and the model answers by spawning a duplicate: duplicate `q_001`/`q_002` in the
   first, and in the second four record-extractors relaunched synchronously while the background
   copies ran on, costing an orphaned source, a 56-minute hung extractor and ~20 minutes of
   duplicate work. The prototype has forced the foreground since the 2026-09-23 lead ruling
   (reaffirmed 2026-09-29); the alpha never got it, which is why both incidents are platform web.
   `DELEGATION_TOOLS` moved to `continue_policy.py`, the arm was added to `_pretool_hook`, and
   `Agent`/`Task` were added to `_PRETOOL_MATCHER` — an arm the matcher does not reach is inert
   with the suite green. Kept in this PR rather than split out: same two files, same class of
   defect as the `delivered` port (a prototype mechanism the alpha never received), and a second
   PR would touch the same hook. This is the lead's option B; option A, teaching the hook which
   subagents are live, is strictly more machinery for a problem option B already closes.

## Explicitly not in this plan

Items 2, 3 and 7 (see above). Any change to the search tools themselves — that is the open
design question for item 4 and is a reviewer decision, not a silent expansion. Any change to
`research-as-a-job-phase2`.
