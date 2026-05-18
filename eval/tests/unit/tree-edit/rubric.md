# Tree Edit Rubric

Grading dimensions for tree-edit unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Data preservation

Did the edit preserve all existing facts and sources from both the original and merged records? No data should be silently dropped during merges or edits.

- **pass:** All facts, names, and source references from the input(s) survive into the output; merges combine fields without dropping data; edits change only the target field.
- **partial:** Most data preserved but one secondary field (a less-preferred name, a tangential source reference) is silently dropped.
- **fail:** Data systematically lost during the edit (multiple facts dropped, sources stripped), or merge collapses divergent fields into one without preserving alternates.

## Edit minimality

Did the skill make only the requested change without modifying unrelated data? Edits should be surgical — changing a birth date should not touch relationships or other persons.

- **pass:** Only the requested fields/entries are modified; unrelated facts, persons, and relationships are byte-for-byte unchanged.
- **partial:** Requested change is made but a tangential field is also touched (e.g., a name capitalization "normalized" while editing a birth date).
- **fail:** Substantial collateral edits beyond the request, or the skill rewrites the whole file when only one entry needed changing.
