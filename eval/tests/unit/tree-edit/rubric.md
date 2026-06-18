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

Per `references/evidence-grounded-edits.md`, every fact, name, or relationship added to the tree should trace back to at least one source reference, and edits without proof support should be refused or routed. The skill's job is to gatekeep the deliverable — not every edit the user asks for is justified.

The threshold per the reference:
- A proof_summary at `probable` tier or higher supports the change, OR
- The edit corrects an objective error verifiable against an already-cited source, OR
- The edit adds factual data directly extracted from a source already linked to the person.

When the threshold is NOT met (speculative connection, no source, conflicting evidence unresolved, person merge requested without `ps` confirming identity), the skill must refuse and explain what is missing.

- **pass:** Edits made meet the threshold (a `ps` at probable+, OR a verifiable cited source, OR a fact-add backed by an existing source ref). Edits that don't meet the threshold are refused with a clear explanation of what is needed (proof-conclusion, person-evidence, record-extraction, an additional source). For tests that aren't edit operations (e.g., match-checking, negative routing), this dimension scores `pass` — there's no edit to ground.
- **partial:** The edit happens AND a source is referenced, but the source-support reasoning is shallow (e.g., source listed without checking whether the data is actually in it), OR the skill refuses the right thing but doesn't explain what threshold was missed.
- **fail:** Edit performed without any source reference, OR a person merge executed without a `probable`-tier proof_summary confirming identity, OR a relationship written without meeting the `relationship-accuracy.md` threshold.
