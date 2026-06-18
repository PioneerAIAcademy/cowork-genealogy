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
  - record_read
  - image_read
  - volume_search
  - place_search
  - place_search_all
  - validate_research_schema
  - record_person_matches
  - record_record_matches
---

# Record Extraction

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

**Places:** When resolving or writing places, follow `references/places-guidance.md` — resolve with `place_search` / `place_search_all` and record the `standardPlace` (and `standard_place` on persisted facts/assertions/events).

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

**Load references on demand** — for straightforward census records,
the instructions below are sufficient. Load reference files
(`references/source-classification-guide.md`,
`references/information-classification-at-extraction.md`,
`references/note-taking-standards.md`) only for unfamiliar record
types or edge cases.

## Inputs

Record data arrives in one of four ways:

1. **MCP tool response in context** — search-records called `record_search`
   and Claude holds the structured data in context.
   This is the most common path.

2. **Record ARK or entity ID** — the user provides a FamilySearch record
   ARK (e.g., `ark:/61903/1:1:QVS9-DHDB`) or bare entity ID (e.g.,
   `QVS9-DHDB`). Call `record_read({ recordId: "<ARK or bare ID>" })`
   to fetch the full simplified GEDCOMX, then extract assertions from
   the returned persons, relationships, and facts.

3. **PDF capture** — the user uploaded a PDF from an external site
   (Ancestry, MyHeritage, FindMyPast, FindAGrave). Claude reads the
   PDF directly. This comes via search-external-sites or a direct
   user upload.

4. **Image** — the user provides a FamilySearch image URL (image ARK
   `3:1:.../$dist` or Image Group Number URL `dgs:.../dist.jpg`). The skill calls
   `image_read` to fetch the image bytes. Claude reads the image
   natively (multimodal) and produces a transcription. **Transcription
   review is mandatory** — see the transcription review section below.

   If the user wants to find images but doesn't have a URL yet (e.g.,
   "look at probate records from Schuylkill County, 1870-1890"), use
   `volume_search` to discover digitized volumes (image groups) by
   standardPlace and year range. `volume_search` returns volume metadata
   (image group numbers, coverage, record types). Once the user picks a
   group, they need to browse it on FamilySearch to find the specific
   image — the DGS URL format requires both the image group number and an
   image index within the group (`dgs:{DGS}_{IMAGE}/dist.jpg`).

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

**GedcomX source description (`tree.gedcomx.json` `S` entry):**
Minimal shape — `additionalProperties: false`. Required: `id` (`S`
prefix), `title`. Optional: `author`, `url`. **Omit optional fields
entirely when not applicable** — `"url": null` fails validation
(must be string or absent). No `description`, `notes`, or other fields.

**Source classification (quick rules):**
- **Original:** First recording or earliest surviving version.
  Digital images/microfilm of originals count. Government record
  copies count.
- **Derivative:** Created from another source (index, abstract,
  transcript, translation). Each step from original adds error risk.
- **Authored:** Compiled works with the author's own analysis
  (family histories, online trees, county histories).

When uncertain, load `references/source-classification-guide.md`.

**Provenance notes:** Use `notes` to trace the path from original to
the version examined and note image quality or legibility issues.

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

For each person-role in the record, extract atomic assertions —
**one fact per assertion.** Separate age/birth year from birthplace:
these are distinct facts with different informant proximity
assessments and must be separate `a_` entries. Do not combine them
into a single assertion like "age 5, born Ireland."

**Only extract facts that are present in the record.** If a column is
blank or empty for a person, do **not** create an assertion for that
field. For example, if only the household head has an occupation
listed ("Laborer") and the other members' occupation columns are
blank, create an occupation assertion only for the head — never
fabricate occupation assertions for members with blank fields.

**Extraction policy (BCG Standard 27 — Objectivity):** Extract all
facts relevant to any open research question, plus identifying facts
(name, age/birth, birthplace) for every person who might be the
subject or a FAN (Family, Associates, Neighbors) associate. Do not
extract every field from every person — skip facts about unrelated
individuals unless a question targets them.

