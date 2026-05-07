---
name: record-extraction
description: Extracts atomic GPS-conformant assertions from genealogical
  records. Reads a record (from MCP tool response, captured PDF, or image
  transcription), breaks it into discrete testable assertions attached to
  record_id and record_role, creates source entries with working citations,
  and writes best-effort evidence classifications. GPS Step 2 (citation)
  and Step 3 (analysis) — the extraction phase. Use when the user says
  "extract assertions", "analyze this record", "what does this record say",
  "process this record", after search-records or search-external-sites
  finds a record, or when the user uploads a PDF or image of a genealogical
  record. Do NOT use when the user wants to search for records (use
  search-records or search-external-sites), wants to refine evidence
  classifications (use assertion-classification), or wants to format
  citations (use citation).
---

# Record Extraction

Reads a genealogical record and extracts every relevant fact as an
atomic assertion. This is the core data-ingestion skill — it transforms
raw records into the structured assertions that every downstream skill
(person-evidence, timeline, conflict-resolution, proof-conclusion)
consumes.

## Inputs

Record data arrives in one of three ways:

1. **MCP tool response in context** — search-records called `record_read`
   or `record_search` and Claude holds the structured data in context.
   This is the most common path.

2. **PDF capture** — the user uploaded a PDF from an external site
   (Ancestry, MyHeritage, FindMyPast, FindAGrave). Claude reads the
   PDF directly. This comes via search-external-sites or a direct
   user upload.

3. **Image transcription** — the user provides a record image ID and
   the skill calls `image_transcribe` to get text. **Transcription
   review is mandatory** — see the transcription review section below.

## Steps

### 1. Identify the source

Determine the source of the record:
- What type of record is it? (census, vital record, probate, etc.)
- Who created it? (U.S. Census Bureau, state health department, etc.)
- When was it created?
- Where is it held? (FamilySearch, Ancestry, NARA, etc.)
- What is the specific locator? (page, dwelling, certificate number)
- Is this an original, derivative, or authored source?

Create or find the source entry:
- Check if a source entry (`src_`) already exists in `research.json`
  for this record accessed from this repository.
- If not, create a new source entry with the next available `src_` ID.
- Also create or find the corresponding source description in
  `tree.gedcomx.json` (the `S` prefix entry). Remember: multiple
  research sources can reference the same GedcomX source description
  (e.g., same census accessed via FamilySearch and Ancestry).

**Source entry fields:**

```json
{
  "id": "src_001",
  "gedcomx_source_description_id": "S1",
  "citation": "<working citation — best-effort Evidence Explained format>",
  "citation_detail": {
    "who": "<creator/agency>",
    "what": "<record title/description>",
    "when_created": "<record creation date>",
    "when_accessed": "<today's date>",
    "where": "<repository>",
    "where_within": "<page/entry/certificate/dwelling>"
  },
  "source_classification": "<original|derivative|authored>",
  "repository": "<FamilySearch|Ancestry|etc.>",
  "access_date": "<today>",
  "url": "<URL or null>",
  "url_archived": null,
  "notes": "<quality/provenance notes or null>"
}
```

**Source classification rules:**
- **Original:** The first recording of an event — a handwritten
  census page, a death certificate, a church register entry, an
  original land deed. Digital images of originals are still original.
- **Derivative:** Copies, transcriptions, indexes, abstracts.
  Ancestry's index of a census is derivative even though the
  underlying census is original. Every step from creation to
  digitization introduces error risk.
- **Authored:** Compiled works — family histories, online trees,
  biographical sketches. Require verification against original sources.

**Provenance notes:** Use the `notes` field to flag risks in the
access path. Example: "Accessed as digital image of microfilm of
original census page — two derivative steps from the original.
Image quality good, handwriting clear."

### 2. Identify roles in the record

List every person mentioned in the record and assign a `record_role`:
- Use the naming convention: `head_of_household`, `wife`, `child_1`,
  `child_2`, `deceased`, `informant`, `father_of_bride`,
  `mother_of_groom`, `grantee`, `grantor`, `testator`, `heir_1`,
  `witness_1`, `godparent_1`
- Number roles sequentially: `child_1`, `child_2`, `child_3`
- For negative evidence, use `absent`

