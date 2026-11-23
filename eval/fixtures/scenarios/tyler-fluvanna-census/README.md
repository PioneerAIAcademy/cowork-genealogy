# Scenario: tyler-fluvanna-census

A project on the head of a Black household in Cunningham District, Fluvanna County,
Virginia, built from the Tyler feedback bundles (issue #4578). The FamilySearch index
gives her surname, Tyler, and no given name. The tree (I1) carries the given name
Anthony, which only a machine transcription supports. The project's one question,
`q_001`, asks what given name the enumerator wrote on the 1900 page.

What the project holds:

- **`src_001`**, the 1900 US census entry (`ark:/61903/1:1:MMF1-WWF`, image
  `ark:/61903/3:1:S3HT-DTXQ-WTP`). The head is indexed as Tyler with no given name,
  and her eight `head_of_household` assertions are linked to I1. `results/log_001.json`
  is the record read from the bundle.
- **`log_002`**, one earlier `image_transcribe` of that page. It read line 23 as
  "Tyler Anthony".
- **`log_003`**, a `record_read` of the 1880 census entry (`ark:/61903/1:1:MC5S-GVQ`).
  The head is indexed as "Armtogne Tyler". No source was made for it, as in the bundle.
- **`src_002`**, the 1923 Virginia death certificate (`ark:/61903/1:1:QVR7-5LJJ`). The
  deceased is indexed as "Ann Tone Lightfoot", given name "Ann Tone" in two words.
  Its ten assertions are extracted and not linked to anyone. `results/log_004.json` is
  the record read from the bundle.
- **`uploads/1880-census-cunningham-p36.png`**, the researcher's upload of page 36 of
  the 1880 census. It is a 1-pixel placeholder, because the unit harness serves
  `image_transcribe` from fixtures and never reads an upload's bytes.

The log notes are rewritten to state only what each record or transcription gives. The
bundle's own notes had already fitted the readings together, for example calling
"Ann Tone" a "split-word rendering consistent with Antone/Antoine". Keeping that would
hand the run the conclusion the tests check it does not draw.

Used by:
- `ut_research_iv1`, with `image-transcribe-tyler-1900-census`;
- `ut_research_iv2`, with `image-transcribe-tyler-1880-census`;
- `ut_research_iv3`, with `person-read-tyler-stub` and `source-attachments-tyler-none`.
  The FamilySearch person behind I1, `PJHQ-7RG`, is a tester's placeholder named
  "stub stub" with no attached sources.

The people are real and long dead, taken from public FamilySearch records. Nothing
identifies the tester.