**Do not let bias affect extraction.** Extract contradicting facts
with the same care as supporting ones. Suspend judgment until
correlation.

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
  "standard_place": "<standardized place name or null — see Standardizing places>",
  "information_quality": "<primary|secondary|indeterminate>",
  "informant": "<who provided this fact — REQUIRED, never omit>",
  "informant_proximity": "<self|witness|household_member|... — REQUIRED, never omit>",
  "informant_bias_notes": "<bias concerns or null>",
  "evidence_type": "<direct|indirect|negative>",
  "log_entry_id": "<log_ reference or null>",
  "extracted_for_question_ids": ["<question IDs or empty>"]
}
```

**Standardizing places (`standard_place`):** every assertion with a
non-null `place` should carry a `standard_place` when one can be found.
- If the source record came from `record_read` / `record_search`, its facts
  already carry a converter-resolved `standard_place` — **copy that value**
  for the matching place (no tool call needed).
- Otherwise (image/PDF/full-text records, or a place not present on the
  source fact), call `place_search({ placeName: "<place>" })` and use the
  first result's `standardPlace` field. Resolve each distinct place once.
- Leave `standard_place` null when `place` is null or nothing resolves.

**Critical rules for each field:**

**`record_id`** — Use the record's canonical identifier.
**Get this right on the first write — validation failures for format
mismatches cost turns and lower quality scores.**
- FamilySearch `record_search` results: use the result's `arkUrl`
  copied **verbatim** — the full URL form
  (`https://www.familysearch.org/ark:/61903/1:1:MXYZ`).
  person-evidence joins an assertion to its record by exact string match
  on this value. Do not trim to the bare ARK — use the full URL.
- FamilySearch `record_read` results: use the full URL form from the
  response's `sources[].url` or construct it from the persona ark:
  `https://www.familysearch.org/` + the `ark` value.
- Ancestry: `ancestry:<collection_id>:<record_id>`
- PDF captures: a descriptive ID (e.g., `capture:ancestry-1850-census-flynn`)
- User-provided records with no ARK: use a descriptive capture ID
  (e.g., `capture:1850-census-schuylkill-thomas-flynn`)
- Always the same for all assertions from the same record

**`record_role`** — The role of THIS person in THIS record. Not who
the person is in the research project — that's person-evidence's job.
Assertions attach to records, not persons.

**`record_persona_id`** — For records that came from `record_search`,
the GedcomX person `id` of this persona within the search result's
`gedcomx` document. The focus persona's id is the result's `primaryId`;
each other person in the record (household members, witnesses) is the
matching entry in the result's `gedcomx.persons[]`. This lets
person-evidence hand the right focus person to `same_person`.
**Required (non-null) for every assertion whose source is a `record_search`
result** — leaving it null on those breaks the downstream matcher and is
a hard validator failure. Set it to **null** only for image-, PDF-, and
full-text-sourced records, which carry no structured GedcomX persona.

**`value`** — Human-readable, what the record says (not your
interpretation). "age 5" not "born 1845". Use `[?]` for uncertain
readings, `[illegible]`/`[torn]` for damage.

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

**`informant` and `informant_proximity`** — **Required on every
assertion — never omit these fields.** The recorder and informant are
different people. For census records the enumerator is the recorder —
a household member answered the questions.

**Census informant table** — use `informant_bias_notes` to explain
who likely reported and why:

| Fact | informant | proximity | bias_notes reasoning |
|------|-----------|-----------|---------------------|
| Name/age/birthplace (adult) | unknown household member (likely self or spouse) | household_member | adults typically self-reported or spouse answered |
| Name/age/birthplace (child) | unknown household member (likely a parent) | household_member | a child of N could not report own birth info; parent provided it |
| Occupation (stated) | unknown household member (likely the worker or spouse) | household_member | |
| Residence | census enumerator | witness | enumerator visited the dwelling |
| Relationship (pre-1880) | census enumerator | witness | inferred from household position; no relationship column |