### 3. Extract assertions

For each person-role in the record, extract atomic assertions.

**Extraction policy:** Extract all facts relevant to any open research
question, plus identifying facts (name, age/birth, birthplace) for
every person who might be the subject or a FAN (Family, Associates,
Neighbors) associate. Do not extract every field from every person —
skip facts about unrelated individuals unless a question targets them.

**Each assertion must have:**

```json
{
  "id": "a_001",
  "source_id": "src_001",
  "record_id": "<record identifier>",
  "record_role": "<role in this record>",
  "fact_type": "<name|birth|death|residence|relationship|...>",
  "value": "<human-readable extracted value>",
  "structured_value": { },
  "date": "<date or null>",
  "date_certainty": "<exact|approximate|estimated|...>",
  "place": "<place or null>",
  "information_quality": "<primary|secondary|indeterminate>",
  "informant": "<who provided this fact>",
  "informant_proximity": "<self|witness|household_member|...>",
  "informant_bias_notes": "<bias concerns or null>",
  "evidence_type": "<direct|indirect|negative>",
  "log_entry_id": "<log_ reference or null>",
  "extracted_for_question_ids": ["<question IDs or empty>"]
}
```

**Critical rules for each field:**

**`record_id`** — Use the record's canonical identifier:
- FamilySearch: the ARK (e.g., `ark:/61903/1:1:MXYZ`)
- Ancestry: `ancestry:<collection_id>:<record_id>`
- PDF captures: a descriptive ID (e.g., `capture:ancestry-1850-census-flynn`)
- Always the same for all assertions from the same record

**`record_role`** — The role of THIS person in THIS record. Not who
the person is in the research project — that's person-evidence's job.
Assertions attach to records, not persons.

**`value`** — Human-readable. Write what the record says, not what
you interpret. "age 5" not "born 1845". "Ireland" not "probably
County Cork". Interpretation happens in assertion-classification.

**`structured_value`** — Machine-readable companion to `value`.
Include it for name, birth, death, residence, relationship, and
occupation facts. Shapes:
- `name`: `{ "given": "Patrick", "surname": "Flynn" }`
- `birth`/`death`: `{ "year": 1845, "place": "Ireland" }`
- `residence`: `{ "place": "Schuylkill County, Pennsylvania" }`
- `relationship`: `{ "relationship_type": "son", "related_person_role": "head_of_household" }`
  Use `_inferred` suffix (e.g., `child_inferred`) when the
  relationship is deduced from position, not stated in the record.
- `occupation`: `{ "occupation": "coal miner" }`

**`information_quality`** — Best-effort classification. Will be
refined by assertion-classification, but provide an initial value:
- `primary`: informant witnessed the event (physician signing death
  certificate for death facts, household member reporting own age)
- `secondary`: informant reporting secondhand (son-in-law reporting
  birth facts on a death certificate)
