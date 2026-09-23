This suite grades **a single routing decision in fresh context**. It cannot
see compaction decay. It guards against routing **edits** — someone changing
the table and breaking a route — not against the decay the §5.3 rule audit
measured (`docs/plan/research-performance-2026-07-27.md`, "Rule audit — only
unanchored prose decays"). Do not cite this suite as coverage for compaction
decay.

## Test naming

- `ut_research_001` – `ut_research_010`: trigger tests (phase 1a). Positive
  and negative tests for whether the router skill activates at all.
- `ut_research_011`+: routing tests (phase 2). Positive tests that assert
  which callee the router hands off to first, given a specific research.json
  state. Each uses `execution.stub_skills` so the callee is denied at the
  `PreToolUse` hook, whether the router reaches it by a `Skill` call or, for a
  callee converted to an agent, by a spawn.

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

`route-shortcut-guard.json` keeps all three in `stub_skills`, and that is
deliberate. The stub is the control on the FAILURE path, not the compliant one:
the non-compliance this fixture catches is a router that calls
`Skill(proof-conclusion)` directly because the user asked for it, and a `Skill`
call is exactly what `skill_runner.py:684` still stubs. Drop the stub and a
shortcutting router runs the real skill inside an empty project for up to 30
turns. The stub is merely inert on the compliant path, where the router spawns
the agent instead — inert is not the same as useless.

Issue #2246 **has landed** (`d25e8560b`, in this branch): `spawned_agents()`
(`skill_runner.py:302`) derives main-thread `Agent` spawns from
`builtin_tool_calls`, already a validator fixture (`validators/conftest.py:140`).
So the harness can now observe a spawn, and `test_no_paired_skill_shortcut`
(`validators/test_research.py`) is the assertion that uses it: on a test tagged
`no-shortcut`, no paired name may be reached by **either** call mechanism.

That second arm is not redundant with `test_routes_to_expected_skill`, which
asserts only the first hand-off. A router that calls `Skill(question-selection)`
first and *then* spawns `@plugin:proof-conclusion` passes it green while doing
the exact thing `ut_research_015` exists to forbid.

A live `make e2e-run` remains the only end-to-end instrument.
