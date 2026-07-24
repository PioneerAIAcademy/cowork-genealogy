# Tree Edit Rubric

Grading dimensions for tree-edit unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Data preservation

Did the edit preserve all existing facts and sources from both the original and merged records? No data should be silently dropped during merges or edits.

- **pass:** All facts, names, and source references from the input(s) survive into the output; merges combine fields without dropping data; edits change only the target field. For merges with conflicting facts that have no proof-specified value, BOTH conflicting facts survive on the keep person (per SKILL.md §"Conflicting facts during merge").
- **partial:** Most data preserved but one secondary field (a less-preferred name, a tangential source reference) is silently dropped.
- **fail:** Data systematically lost during the edit (multiple facts dropped, sources stripped), or merge collapses divergent fields into one without preserving alternates.

## Edit minimality

Did the skill make only the requested change without modifying unrelated data? Edits should be surgical — changing a birth date should not touch relationships or other persons.

- **pass:** Only the requested fields/entries are modified; unrelated facts, persons, and relationships are byte-for-byte unchanged.
- **partial:** Requested change is made but a tangential field is also touched (e.g., a name capitalization "normalized" while editing a birth date, or `standard_place` opportunistically re-resolved when only the date was wrong).
- **fail:** Substantial collateral edits beyond the request, or the skill rewrites the whole file when only one entry needed changing.

## Merge correctness

For person merges, did the skill rewrite ALL references to the deprecated person across BOTH project files, and remove the deprecated person from `tree.gedcomx.json` `persons[]`? A missed reference creates a broken foreign key that propagates silently until `validate_research_schema` (or downstream readers) catches it.

The full rewrite scope is enumerated in SKILL.md §"Person merging" Step 3:

| File | Field |
|---|---|
| `tree.gedcomx.json` | `relationships[].parent` / `.child` / `.person1` / `.person2` |
| `research.json` | `project.subject_person_ids` |
| `research.json` | `person_evidence[].person_id` |
| `research.json` | `timelines[].person_ids` |

After the rewrite, the deprecated person must be deleted from `tree.gedcomx.json` `persons[]`, and `validate_research_schema` must pass.

**When the test is NOT a merge** (no-op verify, value correction, add fact, create person, refuse-merge, negative routing, match-checking), this dimension has nothing to grade and scores `pass`. Judges must NOT score partial on a non-merge test for the absence of merge mechanics.

- **pass:** Either (a) the test is not a merge and this dimension has nothing to grade, OR (b) every reference enumerated above is rewritten from the deprecated ID to the keep ID, the deprecated person is removed from `persons[]`, and post-merge `validate_research_schema` is clean.
- **partial:** Most references rewritten, but one location is missed (e.g., a relationship updated and `subject_person_ids` updated but a `timelines.person_ids` entry still references the deprecated ID).
- **fail:** Multiple references unrewritten, OR the deprecated person remains in `persons[]` after the merge, OR `validate_research_schema` surfaces an unresolved cross-file reference and the skill does not fix it.

## Evidence grounding

Per `references/evidence-grounded-edits.md`, the tree carries **two layers**, and grounding is graded against the layer the edit touches — the old single "nothing lands until proof ≥ probable" gate no longer applies to sourced evidence:

- **Sourced-evidence layer — materializes at link time, NOT proof-gated.** A fact, name, or relationship edge extracted from a source lands on a tree person as research proceeds (at identity-link time, normally via person-evidence's `materialize_facts`); it does **not** wait for a proof conclusion. The gate here is **provenance, not proof tier**: every newly-authored **fact** and every newly-authored **`add_relationship` edge** carries a non-null source-ref (the delta-scoped mandatory-ref guard). Ad-hoc `add_name` / `add_person` **names** are ref-tolerant — hypothesis/oral/init stubs legitimately have no documentary source yet — so a bare name-only stub is grounded without a source-ref, but a fact or a new edge is not.
- **Conclusion / upload / merge layer — still proof-gated at `probable`+.** Marking which value is `primary` (fact) / `preferred` (name), uploading to FamilySearch, and executing a **person merge** still require a `proof_summary` at `probable` tier or higher.

The skill's job is to gatekeep the deliverable — not every edit the user asks for is justified. An edit is grounded when it fits one of:
- It materializes **sourced evidence** — a fact/name/edge whose source is already linked, carrying a source-ref on the fact/edge (a proof conclusion is NOT required to land sourced evidence; ad-hoc, tree-edit may add such a fact when its source is already cited on the person).
- It **corrects an objective error** verifiable against an already-cited source.
- It sets a **concluded value** (`primary`/`preferred`) or executes a **merge**, backed by a `probable`+ `proof_summary`.

When none is met (speculative connection, a newly-authored fact/edge with no source-ref, a value concluded before conflicting evidence is resolved, a person merge without a `ps` confirming identity), the skill must refuse and explain what is missing. Coexisting sourced facts are expected and fine — it is marking one `primary` prematurely, not keeping both, that is refused.

- **pass:** Edits made are grounded per the right layer — a sourced fact/edge (source-ref present; names may be ref-tolerant), a verifiable objective-error correction, OR a concluded/merge edit backed by a `probable`+ `ps`. Edits that don't qualify are refused with a clear explanation of what is needed (proof-conclusion, person-evidence, record-extraction, an additional source). For tests that aren't edit operations (e.g., match-checking, negative routing), this dimension scores `pass` — there's no edit to ground.
- **partial:** The edit happens AND a source is referenced, but the source-support reasoning is shallow (e.g., source listed without checking whether the data is actually in it), OR the skill refuses the right thing but doesn't explain what threshold was missed, OR it **over-gates** — demands a `probable`-tier proof before materializing sourced *evidence* (evidence materializes at link time; only conclusion/upload/merge is proof-gated).
- **fail:** A newly-authored **fact** or **relationship edge** is written with NO source-ref, OR a person merge executed without a `probable`-tier proof_summary confirming identity, OR a value is marked `primary`/`preferred` (or uploaded to FamilySearch) below the `probable` conclusion threshold, OR a relationship written without meeting the `relationship-accuracy.md` threshold.
