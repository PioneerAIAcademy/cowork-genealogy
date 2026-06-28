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
  - research_append
  - research_log_append
  - tree_edit
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
  for this record accessed from this repository. If one does, reuse it
  (refine its citation via `research_append` `op: "update"`).
- If not, append a new source entry in step 5a via `research_append`.
- Also create or find the corresponding source description in
  `tree.gedcomx.json` (the `S` prefix entry). Remember: multiple
  research sources can reference the same GedcomX source description
  (e.g., same census accessed via FamilySearch and Ancestry).

**Source entry fields — closed set, schema rejects extras.**
**Required:** `gedcomx_source_description_id`, `citation` (working
Evidence Explained citation), `citation_detail` (object with six
required keys: `who`, `what`, `when_created`, `when_accessed`, `where`,
`where_within`), `source_classification` (`original`/`derivative`/`authored`),
`repository`, `access_date`. **Optional:** `url`, `url_archived`,
`notes` (provenance/quality), `transcription` (verbatim image text),
`log_entry_id`. The tool assigns `id`. Do not invent fields —
`record_id` is an assertion field, not a source field; `record_type`
is not a field at all.

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
- **Original:** First recording or earliest surviving version of the
  event itself. Digital images/microfilm of originals count. Census
  schedules, marriage licenses, deeds: original.
- **Derivative:** Created from another source or from informant
  testimony about events the recorder didn't witness — indexes,
  abstracts, transcripts, translations, AND **death certificates**
  (the certificate creator records what informants told them about
  birth, parents, etc., not events they witnessed). Each step from
  original adds error risk.
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

**Assertion fields — closed set, schema rejects extras.**
**Required:** `source_id`, `record_id`, `record_role`, `fact_type`,
`value`, `information_quality`, `informant`, `informant_proximity`,
`evidence_type`, `extracted_for_question_ids` (empty array if none).
**Optional:** `record_persona_id` (REQUIRED non-null for
`record_search` sources, `null` for image/PDF/full-text),
`structured_value`, `date`, `date_certainty` (closed set:
`exact`/`approximate`/`estimated`/`calculated`/`before`/`after`/`between`
— do not use `certain`, `about`, `circa`, etc.), `place`,
`standard_place`, `informant_bias_notes`, `log_entry_id`. The tool
assigns `id`. Do not invent fields — `notes` is a source field, not
an assertion field. The per-field craft is detailed below.

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

