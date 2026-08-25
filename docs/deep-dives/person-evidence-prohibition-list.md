# person-evidence — prohibition list (Step 1 of the deep dive)

Built 2026-08-24 for issue #1646, against
`packages/engine/plugin/skills/person-evidence/SKILL.md` at `11c8e2cb` (725 lines).

Every line below is a rule the body states and that **can be checked against a
transcript** — the response text, `output.tool_calls`, or `output.file_changes`.
Judgement rules ("weigh the data points by reasoning directly", "build a profile")
are deliberately absent: they are the judge's, not this list's.

Save and reuse. The next auditor starts here instead of re-reading 725 lines.

**Columns.** *Where* = what you look at to decide. *Guard* = whether anything
checks it today (`—` = nothing does; a name = the validator in
`eval/harness/validators/test_person_evidence.py`; `[tag]` = that validator only
runs on tests carrying the tag, i.e. it is inert on the other ~19).

---

## A. Request mode (Step 0)

| # | Rule (body wording) | Where | Guard |
|---|---|---|---|
| A1 | On a find/search/pull-new-records request — even "to confirm" — "Do **not** create, re-evaluate, or audit any `person_evidence` links", say it belongs to search-records, "and stop" | file_changes + response | — |
| A2 | Review-only mode: "**Produce a written analysis only.** Do NOT write to `research.json` or `tree.gedcomx.json`. Do NOT create new `pe_` entries. Do NOT modify the entry under review" | file_changes | `test_audit_review_makes_no_writes` `[audit-review]`, `test_pe005_unchanged_when_review_confirms` `[pe_005]`, `test_no_unrelated_new_pe_in_focused_review` `[audit-review]` |
| A3 | A review that surfaces a concern: describe it, then "**stop and ask the user to authorize the action** before doing it" | response | — |
| A4 | A review that reveals new linking work: note it and ask. "Don't roll it into the same response." | response + file_changes | — |

## B. Reading project state (Step 1)

| # | Rule | Where | Guard |
|---|---|---|---|
| B1 | Use "**`research_query`, not a whole-file `Read`** of research.json" when entering cold | tool_calls | `test_research_query_called_for_coverage` `[research-query-coverage]` |
| B2 | "**`assertionId` is NOT a valid filter on the `assertions` section**" — query `person_evidence` with `assertionId` instead. "Do not guess" | tool_calls (args) | — |

## C. Scoring with `same_person` (Step 2)

