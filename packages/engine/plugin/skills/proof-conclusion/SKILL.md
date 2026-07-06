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

**Data values are lowercase** (the table labels are capitalized for readability, but the `tier` field stored in `research.json` must be one of `proved` / `probable` / `possible` / `not_proved` / `disproved` — case-sensitive).

### 3. Select the proof conclusion form

- **Statement** — a few cited sentences, no explanation needed. Budget: ≤~150 words.
- **Summary** — multiple sources correlate; weight clearly one direction. Budget: ~300–500 words.
- **Argument** — significant conflicts, only indirect evidence, competing candidates, or a reader would ask "but what about...?" Use only when that bar is met; budget: ≤~800 words.

Do not restate evidence already quoted verbatim elsewhere — cite it. Most conclusions require a Summary or Argument. See `references/gps-proof-writing.md` for full selection tests.

### 4. Write the narrative markdown

The `narrative_markdown` is the **authoritative GPS conclusion** — if structured fields disagree, the narrative governs. It must be **self-contained**: readable without the JSON and uploadable to FamilySearch as a Memory/Document. Write in the Statement / Summary / Argument form selected above (section headings, evidence summary, conflict resolution, tier declaration, inline citations on every factual claim). Organize by significance, not chronology. Name informants when their identity affects weighing. State source classifications explicitly so the reader sees the three-layer analysis.

### 5. Write the proof_summaries entry

`research_append({ projectPath, section: "proof_summaries", op: "append", entry })` without an `id` — the tool assigns `ps_NNN`, validates the whole project, and writes nothing on failure. Surface `{ ok: false, errors }` and fix before retrying.