**`record_id`** — Use the record's identifier from the search result
(don't construct your own).
- FamilySearch `record_search` results: use the result's **`recordId`**
  field — the value search-records hands off to you. The validator matches
  it to the record by **canonical ARK form**, so the exact format is the
  tool's job, not yours: a bare ARK (`ark:/61903/1:1:MXYZ`), a bare id, or
  a resolver URL for the same record all match. Pass through whatever
  `recordId` you were given; you don't need to reformat it. (A full
  resolver URL still belongs in the **source's** `url` field, step 1.)
- FamilySearch `record_read` results: use the response's `recordId` field
  the same way.
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

**`information_quality`** ∈ `primary` | `secondary` | `indeterminate`
(closed set; source of truth `docs/specs/research-schema-spec.md`).
Best-effort classification — will be refined by assertion-classification,
but provide an initial value using the two-question decision tree:
1. Do we know the informant? No -> `indeterminate`
2. Did the informant witness/participate? Yes -> `primary`;
   No -> `secondary`; Cannot tell -> `indeterminate`

Classification is about the informant's proximity to the event,
not accuracy. Primary information can still be wrong.

**`informant` and `informant_proximity`** — **Required on every
assertion — never omit these fields.** `informant_proximity` is a closed
set: `self` | `witness` | `household_member` | `family_not_present` |
`official_duty` | `unknown` (source of truth
`docs/specs/research-schema-spec.md`). There is no `analyst` or
`researcher` value — for a negative assertion the researcher concluded
(no informant in the record), use `unknown` and explain the analyst
inference in `informant_bias_notes`. The recorder and informant are
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
unusual record types or edge cases, load
`references/information-classification-at-extraction.md`.

**Death certificate informants** — typically three, classified
by fact:
- **Attending physician** (e.g., "Dr. Stein"): informant for cause of
  death, duration of illness, death date/place. Proximity
  `official_duty` — medical witness who attended the death.
- **Personal informant** (named on the cert, often spouse or family):
  informant for the decedent's name, birth date/place, parents' names,
  occupation. Proximity `family_not_present` for facts about events the
  informant didn't witness (decedent's birth in another country,
  parents' birthplaces); proximity `witness` only for facts they
  personally observed.
- **Funeral director**: informant for burial date/location. Proximity
  `official_duty`.

A death certificate's **parents' names and birthplaces are `indirect`
evidence** — the personal informant reports what they were told, not
what they witnessed. The decedent's age stated on the certificate is
`direct` (a stated value); a *computed* birth date from age + death
date is `indirect` (arithmetic inference) — and prefer not to compute
exact birth dates from death-cert age at all; a year is enough.

**Marriage record informants** — the parties speak for themselves:
- **Groom and bride**: informants for their own identifying facts
  (age, birthplace, parents, occupation). Proximity `self`. Their
  parents' names on the license are `direct` evidence — the party
  stated them.
- **Officiant / clerk**: informant for the marriage event itself
  (date, place, ceremony). Proximity `official_duty` (officiant) or
  `witness` (clerk who recorded the signed return).
- **Witnesses** listed on the record: note them as FAN associates.
  Extract identifying facts only (name, possibly residence); do not
  create full per-witness assertion sets unless a research question
  targets them.

**`evidence_type`** ∈ `direct` | `indirect` | `negative` (closed set;
source of truth `docs/specs/research-schema-spec.md`). Best-effort
classification:
- `direct`: the fact is explicitly stated in the record (name,
  age, birthplace, occupation, residence — all `direct` when the
  record column contains the value)
- `indirect`: the fact requires inference from what is stated
  (e.g., birth year computed from age, household position suggesting
  parent-child relationship)
- `negative`: the meaningful absence of expected information

**`evidence_type` is about stated-vs-inferred, NOT about who reported
it.** A stated age on a 1850 census is `direct` even though the
informant was a household member, not the subject; *who* reported is
captured by `informant_proximity` (`household_member`), not by
`evidence_type`. The exception is the death-certificate parents'-
names case above, where the certificate creator only records what the
informant said — and a fact recorded from an informant who didn't
witness it is `indirect` even when stated.

There is no `no_evidence` value — a fact irrelevant to every open
question keeps its best-effort type (most often `indirect`). Do not
attempt `no_evidence`; the schema rejects it and the write tool will
refuse the entry.

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

For a user-provided record, call `research_log_append` with
`tool: "user_provided"`. When the record came from a `record_search`
you ran with `projectPath`, instead pass that response's
`staged.resultsRef` as `stagedResultsRef` so the host finalizes the
`results/<log_id>.json` sidecar (the validator needs it to cross-check
assertions carrying a `record_persona_id`). Use the returned `logId` as
the `log_entry_id` you stamp on the source and assertions in step 5.

Staged handles expire (~24h); if `research_log_append` returns
`{ ok: false }` because the handle no longer resolves, re-run the
`record_search` and pass the fresh handle.

### 5. Persist source and assertions

**You must actually persist the data — do not just describe the
extraction in your response.** A text summary without persisted entries
is an incomplete extraction.

**5a/5b. Append the source and every assertion in ONE batched
`research_append` call.** Pass an `ops` array: op #1 appends the source,
then one `append` op per assertion (including each negative assertion).
The whole batch validates once and writes once — on any per-op failure
the call returns `{ ok: false, errors: ["ops[i]: <msg>"] }` and writes
NOTHING, so surface the errors and correct the offending op rather than
retrying blindly. The tool assigns each id (`src_` for the source, `a_`
for each assertion), so there is no first-persona / Edit-append chunking
— just enumerate every fact as its own op:

```
research_append({
  projectPath: "<absolute project dir>",
  ops: [
    { section: "sources",    op: "append", entry: { /* the source fields from step 1, WITHOUT an id */ } },
    { section: "assertions", op: "append", entry: { /* assertion #1 from step 3, WITHOUT an id */ } },
    { section: "assertions", op: "append", entry: { /* assertion #2 … */ } }
    /* …one op per assertion, including each negative assertion… */
  ]
})
```

**Intra-batch id prediction.** The source is op #1, so its assigned id
is predictable — but it is **(highest existing `src_` in `research.json`)
+ 1**, zero-padded to 3, *not* always `src_001`. Read `research.json`'s
`sources[]` and compute it: with `src_001`…`src_009` already present, this
source is `src_010`. **Do NOT assume `src_001`** — that is only correct for
the very first source in a fresh project; assuming it would point every
assertion at a *different record's* source. Stamp each later assertion op's
`source_id` with that computed `src_` id, and stamp each assertion's
`log_entry_id` with step 4's `logId`. (An op may *reference* an id an
earlier op in the same batch created, but it may not `update` one — append
assigns the id internally.)

