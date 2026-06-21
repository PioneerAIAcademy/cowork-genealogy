# Shorten SKILL.md files — team instructions

**Task:** shorten each SKILL.md to the least text that still passes the unit
tests. Shorter files are easier to improve as e2e tests land.

**Read first:** [`shorten-skills-overview.md`](shorten-skills-overview.md)
(methodology + triage table), then your skill's `shorten-<skill>.md` (the exact
sections to cut/keep, with line refs, and the issues to fix in §"Fix in this
PR").

## The one rule that matters

The LLM judge **never reads SKILL.md** — it grades Claude's transcript against
the rubric + base dims + the deterministic validators. So:

- **CUT** text that duplicates a tool's input schema (the `tool({...})` JSON
  blocks), re-derives a validator's logic, restates the rubric, or narrates
  mechanics the tool now does (id allocation, sidecars, "update all refs,"
  post-write `validate_research_schema`).
- **KEEP** the genealogical judgment, the routing/scope boundaries a negative
  test checks, and "don't re-derive what the tool computed" guardrails.
- **Don't shrink-till-red.** Cut what's *provably* redundant, then re-run. A
  brittle minimum is harder to improve, not easier.

## Per-skill loop

1. Apply the CUT / TIGHTEN list; leave the KEEP list intact; **fix the bundled
   issues** (below).
2. `cd eval/harness && uv run python run_tests.py --skill <skill>`
3. Confirm every judge dimension passes and all validators are green. (Editing
   SKILL.md *or* `rubric.md` flips prior run logs inactive → re-run, then
   re-annotate the dimensions.)
4. Open the PR per the usual cadence (junior corrects grades, senior reviews +
   releases).

## Who owns what

- **Developer-led, low-risk (bucket A):** tool-backed skills carrying dead
  mechanics. Strip the prose the tool now owns.
- **Genealogist-led, higher-risk (bucket B):** citation, timeline,
  locality-guide, historical-context, translation — no tool to lean on, so cuts
  are craft compression. The genealogist signs off on every cut.
- **Both:** record-extraction, tree-edit, proof-conclusion, etc. — developer
  cuts mechanics, genealogist guards the judgment.

## Fix these in the SAME PR as the shortening

Each is pinpointed in the relevant brief (look for **"Fix in this PR"** /
JUDGMENT CALLS):

- **Stale `rubric.md` lines** still asserting a post-write
  `validate_research_schema` the migrated skill no longer does — re-word to the
  validate-before-persist / `check-warnings` flow, or drop the clause:
  - assertion-classification — `rubric.md` line 104
  - search-external-sites — `rubric.md` line 33

  (Editing `rubric.md` flips run logs inactive, so it rides the re-run +
  re-annotation you already do; the senior reviews the rubric change with the
  cuts.)
- **Skill inconsistencies:**
  - **timeline** — SKILL.md says invoke `check-warnings` but it isn't in
    `allowed-tools`; genealogist picks the fix (reword to a handoff, remove, or
    add to `allowed-tools`).
  - **locality-guide** — SKILL.md contradicts itself on whether it writes a
    `<topic-slug>.md` file (Step 5 / validator say output-to-user;
    Re-invocation says it writes); genealogist makes it self-consistent.
  - **record-extraction** — add the one-line `check-warnings` handoff the body
    is missing (it lives only in an unloaded `references/` doc); also delete the
    two orphaned `references/` docs (`research-log-protocol.md`,
    `validation-protocol.md`) after verifying no other skill uses them.
  - **hypothesis-tracking** — fix the stale `proved` status in the validator
    docstring (`eval/harness/validators/test_hypothesis_tracking.py`); confirm
    the rubric's `research-schema-spec.md §5.9` reference still resolves.

## Out of scope for this batch (genuinely separate)

- **`research`** has **no unit-test floor** (no tests/validator/rubric). Its
  cuts are e2e-gated, not unit-gated — keep that one conservative and out of
  this batch; authoring a `research` unit suite is separate prerequisite work.

## North star

`search-wikipedia` (65 lines) is the canonical minimal tool-backed skill — the
shape the others should move toward. Don't bloat it.
