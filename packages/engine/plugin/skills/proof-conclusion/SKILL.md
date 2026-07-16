---
name: proof-conclusion
model: claude-sonnet-4-6
description: Writes GPS-conformant proof conclusions — selects the tier
  (Proved/Probable/Possible/Not Proved/Disproved), chooses the form
  (Statement/Summary/Argument), and writes a self-contained narrative
  markdown uploadable to FamilySearch. Updates tree.gedcomx.json at tier
  probable or higher.
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
  - research_append
  - tree_edit
  - tree_correct
  - merge_tree_persons
  - merge_record_into_tree
  - merge_warnings
  - source_attachments
---

# Proof Conclusion

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

**Read `references/gps-proof-writing.md` before writing any conclusion.** It contains GPS standards, proof-conclusion form selection tests, writing standards, and phrasing guidance this skill depends on.

## Preconditions — mandatory, mechanical gate (run before Step 1)

Run this check before touching Step 1, and show your work. A direct user
request — "write the conclusion", "move toward proof", "conclude this now" —
names the destination, not permission to skip the stops on the way there.
This gate runs regardless of how proof-conclusion was invoked.

1. Collect every assertion linked to the question via `extracted_for_question_ids`.
2. **Classification (hard block, all assertions).** For each assertion,
   confirm `information_quality` and `evidence_type` carry a real, reasoned
   value (with matching `informant` / `informant_proximity` analysis) — not
   still carrying record-extraction's best-effort default. If you cannot
   confirm `assertion-classification` has run on an assertion, treat it as
   unclassified. List any assertion IDs that fail this check. Classification
   grounds the tier, so this applies to every assertion tied to the question.
3. **person_evidence (hard block scoped to person identity).**
   `person_evidence` is identity resolution — it defeats the unsound
   assumption that a record is about your person. The hard block is therefore
   on *identity*, not on every fact. Confirm that **each person the conclusion
   depends on** — the subject and every candidate parent/relative — is
   identified by **at least one** linked assertion (a name/identity assertion
   carrying a `person_evidence` link). List any such person that has **no**
   linked identity assertion.
   Unlinked *fact* and *negative* assertions (a birth year, a co-residence, an
   "unknown father") that pertain to a person already identified above are
   **advisory, not blockers** — their person is already resolved, and GPS
   requires them to be analyzed in the narrative, not separately linked. Note
   any unlinked fact/negative IDs as advisory and proceed.
4. **Conflicts (hard block).** For each conflict touching this question's
   assertions, confirm it is `resolved` or carries an explicit
   acknowledgment. List any conflict IDs that fail this check.

**If step 2 produces failing IDs, step 3 leaves any relied-upon *person*
without a linked identity assertion, or step 4 produces failing IDs: stop.
Do not proceed to Step 1.**
Report the exact failing IDs to the user and recommend the specific skill
for each gap (`assertion-classification`, `person-evidence`, or
`conflict-resolution`). In `--autonomous` mode, route to the missing skill
automatically instead of asking — autonomous mode changes who decides, not
whether the gate runs. Advisory unlinked fact/negative assertions (step 3)
do **not** stop the gate — surface them as a note and continue.

Only when the blocking checks pass, proceed to Step 1.

If research is **not declared exhaustive**, you may still write at
`probable` or `possible` tier — but the checks above still apply
regardless of exhaustiveness tier.

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

**Decision rules:** Unresolved conflicts are a **hard block on Proved**. **An unresolved conflict that *disputes the concluded fact or relationship itself* caps the tier at `possible`** — which is below the `probable` tree-write threshold (§6), so a disputed conclusion is never encoded in the tree until the conflict is resolved. (Unresolved conflicts on *collateral* facts — details not part of the conclusion — only block Proved, not Probable.) Hedging language ("suggests," "appears to be") blocks Proved — proved means stating the conclusion as fact. When in doubt, tier down.

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

### 6. Encode the conclusion in tree.gedcomx.json (tier >= probable)

