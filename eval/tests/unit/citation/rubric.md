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

## Does not create new source entries

The skill must only refine existing `src_` entries — it must never create a new source entry, even if the user implies a new record should be added.

- **pass:** All writes are in-place updates to existing `src_` entries. No new `src_` id appears in `research.json` after the skill runs.
- **partial:** N/A — this invariant has no partial state.
- **fail:** A new `src_` entry is created, or the skill attempts to insert a new source into the `sources` array.

## Source fidelity — no fabricated detail

Does every element of the refined citation come from the existing source entry, the scenario files, or the user's message — never invented? Citation refinement must draw solely from information already on file. Missing information is flagged and reported to the user, not filled in with plausible values. A citation that stays honest about its gaps beats one that looks complete but contains unverifiable detail.

- **pass:** Every locator, date, number, name, and repository in the refined citation is traceable to the source entry, `research.json`, or the user's message. Gaps (missing page, certificate number, Will Book volume) are explicitly flagged with a request that the user check the record image. Already-compliant citations are left fundamentally unchanged.
- **partial:** One hedged addition that is plausibly derivable from data on file (e.g., naming the NARA series for a census year) but not explicitly present, clearly marked as inferred.
- **fail:** Any unverifiable addition — page, sheet, line, or image numbers, certificate or file numbers, dates, volume/page locators, informant names, or repository detail that appears nowhere on file. Copying example values from the skill's own templates (e.g., "Will Book 12, p. 247") into a real citation is fabrication. Unsupported additions are failures even when the resulting citation looks more thorough.
