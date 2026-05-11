# Tree Edit Rubric

## Dimensions

### Data preservation
Did the edit preserve all existing facts and sources from both the original and merged records? No data should be silently dropped during merges or edits.

### Cross-reference integrity
After the edit, do all cross-references in research.json (person_evidence.person_id, timelines.person_ids, project.subject_person_ids) still point to valid GedcomX persons?

### Edit minimality
Did the skill make only the requested change without modifying unrelated data? Edits should be surgical — changing a birth date should not touch relationships or other persons.
