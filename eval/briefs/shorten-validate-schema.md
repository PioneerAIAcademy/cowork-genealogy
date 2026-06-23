# Shorten: validate-schema

**Bucket:** A (dead-mechanics removal)
**Primary owner:** developer (it's plumbing/guardrail, not genealogy craft)
**Current size:** 110 lines → **Target:** ~35–40 lines (~65% reduction)
**Tool migration:** done — calls `validate_research_schema`
**Still needed as a skill?** **Borderline — keep, but as a tiny router.**
See "Is this even a skill?" below.

## TL;DR
Delete the entire "What the validator checks" enumeration (lines ~64–99) — it
duplicates the validator's own logic, the tool reports the real errors at
runtime, and the rubric explicitly does **not** re-grade whether the validator
is correct. Keep only: interpret errors in plain language, suggest a concrete
correct fix, stay read-only, and **route** logical-impossibility →
check-warnings / GPS → proof-conclusion.

## Why this skill is shortenable
Now that every write tool (`tree_edit`, `research_append`, `merge_*`)
validates-before-persist, validate-schema's old role as the *post-write
backstop* is gone. Its only remaining job is the **user-invokable audit**
("validate my files") plus a routing boundary. The 35-line catalog of "what
the validator checks" is reference material that grades nothing and drifts
from the real validator.

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_validate_schema.py`):
  - `test_only_calls_validate_research_schema` — must call *only*
    `validate_research_schema`, no other MCP tool.
  - `test_does_not_modify_project_files` — `research.json` and
    `tree.gedcomx.json` byte-identical before/after (read-only).
  - Universal ownership table: validate-schema is absent from it → **any**
    write is flagged.
- **Rubric dims** (`eval/tests/unit/validate-schema/rubric.md`):
  1. *Tool-response interpretation & error explanation* — surface each
     specific error and explain it in plain terms.
  2. *Fix-suggestion specificity* — a concrete, correct remedy per error.
  3. *Read-only discipline & scope adherence* — report only; on a boundary
     prompt, route instead of answering "valid."
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary test:** `negative-check-warnings.json`
  (`ut_validate_schema_003`) — a "check for logical impossibilities" prompt
  **must route to check-warnings**, not return "schema validation passes."
- **Key test files:** `error-bad-id-prefix`, `error-invalid-enum`,
  `error-dangling-reference`, `error-cross-file-reference`,
  `error-missing-required-field`, `error-bad-sidecar`,
  `clean-evaluations-pass`, `negative-check-warnings`.

## CUT — safe to remove
- **[~64–99] "What the validator checks" (research.json / tree.gedcomx.json /
  cross-file)** — pure duplication of the validator's logic. The tool emits
  the actual errors; the rubric grades *reading those errors*, not whether the
  skill can recite the checklist. Highest-value cut. **(~35 lines)**
- **[~102–110] "Re-invocation behavior"** — boilerplate ("Writes: nothing").
- **[~29–35] the `validate_research_schema({ projectPath })` example block** —
  the tool schema documents the one param; a single inline mention suffices.
- **[~46–53] the long "suggest only a fix that leaves the whole project
  valid" paragraph** — TIGHTEN to one sentence (see below); the multi-sentence
  worry-list is craft the model already does.

## KEEP — load-bearing judgment
- **Error explanation + concrete fix** (rubric dims 1 & 2) — keep as 2–3
  tight bullets, not a page.
- **Read-only discipline** (rubric dim 3 + the read-only validator) — one
  line: "Report only. Never edit a file to fix an error; the user fixes their
  own files."
- **Routing boundary** (the negative test) — one line: "Schema only. Route
  logical impossibilities (birth after death, etc.) to check-warnings, and
  proof/GPS-quality questions to proof-conclusion — don't answer them with a
  schema-validation result."

## TIGHTEN
Collapse the "suggest a fix" guidance to: *"Suggest a fix that clears the
error without creating a new one (don't dangle a reference or drop a required
field). If no clean fix is obvious, describe the problem and let the user
decide. Don't guess required fields — a research.json source and a
tree.gedcomx.json source are different shapes."*

## Suggested target structure (~35 lines)
1. Frontmatter (unchanged).
2. Narration line.
3. 2-sentence purpose (guardrail; user-invokable audit; not auto-triggered).
4. "What to do": call the tool; on errors → explain + suggest a clean fix
   (read-only); on clean → confirm; on missing file → point at init-project.
5. One-line routing boundary.

## Is this even a skill?
Borderline. The post-write-backstop reason is gone; the only thing a bare tool
call wouldn't give you is the **tested routing boundary** (don't substitute a
schema pass for a check-warnings/proof-conclusion answer). That's cheap to keep
at ~35 lines and expensive to lose, so **keep it — just strip it to the bone.**
Removing it entirely would mean relying on the tool description for triggering
and dropping a behavior that has a passing negative test.

## Verify
```
cd eval/harness && uv run python run_tests.py --skill validate-schema
```
All three rubric dims + base dims pass; both validators green; the negative
test still routes to check-warnings.

## Owner notes
Fully a **developer** cut — no genealogy judgment is at stake. The only
craft-adjacent line is the routing boundary, which is mechanical (skill A vs
skill B), not Evidence-Explained reasoning.
