This suite grades **a single routing decision in fresh context**. It cannot
see compaction decay. It guards against routing **edits** — someone changing
the table and breaking a route — not against the decay the §5.3 rule audit
measured (`docs/plan/research-performance-2026-07-27.md`, "Rule audit — only
unanchored prose decays"). Do not cite this suite as coverage for compaction
decay.

## Test naming

- `ut_research_001` – `ut_research_010`: trigger tests (phase 1a). Positive
  and negative tests for whether the router skill activates at all. Only 005
  and 008 remain.
- `ut_research_011`+: routing tests (phase 2). Positive tests that assert
  which callee the router hands off to first, given a specific research.json
  state. Each uses `execution.stub_skills` so the callee is denied at the
  `PreToolUse` hook, whether the router reaches it by a `Skill` call or, for a
  callee converted to an agent, by a spawn.

## Deleted activation tests (issue #2984)

`ut_research_001`, `002`, `003`, `004`, `012`, `013` and `014` were deleted on
2026-10-01 (`015` too; see "Paired rows"). All seven were `xfail` for one defect: `research` and
`project-status` both match a "drive the workflow forward" request, so the
orchestrator is skipped about half the time (issue #2927). Under single-run
grading that made each one a coin flip on every `research` run. Issue #2927
needs new acceptance tests when it lands; git history has the old files.

## Routing tests — tag convention

Routing tests carry a `routes-to:<name>` tag. The deterministic
validator (`eval/harness/validators/test_research.py`) parses this tag and
asserts the router's first hand-off matches: a `Skill` call or a main-thread
agent spawn, in call order (`handoffs`, `skill_runner.py`). `routes-to:stop`
means the router should finish without handing off at all.

A `stub_skills` entry may name an agent with no skill directory. That is how a
routing test keeps working when its callee is converted from a skill to an
agent: the hook denies the spawn exactly as it denies a `Skill` call. A name
that is still a skill is stubbed at its `Skill` call only.

## What is NOT covered (and why)

Two routing-table rows are blocked on #1492 (research/SKILL.md reconciliation):

- **Row 14 post-verdict**: the `address_first` verdict handler has two
  contradictory tables. The routing decision TO `proof-critique` is testable;
  the handler for its return is not.
- **Row 16**: who writes `project.status = "completed"` — the routing table,
  the ownership validator, the tool comments, and the empirical run logs all
  disagree. Cannot test until the ruling lands.

## Paired rows

`research-exhaustiveness`, `proof-conclusion` and `person-evidence` are routed
by an `Agent` spawn of `@plugin:<name>`, not by a `Skill` call (#2075). A
`routes-to:` tag now observes a spawned row, because the validator reads
`handoffs`.

`ut_research_015` (`route-shortcut-guard.json`) was the only test tagged
`no-shortcut`, and it was deleted on 2026-10-01 (issue #2984): it failed 9 of 19
committed runs on a real router defect, spawning `person-evidence` and
`research-exhaustiveness` directly instead of walking the table from the top
(recorded on issue #2927; the test's old note cited #2272, a closed
person-evidence card). `test_no_paired_skill_shortcut`
(`validators/test_research.py`) is still correct and still runs, but **no test
exercises it now**. A replacement test is needed before anyone can claim the
shortcut is fixed; git history has the old file, including why it kept the paired agents in `stub_skills`.

That validator is not redundant with `test_routes_to_expected_skill`, which
asserts only the first hand-off. A router that calls `Skill(question-selection)`
first and *then* spawns `@plugin:proof-conclusion` passes it green.

## Bounded requests (issue #2813)

`ut_research_018` (`open-ask-still-a-job.json`) and `ut_research_019`
(`bounded-ask-not-a-job.json`) pin the two directions of the "Bounded request or
job" section: an open ask must still walk the routing table, and a bounded ask
must not enter the question/plan chain. They are paired deliberately — neither
passes a body that classifies everything one way.

Both are deterministic routing assertions (`routes-to:` + `test_routes_to_expected_skill`
for 018; absence of a question-selection call for 019), not judge-graded, per this
suite's own rule that routing is not the judge's to grade.

**What they do NOT cover, and cannot:** that a bounded turn ends with the
`delivered` outcome. `DELIVERY_GUIDANCE` is appended only in the prototype worker
and `research_delivered` is not in this harness's `LIVE_TOOLS`, so the outcome is
unobservable here. That half is prototype-only acceptance.

## Moved negatives (issue #2268)

`ut_research_016` (negative-research-plan.json) and `ut_research_017`
(negative-indexed-search.json) were moved from `eval/tests/unit/search-images/`
when the search-images thin skill was deleted. Both are `grade_on_invariant`
negatives whose tags (`no-browse-no-write`, `no-browse-on-indexed`) gate
deterministic validators now in `validators/test_research.py`. They test
that the research router does not trigger a browse when the request belongs
to research-plan or search-records.

A live `make e2e-run` remains the only end-to-end instrument.
