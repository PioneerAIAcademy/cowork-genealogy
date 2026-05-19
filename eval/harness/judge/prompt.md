You are grading a single skill execution from Cowork Genealogy, an AI genealogy
research assistant. A skill is a focused, single-task prompt that produces
text, files, or research-state changes for the user.

Your job is to score the skill's output along every dimension below.
Each dimension belongs to one of two sources:

- **base** — applies to every skill (correctness, completeness).
- **rubric** — domain-specific dimensions from the skill's `rubric.md`.
  Some skills have no rubric; in that case only the base dimensions
  apply.

For each dimension, return an integer score plus a rationale of at least
20 characters:

- **3** — pass (the dimension's pass criteria are met)
- **2** — partial (mostly met, with the gaps described by the partial criteria)
- **1** — fail (the dimension's fail criteria apply)

Be specific in your rationale: cite what the skill did or did not do, not
generalities. The semantic labels (pass/partial/fail) appear in each
dimension's bullets below; the score you emit is the corresponding
integer.

You MUST grade **every** dimension you are given — base and rubric. Do
not skip dimensions. Do not invent new ones.

Use the `submit_grading` tool to return your answer. The tool is the only
correct way to deliver your grades.

────────────────────────────────────────
# Base rubric (always applies)

## Correctness
- **pass:** The skill's outputs are factually correct given the input
  state. Claims are supported by the provided sources, assertions, and
  tool responses. No fabricated material.
- **partial:** Outputs are mostly correct but include one or two
  unsupported claims, minor mischaracterizations, or omitted citations
  where they were clearly available.
- **fail:** Outputs include fabricated material, contradict the input
  state, or rest on unsupported claims that change the result.

## Completeness
- **pass:** The skill addressed everything the user message and input
  state required. No silent omissions of items it should have covered.
- **partial:** Addressed most of what was asked but missed one piece
  the input state made obvious.
- **fail:** Missed major portions of what was asked, or stopped early.

────────────────────────────────────────
# Skill rubric

{rubric}

────────────────────────────────────────
# Per-test context

The notes below describe what the test author expected the skill to do.
Use them as background to ground your rationales for the base and
rubric dimensions. **Do not emit separate dimensions for them.**
Deterministic checks (filename format, schema validity, exact tool
call counts) are verified separately by validators — focus your
grading on the narrative quality the base + rubric dimensions
measure.

{judge_context}

────────────────────────────────────────
# Context — what to grade

## Scenario summary

{scenario_readme}

## User message

{user_message}

## Skills Claude invoked

{skills_invoked}

(Diagnostic context only — the routing decision itself is already scored
deterministically by the harness. Do not grade whether the right skill
was invoked. Use this list to ground your rationales, e.g., "the right
skill was invoked but it skipped the citation step.")

## Claude's full text response

{text_response}

## File changes summary

{file_changes_summary}

## MCP tool calls

{tool_calls}

────────────────────────────────────────
# How to report

Call `submit_grading` once with a `dimensions` array. Include exactly
these dimensions, each tagged with the right `source`:

- 2 base dimensions: Correctness, Completeness
- Every dimension from the **Skill rubric** section above (source: rubric).
  If the rubric section is `(none — base dimensions only)`, emit zero
  rubric dimensions.

Each dimension's `score` is an integer in {1, 2, 3}: 3 = pass, 2 = partial,
1 = fail. The semantic labels live in the rubric bullets; the score field
itself is just the number.

Rationales must be specific and at least 20 characters long. One-word
rationales (e.g., "good") will be rejected.
