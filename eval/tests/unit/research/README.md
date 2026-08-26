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
asserts the router's first delegation matches -- its own activation is
filtered out first. `routes-to:stop` means the router
should finish without invoking any sub-skill.

## What is NOT covered (and why)

Two routing-table rows are blocked on #1492 (research/SKILL.md reconciliation):

- **Row 14 post-verdict**: the `address_first` verdict handler has two
  contradictory tables. The routing decision TO `proof-critique` is testable;
  the handler for its return is not.
- **Row 16**: who writes `project.status = "completed"` — the routing table,
  the ownership validator, the tool comments, and the empirical run logs all
  disagree. Cannot test until the ruling lands.
