---
name: proof-conclusion
model: claude-sonnet-4-6
description: Writes GPS-conformant proof conclusions — selects the
  confidence tier (Proved/Probable/Possible/Not Proved/Disproved), chooses
  the proof conclusion form (Statement/Summary/Argument), and produces a
  self-contained narrative markdown that can be uploaded to FamilySearch.
  Updates tree.gedcomx.json when the tier reaches probable or higher.
  GPS Step 5 — Soundly Reasoned, Coherently Written Conclusion. Use when
  the user says "write the conclusion", "what's the proof?", "summarize
  the evidence", "write a proof statement", "write a proof argument",
  "conclude this question", when assertions and person_evidence exist for
  a question, or when a hypothesis reaches supported status. Do NOT use
  when the user wants to resolve a conflict (use conflict-resolution),
  wants to select the next question (use question-selection), or wants to
  classify evidence (use assertion-classification).
allowed-tools:
  - research_append
  - tree_edit
  - merge_tree_persons
  - merge_record_into_tree
  - merge_warnings
  - source_attachments
---

# Proof Conclusion

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

**Read `references/gps-proof-writing.md` before writing any conclusion.** It contains GPS standards, proof-conclusion form selection tests, writing standards, and phrasing guidance this skill depends on.

## Preconditions

Before writing, verify: assertions exist for the question (extracted, classified); person_evidence links them to persons; related conflicts are resolved or acknowledged. If not, tell the user what is missing and recommend the appropriate skill — do not write a conclusion with unclassified or unlinked evidence.

If research is **not declared exhaustive**, you may still write at `probable` or `possible` tier. State the research is ongoing and what additional evidence is needed.

## Steps

### 1. Gather evidence from research.json

All assertions linked to the question via `extracted_for_question_ids`, their person_evidence entries, resolved conflicts, related hypotheses, the exhaustive declaration, and the timeline for the subject.

### 2. Select the confidence tier

| Tier | When to use |
|------|-------------|
| **Proved** | ALL five GPS components met. 2+ independent original sources with primary information agree. All conflicts resolved. Research declared exhaustive. |
| **Probable** | Strong preponderance, but one or more GPS components incomplete — fewer independent sources, secondary/indirect evidence, minor gaps, or research not exhaustive. |
| **Possible** | Credible hypothesis, some supporting evidence, significant gaps. |
| **Not Proved** | Insufficient evidence to lean toward any conclusion. |
| **Disproved** | Evidence affirmatively refutes the hypothesis. |

**Decision rules:** Unresolved conflicts are a **hard block on Proved**. Hedging language ("suggests," "appears to be") blocks Proved — proved means stating the conclusion as fact. When in doubt, tier down.

### 3. Select the proof conclusion form

- **Statement** — a few cited sentences, no explanation needed.
- **Summary** — multiple sources correlate; weight clearly one direction.
- **Argument** — significant conflicts, only indirect evidence, competing candidates, or a reader would ask "but what about...?"

Most conclusions require a Summary or Argument. See `references/gps-proof-writing.md` for full selection tests.

### 4. Write the narrative markdown

The `narrative_markdown` is the **authoritative GPS conclusion** — if structured fields disagree, the narrative governs. It must be **self-contained**: readable without the JSON and uploadable to FamilySearch as a Memory/Document. Write in the Statement / Summary / Argument form selected above (section headings, evidence summary, conflict resolution, tier declaration, inline citations on every factual claim). Organize by significance, not chronology. Name informants when their identity affects weighing. State source classifications explicitly so the reader sees the three-layer analysis.

### 5. Write the proof_summaries entry

`research_append({ projectPath, section: "proof_summaries", op: "append", entry })` without an `id` — the tool assigns `ps_NNN`, validates the whole project, and writes nothing on failure. Surface `{ ok: false, errors }` and fix before retrying.

On re-invocation where a proof summary for this question already exists, use `op: "update"` with the existing `ps_` id — **never append a second summary for the same question**.

### 6. Update tree.gedcomx.json (tier >= probable)

Use `tree_edit` (one call per edit) to add facts (`add_fact` with `primary: true`), relationships (`add_relationship`), and source entries (`add_source` — hand-write; no tool source op yet, copy the finalized `research.json` `sources[].citation`). Set source reference `quality`: 3 = original+primary+direct; 2 = original+secondary or derivative+primary; 1 = derivative+secondary; 0 = authored. On downgrade, remove the concluded fact or relationship with `tree_edit({ operation: "remove", … })`.

**Person merging:** proof-conclusion decides WHETHER to merge; the merge tool repoints all references. Before any merge: (1) check `source_attachments` — if the record is already in the tree, stop; (2) call `merge_warnings` as a dry-run — `severity: "error"` blocks (revisit identity; only override with explicit user confirmation and a logged explanation); `severity: "warning"` is advisory. Get confirmation, then call `merge_tree_persons` or `merge_record_into_tree`.

After any tree edit or merge, run `check-warnings` (see `references/validation-protocol.md`).

### 7. Do not modify the question

**This skill does not write the `questions` section.** Leave it entirely untouched, including the question referenced by `proof_summaries[].question_id`.

Marking the question `resolved` (setting `resolved`, `resolution_assertion_ids`) is `question-selection`'s job; the `exhaustive_declaration` belongs to `research-exhaustiveness`. The proof's only link to its question is `proof_summaries[].question_id`. After writing the proof, recommend `question-selection` as the next step.

**Never set `status`, `resolved`, `resolution_assertion_ids`, or `exhaustive_declaration` on the question.** This skill writes only `proof_summaries` and `project` on `research.json`, plus `persons`/`relationships`/`sources` on `tree.gedcomx.json`.

### 8. Update project status

Set `project.updated` to today's date (hand-write — no tool op yet). If ALL questions are now `resolved`, set `project.status` to `completed`.

### 9. Present

Show the full narrative (formatted), the tier and rationale, what changed in the tree, what would advance the tier, and next steps: more questions → question-selection; all resolved → "The project is complete."; tier could advance → question-selection or research-plan.

## Important rules

- **The narrative is authoritative.** Structured fields follow it, not the reverse.
- **Never use Proved with hedging.** Proved states fact; anything tentative is Probable or below.
- **Cite everything; acknowledge limitations.** State what was not searched, what conflicts remain, what assumptions are made. A well-written "Not Proved" is better than a fabricated "Proved."
- **Do not resolve conflicts here** — recommend conflict-resolution. Do not evaluate exhaustiveness here — reference the existing declaration and tier accordingly.
