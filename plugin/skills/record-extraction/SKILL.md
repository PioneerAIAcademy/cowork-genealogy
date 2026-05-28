---
name: record-extraction
model: claude-sonnet-4-6
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
allowed-tools:
  - image_read
  - validate_research_schema
  - record_person_matches
  - record_record_matches
---

# Record Extraction

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Reads a genealogical record and extracts every relevant fact as an
atomic assertion. This is the core data-ingestion skill — it transforms
raw records into the structured assertions that every downstream skill
(person-evidence, timeline, conflict-resolution, proof-conclusion)
consumes.

## GPS Foundation

This skill implements BCG standards 23-36 during data collection.
The governing principles:

1. **Faithful capture:** Record content exactly as it appears. Flag
   uncertain readings with `[?]` rather than guessing. Distinguish
   record content from your own interpretations.
2. **Objectivity:** Extract facts that contradict the working
   hypothesis with the same care as supporting facts.
3. **Per-fact analysis:** Classify each layer independently —
   source (original/derivative/authored), information
   (primary/secondary/indeterminate), evidence (direct/indirect/negative).

**Load references on demand:**
- `references/source-classification-guide.md` — source classification
  rules and edge cases
- `references/information-classification-at-extraction.md` — informant
  analysis decision tree and multi-informant examples
- `references/note-taking-standards.md` — transcription fidelity and
  content/comment separation

## Inputs

Record data arrives in one of three ways:

1. **MCP tool response in context** — search-records called `record_search`
   and Claude holds the structured data in context.
   This is the most common path.

2. **PDF capture** — the user uploaded a PDF from an external site
   (Ancestry, MyHeritage, FindMyPast, FindAGrave). Claude reads the
   PDF directly. This comes via search-external-sites or a direct
   user upload.