- `indeterminate`: informant unknown (pre-1940 census records where
  the specific household respondent isn't identified)

**`informant` and `informant_proximity`** — Identify WHO provided
this specific fact, not who created the record:
- The census enumerator is the RECORDER, not the informant. The
  informant is the household member who answered the questions.
- For name facts on census records, use `unknown` proximity (the
  enumerator may have read a sign or heard from a neighbor).
- For age/birthplace facts on census records, use `household_member`
  (someone in the household actively reported these).
- For residence facts on census records, the enumerator IS a witness
  (they visited the dwelling) — use `witness`.
- For death certificate facts: the physician is `witness` for death
  facts; a family informant is `family_not_present` for birth facts.

**`evidence_type`** — Best-effort classification:
- `direct`: the fact explicitly answers a research question
- `indirect`: the fact implies an answer but requires inference
  (e.g., household position suggesting parent-child relationship)
- `negative`: the meaningful absence of expected information

**`log_entry_id`** — Reference to the search that produced this
record. If search-records or search-external-sites already logged
the search, use that log entry's ID. If processing a user-provided
record (no prior search), this will be the log entry you create in
step 4.

**`extracted_for_question_ids`** — Which open research questions does
this assertion bear on? Check `research.json` questions. Many
assertions are extracted opportunistically — use an empty array for
facts that don't clearly relate to any current question.

### 4. Write log entry (conditional)

**Only when no search skill already logged this search.** If
search-records or search-external-sites produced the record, they
already wrote the log entry — reference it via `log_entry_id`.

When processing a user-provided record (direct PDF upload, manual
record analysis), create a log entry:

```json
{
  "id": "log_001",
  "plan_item_id": null,
  "performed": "<ISO 8601 datetime>",
  "tool": "user_provided",
  "query": { "description": "<what the user provided>" },
  "outcome": "positive",
  "results_examined": 1,
  "captured_source_ids": ["src_001"],
  "produced_assertion_ids": ["a_001", "a_002"],
  "notes": "<description of the record>",
  "external_site": null
}
```

### 5. Validate

After writing sources and assertions to `research.json` and source
descriptions to `tree.gedcomx.json`, invoke `validate-schema` to
verify both files.

### 6. Present results

Show the user:
- The source entry (classification, citation)
- Each assertion extracted, organized by person-role
- Best-effort classifications (will be refined by
  assertion-classification)
- Suggest next steps: "Would you like me to classify these
  assertions?" (assertion-classification) or "Would you like me to
  link these to persons in the tree?" (person-evidence)

## Transcription review

When processing image transcriptions (via `image_transcribe`):

1. Call `image_transcribe` with the image ID
2. **Present the transcription to the user for review** before
   creating any assertions
3. Ask the user to confirm the transcription is accurate
4. Flag uncertain readings with `[?]` notation (e.g., `[?]Smith`,
   `[?]1845`)
5. Only after user confirmation, proceed to extract assertions
6. Note in the source's `notes` field: "Transcription reviewed by
   user on [date]"

**Do not silently promote transcription output into assertions.**
Handwritten historical records have high transcription error rates
that propagate silently into the research file.

## Negative evidence

When a search returned nil results and the absence is analytically
meaningful (e.g., "Patrick should appear in the 1870 census but
doesn't"), create a negative assertion:

```json
{
  "id": "a_015",
  "source_id": "src_005",
  "record_id": "<the record/collection that was searched>",
  "record_role": "absent",
  "fact_type": "residence",
  "value": "Patrick Flynn absent from 1870 Schuylkill County census where expected",
  "structured_value": null,
  "date": "1870",
  "date_certainty": "exact",
  "place": "Schuylkill County, Pennsylvania",
  "information_quality": "primary",
  "informant": "Census enumerator (absence from enumeration)",
  "informant_proximity": "official_duty",
  "informant_bias_notes": "Absence could be due to: temporary relocation, enumerator error, damaged pages, or the subject genuinely not residing there",
  "evidence_type": "negative",
  "log_entry_id": "log_010",
  "extracted_for_question_ids": ["q_001"]
}
```

Not every nil search result warrants a negative assertion. Only
create one when the absence is analytically significant — the person
was expected to be in the record based on the timeline and known
facts.

## Example: 1850 Census record

**Input:** MCP tool returns data for 1850 Census, Schuylkill County,
dwelling 84, Thomas Flynn household.

**Source created:**
- `src_001`: original, FamilySearch, 1850 census
- `S1` in tree.gedcomx.json: "1850 U.S. Federal Census"

**Assertions extracted:**

| ID | Role | Fact | Value | Quality | Proximity |
|----|------|------|-------|---------|-----------|
| a_001 | child_1 | name | Patrick Flynn | indeterminate | unknown |
| a_002 | child_1 | birth | age 5 | indeterminate | household_member |
| a_003 | child_1 | residence | Schuylkill County, PA | primary | witness |
| a_004 | child_1 | relationship | position consistent with child | indeterminate | unknown |
| a_005 | head_of_household | name | Thomas Flynn | indeterminate | unknown |

Note the per-fact informant analysis:
- **Name** (a_001): `unknown` proximity — the enumerator may not have
  gotten the name directly from a household member
- **Birth/age** (a_002): `household_member` — someone actively
  reported the age
- **Residence** (a_003): `witness` — the enumerator visited the dwelling
- **Relationship** (a_004): `unknown` — 1850 census doesn't state
  relationships; this is inferred from position. Uses
  `child_inferred` in structured_value.
