This suite grades **a single routing decision in fresh context**. It cannot
see compaction decay. It guards against routing **edits** — someone changing
the table and breaking a route — not against the decay the §5.3 rule audit
measured (`docs/plan/research-performance-2026-07-27.md`, "Rule audit — only
unanchored prose decays"). Do not cite this suite as coverage for compaction
decay.

## Test naming

- `ut_research_001` – `ut_research_010`: trigger tests (phase 1a). Positive
  and negative tests for whether the router skill activates at all. 001, 005
  and 008 remain.
- `ut_research_011`+: routing tests (phase 2). Positive tests that assert
  which callee the router hands off to first, given a specific research.json
  state. Each uses `execution.stub_skills` so the callee is denied at the
  `PreToolUse` hook, whether the router reaches it by a `Skill` call or, for a
  callee converted to an agent, by a spawn.

## Restored activation tests (issue #3119)

`ut_research_001`, `012`, `013`, `014` and `015` were deleted on 2026-10-01
(issue #2984) and are restored without their `xfail` markers. They were `xfail`
for one defect: `research` and `project-status` both matched a "drive the
workflow forward" request, so the orchestrator was skipped about half the time
(issue #2927). `project-status`'s description now tells it not to drive the
research workflow forward (#3092). Each restored test passed three runs of three
on main before it came back (#3119). `015` needed one more change; see "Paired
rows".

Not restored:

- `ut_research_004` (`investigate-person.json`) activated `research` on two of
  its three runs. On the third, the main thread asked the user two
  `AskUserQuestion` questions and no skill ran. Its committed history shows the
  same miss in other forms: `project-status` or a sub-skill taking the request.
  The per-run data is on #3119.
- `ut_research_002` (`slash-research-question.json`), which issue #3116 owns.
- `ut_research_003` (`find-relative.json`), which is not part of #2927's removal
  condition.

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

The router's `@plugin:` callees are its paired rows: each is routed by an
`Agent` spawn of `@plugin:<name>`, not by a `Skill` call (#2075), and
`_paired_names()` in `validators/test_research.py` derives the set from
`research/SKILL.md`. A `routes-to:` tag observes a spawned row, because the
validator reads `handoffs`.

`ut_research_015` (`route-shortcut-guard.json`) is the only test tagged
`no-shortcut`, so it is the one test `test_no_paired_skill_shortcut` runs on.
The user names a downstream destination ("through to a proof conclusion") on a
project that has only an objective, so the first hand-off must be row 1,
question-selection. The `no-shortcut` tag makes the harness end the run at that
first hand-off (`first_handoff_stop` in `harness/skill_runner.py`). Without the
stop the test cannot pass reliably: `research/SKILL.md` tells the router to drive
the table forward to the named destination, so after question-selection it walks
on, and because the stubs write nothing, the walk can loop back to row 1 until
the turn cap. The test's committed failures on main were mostly the activation
defect above, then that walk. One committed run (`v1_2026-08-25_20-14-29.json`)
did hand off to proof-conclusion first. In every committed run, person-evidence,
research-exhaustiveness and proof-conclusion were reached by `Skill` calls, which
is why a count of agent spawns alone finds none. The test keeps the paired agents in `stub_skills`: a denied spawn is still
recorded, so a shortcut fails the validator rather than running.

That validator is not redundant with `test_routes_to_expected_skill`, which
asserts only the first hand-off. A router that calls `Skill(question-selection)`
and spawns `@plugin:proof-conclusion` in the same turn passes the routing check.
The stop denies and records both, and this validator fails the run.

## Moved negatives (issue #2268)

`ut_research_016` (negative-research-plan.json) and `ut_research_017`
(negative-indexed-search.json) were moved from `eval/tests/unit/search-images/`
when the search-images thin skill was deleted. Both are `grade_on_invariant`
negatives whose tags (`no-browse-no-write`, `no-browse-on-indexed`) gate
deterministic validators now in `validators/test_research.py`. They test
that the research router does not trigger a browse when the request belongs
to research-plan or search-records.

A live `make e2e-run` remains the only end-to-end instrument.
