---
name: research
model: claude-sonnet-4-6
description: Drives the full GPS (Genealogical Proof Standard) research
  workflow on a research objective, invoking the right sub-skills in
  the right order based on current research.json state. Iterates from
  question selection through proof conclusion until all questions are
  resolved. Use when the user says "research <objective>", "/research
  <question>", "find <relative>", "investigate <person>", "answer this
  research question", or wants to hand off a full research objective
  without driving each step themselves. Especially useful for beginning
  genealogists who don't yet know which sub-skill to invoke when. Also
  the entry point for autonomous runs — when the user message contains
  `--autonomous`, proceed without pausing for clarifying questions and
  use best judgment for any decisions that would normally prompt the
  user. Do NOT use when the user wants to drive a specific step
  directly (use question-selection, research-plan, search-records,
  etc.), when the user wants only a status summary (use
  project-status), or when no research.json exists yet (use
  init-project first).
allowed-tools:
  - validate_research_schema
---

# /research — Full GPS Research Workflow

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

You drive the full Genealogical Proof Standard (GPS) workflow on the
user's research objective. Rather than the user invoking each
sub-skill in turn, you read `research.json` to determine the current
state and invoke the appropriate sub-skill, then iterate.

This skill is intentionally a thin orchestrator — the GPS work
itself happens in the sub-skills. Your job is to keep the workflow
moving.

## Autonomous mode

If the user message contains `--autonomous`, proceed without pausing
for clarifying questions. Use your best judgment for any decision
that would normally prompt the user (which records to prioritize
when several are plausible, how to weight conflicting evidence, when
to declare exhaustiveness). Log the decision and your rationale in
the appropriate research.json field (log entry, assertion rationale,
or conflict resolution analysis) so the audit trail captures it.

Otherwise (interactive mode), surface meaningful decisions to the
user as you encounter them.

## What to do

1. **Read `research.json`.** Identify the current state: which
   questions exist, which have plans, which plans have log entries,
   which entries have produced assertions, which are classified,
   which are linked to persons, whether conflicts are present, and
   whether each question is resolved.

2. **Pick the next sub-skill based on state.** Use these routing
   cues — defer to each sub-skill's own "Use when" guidance when
   state is ambiguous:

   | If research.json has... | Invoke |
   |-------------------------|--------|
   | Objective but no questions | `question-selection` (derive first question) |
   | A question with no plan | `research-plan` |
   | Plan items not yet executed | `search-records` (or `search-external-sites` for non-FS sources) |
   | Log entries with no assertions extracted | `record-extraction` |
   | Assertions needing GPS three-layer classification | `assertion-classification` |
   | Assertions not yet linked to persons | `person-evidence` |
   | Evidence conflicts present | `conflict-resolution` |
   | Identity uncertainty across assertions | `hypothesis-tracking` |
   | All plan items for a question are `completed` or `skipped`, and analysis above is done | `research-exhaustiveness` |
   | `research-exhaustiveness` returned "not yet exhaustive" with gaps to fill | `research-plan` (extend the plan) or `question-selection` (FAN pivot) |
   | A question is at `status: "exhaustive_declared"` with no `proof_summaries` entry yet | `proof-conclusion` (writes the proof and flips the question to `resolved`) |
   | All questions are `resolved` and `project.status` is `completed` | Stop |

   Exhaustiveness is the last gate before proof. It evaluates a
   question only after its plan has been executed and the resulting
   evidence has been extracted, classified, person-linked, and
   conflict-resolved — the 5 threshold questions and 7-point stop
   criteria cannot be answered without those upstream artifacts.

3. **Iterate.** After each sub-skill returns, re-read `research.json`
   and pick the next step. New evidence may reveal new questions —
   return to `question-selection`. Resolved conflicts may unblock
   `proof-conclusion`. Do not assume the chain is linear; the same
   sub-skill may be invoked multiple times across the run.

4. **Validate periodically.** After significant state changes, run
   `validate_research_schema` to catch schema errors before they
   compound across many entries.

## When to stop

Stop when one of:

- `project.status == "completed"` — proof-conclusion has set this
  after writing summaries for all resolved questions
- The user explicitly halts you
- You hit a genuine blocker (no more accessible records, an
  irreducible conflict, missing access to a required repository) —
  in this case, summarize what was accomplished and what is blocked,
  then stop

In autonomous mode, do not stop just because a decision is hard.
Make the call, log the rationale, and continue. The audit trail
captures the choice for later review.

## What this skill does not do

- It does not introduce new GPS logic. Every sub-skill encodes its
  own portion of the GPS standard; this skill only routes between
  them.
- It does not skip steps. GPS depends on the full chain —
  classification precedes person-linking, person-linking precedes
  conflict detection, conflict resolution precedes proof. Shortcuts
  break the audit trail.
- It does not interview the user for project setup. If
  `research.json` does not exist, route to `init-project` first.
