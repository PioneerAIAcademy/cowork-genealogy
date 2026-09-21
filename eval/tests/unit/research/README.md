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
  which sub-skill the router invokes first, given a specific research.json
  state. Each uses `execution.stub_skills` so the callee is denied at the
  `PreToolUse` hook and recorded in `skills_invoked`.

## Routing tests — tag convention

Routing tests carry a `routes-to:<skill-name>` tag. The deterministic
validator (`eval/harness/validators/test_research.py`) parses this tag and
asserts the router's first delegation matches. `routes-to:stop` means the router
should finish without invoking any sub-skill.

## What is NOT covered (and why)

Two routing-table rows are blocked on #1492 (research/SKILL.md reconciliation):

- **Row 14 post-verdict**: the `address_first` verdict handler has two
  contradictory tables. The routing decision TO `proof-critique` is testable;
  the handler for its return is not.
- **Row 16**: who writes `project.status = "completed"` — the routing table,
  the ownership validator, the tool comments, and the empirical run logs all
  disagree. Cannot test until the ruling lands.

## A paired row is asserted on `spawned_agents()`, not `routes-to:`

`research-exhaustiveness`, `proof-conclusion` and `person-evidence` are routed
by an `Agent` spawn of `@plugin:<name>`, not by a `Skill` call (#2075).

**`skills_invoked` does not see them, but the harness does.** `skill_runner.py`
gates `skills_invoked` (`:660`) and stub application (`:684`) on
`if tool_name == "Skill"` (`:654`), so a `routes-to:` tag — which
`validators/test_research.py:34` asserts against `skills_invoked` — cannot
observe a spawned row. A `routes-to:` tag naming a paired row is therefore
wrong; assert on `spawned_agents()` instead.

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
asserts only `delegations[0]` and reads `skills_invoked` alone. A router that
spawns `@plugin:proof-conclusion` and *then* calls `Skill(question-selection)`
passes it green while doing the exact thing `ut_research_015` exists to forbid.

A live `make e2e-run` remains the only end-to-end instrument.