When the informant is named on the record, use their name. For
non-census records, load
`references/information-classification-at-extraction.md`.

**`evidence_type`** — Best-effort classification:
- `direct`: the fact is explicitly stated in the record (name,
  age, birthplace, occupation, residence — all `direct` when the
  record column contains the value)
- `indirect`: the fact requires inference from what is stated
  (e.g., birth year computed from age, household position suggesting
  parent-child relationship)
- `negative`: the meaningful absence of expected information

**Age vs. birth year:** If the record states "age 32", an assertion
for fact_type `age` with value "32" is `direct` (explicitly stated).
An assertion for fact_type `birth` with value "~1818" (computed from
age) is `indirect` (requires arithmetic inference). Keep these as
separate assertions with different evidence_types.

**Pre-1880 census relationships are always `indirect`:** The 1850 and
1860 U.S. census do not have a relationship column — relationships
must be inferred from household position, shared surname, and age
patterns. Explicit relationship columns were introduced in the 1880
census. Even when the GedcomX data from `record_read` or
`record_search` includes a `ParentChild` or `Couple` relationship,
that relationship was inferred by the indexer, not stated in the
original record — classify it as `indirect` with
`relationship_type: "child_inferred"` (or `"spouse_inferred"`) in
`structured_value`.

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
record analysis, or a `record_search` result handed over in the
message), create a log entry. **Never modify an existing log
entry — the log is append-only.** Use the next available `log_` ID
(check `research.json` for existing entries first).

```json
{
  "id": "log_NNN",
  "plan_item_id": null,
  "performed": "2026-05-24T14:30:00Z",
  "tool": "user_provided",
  "query": { "description": "<what the user provided>" },
  "outcome": "positive",
  "results_examined": 1,
  "results_ref": "results/log_NNN.json",
  "notes": "<description of the record>",
  "external_site": null
}
```

**Sidecar for `record_search` results:** When assertions carry
`record_persona_id`, the validator cross-checks against a sidecar at
`results/log_NNN.json`. Create it with: `{ "log_id": "log_NNN",
"tool": "record_search", "retrieved": "<ISO timestamp>",
"returned_count": 1, "payload": { "results": [{ "recordId":
"<arkUrl>", "gedcomx": <the gedcomx from the search result> }] } }`.
Set `results_ref` on the log entry to `"results/log_NNN.json"`.
For image/PDF records (no `record_persona_id`), set `results_ref`
to null and skip the sidecar.

### 5. Write the files

**You must actually write the files — do not just describe the
extraction in your response.** Use file-write tools to persist the
data to `research.json` and `tree.gedcomx.json`. A text summary
without persisted files is an incomplete extraction.

**Write each file in its own turn** — do not bundle into one mega-write.

**5a. Write `research.json`** — source, log entry (if applicable), and
assertions. **Only modify `sources`, `assertions`, `log`** — do not
touch `timelines`, `persons`, `questions` (other skills own those).
For multi-persona records (3+), split: first persona in the initial
write, subsequent personas via Edit appends. Every persona must have
fully expanded individual `a_` entries — never compress into ranges.

**5b. Write `tree.gedcomx.json`** — append the `S` entry to `sources`.
Root has exactly three keys: `persons`, `relationships`, `sources` —
do not add `id` or other keys at root. Optional `S` fields (author,
url) must be omitted if not applicable — never set to `null`.

### 6. Validate

After all writes are done, call
`validate_research_schema({ projectPath: "<absolute-path-to-project-directory>" })`
to verify both research.json and tree.gedcomx.json are valid. If
validation fails, fix the errors before presenting.

**Aim to pass validation on the first call.** Repeated validation
failures indicate sloppy initial writes. Before writing, double-check:
- `record_id` uses the correct format (full URL for FamilySearch, not bare ARK)
- `record_persona_id` is set (non-null) for `record_search` sources
- All required assertion fields are present (informant, informant_proximity, evidence_type)
- The GedcomX `S` entry has only allowed fields (id, title, citation, author, url)

