# Deep-Dive Brief — `person-evidence`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Genealogical-judgment-heavy — the day is identity-resolution reasoning, not test mechanics. This is the best-covered analysis skill (7 tests); the `same_person` score-vs-qualitative matrix is already strong, so don't manufacture duplicates. Real cost is scenario state for the two untested behaviors (stub creation, more neighbor negatives), plus reusing the existing `same-person-flynn-*` fixtures.
**Files:** SKILL.md (486 lines) · references ×4 (245 lines) · tests ×7 · rubric ✓ (27 lines).

## What this skill does
GPS Step 3 (identity resolution). For an assertion in role X of record Y, it decides whether that person is the same as GedcomX person Z, then writes `person_evidence` entries (confidence + rationale) into `research.json`. It enforces the match-threshold policy and links **every role** in a multi-person record — a relationship assertion links to BOTH persons. **person-evidence now owns the household skeleton in the tree** (moved off record-extraction, which is assertion-only): when a persona matches no existing person it **mints** that person via `materialize_facts` create-or-enrich so it arrives carrying the record's **SOURCED evidence facts** (not a name-only stub), and for a household record it likewise mints each member — the subject's siblings included — then writes the parent-child / spouse **edges** via `tree_edit` `add_relationship`, each edge carrying a source-ref resolved from the relationship assertion's `source_id` (a pre-1880 census parent-child edge is indirect → lower ref quality). It runs a `merge_warnings` **dry-run coherence gate** over the pre-materialization household set before committing the members. It also AUDITS existing `person_evidence`: confidence calibration and whether other roles still need their own link. It calls the `same_person` MCP tool for a match score and persists it, but the score is advisory: a high score must NOT auto-link past a qualitative conflict, and a low score must NOT dismiss a strong qualitative correlation. Full-text assertions get a qualitative fallback (no score). Calls `validate_research_schema` after writing.

## Where everything lives
- `plugin/skills/person-evidence/SKILL.md`
- `plugin/skills/person-evidence/references/correlation-techniques.md` (81 lines)
- `plugin/skills/person-evidence/references/evidence-standards.md` (106 lines)
- `plugin/skills/person-evidence/references/person-profiles.md` (44 lines)
- `plugin/skills/person-evidence/references/validation-protocol.md` (14 lines)
- `eval/tests/unit/person-evidence/` — `link-death-cert-to-patrick.json`, `link-relationship-to-both-persons.json`, `negative-search-for-records.json`, `match-score-persisted.json`, `fts-assertion-qualitative-fallback.json`, `high-score-conflict-not-auto-linked.json`, `low-score-strong-correlation-still-links.json`, `rubric.md`
- Scenarios used: `mid-research-flynn`, `flynn-record-matching`. Fixtures: `same-person-flynn-strong`, `same-person-flynn-conflict`, `same-person-flynn-variant`.

## Current tests (7)
| id | covers | type | fixtures |
|----|--------|------|----------|
| ut_person_evidence_001 | Confidence calibration on death-cert link `pe_005` (audit path) | positive | — |
| ut_person_evidence_002 | Relationship `a_010`/`pe_004` links to BOTH persons (multi-person awareness) | positive | — |
| ut_person_evidence_003 | "Find more records confirming…" → routes to `search-records` | negative | — |
| ut_person_evidence_010 | Persist the `same_person` score on a `record_search`-sourced link | positive | same-person-flynn-strong |
| ut_person_evidence_011 | Full-text assertion takes the qualitative fallback (no score) | positive | — |
| ut_person_evidence_012 | High score must NOT auto-link past a qualitative conflict (safety) | positive | same-person-flynn-conflict |
| ut_person_evidence_013 | Low score must NOT dismiss a strong qualitative match | positive | same-person-flynn-variant |

> Coverage is genuinely good on the score-vs-qualitative matrix (high/low/fallback/conflict all fired). The two honest gaps are behavioral, not duplicative: stub-person creation, and three of four named neighbors lack a negative.

## Gaps — new tests to add
**Positive (untested behaviors, not score-matrix duplicates):**
- **Fact-carrying mint when nothing matches** (`stub-creation-new-son`, now covered) — a link where no GedcomX person is plausible requires **minting the person via `materialize_facts` create-or-enrich carrying the record's sourced fact(s)** (not a name-only stub) + a `person_evidence` entry pointing to it, and — when the record states a relationship — the parent-child edge via `tree_edit` `add_relationship` with a source-ref. Not a forced bad match.
- **Household skeleton from a census** — when the subject appears as a child on a multi-person household record, person-evidence must mint each sibling member with its sourced facts and write the parent-child edges (pre-1880 → indirect), running the `merge_warnings` coherence gate first and FLAGGING (never overwriting) tree children absent from the record. This coverage MOVED off record-extraction (now assertion-only) and is tested by `household-skeleton-siblings.json` (ut_person_evidence_021), graded by the rubric's *Person minting and connecting edges* dimension.
- **Audit surfaces an un-linked sibling role** — an existing record where one role is linked but a second role still needs its own `person_evidence`; require the audit to flag it (extends `_002`'s multi-person rule into the audit path).

**Negative (boundaries from the description):**
- → `search-records`: "Find more records confirming Patrick is the son" — **covered** (`ut_person_evidence_003`).
- → `record-extraction`: "Pull the facts out of this death certificate and add them as assertions."
- → `conflict-resolution`: "Two different Patrick Flynns are competing for this record — sort out which one is real."
- → `tree-edit`: "These two persons are confirmed the same — merge them in the tree."

## ⚠️ Known issues
- Fact-carrying mint (`stub-creation-new-son`) and the **multi-member household** case (`household-skeleton-siblings`: siblings + edges + `merge_warnings` gate + pre-1880-indirect + discrepancy-flag) are both **tested and graded** by the rubric's merged *Person minting and connecting edges* dimension — mint carries sourced facts, and the connecting edges carry source-refs (direct for a will's "my son", indirect for a pre-1880 census).
- Three of four "Do NOT use" neighbors (`record-extraction`, `conflict-resolution`, `tree-edit`) have **no negative test**; only `search-records` is covered. `conflict-resolution` is the most important miss — it's the nearest neighbor (competing identities vs. same-identity linking).
- Confirm the rubric scores the **score-is-advisory** invariant (that a persisted high/low score does not override qualitative judgment); `_012`/`_013` only matter if a dimension grades it.

## Fixture work
Light on net-new. All seven existing tests reuse `mid-research-flynn` / `flynn-record-matching` and the three `same-person-flynn-*` MCP fixtures — the gap tests reuse the same scenarios. The stub-creation test needs a scenario state with an assertion that has no plausible GedcomX match (a new project-state stub, not a new MCP fixture); a `same_person` low/no-match fixture may be reusable here. The neighbor negatives are pure routing prompts — no fixtures.

## Definition of done
Confirm the rubric grades stub-creation and the score-is-advisory invariant → add the stub-creation positive + the audit-sibling-role positive → add the three missing neighbor negatives (`record-extraction`, `conflict-resolution`, `tree-edit`) → rubric/SKILL polish → full harness pass + CRUD review + PR.
