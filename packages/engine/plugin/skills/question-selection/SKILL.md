---
name: question-selection
description: Selects the next research question (writing it to research.json) based on current project
  state — timeline gaps, unresolved conflicts, hypothesis tests, or
  exhausted direct evidence requiring FAN pivot. Also derives the first
  research question on a brand-new project. GPS Step 1 — Reasonably
  Exhaustive Research. Use when the user says "what should I research
  next?", "what should we work on next?", "next question", "where should
  I start?", "where do I begin?", "what's missing?", "should we try FAN
  research?", after a question is resolved, or after a proof summary
  reveals gaps. Do NOT use when
  the user already has a specific question and wants to plan how to
  answer it (use research-plan), when the user wants to evaluate
  whether research on a question is exhaustive (use
  research-exhaustiveness), when the user only wants a summary of the
  project's current state (use project-status), or when the user wants
  to search records (use search-records or search-external-sites).
allowed-tools:
  - project_context
---

# Question Selection

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

## 1. Resolve the project

Establish the `projectPath` for the active project via `project_context`.

**Read nothing else, and judge nothing.** Do not query questions, assertions,
plan items or proof summaries, and do not form a view on which question is next
or whether the objective is already answered. Every gate — finishing an open
question first, stopping at a defensible tier, scoping to the objective,
ranking, formulation and the write — belongs to the agent, which sees the
evidence. A judgement made out here is made by the one participant that has not
read the project.

## 2. Delegate the selection

Invoke `@plugin:question-selection` with a delegation message carrying
`projectPath`, and asking it to **select and record the next research question**.

**Do not ask it to "add a question."** An instruction to add overrides the
agent's own stop conditions, and it will write one past a gate it would
otherwise have halted on — including the case where the objective is already
answered and the correct outcome is to select nothing.

## 3. Relay

Report the agent's result to the user as it returned it. If the delegation
fails, report the failure and stop — do not select or write a question inline.

## Re-invocation behavior

**Writes:** nothing directly. Every write is made by the `question-selection`
agent this skill delegates to — new `q_` entries in the `questions` section of
`research.json`. Nothing else, and no `tree.gedcomx.json` changes.

**On repeat invocation:** delegate again, unchanged. The agent re-evaluates
which question is next and either points at one already present or adds a new
`q_`; it never writes a second `q_` for the same question and never revises an
existing question's `status`.

**Safe to re-invoke.** A repeat run re-evaluates the same project state; it
never duplicates a question.

## Never

- Never write `research.json` yourself — not a question, not its `status`.
- Never decide, on the agent's behalf, which question is next, or that the
  objective is already answered. If the agent selects nothing and says why,
  relay that — it is a correct outcome, not a failure to work around.
- Never add a question because the user asked for one when the agent declined.
  Selecting nothing is a legitimate result when the objective is already
  answered at a defensible tier.