If a source for this record already exists, refine it instead with an
`update` op in the same batch: `{ section: "sources", op: "update",
entryId: "<src_>", fields: { /* changed fields */ } }`, and stamp the
assertions with that existing `src_` id rather than a predicted one.

Every persona gets fully expanded individual `a_` ops — one op per
assertion, never a range op, never compressed into ranges. Batching
changes only the number of *calls*; every assertion is still its own op
in the array.

**5c/5d. Write the tree side in ONE batched `tree_edit` call** — the
source `S` entry plus any sibling person stubs and their ParentChild
edges. `tree_edit` is a SEPARATE tool from `research_append`; its ops
cannot be merged into the `research_append` batch above. Pass a single
`ops` array: op #1 is the `add_source`, followed by the `add_person`
and `add_relationship` ops for any in-scope siblings (5d below). The
whole batch validates once and writes the tree once (with a one-deep
`.bak`) — on any per-op failure it returns `{ ok: false, errors:
["ops[i]: <msg>"] }` and writes NOTHING. The tool assigns every id (the
next `S` for the source, the next `I`/`N` for each person/name); do
**not** hand-edit the file, allocate ids, or call
`validate_research_schema` for it.

```
tree_edit({
  projectPath: "<absolute project dir>",
  ops: [
    { operation: "add_source", source: { /* title + optional author/url, NO id */ } }
    /* …then one add_person op per in-scope sibling from 5d (the
       add_relationship edges go in a SECOND tree_edit batch — see 5d)… */
  ]
})
```

For the `add_source` op, pass `title` (required) plus the optional
`author`/`url`; omit any field that doesn't apply — never set it to
`null`, and never pass an `id`. To correct an existing `S` entry's title
or citation later, use a `{ operation: "update_source", sourceId,
source }` op.

Before writing, double-check the fields the validator is strict about,
so the `research_append` batch passes on the first call:
- `record_id` is the result's `recordId` (any ARK / URL / bare-id form — the validator matches by canonical ARK form, so just pass it through). The full resolver URL goes in the source's `url` field
- `record_persona_id` is set (non-null) for `record_search` sources
- All required assertion fields are present (informant, informant_proximity, evidence_type)
- The `add_source` payload carries `title` (required) and only the optional `author`/`url`/`citation` — no `id`, no `null` values

**5d. Sibling person stubs — when the subject is a child on a household
record.** When the subject's `record_role` is `child_N` (i.e., the subject
appears as a child in a household record such as a census), also create
minimal person stubs in `tree.gedcomx.json` for the subject's siblings
on this record (the household's other `child_N` roles). The
`add_person` ops go in the SAME `tree_edit` batch as the 5c
`add_source` (one op per sibling); the `add_relationship` edges (one per
sibling × in-tree parent) follow in a SECOND `tree_edit` batch, because
each edge references the `I` id the tool assigns to its sibling — see
the write loop below. This is the
upstream half of the warnings-architecture chain Dallan called for: with
siblings persisted as persons, `buildParentMob` discovers them as
co-children, `relativesChildBirthRange40` and `person-evidence` can
reach them, and downstream skills can attach the per-sibling assertions
from step 5b.

**Trigger** — apply when ALL of these hold:
- the subject is `child_N` on this record (not the head, the spouse, or
  an unrelated role), AND
- at least one of the household's parent roles
  (`head_of_household`, `wife`, `father_of_*`, `mother_of_*`) maps to
  a person who **already exists in `tree.gedcomx.json`** — i.e., the
  shared parent is in the tree. Without an existing parent, the
  ParentChild edge has no terminus, so skip the stub creation and
  surface the gap in your summary.

**Skip** the stub creation when:
- the subject's role is anything else (head, spouse, witness, deceased,
  informant); the household's children are downstream of
  `person-evidence` and other skills, not this skill, OR
- no household parent exists in `tree.gedcomx.json` yet, OR
- a sibling with the same preferred name + gender already exists in
  `tree.gedcomx.json` (avoid duplicates — list `tree.gedcomx.json`
  `persons[]` once and skip stubs whose `names[0].given + surname` and
  `gender` match an existing entry).

**Before writing, enumerate the actual tree state — do not assume.**
Both the trigger and the skip conditions depend on what is **currently**
in `tree.gedcomx.json` on disk; you cannot apply them from memory or by
guessing the previous-extraction's output. Therefore, before deciding
whether to write any stub:

1. **Read `tree.gedcomx.json`** at the project path. List its
   `persons[]` once.
2. **For each household parent role on this record** (the
   `head_of_household` / `wife` / etc.), look up by preferred name +
   gender in the listed persons. Record the `I` id of each parent that
   is found. If at least one parent is found, the trigger fires; if
   none is found, the skip-on-no-parent condition applies and you stop
   here.
