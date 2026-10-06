# Issue #2813 items 1, 4, 5 and 6: one batch, one paid run

**Status:** PENDING — not yet built. Plan only.

**Throughout, `main` means `origin/main`.** The local `main` ref in this checkout is ~281
commits behind it.

## Why these four together, and nothing else from #2813

All four edit `packages/engine/plugin/skills/research/SKILL.md`, which is inside the
`research` eval snapshot (`eval/harness/harness/snapshot.py`: a snapshot covers
`skills/<skill>/**`, the agents a SKILL.md names via `@plugin:`, `eval/tests/unit/<skill>/**`,
and the scenarios + MCP fixtures those reference). **Any edit to that file buys a paid run
(~$8-12, 45-65 min).** Four separate PRs would buy four. Batched, they buy one.

The other three #2813 items are deliberately NOT here:

- **Item 2** (end a bounded turn at its deliverable) is already built and is PR #3147, now
  in review. This batch depends on it.
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

**This batch cannot land before PR #3147.** Item 1's whole purpose is to decide *which*
turns are bounded; item 2's exit is what a bounded turn then uses to stop. The exit
(`research_delivered`, `DELIVERY_GUIDANCE`, the `PreToolUse` arm) exists only on #3147's
branch. Writing item 1 against a `main` without it would describe a stop that cannot happen.

**Do not start the eval run until #3147 has merged.** Same reasoning as the #3077 hold: a
run bought against a tree that is about to change is bought twice.

## The one design question to settle BEFORE writing prose

CLAUDE.md's lane rule and ADR-0011 both say prose is the **last** resort, and ADR-0011's
first question is: *can this be decided by reading the project documents alone?* If yes, it
is a writer-tool precondition, where it binds everywhere and cannot be argued with.

Apply that question to each item honestly:

- **Item 4** ("before any search, read the person's attached sources and relatives; never
  search for a record already attached; never offer to add a person already in the tree").
  The "already attached" and "already in the tree" halves ARE decidable from the project
  documents alone. **This is the one item with a real claim to being a tool precondition
  rather than prose.** The plan's position: raise it explicitly in the PR body and in review
  rather than silently choosing. A precondition on the search tools would bind in Cowork and
  the harness too, where prose does not; but it is also a larger change touching tools this
  issue does not list under **Touches:**, so it may be a separate card. **Decide with the
  reviewer; do not expand scope unilaterally.**
- **Item 1** (is this request bounded?) is a routing judgment about the user's *message*,
  not about project state. No tool can read it. Prose is correct here.
- **Item 5** (save what the turn finds) is partly mechanical — "a record that is found goes
  in as a source through `record-extraction`" names an existing skill — and partly judgment
  ("a search that finds nothing goes in as a negative log entry that names its scope").
  Prose for the routing half; the scope fields are a `research_log_append` shape question.
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

The existing `## Direct user requests` section is the nearest neighbour and must not be
contradicted: it says naming a downstream skill is "drive the routing table forward to that
outcome", NOT permission to invoke it immediately. A bounded ask is a different thing from
naming a destination, and the new section has to say so explicitly or the two rules collide.

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

At least one new test per item, each with a judge line that can fail:
- item 1: a bounded first message does not produce questions or plans.
- item 1 negative: an open ask ("find the parents of <PID>") still routes as a job. **This
  is #2813's own "Open asks still run as jobs" acceptance and the thing most at risk** —
  `DELIVERY_GUIDANCE` rides every turn, so only the model's judgment stops a job ending
  itself `delivered`.
- item 4: the answer already attached is answered from that source with no `record_search`.
- item 5: a nothing-found search leaves a negative log entry naming its scope.
- item 6: an identity ask returns candidates with match strength, not a verdict.

## Verification

- `make harness-test` (from `eval/harness`, never the repo root — from the root
  `test_calibrate_judge_does_not_import_agent_sdk` fails with "No module named 'e2e'",
  an invocation artifact that reads exactly like a regression).
- `npx vitest run tests/packaging` in `packages/engine/mcp-server` — `prompt-budget` will
  red until `prompt-sizes.json` is regenerated, because SKILL.md's byte count changes.
  **Regenerate with `UPDATE_PROMPT_SIZES=1`, never by hand.**
- `mutation-check.sh` with the suite that GUARDS these files, i.e. the harness suite, not
  the engine one.
- **The paid run is the acceptance.** `make eval-skill SKILL=research`, once, after #3147
  has merged.

## Done when

- A bounded first message with a PID creates a project with no questions and no plans, and
  the turn ends `delivered`.
- "find the parents of <PID>" still invokes `research` and runs as a job, and does **not**
  end `delivered`.
- A lookup whose answer is already attached answers from that source and makes no
  `record_search` call.
- A nothing-found search leaves a negative log entry naming collection, place, years and
  names.
- An identity ask returns candidates with match strength and what was searched, and does not
  declare the question answered on a name match.
- One `research` run bought, not four.

## Explicitly not in this plan

Items 2, 3 and 7 (see above). Any change to the search tools themselves — that is the open
design question for item 4 and is a reviewer decision, not a silent expansion. Any change to
`research-as-a-job-phase2`.
