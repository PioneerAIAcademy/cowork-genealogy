---
name: proof-conclusion
description: Writes GPS-conformant proof conclusions — selects the tier
  (Proved/Probable/Possible/Not Proved/Disproved), chooses the form
  (Statement/Summary/Argument), and writes a self-contained narrative
  markdown uploadable to FamilySearch.
  GPS Step 5 — Soundly Reasoned, Coherently Written Conclusion. Use when
  the user says "write the conclusion", "what's the proof?", "summarize
  the evidence", "write a proof statement", "write a proof argument",
  "conclude this question", when assertions and person_evidence exist for
  a question or a hypothesis reaches supported status. ALSO for
  review of an existing proof — "does my proof meet the GPS", "assess
  ps_NNN against the GPS components", "review my existing proof summary"
  (invokes the gps-mentor critique). Do NOT use
  when the user wants to resolve a conflict (use conflict-resolution),
  wants to select the next question (use question-selection), or wants to
  classify evidence (use record-extraction, which owns classification).
allowed-tools:
  - project_context
---

# Proof Conclusion

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

## 1. Identify the question

Resolve the user's request to ONE `q_` id via `project_context`. If the request names no question and more than one is open, ask which before proceeding.

**Read nothing else, and judge nothing.** Do not query assertions, conflicts, person_evidence, or existing summaries, and do not form a view on whether the question is ready to conclude. The preconditions gate — classification, identity links, and unresolved conflicts — belongs to the agent, which declines and routes when it fails. A conflict you judge "collateral" from out here is the gate being decided by the one participant that cannot see the evidence.

## 2. Delegate the conclusion

Invoke `@plugin:proof-conclusion` with a delegation message carrying `questionId` and `projectPath`, and asking it to **evaluate whether the question can be concluded, and to conclude it only if its preconditions hold**.

**Do not ask it to "write a proof conclusion."** Ask it to run its preconditions gate first and to decline and route if the gate fails. The agent's gate is prose in its body; an instruction from you to write overrides it, and the agent will write past a hard block it would otherwise have stopped on. This is a measured failure mode, not a hypothetical one.

The agent owns every step from there: preconditions, tier and form selection, the narrative, the `proof_summaries` write, and the tree encoding at tier ≥ probable.

**Do not write `proof_summaries` yourself.** That section is routed to the agent and a direct `research_append` on it is denied. If the delegation fails, report the failure and stop — do not write the entry inline.

One invocation per question. For a question that already has a `ps_NNN`, invoke the agent the same way; it updates in place.

## 3. Relay

Relay the agent's returned summary as-is. Do not re-generate the narrative, re-state the argument, or add a per-assertion walkthrough — the narrative is persisted in the `proof_summaries` entry.

Then recommend the next step: more open questions → question-selection; all resolved → "The project is complete."

## Re-invocation behavior

**Writes:** nothing directly. Every write is made by the `proof-conclusion` agent this skill delegates to — `proof_summaries[]`, the concluded question's resolution fields, and `project` in `research.json`, and `persons[].facts[]`, `relationships[]` and `sources[]` in `tree.gedcomx.json` at tier ≥ probable.

**On repeat invocation for the same question:** delegate again, unchanged. The agent finds the existing `ps_NNN` and updates it in place rather than appending a second summary. Do not pre-check for an existing summary and do not tell the agent to append.

**Safe to re-invoke.** A repeat run re-concludes the same question; it never duplicates a summary.

## Never

- Never write `research.json` yourself. The agent writes the summary and the question's resolution together, in one batch — do not resolve the question here, and do not split the two into separate calls.
- Never resolve a conflict here — recommend conflict-resolution.
- Never append a second `proof_summary` for a `question_id` that already has one.
- Never decide, on the agent's behalf, that a precondition does not apply. If the agent declines and routes, relay that — it is the correct outcome, not a failure to work around.
