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

## No `routes-to:` test may name a paired row

`research-exhaustiveness`, `proof-conclusion` and `person-evidence` are routed
by an `Agent` spawn of `@plugin:<name>`, not by a `Skill` call (#2075). The
harness observes routing only through `Skill`:
`eval/harness/harness/skill_runner.py:654` gates both `skills_invoked` (`:660`)
and stub application (`:684`) on `if tool_name == "Skill"`. So a `routes-to:`
assertion naming one of those three cannot fail — it would grade a call the
harness never sees.

The three names are dropped from `route-shortcut-guard.json`'s `stub_skills`
for the same reason: a stub that can never be applied is not a control. The
other nine fixtures in this directory still carry them as inert entries, which
`test_runnability.py` accepts because the names are real skill directories;
they are left alone deliberately rather than swept, since only this fixture's
stated purpose names a paired row.

Issue #2246 holds the harness work that would let a unit suite observe an
`Agent` spawn. Until it lands, the route these three take is graded by no unit
test — a live `make e2e-run` is the only instrument.