### 7. Present results

Show source, assertions by person-role, and classifications. Suggest
assertion-classification or person-evidence as next steps.

## Image-based records

For `image_read` records: produce a verbatim transcription, present
it for user review, then extract assertions only after confirmation.
Use `[?]` for uncertain readings, `[illegible]`/`[torn]` for damage.
Write the confirmed transcription to the source's `transcription` field.
`image_read` accepts only image ARKs (`3:1:...`) and Image Group Number
URLs — not persona (`1:1:`) or record (`1:2:`) ARKs.

## Decision rules

**When to create a new source vs. reuse existing:**
- Same record accessed from the same repository -> reuse the `src_` entry
- Same underlying record accessed from a different repository
  (e.g., same census via FamilySearch vs. Ancestry) -> new `src_` entry,
  but same GedcomX source description (`S` entry)
- Different record entirely -> new `src_` and new `S` entry

**Partial or damaged records:** Extract whatever is legible. Annotate
gaps with `[illegible]`, `[torn]`, `[stained]`. Do not guess missing data.

## Match checking after extraction

After extracting assertions from a record that came via `record_search`
(i.e., it has a `record_persona_id`), you may optionally call the match
tools to enrich the research context.

- `record_person_matches({ id: "<persona ID>" })` — check if record
  is already attached to a tree person. Report accepted/pending status.
- `record_record_matches({ id: "<persona ID>" })` — find collateral
  records matched to the same person. Mention confidence ≥ 4 matches.

These are **optional** — use when the user asks. **Match results are
informational only** — do NOT write them to `research.json` or create
log entries for them. Report verbally only.

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
  "informant": "researcher (searched index and found no match)",
  "informant_proximity": "analyst",
  "informant_bias_notes": "The researcher searched the census index and concluded the person is absent. Absence could be due to: temporary relocation, enumerator error, indexing omission, damaged pages, or the subject genuinely not residing there",
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

| ID | Role | Fact | Value | Quality | Informant | Proximity |
|----|------|------|-------|---------|-----------|-----------|
| a_001 | child_1 | name | Patrick Flynn | indeterminate | unknown household member (likely a parent) | household_member |
| a_002 | child_1 | birth | age 5 | indeterminate | unknown household member (likely a parent) | household_member |
| a_003 | child_1 | residence | Schuylkill County, PA | primary | census enumerator | witness |
| a_004 | child_1 | relationship | position consistent with child | indeterminate | census enumerator | witness |
| a_005 | head_of_household | name | Thomas Flynn | indeterminate | unknown household member (likely self or spouse) | household_member |

Note the per-fact informant analysis with reasoning in
`informant_bias_notes`:
- **Name** (a_001): `household_member` — a parent in the household
  reported the child's name to the enumerator
- **Birth/age** (a_002): `household_member` — a 5-year-old cannot
  report their own age; a parent provided this
- **Residence** (a_003): `witness` — the enumerator visited the dwelling
- **Relationship** (a_004): `witness` — inferred from household
  position; the enumerator recorded who lived in the dwelling. Uses
  `child_inferred` in structured_value.

## Re-invocation behavior

**Writes:** new entries in `sources` (`src_` ids), `assertions`
(`asn_` ids), and `log` (append-only `log_` ids) in `research.json`,
plus the corresponding GedcomX `sources` in `tree.gedcomx.json` and
optionally a `results/log_NNN.json` sidecar for the underlying search.

**On repeat invocation:** detects whether a source for this record (by
`gedcomx_source_description_id` or by working citation) already
exists. If so, refines its working citation and re-derives
assertions for the same `src_` instead of creating a duplicate
source. **Always appends a new `log_` entry with the next available
ID — never modify or overwrite existing log entries.** The log is
append-only by design (see `docs/specs/research-schema-spec.md` §4).

**Do not duplicate:** never create a second source entry for the same
underlying record. If working-citation lookup matches an existing
`src_`, reuse that id. Assertions tied to that source are refined
in place by `asn_` id, not duplicated.