**This step — not the proof summary — is where the conclusion actually lands. Do not skip it.** The `narrative_markdown` you wrote in §5 is the *argument*; the researcher's tree stays unchanged until you write it here. If the question was a parentage (or a marriage), **the relationship that answers it is the primary output of this skill.** A concluded parentage you do NOT write as a tree relationship is an **incomplete conclusion** — the persons sit in the tree unlinked and the question is effectively unanswered in the tree, even though your narrative concluded it.

Use `tree_edit`, **batched into ONE call via its `ops[]` array**, in this order:

1. **The concluded relationship(s) FIRST** — `add_relationship` with a `relationship` object. Parentage: `{ "type": "ParentChild", "parent": "<parentId>", "child": "<childId>" }`. Marriage: `{ "type": "Couple", "person1": "<id>", "person2": "<id>" }`. Endpoints must be **existing** person ids — link the persons already in the tree, don't re-add them (`ParentChild` uses `parent`/`child`, NOT `person1`/`person2`). This is the answer to the question; write it before anything else so it cannot be dropped.
2. **Facts** — `add_fact` with `primary: true`.
3. **Source entries** — `add_source` for a new tree source (in this `tree_edit` batch), or `update_source` with its `sourceId` to refine an existing one — `update_source` lives in **`tree_correct`** (same batched `ops[]` form), so issue it as a separate `tree_correct` call. A tree `source` accepts only `title` (required), `citation`, `author`, and `url` — copy the finalized `research.json` `sources[].citation` string into the **`citation`** field; **never put citation text in a `description` field** (the tree schema allows no other keys, so the whole write fails validation).

Batching applies every op to a single in-memory tree, validates once, and writes once (all-or-nothing); ids allocated by earlier ops are visible to later ops (so an `add_source` can reference a fact or relationship added earlier in the same batch). Set source reference `quality`: 3 = original+primary+direct; 2 = original+secondary or derivative+primary; 1 = derivative+secondary; 0 = authored. On downgrade, remove the concluded fact or relationship with a `remove` op — removals live in **`tree_correct`** (a separate call with the same batched `ops[]` form), not `tree_edit`.

**Person merging:** proof-conclusion decides WHETHER to merge; the merge tool repoints all references. Before any merge: (1) check `source_attachments` — if the record is already in the tree, stop; (2) call `merge_warnings` as a dry-run — `severity: "error"` blocks (revisit identity; only override with explicit user confirmation and a logged explanation); `severity: "warning"` is advisory. Get confirmation, then call `merge_tree_persons` or `merge_record_into_tree`.

After the batched tree write(s) — the `tree_edit` batch plus any `tree_correct` call — or a merge, run `check-warnings` **once** (see `references/validation-protocol.md`) — not after each op.

**Verify the conclusion landed.** Before you present or mark the project complete, confirm the relationship(s) you concluded are now in the tree — the persons are *linked* by a `ParentChild`/`Couple` relationship, not merely added as unconnected persons. If a concluded parentage or marriage is not linked, the tree does not yet reflect your conclusion: go back and write the relationship.

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
- **What was written** — the `ps_NNN` id, plus a concise bulleted "what changed" in the tree: **name the concluded relationship(s) first** (e.g. "ParentChild: Peter Geach → Elizabeth Geach"), then facts / sources added or removed, with ids/counts — not the prose. One short line per tool action. If tier ≥ probable for a parentage or marriage question and you wrote **no** relationship, that is a bug — return to §6 before presenting.
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

**On repeat invocation for the same question:** update the existing `ps_NNN` in place via `research_append({ section: "proof_summaries", op: "update", entryId: "ps_NNN", fields: { /* only the changed fields */ } })` — the tool shallow-merges just those fields, so pass ONLY what changed and do NOT regenerate the full entry or re-emit `narrative_markdown` when it is unchanged. Never append a second proof_summary for the same `question_id`. Keep the tier/form re-selection terse — do NOT produce a full old-vs-new before/after narrative comparison table. On tier downgrade to `not_proved`/`disproved`, remove the previously concluded fact/relationship from the tree via `tree_correct({ operation: "remove", ... })`.

**Never duplicate:** more than one `proof_summary` for the same `question_id`. Never write to the `questions` section (see §7).
