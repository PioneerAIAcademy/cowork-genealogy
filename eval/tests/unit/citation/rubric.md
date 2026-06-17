# Citation Rubric

Grading dimensions for citation unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Evidence Explained compliance

Does the citation follow the Who/What/When/Where/Where-within framework from Evidence Explained? All five elements should be present and correctly populated. Grade against what the source data makes achievable: an element whose data is genuinely absent from the source entry and the scenario, and which is explicitly flagged with an unknown-marker (e.g. `[PAGE NOT RECORDED]`) and referred to the user, counts as correctly handled — not as a missing element.

The **count of flagged elements does not lower the grade.** When the input itself supplies little (e.g., a bare URL the skill cannot expand from an opaque ARK), a template carrying every datum that IS available plus honest unknown-markers for all genuinely-absent elements is a full pass — an all-markers template reflects an incomplete *input*, not incomplete skill work. Partial and fail apply only when data that IS on file was omitted or made generic, or when elements are conflated.

- **pass:** All five elements present, each populated with specific data appropriate to the source type (NARA microfilm publication for a census; certificate number for a death record) — or populated with everything on file plus explicit unknown-markers for data the source entry genuinely lacks.
- **partial:** Four of five elements present, or all five present but one is generic ("various records" instead of the specific collection name) when more specific data was available on file.
- **fail:** Two or more elements missing or generic despite data being on file, or the citation conflates elements (location and repository merged into one field).

## Replication test

Could another researcher find the exact same record using only this citation? The citation must include enough specificity (page, entry, certificate number, microfilm roll) to locate the source. Grade against what the source data makes achievable: when a locator is genuinely absent from the source entry and the scenario, a properly flagged gap is the correct behavior and must not be graded as if the skill failed to do its job.

**Decisive rule:** a locator that genuinely does not exist on file, flagged with an unknown-marker AND referred to the user (asked to read it from the record image), is a **pass** — never deduct for a locator the source data cannot supply. Partial is reserved for a locator that is coarser than the on-file data would allow (a finer locator WAS available and was not cited) or a flagged gap given with no resolution path for the user. Fail is reserved for omitting an on-file locator, pointing to the wrong scope, or — always — inventing one. "Honest about an unavoidable gap" is the top of this scale, not the middle.

- **pass:** A genealogist following the citation would arrive at the same record — page, entry, dwelling number, or equivalent identifier is included. Also pass when every locator that exists on file is cited and the only missing pieces are absent from the source data, explicitly flagged with unknown-markers, and referred to the user to read from the record image.
- **partial:** Locator information present but coarser than ideal (citation names the right collection and date range but no page/entry number on file is cited), or a genuinely-absent locator is flagged but without clearly directing the user how to resolve it.
- **fail:** No locator beyond the collection name when finer locators are on file, a locator pointing to the wrong scope (page number for a record that needs an entry number), or — always — an invented locator. Fabricating a plausible page/volume/certificate number to satisfy replication is a fail on this dimension as well as on source fidelity.

## Source vs information distinction

Is the source classified at the source level (original/derivative/authored), not confused with information quality? A single original source can contain both primary and secondary information.

When the skill correctly creates or modifies **no** source (e.g., a URL-only input it cannot persist, or a request it routes elsewhere), there is no `source_classification` to evaluate and no conflation can occur — score this a **pass** (the dimension's failure mode did not arise), not partial. An absent classification that *should* have been present is the only thing that lowers this dimension.

- **pass:** `source_classification` reflects the source itself (the death certificate is original); information quality is reserved for assertions (the father's name reported by a son-in-law is secondary). Also pass when no source was created/modified and so none was due.
- **partial:** Source classification mostly right but blurred in one place (a death certificate labeled "secondary" because the informant was distant).
- **fail:** The two layers are systematically conflated, or `source_classification` is omitted.

## Does not create new source entries

The skill must only refine existing `src_` entries — it must never create a new source entry, even if the user implies a new record should be added.

- **pass:** All writes are in-place updates to existing `src_` entries. No new `src_` id appears in `research.json` after the skill runs.
- **partial:** N/A — this invariant has no partial state.
- **fail:** A new `src_` entry is created, or the skill attempts to insert a new source into the `sources` array.

## Source fidelity — no fabricated detail

Does every element of the refined citation come from the existing source entry, the scenario files, or the user's message — never invented? Citation refinement must draw solely from information already on file. Missing information is flagged and reported to the user, not filled in with plausible values. A citation that stays honest about its gaps beats one that looks complete but contains unverifiable detail.

Three clarifications on what is NOT fabrication: (1) Explicit unknown-markers such as `[PAGE NOT RECORDED]` or `[WILL BOOK NUMBER NOT RECORDED]` are flags, not invented values — they are the mandated way to represent a gap and must never be penalized as fabrication. Fabrication means a plausible-looking concrete value (a real-seeming number, date, or title); a bracketed marker that plainly states the data is absent is the opposite of fabrication. (2) Data traceable anywhere in `research.json` or `tree.gedcomx.json` — including sibling sources for the same underlying record — is on-file, not invented. (3) Completing a place name with the jurisdiction the scenario consistently establishes for it is standard Evidence Explained geographic formatting, not fabrication — e.g., writing "Pottsville, Schuylkill County, Pennsylvania" (or "St. Mary's Catholic Church, Pottsville, Pennsylvania") when research.json/tree.gedcomx.json place the project in Pottsville, Schuylkill County, PA throughout. The state/county is scenario-established context, so it is on-file per clarification (2). Fabrication remains a concrete unverifiable *value* — a page, certificate, volume, date, or informant name that appears nowhere on file — not the geographic jurisdiction the record's town already sits in.

- **pass:** Every locator, date, number, name, and repository in the refined citation is traceable to the source entry, `research.json`, or the user's message. Gaps (missing page, certificate number, Will Book volume) are explicitly flagged — unknown-markers in the fields are the correct form — with a request that the user check the record image. Already-compliant citations are left fundamentally unchanged.
- **partial:** One hedged addition that is plausibly derivable from data on file (e.g., naming the NARA series for a census year) but not explicitly present, clearly marked as inferred.
- **fail:** Any unverifiable concrete addition — page, sheet, line, or image numbers, certificate or file numbers, dates, volume/page locators, informant names, person-entry identifiers naming the wrong person, or repository detail that appears nowhere on file. Copying example values from the skill's own templates (e.g., "Will Book 12, p. 247") into a real citation is fabrication. Unsupported additions are failures even when the resulting citation looks more thorough.
