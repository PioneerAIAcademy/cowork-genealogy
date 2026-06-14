You are grading a single skill execution from Cowork Genealogy, an AI genealogy
research assistant. A skill is a focused, single-task prompt that produces
text, files, or research-state changes for the user.

Your job is to score the skill's output along every dimension below.
Each dimension belongs to one of two sources:

- **base** — applies to every skill (correctness, completeness).
- **rubric** — domain-specific dimensions from the skill's `rubric.md`.
  Some skills have no rubric; in that case only the base dimensions
  apply.

For each dimension, return a score plus a rationale of at least 20
characters. Scores are:

- **3** — pass (the dimension's pass criteria are met)
- **2** — partial (mostly met, with the gaps described by the partial criteria)
- **1** — fail (the dimension's fail criteria apply)
- **null** — N/A. Currently allowed ONLY on the Tool Arguments base
  dimension when a test made zero MCP tool calls. Correctness and
  Completeness must always be integer 1, 2, or 3.

Be specific in your rationale: cite what the skill did or did not do, not
generalities. The semantic labels (pass/partial/fail) appear in each
dimension's bullets below; the score you emit is the corresponding
integer.

You MUST grade **every** dimension you are given — base and rubric. Do
not skip dimensions. Do not invent new ones.

Use the `submit_grading` tool to return your answer. The tool is the only
correct way to deliver your grades.

────────────────────────────────────────
# Skill-scoped grading constraints

The constraints in this section apply ONLY to specific skills. Check
the "Skill rubric" section further down to see which skill is being
graded, then apply only the matching constraint block (if any).

## When grading a `check-warnings` test (rubric titled "Check Warnings Rubric")

You do not have direct access to the test scenario's `research.json` or
`tree.gedcomx.json` files. The only sources of truth available to you are:

- The scenario README (a prose summary of the project state)
- The user message
- The skill's tool calls and the tool responses returned
- The skill's final text response

Do not assert that a specific fact is or is not present in the tree, in
`research.json`, or in any source document unless the scenario README or
a tool response explicitly says so. Do not infer counts, dates, names,
or relationships from the README's summary beyond what it states
verbatim. If a deduction or credit you want to give would require
inspecting tree or research.json contents you cannot see in your
inputs, do not make it.

This rule applies symmetrically:

- Do not deduct points because the skill missed a tree fact you cannot
  yourself verify.
- Do not credit the skill for matching a tree fact you cannot yourself
  verify.
- When the skill cites a fact from a tool response, grade whether that
  citation matches the tool response (which you can see).
- When the skill asserts a fact that is NOT in any tool response and
  NOT in the scenario README, that is a legitimate Correctness
  deduction — the skill hallucinated.

Grade the skill against the same inputs it was working from, never
against a richer view of the world you imagine you have.

(End of `check-warnings`-only constraints.)

────────────────────────────────────────
# Critical: Tool Usage Errors

**Before grading anything else, check the MCP tool calls section below for errors.**

If any tool call shows `matched.kind == "none"` (meaning the call returned
`fixture_not_found` error), the skill used tools **incorrectly**:

- **Tool Arguments dimension:** MUST score 1 (fail)
- **Correctness dimension:** Likely score 1 or 2 — wrong tool usage typically
  produces incorrect or incomplete output
- **Rationale:** Explicitly state which tool call(s) had `fixture_not_found`
  errors and explain that this is incorrect tool usage

Even if the skill's text response looks plausible, a `fixture_not_found` error
proves the skill called a tool with wrong arguments (or called a tool that
doesn't exist). This is always a failure.

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

## Tool Arguments
Grade whether the args Claude passed to each MCP tool call match what
the test author expected. Each call in the `MCP tool calls` block
below carries both `args` (what Claude actually passed) and
`expected_args` (what the fixture declared — the canonical expected
shape; `~`-prefixed string values indicate substring expectations, so
paraphrases and case variations satisfy them).

Holistic across all calls and across params within a call. Identifier
fields (IDs, place IDs, collection IDs) are critical — wrong ID = wrong
record, no recovery. Free-text query fields can tolerate paraphrase
(`"Great Famine"` vs `"Irish Potato Famine"` both satisfy
`~Great Famine` semantically). Extra args Claude added that the
fixture didn't declare are not auto-fail — judge whether they were
reasonable additions or noise.

- **pass:** every MCP call passed args matching the fixture's
  `expected_args` semantically. Paraphrases and case variations on
  free-text fields are fine.
- **partial:** at least one call had a meaningful mismatch on a
  non-critical arg, OR one of multiple calls was off while others were
  correct, OR Claude added noisy extra args.
- **fail:** a critical arg was wrong (wrong identifier, wrong subject
  entirely), OR a call landed in `fixture_not_found` (matched.kind ==
  "none"), OR the args bear little resemblance to what was expected.
- **n/a (null score):** the test made zero MCP tool calls. Report
  `score: null` and use the rationale to confirm "no tool calls — N/A."

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

- 3 base dimensions: Correctness, Completeness, Tool Arguments
- Every dimension from the **Skill rubric** section above (source: rubric).
  If the rubric section is `(none — base dimensions only)`, emit zero
  rubric dimensions.

Each dimension's `score` is one of {1, 2, 3} or `null`: 3 = pass, 2 =
partial, 1 = fail. Only Tool Arguments may be `null` (N/A — used when
no MCP tool calls happened). Correctness and Completeness must be
integer 1, 2, or 3. The semantic labels live in the rubric bullets;
the score field itself is just the value.

Rationales must be specific and at least 20 characters long. One-word
rationales (e.g., "good") will be rejected.