3. **Image** — the user provides a FamilySearch image URL (image ARK
   `3:1:.../$dist` or DGS URL `dgs:.../dist.jpg`). The skill calls
   `image_read` to fetch the image bytes. Claude reads the image
   natively (multimodal) and produces a transcription. **Transcription
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
  "notes": "<quality/provenance notes or null>",
  "transcription": "<verbatim image transcription, or null>",
  "log_entry_id": "<log_ reference or null>"
}
```

Set the source's `log_entry_id` to the search log entry that found
the record — the same value used for the assertions below. For a
user-provided record with no prior search, it is the log entry
created in step 4. This is the source→search provenance link; the
log entry itself is never modified.

**GedcomX source description fields (`tree.gedcomx.json` `S` entry):**

The `S` entry uses a deliberately minimal shape — exactly these
fields, **no others** (the file is validated with
`additionalProperties: false`):

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | `S` prefix |
| `title` | yes | Human-readable source title |
| `citation` | no | **Omit during active research.** proof-conclusion populates it at upload time from `research.json` `sources[].citation` |
| `author` | no | Creator/agency |
| `url` | no | URL to the digital source |

Do not add a `description`, `notes`, or any other field — they fail
schema validation.

**Source classification (quick rules):**
- **Original:** First recording or earliest surviving version.
  Digital images/microfilm of originals count. Government record
  copies count.
- **Derivative:** Created from another source (index, abstract,
  transcript, translation). Each step from original adds error risk.
- **Authored:** Compiled works with the author's own analysis
  (family histories, online trees, county histories).

When uncertain, load `references/source-classification-guide.md`.

**Provenance notes:** Use the `notes` field to trace the path from
original creation to the version examined. Example: "Accessed as
digital image on FamilySearch of microfilm made by the Genealogical
Society of Utah from the original register held by St. Mary's
Parish, Cork, Ireland. Image quality good, handwriting clear."

### 2. Identify roles in the record

List every person mentioned in the record and assign a `record_role`:
- Use the naming convention: `head_of_household`, `wife`, `child_1`,
  `child_2`, `deceased`, `informant`, `father_of_bride`,
  `mother_of_groom`, `grantee`, `grantor`, `testator`, `heir_1`,
  `witness_1`, `godparent_1`
- Number roles sequentially: `child_1`, `child_2`, `child_3`
- For negative evidence, use `absent` — the exact string, lowercase, no
  prefix or qualifier. Do not invent variants like `subject_absent`,
  `not_listed`, or `missing`: downstream validators, search-records
  triage, and proof-conclusion all key off the literal `absent` token
  to recognize a documented null finding

### 3. Extract assertions

For each person-role in the record, extract atomic assertions.

**Extraction policy (BCG Standard 27 — Objectivity):** Extract all
facts relevant to any open research question, plus identifying facts
(name, age/birth, birthplace) for every person who might be the
subject or a FAN (Family, Associates, Neighbors) associate. Do not
extract every field from every person — skip facts about unrelated
individuals unless a question targets them.

**Do not let bias affect extraction.** Extract facts that contradict
the current working hypothesis just as carefully as supporting facts.
Do not trim, tailor, or ignore potentially relevant information to
fit a preconception or to harmonize with other evidence. Suspend
judgment about the information's effect on research questions until
after correlation.

**Each assertion must have:**

```json
{
  "id": "a_001",
  "source_id": "src_001",
  "record_id": "<record identifier>",
  "record_role": "<role in this record>",
  "record_persona_id": "<gedcomx person id (REQUIRED for record_search sources), or null (image/PDF/full-text only)>",
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
- FamilySearch `record_search` results: the result's `arkUrl` copied
  **verbatim** — the full URL form
  (`https://www.familysearch.org/ark:/61903/1:1:MXYZ`), not a trimmed
  bare `ark:/...`. person-evidence joins an assertion to its record by
  exact string match on this value.
- Ancestry: `ancestry:<collection_id>:<record_id>`
- PDF captures: a descriptive ID (e.g., `capture:ancestry-1850-census-flynn`)
- Always the same for all assertions from the same record

**`record_role`** — The role of THIS person in THIS record. Not who
the person is in the research project — that's person-evidence's job.
Assertions attach to records, not persons.

**`record_persona_id`** — For records that came from `record_search`,
the GedcomX person `id` of this persona within the search result's
`gedcomx` document. The focus persona's id is the result's `primaryId`;
each other person in the record (household members, witnesses) is the
matching entry in the result's `gedcomx.persons[]`. This lets
person-evidence hand the right focus person to `match_two_examples`.
**Required (non-null) for every assertion whose source is a `record_search`
result** — leaving it null on those breaks the downstream matcher and is
a hard validator failure. Set it to **null** only for image-, PDF-, and
full-text-sourced records, which carry no structured GedcomX persona.

**`value`** — Human-readable. Write what the record says, not what
you interpret. This is BCG standard 26: clearly distinguish record
content from your own interpretations.
- "age 5" not "born 1845"
- "Ireland" not "probably County Cork"
- "do" (meaning ditto marks) should be noted as `[ditto from above]`
- Uncertain readings: use `[?]` notation (e.g., `[?]Smith`)
- Illegible portions: `[illegible]`
- Damaged text: `[torn]` or `[stained]`
Interpretation happens in assertion-classification, not here.

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
refined by assertion-classification, but provide an initial value
using the two-question decision tree:
1. Do we know the informant? No -> `indeterminate`
2. Did the informant witness/participate? Yes -> `primary`;
   No -> `secondary`; Cannot tell -> `indeterminate`

Classification is about the informant's proximity to the event,
not accuracy. Primary information can still be wrong.

**`informant` and `informant_proximity`** — Identify WHO provided
this specific fact, not who created the record. The recorder and
the informant are different people. Many records have multiple
informants — classify each fact based on who provided THAT fact.

When the informant is identified by name on the record, use their
name. When identified by role only, use the role (e.g., "attending
physician", "household member").

For detailed per-record-type informant guidance (census, death
certificates, marriage records), load
`references/information-classification-at-extraction.md`.

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
  "performed": "2026-05-24T14:30:00Z",
  "tool": "user_provided",
  "query": { "description": "<what the user provided>" },
  "outcome": "positive",
  "results_examined": 1,
  "notes": "<description of the record>",
  "external_site": null
}
```

### 5. Write the files

**Emit each write as its own tool call in its own model turn — do not
bundle research.json and tree.gedcomx.json into a single mega-write.**
Bundling forces one very long JSON-generation turn that streams slowly
and is more likely to stall mid-stream. Splitting gives observable
progress, smaller per-turn output, and a recoverable state if any one
write fails.

**5a. Write `research.json`** — the source entry from step 1, the log
entry from step 4 (if it applied), and the assertions from step 3.

For **multi-persona records** (3+ personas with full assertion sets,
typical for census households or wills with multiple heirs), split
this further to keep each turn small:

- First turn: Write `research.json` with the new source, the new log
  entry (if any), and the first persona's assertions only.
- Subsequent turns: Use `Edit` to append the next persona's assertions
  to the `assertions` array, one persona per turn.

For single-persona or 2-persona records, a single Write is fine.

**5b. Write `tree.gedcomx.json`** in a separate turn — the new `S`
source description entry only (the §1 table — `id`, `title`,
optionally `author`/`url`). This write is always small.

### 6. Validate

After all writes are done, call
`validate_research_schema({ projectPath: "<absolute-path-to-project-directory>" })`
to verify both research.json and tree.gedcomx.json are valid. If
validation fails, fix the errors before presenting.

### 7. Present results

Show the user:
- The source entry (classification, citation)
- Each assertion extracted, organized by person-role
- Best-effort classifications (will be refined by
  assertion-classification)
- Suggest next steps: "Would you like me to classify these
  assertions?" (assertion-classification) or "Would you like me to
  link these to persons in the tree?" (person-evidence)

## Handwriting and Historical Terms

When processing handwritten or historical records:
- Flag uncertain readings with `[?]` rather than guessing.
- When a term's historical meaning differs from modern usage,
  annotate in the `value` field: e.g.,
  `"cousin [term may mean any relative in this period]"`.
- Record jurisdictions as they existed when the record was created.

For detailed guidance on letter forms, obsolete conventions, and
historical term meanings, load `references/note-taking-standards.md`.

## Transcription review

When processing image-based records (via `image_read`):

1. Call `image_read` with the image URL. Only two URL formats are
   accepted by the tool — anything else is rejected:
   - Image ARK: `https://sg30p0.familysearch.org/service/records/storage/deepzoomcloud/dz/v1/3:1:{ID}/$dist`
   - DGS: `https://familysearch.org/das/v2/dgs:{DGS}_{IMAGE}/dist.jpg`

   The tool returns the image as a multimodal content block — you
   (Claude) see the image directly.
2. Read the image and produce a verbatim transcription. Preserve
   spelling, punctuation, abbreviations, and the original layout.
3. **Present the transcription to the user for review** before
   creating any assertions.
4. Ask the user to confirm the transcription is accurate.
5. Flag uncertain readings with `[?]` notation (e.g., `[?]Smith`,
   `[?]1845`). Mark damaged or illegible passages with `[illegible]`,
   `[torn]`, or `[stained]`.
6. Only after user confirmation, proceed to extract assertions.
7. Write the confirmed verbatim transcription to the source's
   `transcription` field — `image_read` returns an image, not text, so
   this transcription is the retained record content (there is no
   results sidecar for image records). Then **append** to the source's
   `notes` field: "Transcription reviewed by user on [date]". Do not
   overwrite existing provenance notes — the `notes` field is a running
   log of quality and provenance observations, and earlier entries
   (e.g., the original provenance chain) must be preserved.

**Do not silently promote transcription output into assertions.**
Handwritten historical records have high transcription error rates
that propagate silently into the research file.

**If the user provides a persona ARK (`1:1:...`) or record ARK
(`1:2:...`), `image_read` will reject the URL** — the tool only
accepts image ARKs (`3:1:...`) and DGS URLs. Ask the user for the
image URL from the FamilySearch record viewer's "View Image" link.
If the user only has a persona or record ARK, the image URL must be
looked up separately (e.g., from the FS record-detail page) before
calling `image_read`.

## Decision rules

**When to create a new source vs. reuse existing:**
- Same record accessed from the same repository -> reuse the `src_` entry
- Same underlying record accessed from a different repository
  (e.g., same census via FamilySearch vs. Ancestry) -> new `src_` entry,
  but same GedcomX source description (`S` entry)
- Different record entirely -> new `src_` and new `S` entry

**Scope — what to extract:**
- For the target person(s): extract all facts (name, dates, places,
  relationships, occupation, etc.)
- For FAN (Family, Associates, Neighbors): extract identifying facts
  (name, age/birth, birthplace) plus any facts bearing on open questions
- For unrelated individuals: skip unless a research question targets them

**Partial or damaged records:**
- Extract whatever is legible. Annotate gaps with `[illegible]`,
  `[torn]`, `[stained]`, or `[missing page]`.
- Note damage in the source `notes` field.
- Do not invent or guess missing data. An incomplete extraction is
  better than a fabricated one.

**When to stop and hand off:**
- After extraction, suggest assertion-classification if best-effort
  classifications need refinement.
- Suggest person-evidence if the user wants to link assertions to
  tree persons.
- Do NOT attempt full evidence correlation or conflict resolution
  here -- those are downstream skills.

## Match checking after extraction

After extracting assertions from a record that came via `record_search`
(i.e., it has a `record_persona_id`), you may optionally call the match
tools to enrich the research context.

### Check if the record is already linked to a tree person

Call `record_person_matches` with the record persona's ID to see whether
FamilySearch has already matched this record to a tree person:

```
record_person_matches({ id: "QPTX-TMQ2" })
```

- If a match is `status: "accepted"`, the record is already attached to
  that tree person — note this in your narration so the user knows.
- If a match is `status: "pending"`, there is an unreviewed hint — flag
  it for the user to evaluate.
- Only call this when you have a record persona ID (`1:1:` ARK or bare
  record pid). Skip if the record came from a PDF or image (no persona ID).

### Find collateral records about the same individual

Call `record_record_matches` with the record persona's ID to find other
records that FamilySearch matched to the same person:

```
record_record_matches({ id: "QPTX-TMQ2" })
```

Useful when the user wants to know what other records exist for this
person without running a new search. Mention any high-confidence
(`confidence >= 4`) pending matches as worth extracting next.

These calls are **optional** — make them when the user asks about
attachments or related records, or when `includeSummary` context would
help resolve a conflict. Do not call them by default on every extraction.

**Match results are informational only.** Do NOT write match results to
`research.json`. Do NOT add a log entry for the match check. Do NOT set
or update `results_ref` on any existing log entry. Report the results
verbally in your response to the user.

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