3. **For each sibling on this record** (every other `child_N` role
   besides the subject's), look up by preferred name + gender in the
   listed persons. Siblings found in the tree are skipped (duplicate-
   sibling skip). Siblings not found are the in-scope set for the
   write loop below.
4. **State the result of steps 2–3 explicitly in your response** — name
   the in-tree parents and their `I` ids, name each sibling as either
   "already in tree as I<x>" or "to be created", and only then proceed
   to write. Never write the words *"all siblings already existed"* or
   *"trigger was skipped"* without first surfacing the enumerated list
   that supports the conclusion. A reader (or validator) must be able
   to confirm the skip from the enumeration, not from a bare claim.

**For each in-scope sibling (i.e., not already present in the tree),
write the stub and the edges.** A sibling's ParentChild edge references
the `I` id the tool assigns to that sibling. The tool *does* let a later
op reference an id an earlier op created in the same batch (the `I`
allocator is `max+1`, like `src_`/`a_`), so add_person + add_relationship
in one batch is supported. But tree `I` ids are easier to mis-predict than
research ids — a tree mixes synthesized `I<n>` ids with FamilySearch person
ids — so prefer the robust pattern here: read each sibling's assigned `I`
id back from the stub batch's `results[].assignedIds`, then reference it in
a second `tree_edit` batch. Split this across two `tree_edit` calls:

1. **Person stubs — in the SAME batch as the 5c `add_source`.** Add one
   `add_person` op per in-scope sibling to that first `tree_edit` ops
   array. The tool assigns each sibling's `I` id and the `N` ids for
   names; do not set `id`. Each op's shape:

   ```
   { operation: "add_person",
     person: {
       gender: "Male" | "Female",
       names: [
         {
           given: "<given name from the record>",
           surname: "<surname from the record>",
           preferred: true,
           type: "BirthName"
         }
       ]
     } }
   ```

   No facts on the stub — the sibling's facts (birth, residence, etc.)
   stay on the per-sibling assertions in `research.json` from step 5b.
   Detailed sibling facts land later via record-extraction passes on
   records that feature the sibling directly (e.g., the next census).
   Read back each sibling's assigned `I` id from that batch's
   `results[].assignedIds`.

2. **ParentChild edges — in a SECOND `tree_edit` batch**, now that the
   sibling `I` ids are known. Add one `add_relationship` op per (sibling
   × in-tree parent) pair to a single ops array:

   ```
   tree_edit({
     projectPath: "<absolute project dir>",
     ops: [
       { operation: "add_relationship",
         relationship: {
           type: "ParentChild",
           parent: "<the existing parent's I id>",
           child: "<the sibling I id from step 1's response>"
         } }
       /* …one op per (sibling × in-tree parent) pair… */
     ]
   })
   ```

   If both household parents exist in the tree (e.g., both
   `head_of_household` and `wife` map to in-tree persons), emit TWO
   ParentChild ops per sibling — one per parent — so the sibling
   shows up correctly under either parent's `buildParentMob`.

**The subject's own person and the subject's ParentChild edges are
out of scope here** — those are written by `person-evidence` when it
links the subject's assertions to the tree person. This step is only
about the *siblings* the subject's `child_N` role implies.

**No new tool, no new schema.** `tree_edit` already supports
`add_person` and `add_relationship` (see `src/tools/tree-edit.ts`); the
simplified GedcomX `relationships[]` array already supports unlimited
`ParentChild` entries per parent (no schema change).

### 6. Present results

Show source, assertions by person-role, and classifications. Suggest
`check-warnings` to surface genealogical impossibilities, and
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
doesn't"), append a negative assertion via `research_append`
(`section: "assertions", op: "append"`). Conventions:

- `record_role: "absent"` and `evidence_type: "negative"` (literal strings).
- `record_id`: the record/collection that was searched.
- `value`: describes the **expected-but-missing** fact (not blank, not
  just "absent") — e.g., "Patrick Flynn absent from 1870 Schuylkill
  County census where expected".
- `informant`: the researcher/analyst who concluded absence.
  `informant_proximity: "unknown"` (no record informant reported the
  absence). Explain the analyst inference in `informant_bias_notes`,
  including alternative explanations (relocation, enumerator error,
  indexing omission, damaged pages).

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

On repeat invocation, detect whether a source for this record already
exists (by `gedcomx_source_description_id` or working citation). If so,
refine it via `research_append` `op: "update"` instead of creating a
duplicate; refine its assertions the same way. The log is append-only —
always append a new `log_` entry, never modify existing ones (see
`docs/specs/research-schema-spec.md` §4).
