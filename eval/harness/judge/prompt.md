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
# Critical: Negative tests (decline / routing / non-activation)

Some tests are **negative tests**: the correct behavior is for the skill
under test to NOT carry out its own task. When this is the case, the
**Per-test context** section below states it explicitly ("This is a
NEGATIVE test…") and names what should have happened instead — decline
and route to a specific other skill, or (for an out-of-scope request)
produce no output at all.

On a negative test, grade **Correctness** and **Completeness** against
that expected behavior — NOT against the quality of any task output that
happens to appear:

- **Correct decline / routing / non-activation → score 3 (pass).** If the
  skill declined, and/or the request was handled by the skill it was
  supposed to route to (or, for an out-of-scope request, no skill acted),
  Correctness and Completeness are a full pass. Do not lower them because
  the decline was terse, because the skill performed the handoff by
  invoking the correct skill, or because that other skill's work appears
  in the transcript below. Not doing the under-test skill's task is the
  correct outcome — do not both credit the routing and penalize the base
  dimensions for "not declining thoroughly enough."
- **Wrongly performing the task → score 1 (fail).** If the skill instead
  carried out its own task, or produced substantive output when it should
  have declined or stayed silent, Correctness and Completeness fail —
  **even when that output is fluent, accurate-looking, and well-organized.**
  Polished output for the wrong behavior is a failure, not a pass; do not
  award craft credit for work that should never have been done.

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

Presentation is not correctness. Do not lower Correctness because the
response did not re-print a file's full contents, kept its narration
brief (some skills instruct brevity — "the content is in the file"), or
did not restate a validation/tool step in prose. Grade the substance of
what was produced, not whether the response re-displays it — file writes,
schema validity, and tool-call counts are checked separately by
validators. Likewise, correctly **surfacing** a conflict or a flagged
data gap (e.g. "the tool warns X but the tree shows Y — flagging rather
than resolving"), or a clearly-marked out-of-scope observation, is not a
correctness defect when the skill's own instructions call for it. This is
all distinct from work that was never actually done: a tool that returned
no records, a required write that never happened, or a claimed edit that
left the file unchanged remain Correctness failures.

## Completeness
- **pass:** The skill addressed everything the user message and input
  state required. No silent omissions of items it should have covered.
- **partial:** Addressed most of what was asked but missed one piece
  the input state made obvious.
- **fail:** Missed major portions of what was asked, or stopped early.

"Incomplete" means work the input state required was not done — not that
the response declined to re-print or re-narrate work it did do (see the
presentation note under Correctness). Judge substance, not display.

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
