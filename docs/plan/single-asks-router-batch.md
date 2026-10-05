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
- **Item 5** (save what the turn finds) is **dropped: already built elsewhere.**
  `search-records` already owns this: it **holds `research_log_append`** in its own
  frontmatter (`:21`), calls it once per search (`:586`), defines the required log-entry
  fields (`:600`), **logs the nil result with `outcome: "negative"` (`:651`)** and carries
  the browse-only pivot rule (`:667`). (Review first cited `:575/:626/:643`; PR #3099
  rewrote this file and moved them. Both sets above were re-verified on this branch.) And "a found record goes
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
2. an open ask ("find the parents of `<PID>`") still routes as a job.

   **Careful about why this matters.** The real risk — `DELIVERY_GUIDANCE` riding every
   turn so only the model's judgment stops a job ending itself `delivered` — can only
   manifest on the **prototype worker**; the guidance is appended in
   `proto/worker/options.py` and the unit harness never sees it. What this unit test
   actually guards is narrower and still worth having: that the new prose does not
   over-classify an open ask as bounded.

**Item 4 gets no in-batch test.** Both its candidates moved to e2e, so its prose rides the
paid run graded only by the base dimensions. Stated rather than left to be discovered.

Both are routing assertions needing a `routes-to:` tag and `test_routes_to_expected_skill`,
**not a judge line**: `route-no-questions.json`'s own `judge_context` says "ROUTING IS NOT
YOURS TO GRADE".

**Move to the e2e corpus:** item 4's already-attached case and item 6's candidate reporting.

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

No fixture in `eval/tests/e2e/` covers either — the corpus genre is the opposite (stripped
trees). Writing them is genealogist work (`author-e2e-fixture`). **Naming them here without
budgeting them would be CLAUDE.md step 4 in disguise**, so they are called out as a
prerequisite card rather than parked as a limitation: item 4 and item 6 ship with their
prose graded only by the paid run and the bundle replay, and their dedicated e2e coverage
is filed separately.

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
