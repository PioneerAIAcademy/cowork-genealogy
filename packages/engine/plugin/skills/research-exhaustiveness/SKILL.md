---
name: research-exhaustiveness
description: Evaluates whether research on a question is reasonably
  exhaustive — applies the five threshold questions and the 7-point
  stop criteria, then either writes the exhaustive_declaration on the
  question or explains what's missing. GPS Step 1 — Reasonably
  Exhaustive Research. Use when the user says "is this research
  exhaustive?", "are we done?", "have we searched enough?", "can we
  declare exhaustive?", or after all plan items for a question are
  complete. Do NOT use when the user wants the next research question
  (use question-selection), when the user wants to plan more searches
  for an open question (use research-plan), or when the user wants to
  write the proof conclusion (use proof-conclusion).
allowed-tools:
  - project_context
---

# Research Exhaustiveness

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

## 1. Identify the question

Resolve the user's request to ONE `q_` id via `project_context`, **matching on the question's TEXT** in `openQuestions`. "The parentage question" is the question whose text asks about a parent; "the marriage question" the one that asks about a marriage.

**`questionStatuses` is advisory and must never rule a question in or out.** It reports how far a question has got, not whether it is the one the user means — and it is derived, so a question with a draft proof summary reads `concluded` while its `status` is still `in_progress`. Using it to eliminate a candidate sends the evaluation to a different question with a matching-sounding state.

If the text matches no question, or matches more than one, ask which before proceeding. Never fall back to "the only one left".

**Read nothing else, and judge nothing.** Do not query assertions, plan items, log entries or the existing declaration, and do not form a view on whether the question is ready. The preconditions — classification, identity links, tentative values, and whether the plan is still in flight — belong to the agent, which declines and names the blocker when one fails. A plan item you judge "finished really" from out here is a gate being decided by the one participant that cannot see the evidence.

## 2. Delegate the evaluation

Invoke `@plugin:research-exhaustiveness` with a delegation message carrying `questionId` and `projectPath`, and asking it to **assess whether the question is reasonably exhaustive and record the outcome** — declaring if the criteria are met, and recording an honest `declared: false` termination if they are not.

**Do not ask it to "declare the question exhaustive."** An instruction to declare overrides the agent's own preconditions, and it will write past a block it would otherwise have stopped on. Equally, do not ask it merely to "evaluate whether you can declare" — that invites a decline on evidence that in fact supports a declaration. Ask for the assessment and let the body decide.

The agent owns every step from there: the preconditions, the five threshold questions, the 7-point stop criteria, the tier of the outcome, and the `exhaustive_declaration` write.

**Do not write `exhaustive_declaration` yourself.** Declaring a question exhaustive is routed to the agent and a direct `research_append` setting `declared: true` is denied. If the delegation fails, report the failure and stop — do not write the declaration inline.

One invocation per question.

## 3. Relay

Relay the agent's returned outcome as-is. Do not re-run the threshold questions, re-state the stop criteria, or re-argue the judgment.

Then recommend the next step: declared exhaustive → proof-conclusion; not declared because a gap remains → research-plan; not declared because a precondition blocked it → the skill the agent named.

## Re-invocation behavior

**Writes:** nothing directly. Every write is made by the `research-exhaustiveness` agent this skill delegates to — the `exhaustive_declaration` object and `status` on a single question in `research.json`. Nothing else, and no `tree.gedcomx.json` changes.

**On repeat invocation for the same question:** delegate again, unchanged. The agent finds an existing declaration and refines it in place rather than writing a second one; if it is already `declared: true` it reports that and points at proof-conclusion.

**Safe to re-invoke.** A repeat run re-evaluates the same question; it never duplicates a declaration.

## Never

- Never write `research.json` yourself — not the declaration, not the question's `status`.
- Never decide, on the agent's behalf, that a precondition does not apply. If the agent declines and names a blocker, relay that — it is the correct outcome, not a failure to work around.
- Never clear a blocker the agent reports. A plan item still `in_progress` is finished by the search skill that owns it, an unclassified assertion by record-extraction; flipping a status to unblock a declaration falsifies the record.
- Never evaluate more than one question per invocation.
