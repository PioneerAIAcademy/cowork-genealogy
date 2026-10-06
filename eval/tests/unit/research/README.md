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

`ut_research_019` (`open-ask-still-a-job.json`) and `ut_research_020`
(`bounded-ask-not-a-job.json`) pin the two directions of the "Bounded request or
job" section: an open ask must still walk the routing table, and a bounded ask
must not enter the question/plan chain. They are paired deliberately — neither
passes a body that classifies everything one way.

**Both are deterministic, and both were briefly not.** Each carries a `routes-to:`
tag and so fires `test_routes_to_expected_skill`, which reads hook records rather
than the model's narration: 019 `routes-to:question-selection`, 020
`routes-to:image-reader`. 020 was first written with the `routing` tag and no
`routes-to:` tag — the one combination that validator *skips* (`test_research.py:58`),
and a skipped validator records `passed=True`. It was therefore judge-only while
three places (this README, the commit message, the plan) claimed it was
deterministic. Nothing lints for that, which is why it is written down here.
image-reader is 020's destination because its own description owns "transcribe this
register page" / "OCR this scan", and the router holds no `image_transcribe`, so
doing it inline is not available.

`ut_research_021` (`attached-before-searching.json`) covers the third rule in that
section, "Start from what is already attached" (issue #2813 item 4). Cornelius
Driscoll already holds `SD-DRIS-D`, a Quebec civil death registration, so a request
for a death record asks for something the project has; reading and reporting it is
the pass, and searching for it — by an MCP call *or* by a hand-off to a search step —
is the failure. Deterministic, via the `attached-first` tag and
`test_reads_attachments_before_searching`, which reads the MCP call log and the
hand-off list so a turn that only narrates having checked cannot pass.

**This one needed a fixture to exist at all, and that is the general rule.** Neither
`person_read` nor `source_attachments` is in `mock_mcp.LIVE_TOOLS`, and the mock
registers a tool outside that set *only* for a test that declares a fixture for it
(`mock_mcp.py:1094`). Before this test no research test declared one, so the rule was
unexercisable and a body ignoring it passed every test in the suite. It also needed a
NEW fixture rather than the existing `person-read-driscoll-attached-sources.json`:
that one's predicate requires `sourceDescriptions: true`, and `matches()` demands
every predicate key be present (`harness/fixtures.py:93`), so a router omitting that
optional argument would have matched nothing and been refused — the wrong failure for
a test about whether the router looks before it searches.

`ut_research_022` (`candidates-not-verdicts.json`) covers item 6, and is **judge-graded
on purpose** — which is a different thing from 020's accident. Every part of that rule
is a property of the reply: whether a name match was presented as an answer, whether
match strength and search scope were given, and whether the closing offer is to research
further rather than to extract or attach. None of that appears in a hook record or a
call log. A deterministic check here could only assert something that cannot fail, and
CLAUDE.md is explicit that such a check is worse than none. The suite's "routing is not
yours to grade" rule constrains ROUTING; reply quality is what the judge is for. The
distinction worth holding on to: 020 was judge-only because a gate tag silently skipped
its validator, and nobody could see it; 022 says so in its own description and here.

`ut_research_023` (`autonomous-is-always-a-job.json`) guards the e2e corpus against
this whole section. Every e2e run enters as `/research --autonomous {question}`, so
every run reads it, and 63 of the 136 committed e2e fixtures ask a question whose
SHAPE is on the bounded list. Without the `--autonomous` carve-out the router would
deliver one answer and stop on those. Its message deliberately omits the leading
`/research`: `skills_invoked` is filled only by a `Skill` tool call, so a slash entry
grades a positive test `fail` whatever the router does (issue #3116, fix PR #3146 open).
Restore the prefix once that lands and this becomes the e2e entry form exactly.

**What they do NOT cover, and cannot:** that a bounded turn ends with the
`delivered` outcome. `research_delivered` is not in this harness's `LIVE_TOOLS` and
no Stop hook binds here, so the outcome is unobservable in a unit test regardless of
which plane implements it. Both hosted planes now halt on the signal — the prototype
via its own `PreToolUse` arm plus `DELIVERY_GUIDANCE`, the alpha via `count_only` and
`should_continue_run(delivered=...)` — and that half is covered by
`apps/server/tests/test_alpha_stop_hook.py`, not here.

## Moved negatives (issue #2268)

`ut_research_016` (negative-research-plan.json) and `ut_research_017`
(negative-indexed-search.json) were moved from `eval/tests/unit/search-images/`
when the search-images thin skill was deleted. Both are `grade_on_invariant`
negatives whose tags (`no-browse-no-write`, `no-browse-on-indexed`) gate
deterministic validators now in `validators/test_research.py`. They test
that the research router does not trigger a browse when the request belongs
to research-plan or search-records.

A live `make e2e-run` remains the only end-to-end instrument.
