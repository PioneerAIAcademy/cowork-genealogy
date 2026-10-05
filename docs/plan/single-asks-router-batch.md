# Issue #2813 items 1, 4 and 6: the router's bounded/job decision

**Status:** PENDING — not yet built. Plan only. Rewritten after plan-critic returned
five blocking findings on the first draft; what changed is listed at the end.

**Throughout, `main` means `origin/main`.** The local `main` ref in this checkout is ~281
commits behind it.

## Why these four together, and nothing else from #2813

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
- **Item 5** (save what the turn finds) is **dropped: already built elsewhere.**
  `search-records` already owns this: it **holds `research_log_append`** in its own
  frontmatter (`:21`), calls it once per search (`:586`), and defines what counts as a nil
  result and what the sidecar must contain (`:604`). (Review cited `:575/:626/:643` for
  this; those line numbers are wrong — verified against the file.) And "a found record goes
  in as a source through
  `record-extraction`" is already routing-table row `research/SKILL.md:142`. The router also
  **holds no writer tool** (`research/SKILL.md:15-17` grants only `validate_research_schema`
  and `research_query`; `:152` states it), so item 5 as drafted contradicted its own
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
file. Every acceptance bullet is therefore scoped to a turn that provably enters the router
— a `/research` entry, or a second message on an existing project.

## The one design question to settle BEFORE writing prose

CLAUDE.md's lane rule and ADR-0011 both say prose is the **last** resort, and ADR-0011's
first question is: *can this be decided by reading the project documents alone?* If yes, it
is a writer-tool precondition, where it binds everywhere and cannot be argued with.

Apply that question to each item honestly:

- **Item 4 — DECIDED, not deferred.** The first draft floated this and left it to the
  reviewer; that was ducking, because ADR-0011 is a decision *procedure*, and the draft ran
  it, reached an answer, then handed the answer over. The decision:
  - **Item 4 ships as prose here**, labelled guidance per ADR-0011's layer map.
  - **A refusal on the search tools is REJECTED**, under ADR-0011 limit 1: a semantic gate
    must prefer a false allow to a false deny, and refusing a search because a same-type
    source is already attached false-denies a second record, a re-search after a correction,
    and a verification pass. `record_search` also writes nothing, so there is no state
    transition for a writer-tool precondition to own.
  - **What IS a genuine step-1 fit** is ADR-0011's bridge: the duplicate lands as a
    `research_append` source op, and "this source is already attached to this person" is
    decidable from `research.json` alone. That is a **separate card**, with limit 2's corpus
    replay as its own acceptance. Not folded in here.
- **Item 1** (is this request bounded?) is a routing judgment about the user's *message*,
  not about project state. No tool can read it. Prose is correct here.
- **Item 6** (candidates not verdicts) is judgment about how to report. Prose is correct.

## Where each edit goes, read from the current file (457 lines)

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
2. an open ask ("find the parents of `<PID>`") still routes as a job. **The one most at
   risk** — `DELIVERY_GUIDANCE` rides every turn, so only the model's judgment stops a job
   ending itself `delivered`.

Both are routing assertions needing a `routes-to:` tag and `test_routes_to_expected_skill`,
**not a judge line**: `route-no-questions.json`'s own `judge_context` says "ROUTING IS NOT
YOURS TO GRADE".

**Move to the e2e corpus:** item 4's already-attached case and item 6's candidate reporting.

`eval/tests/unit/research/README.md` is itself in the snapshot and must be updated — it
tracks test IDs, the `routes-to:` convention and a "what is NOT covered" register that two
new tests make wrong.

## Verification

- `make harness-test` (from `eval/harness`, never the repo root — from the root
  `test_calibrate_judge_does_not_import_agent_sdk` fails with "No module named 'e2e'",
  an invocation artifact that reads exactly like a regression).
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

Each bullet names the environment that checks it, because none holds everywhere:

- **(unit)** a bounded ask entering via `/research` routes to its deliverable and does not
  enter the question/plan chain.
- **(unit)** "find the parents of `<PID>`" still routes as a job.
- **(e2e)** a lookup whose answer is already attached is answered from that source.
- **(e2e)** an identity ask returns candidates with match strength and what was searched,
  and does not declare the question answered on a name match.
- **(prototype worker only)** a bounded turn ends `delivered`. Not observable in Cowork, in
  e2e, or in the unit harness.

Dropped from the first draft: *"a bounded first message creates a project with no questions
and no plans"* — that is **item 3's** acceptance, not this batch's, because the web path's
first message never reaches this file. And *"one run bought, not four"*, which is a property
of the PR's shape, true by construction, and therefore not a criterion.

## What changed from the first draft

1. **Cost corrected** from an inflated generic figure to the measured median ($3.24), and
   the batch re-argued on coherence rather than money.
2. **Item 5 dropped** — already implemented in `search-records/SKILL.md`, and the router
   holds no writer tool.
3. **Three of five tests moved** to e2e; non-falsifiable in a suite that stubs every callee.
4. **Four colliding sections named**, where the draft named one.
5. **Item 4 decided** rather than deferred, with the search-tool refusal rejected under
   ADR-0011 limit 1 and a `research_append` precondition named as a separate card.
6. **The router re-entry added** as the live blocking dependency; #3147 has merged.
7. **`mutation-check.sh` kept, with its real path** — review called it non-existent on a
   `git grep` that could not see outside the repo.

## Explicitly not in this plan

Items 2, 3 and 7 (see above). Any change to the search tools themselves — that is the open
design question for item 4 and is a reviewer decision, not a silent expansion. Any change to
`research-as-a-job-phase2`.
