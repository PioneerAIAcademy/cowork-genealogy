# Citation Rubric

Grading dimensions for citation unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Evidence Explained compliance

Does the citation follow the Who/What/When/Where/Where-within framework from Evidence Explained? All five elements should be present and correctly populated.

- **pass:** All five elements present, each populated with specific data appropriate to the source type (NARA microfilm publication for a census; certificate number for a death record).
- **partial:** Four of five elements present, or all five present but one is generic ("various records" instead of the specific collection name).
- **fail:** Two or more elements missing, or the citation conflates elements (location and repository merged into one field).

## Replication test

Could another researcher find the exact same record using only this citation? The citation must include enough specificity (page, entry, certificate number, microfilm roll) to locate the source.

- **pass:** A genealogist following the citation would arrive at the same record — page, entry, dwelling number, or equivalent identifier is included.
- **partial:** Locator information present but coarser than ideal (citation names the right collection and date range but no page/entry number).
- **fail:** No locator beyond the collection name, or locator pointing to the wrong scope (page number for a record that needs an entry number).

## Source vs information distinction

Is the source classified at the source level (original/derivative/authored), not confused with information quality? A single original source can contain both primary and secondary information.

- **pass:** `source_classification` reflects the source itself (the death certificate is original); information quality is reserved for assertions (the father's name reported by a son-in-law is secondary).
- **partial:** Source classification mostly right but blurred in one place (a death certificate labeled "secondary" because the informant was distant).
- **fail:** The two layers are systematically conflated, or `source_classification` is omitted.