| # | Rule | Where | Guard |
|---|---|---|---|
| C1 | Call `same_person` when the assertion is `record_search`-sourced (non-null `record_persona_id`) and a serious tree candidate exists | tool_calls | — **(the one the suite most needs; see #1646 comment 4)** |
| C2 | `gedcomx2` is the candidate plus its matching mob (focus, parents, spouses, children, **siblings**) — "**Not** the whole tree" | tool_calls (args) | — |
| C3 | "**Cap the mob at 40 people**" | tool_calls (args) | — |
| C4 | Household: after the focus call, call `matchRelatives: true` "**once**" — not per relative | tool_calls | — |
| C5 | FTS-, image-, PDF-sourced or `results_ref: null` → no score is available | tool_calls + file_changes | `test_fts_assertion_no_score` `[no-score-fallback]` |

## D. Match threshold policy (Step 3) — "**This policy is non-negotiable**"

| # | Rule | Where | Guard |
|---|---|---|---|
| D1 | Weak match → `speculative` only, and "**Pause for user confirmation** … **Never auto-link**" | file_changes + response | — |
| D2 | "A **qualitative conflict caps confidence regardless of score** … A high score never auto-links past a conflict" | file_changes | `test_high_score_conflict_not_confident` `[score-conflict]` |
| D3 | A patronymic mismatch or unaccounted-for name element caps confidence at `speculative` **and** "must be **named explicitly in the `pe_` rationale**" — "do not rationalize it inline as 'close enough'" | file_changes (rationale text) | — |
| D4 | Strong household relationship-fit on a fact-less stub is **Moderate** (`probable`), not Weak — "Do **not** down-rate it to Weak purely because the stub lacks vitals" | file_changes | — |
| D5 | Autonomous mode resolves "**downward, never upward**": a weak or `speculative`-capped match becomes a **no-link**. "Do not create the pe_ entry." | file_changes | — |
| D6 | The autonomous rejection is stated explicitly — "the candidate, the score, and exactly what conflicted" — in the summary, "**never in `hypotheses` or `log`**" | response + file_changes | — |
| D7 | **Disclose the score**: whenever a score was computed, state it in the `pe_` rationale | file_changes (rationale text) | — |
| D8 | A low score caused by a **transcription/surname variant** does NOT make the match Weak; "document the variant explanation in `rationale`" | file_changes | `test_low_score_variant_still_links` `[score-variant]` |
| D9 | A **degenerate near-zero score** on an unresolvable id is "**no score available**"; fall back to correlation and "Note in the rationale that the score was uninformative and why" | file_changes | — |
| D10 | "**Never auto-merge persons.**" No `merge_tree_persons`; links only | tool_calls | — |

## E. Writing `pe_` entries (Steps 4 and 6)

| # | Rule | Where | Guard |
|---|---|---|---|
| E1 | Persist "in ONE batched `research_append({ ops: [...] })` call" | tool_calls (count) | — |
| E2 | "Omit each entry's `id`, `created`, and `superseded_by`" | tool_calls (args) | — |
| E3 | `match_score` carries the score when scored, null otherwise | file_changes | `test_match_score_persisted` `[match-score]` |
| E4 | "**Rationale is mandatory.** … 'Name matches' is insufficient" | file_changes | `test_new_person_evidence_have_required_fields` (presence only, not quality) |
| E5 | "**One pe_ entry per assertion-person pair.** Don't create duplicate links" | file_changes | — |
| E6 | Revision: "**never delete the old entry**" — append the correction, then `update` the old entry's `superseded_by` | file_changes | `test_person_evidence_no_deletions` (universal) |

## F. Minting persons (Step 5)

| # | Rule | Where | Guard |
|---|---|---|---|
| F1 | Mint via `materialize_facts` create-or-enrich — "do **not** hand-build a name-only stub with `tree_edit add_person`" | tool_calls | `test_stub_person_created_and_linked` `[stub-creation]` |
| F2 | "**Never use FamilySearch IDs for a new person**" | tool_calls (args) | — |
| F3 | A brand-new stub is "`probable` at most … Do not use `confident` for a brand-new stub" | file_changes | — |

## G. Household skeleton (Step 7)

| # | Rule | Where | Guard |
|---|---|---|---|
| G1 | "If **no household parent is in the tree**, surface that gap plainly and do **not** fabricate a parent to anchor the household on" | file_changes + response | — |
| G2 | A tree person expected in the household but **absent from the record** is **flagged as an identity question** — never renamed or overwritten | response + file_changes | — |
| G3 | Dry-run `merge_warnings` **before any write** when a `candidateGedcomx` is available; the **error tier blocks** materialization | tool_calls (order) | — |
| G4 | No candidate document → skip the gate **and note in the rationale** that the dry-run was not possible | file_changes | — |
| G5 | "**Materialize every member in ONE batched call** … **Batch this; do not loop one call per persona**" | tool_calls (count) | — |
| G6 | A matched persona whose assertions are entirely relationship-implying is **skipped** for materialization | tool_calls | — |
| G7 | "**Write the edges in ONE batched call**" — one `tree_edit({ ops: [...] })` | tool_calls (count) | — |
| G8 | Pass **`sourceAssertionId`**; "do **not** hand-walk `assertion.source_id → research source → tree S-entry` and supply a literal `relationship.sources` yourself" | tool_calls (args) | — |
| G9 | "**Both-sided `pe_` entries are mandatory** … write the link for the other party **in the same `research_append` call**. Do not defer it, do not ask first" | file_changes + response | `test_a010_has_second_side_link` `[multi-person-awareness, a_010]`, `test_pe004_unchanged_when_adding_second_side` `[multi-person-awareness, pe_004]` |
| G10 | "Every household persona ends up **paired** … with none left dangling" | file_changes | — |

## H. Cross-cutting (Step 8 and "Important rules")

| # | Rule | Where | Guard |
|---|---|---|---|
| H1 | After creating links and stubs, "invoke `check-warnings` on the affected persons" | tool_calls / response | — |
| H2 | A sensitive family-structure finding is "call[ed] out explicitly in the `rationale`", not folded into a routine entry | file_changes | — |
| H3 | Outside the household-skeleton exception, "Do **not** create the `Couple`/`ParentChild` relationship itself, and do **not** write the couple-event fact (Marriage, Divorce) here" | tool_calls + file_changes | — |
| H4 | A single non-household record stating a parentage (a baptism naming a mother) is **not** a household skeleton — `pe_` links only, defer the edge | tool_calls | — |
| H5 | Tool use stays inside `allowed-tools`: `research_append`, `research_query`, `tree_edit`, `same_person`, `materialize_facts`, `merge_warnings` | tool_calls | `test_tool_allowlist` (universal, in `test_universal.py`) |

---

## Coverage summary

**36 checkable rules. 11 have a guard, and 9 of those 11 are tag-gated** — they
run on one or two named tests and are inert on the other ~19. Only three
person-evidence validators are universal (`no_deletions`,
`references_valid_assertion`, `have_required_fields`), and `have_required_fields`
checks that `rationale` is non-empty, not that it says anything (E4).

**25 rules have nothing checking them at all.** The densest unguarded blocks are
**G (household skeleton, 8 of 10 unguarded)** and **D (threshold policy, 7 of 10
unguarded)** — which is exactly where the body is most emphatic
("non-negotiable", "mandatory", "never").

The single highest-value gap is **C1**: nothing verifies that `same_person` was
called when the assertion carries a `record_persona_id`. `rubric/Score discipline`
nominally grades it, and `ut_person_evidence_n7v` shows the miss is real and
intermittent (#1646 comment 4: fail / pass / partial across three runs, the
discriminator being whether the call happened at all).

## Known gap this list does not cover

The lead's finding of 2026-08-22 (#1646) is a rule the body **does not state** and
so cannot appear above: `docs/specs/tree-materialization-spec.md` assigns
person-evidence "write the linked persona's assertions as sourced facts/names onto
the tree person" for *every* linked persona, but SKILL.md only covers it in Step 5
(persona matches **no** existing person) and Step 7.3 (**multi-person** household
record). A single-person record matched to an existing tree person — a death
certificate matched to the subject — gets a `pe_` link and no facts. Verified
against the body on 2026-08-24: Step 4 has no materialize instruction.