**Required fields in `entry`:** `question_id` (the `q_` this conclusion answers), `tier` (lowercase enum from §2), `vehicle` (lowercase enum from §3: `statement` / `summary` / `argument`), `supporting_assertion_ids` (array of `a_` ids that ground the conclusion), `resolved_conflict_ids` (array of `c_` ids the conclusion resolves — may be empty `[]`), `exhaustive_search_summary` (one-paragraph string describing what was searched and what wasn't, even at probable/possible tiers), and `narrative_markdown` (the self-contained narrative from §4). Omitting any of these causes the project schema validation to reject the entry and `research_append` writes nothing.

On re-invocation where a proof summary for this question already exists, use `op: "update"` with the existing `ps_` id — **never append a second summary for the same question**. `op: "update"` shallow-merges, so pass `entryId: "ps_NNN"` plus a `fields` object containing ONLY the fields that changed — do NOT regenerate or re-emit the full entry (especially `narrative_markdown`) when just a couple of fields change.

### 6. Update tree.gedcomx.json (tier >= probable)

Use `tree_edit` to add facts (`add_fact` with `primary: true`), relationships (`add_relationship`), and source entries (`add_source` for a new tree source, or `update_source` with its `sourceId` to refine an existing one). A tree `source` accepts only `title` (required), `citation`, `author`, and `url` — copy the finalized `research.json` `sources[].citation` string into the **`citation`** field; **never put citation text in a `description` field** (the tree schema allows no other keys, so the whole `tree_edit` write fails validation). **Batch all of these into ONE `tree_edit` call via its `ops[]` array** rather than one call per edit — the tool applies every op to a single in-memory tree, validates once, and writes once (all-or-nothing), and ids allocated by earlier ops are visible to later ops (so an `add_source` can reference a fact added earlier in the same batch). Set source reference `quality`: 3 = original+primary+direct; 2 = original+secondary or derivative+primary; 1 = derivative+secondary; 0 = authored. On downgrade, remove the concluded fact or relationship with a `remove` op in the same batch.

**Person merging:** proof-conclusion decides WHETHER to merge; the merge tool repoints all references. Before any merge: (1) check `source_attachments` — if the record is already in the tree, stop; (2) call `merge_warnings` as a dry-run — `severity: "error"` blocks (revisit identity; only override with explicit user confirmation and a logged explanation); `severity: "warning"` is advisory. Get confirmation, then call `merge_tree_persons` or `merge_record_into_tree`.

After the single batched `tree_edit` (or a merge), run `check-warnings` **once** (see `references/validation-protocol.md`) — not after each op.

### 7. Do not modify the question

**This skill does not write the `questions` section.** Leave it entirely untouched, including the question referenced by `proof_summaries[].question_id`.

Marking the question `resolved` (setting `resolved`, `resolution_assertion_ids`) is `question-selection`'s job; the `exhaustive_declaration` belongs to `research-exhaustiveness`. The proof's only link to its question is `proof_summaries[].question_id`. After writing the proof, recommend `question-selection` as the next step.

**Never set `status`, `resolved`, `resolution_assertion_ids`, or `exhaustive_declaration` on the question.** This skill writes only `proof_summaries` and `project` on `research.json`, plus `persons`/`relationships`/`sources` on `tree.gedcomx.json`.

### 8. Update project status

`project.updated` is stamped for you — do **not** set it yourself. Any `research_append` on the `project` section stamps `updated` to today's date and accepts no field except `status` (passing `updated` is rejected).

- If ALL questions are now `resolved`, call `research_append({ section: "project", op: "update", fields: { status: "completed" } })` — the same write stamps `updated`.
- Otherwise (no status change), call `research_append({ section: "project", op: "update", fields: {} })` to stamp `updated` alone.

**Never pass `updated` in `fields`.**

### 9. Present

**OUTPUT ECONOMY (latency):** The proof_summaries entry — including the full `narrative_markdown` — is ALREADY persisted to research.json by `research_append`, and any tree facts by `tree_edit`. Wall-clock time is ~linear in the tokens you generate (~16–20 ms/token, independent of model tier), so generating fewer tokens is the single biggest latency lever. Do NOT reproduce the persisted narrative, the full argument, or a per-assertion walkthrough in chat — that prose belongs in the persisted artifact, not echoed here.

Present a terse summary ONLY:

- **Tier + rationale** — the tier and a one-to-two-sentence why (which GPS components are met vs. incomplete).
- **What was written** — the `ps_NNN` id, plus a concise bulleted "what changed" in the tree (facts / relationships / sources added or removed, with ids/counts) — not the prose. One short line per tool action.
- **Next step** — more questions → question-selection; all resolved → "The project is complete."; tier could advance → question-selection or research-plan (name in one line what would advance the tier).

The full narrative lives in the persisted `proof_summaries` entry — point the user there rather than reprinting it.

**Exception — review / assessment mode (no new proof written).** When this
invocation does NOT write a new or updated `proof_summaries` entry — e.g.
the user asks whether an existing conclusion meets GPS, or to assess the
current evidence without concluding — the reasoned assessment IS the
deliverable and exists only in your chat reply. Give the full assessment
(which GPS components are met vs. missing, and why), not a terse summary:
there is no persisted artifact to point to, so trimming here deletes the
entire output. The OUTPUT ECONOMY rule above applies only to content that
is already persisted.

## Important rules

- **The narrative is authoritative.** Structured fields follow it, not the reverse.
- **Never use Proved with hedging.** Proved states fact; anything tentative is Probable or below.
- **Cite everything; acknowledge limitations.** State what was not searched, what conflicts remain, what assumptions are made. A well-written "Not Proved" is better than a fabricated "Proved."
- **Do not resolve conflicts here** — recommend conflict-resolution. Do not evaluate exhaustiveness here — reference the existing declaration and tier accordingly.

## Re-invocation behavior

**Writes:** `proof_summaries[]` and `project` (`updated`, optionally `status`) in `research.json`; `persons[].facts[]`, `relationships[]`, and `sources[]` in `tree.gedcomx.json` when tier ≥ probable.

**On repeat invocation for the same question:** update the existing `ps_NNN` in place via `research_append({ section: "proof_summaries", op: "update", entryId: "ps_NNN", fields: { /* only the changed fields */ } })` — the tool shallow-merges just those fields, so pass ONLY what changed and do NOT regenerate the full entry or re-emit `narrative_markdown` when it is unchanged. Never append a second proof_summary for the same `question_id`. Keep the tier/form re-selection terse — do NOT produce a full old-vs-new before/after narrative comparison table. On tier downgrade to `not_proved`/`disproved`, remove the previously concluded fact/relationship from the tree via `tree_edit({ operation: "remove", ... })`.

**Never duplicate:** more than one `proof_summary` for the same `question_id`. Never write to the `questions` section (see §7).
