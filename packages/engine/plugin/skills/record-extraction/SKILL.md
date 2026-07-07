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
   and Claude holds the (compact-stub) results in context. This is the most
   common path. The stubs are enough to *triage*; for full extraction, get the
   record's gedcomx from the search **sidecar** via path 2's `resultsRef` — not
   a fresh live fetch.

2. **Record ARK or entity ID** — a FamilySearch record ARK (e.g.,
   `ark:/61903/1:1:QVS9-DHDB`) or bare entity ID (e.g., `QVS9-DHDB`). Call
   `record_read` to get the full simplified GEDCOMX (persons, relationships,
   facts), then extract assertions from it.

   **Prefer the sidecar for a record that came from a staged `record_search`.**
   A `record_search` with a `projectPath` stages every result — the full gedcomx
   lives in that search's log-entry `results_ref` sidecar. Pass the ref to read
   the record **without a live fetch**:
   `record_read({ recordId, resultsRef: "<the search log entry's results_ref>", projectPath })`.
   The sidecar carries the **same persons, facts, and relationships** as a live
   read (verified) — use it for extracting evidence; it saves a network
   round-trip and never re-fetches a record you already searched. Do a **live**
   read (omit `resultsRef`) only when (a) you are finalizing a source and need
   its authoritative full **citation**, or (b) the record was not part of a
   staged search (a bare ARK handed to you). And never `record_read` a record you
   already read this session — reuse the content you have.

3. **PDF capture** — the user uploaded a PDF from an external site
   (Ancestry, MyHeritage, FindMyPast, FindAGrave). Claude reads the
   PDF directly. This comes via search-external-sites or a direct
   user upload.

4. **Image** — a FamilySearch image ARK (`3:1:.../$dist`) or Image
   Group Number (`dgs:{DGS}_{IMAGE}/dist.jpg`, i.e. an imageId like
   `004022578_00190`). **Do not call `image_read` yourself** — delegate
   to the **`image-reader` subagent** by invoking `@plugin:image-reader`,
   the same way `/research` invokes `@plugin:gps-mentor`. Invoke it
   **once per image** (it reads exactly one), with a delegation message
   naming the single `imageId`. It reads the scan in an isolated context
   and returns a **full text transcription** of the page plus an
   extracted-facts list; the raw image never enters your context.

   **`looking_for` is a search key, not the answer.** If you add a
   `looking_for` note, phrase it as *who or what* to locate on the page —
   e.g. "the christening entry for a Christina born ~Jan 1783" or "any
   entry naming a Clark." **Never tell the reader the answer or ask it to
   "confirm" one** — do not write "confirm the father is Adam Schreck and
   mother Margreth." The reader transcribes what the page actually says;
   **you** decide whether the returned transcription contains what you
   were looking for. Feeding it the expected result invites it to echo
   your hoped-for answer instead of reading the page.

   Treat the returned transcription exactly as you would your own reading
   — present it for user review, extract assertions after confirmation,
   and write it to the source's `transcription` field.

   **If the reader returns `NOT READ`** (an unreachable ARK, or an image
   over `image_read`'s transport-safety floor), it will include the
   verbatim error and a pivot recommendation. Do **not** treat a NOT READ
   as evidence and do **not** retry the image — pivot to indexes (see the
   paragraph below). Never fill the gap with an assumed reading.

   **Why delegate:** `image_read` returns the page as inline base64, and
   those blobs accumulate in the conversation, which is re-serialized every
   turn and eventually overflows the transport's ~1 MiB buffer, crashing
   the whole run. The subagent absorbs the base64 so only text flows back
   to you. Hand it **one specific** imageId at a time — narrow to the right
   page first (below); never ask it to browse a range or a whole volume.

   To find images without a URL, use `volume_search` by `standardPlace`
   + year range to discover digitized volumes (image groups), then invoke
   the `image-reader` subagent once for each specific image you land on.

   If an image cannot be read — you have no reachable image ARK / DGS
   URL, or `volume_search` / `place_search` fails (common in the sandbox,
   where the Places API is often unreachable) — do **not** try a browser,
   "Claude in Chrome", or `web_fetch` to fetch it: those are unavailable
   here and only waste turns. Instead, pivot to searchable **indexes**
   that carry the same facts — the record's own indexed persona fields
   (`record_read`), a broader `record_search` / `search-full-text`, a
   Find A Grave index entry, or the indexed records of related persons
   (e.g. a subject's children's death-record indexes routinely name a
   parent). Reserve image transcription for facts that exist *only* on
   the image; when even that is blocked, log the gap and continue via
   indexes rather than stopping the research.

## Steps

**Read inputs once, up front.** Before Step 1, read `research.json` and
`tree.gedcomx.json` a single time and keep both in context for the whole
extraction — you reuse them for source-id (`src_`) numbering, duplicate
checks, and existing-person (`I` id) lookups. Do not re-open either file
before each such check; the copy you read at the start is authoritative
for this pass, and `tree_edit` returns the ids it assigns, so you never
need to re-read to learn a new id. (This is the pre-write counterpart to
the no-re-read-after-write rule below.)

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

**`record_id`** — For FamilySearch `record_search` results, use the
result's **`arkUrl`** verbatim (the full URL form
`https://www.familysearch.org/ark:/61903/1:1:<id>`) — downstream
person-evidence requires the URL form to call `same_person`. For
`record_read` results, use the response's `recordId` (also a URL or
ARK; canonical matching makes the form forgiving here). For
non-FamilySearch sources use `ancestry:<collection>:<id>` or a
`capture:<descriptive>` id. Use the same `record_id` on every
assertion from one record.

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
a hard validator failure. Set it to **null** for image-, PDF-,
full-text-, and **`record_read`-sourced** records — none of these produce
the staged `record_search` sidecar the matcher keys on, so there is no
persona id to point at.

**`value`** — Human-readable, what the record says (not your
interpretation). "age 5" not "born 1845". Use `[?]` for uncertain
readings, `[illegible]`/`[torn]` for damage.

**`structured_value`** — Machine-readable companion to `value` for
name (`given`/`surname`), birth/death (`year`/`place`), residence
(`place`), relationship (`relationship_type`/`related_person_role` —
add `_inferred` suffix when deduced from position, not stated), and
occupation (`occupation`). One field per shape; see the schema for
exact keys.

**`information_quality`** ∈ `primary` | `secondary` | `indeterminate`.
Best-effort initial value (assertion-classification refines later): if
the informant witnessed/participated, `primary`; if they were told,
`secondary`; if the informant is unknown or it's unclear,
`indeterminate`. Classification is about the informant's proximity to
the event, not accuracy — primary information can still be wrong.

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

**Age vs. birth year (separate assertions, different evidence types):**
when the record states "age 32", the `age` assertion (`value: "32"`) is
`direct`; a separate `birth` assertion (`value: "~1818"`, computed
from age) is `indirect`. Same on a 1850/1860 census child age 5 →
birth `~1845` is indirect. Keep them as **separate `a_` entries**.

**Pre-1880 census relationships are always `indirect`** — the 1850 and
1860 U.S. census have no relationship column; relationships are inferred
from household position. Even when `record_read`/`record_search` returns
a `ParentChild` or `Couple` edge, the indexer inferred it — classify it
`indirect` with `relationship_type: "child_inferred"` (or
`"spouse_inferred"`). The 1880 census introduced explicit relationships.

**`log_entry_id`** — the search-log entry that produced this record
(reuse search-records/search-external-sites' `logId` if it logged the
search; otherwise the one you create in step 4).

**`extracted_for_question_ids`** — open research questions this
assertion bears on (check `research.json` questions); empty array
when the fact is extracted opportunistically.

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

A record from **`record_read`** (fetched by ARK, not staged from a
`record_search`) has **no** staged sidecar. Do **not** pass
`stagedResultsRef`, and do **not** hand-write a `results/<log_id>.json`
file for it — a manual sidecar with no staged persona is flagged as an
orphan by the validator and blocks every subsequent write until removed.
Just call `research_log_append` for it (tool `record_read`) with no
staged ref; its assertions carry `record_persona_id: null` (step 3), so
no sidecar is needed.

Staged handles expire (~24h); if `research_log_append` returns
`{ ok: false }` because the handle no longer resolves, re-run the
`record_search` and pass the fresh handle.

### 5. Persist source and assertions

**Call the tool BEFORE narrating it.** No "Now I'll persist…" preamble
before the call fires — the audit log must show the actual
`research_append` / `tree_edit` invocation, not text claiming you made
it. Narrating the persistence then ending the response is a hard test
failure.

**Tool-first checklist for this step:**
1. Make the `research_append` call (the batched `ops` from 5a/5b
   below). Wait for its return.
2. Make the `tree_edit` call (5c/5d, source `S` + any sibling
   `add_person` ops). Wait for its return.
3. If 5d sibling stubs fired: make the second `tree_edit` call for
   the `ParentChild` edges. Wait for its return.
4. **Only after the tool returns are you allowed to summarize
   what was persisted.** Match what you write to what the tool log
   actually shows.

**No post-write re-validation.** `research_append` and `tree_edit`
validate-on-write and keep a one-deep `.bak`; a successful return is
proof the write is valid. Do NOT call `validate_research_schema` (it is
not in this skill's allowed-tools) and do NOT re-read `research.json` /
`tree.gedcomx.json` to "sanity check" a successful write — that only
burns turns and tokens.

**If `research_append` or `tree_edit` are not immediately available** in
your tool list (e.g., shown as deferred), call ToolSearch first with
`query: "select:research_append,tree_edit,research_log_append,place_search"`
to load their schemas, then proceed with the tool-first checklist
above. **Never fall back to writing `research.json` or
`tree.gedcomx.json` files directly** — direct file writes bypass schema
validation, id allocation, and the `.bak` safety net, and they fail the
harness's tool-call validators even when the JSON is shape-correct.

**5a/5b. Append the source and every assertion in ONE batched
`research_append` call** (`ops`: source append first, then one append
op per assertion — including each negative). The batch validates once
and writes once; on any per-op failure it returns
`{ ok: false, errors: ["ops[i]: <msg>"] }` and writes NOTHING, so
surface and fix rather than retrying blindly. The tool assigns each
id; do not invent one.

**Intra-batch `source_id` prediction.** The source's assigned id is
`(highest existing src_ in research.json) + 1`, zero-padded to 3 —
**not always `src_001`**. Read `sources[]` and compute it (`src_009`
present → this is `src_010`). Stamp each assertion op's `source_id`
with that predicted id and `log_entry_id` with step 4's `logId`.
Assuming `src_001` on a non-empty project points every assertion at a
*different* record's source.

If a source for this record already exists, use an `update` op in the
same batch instead of `append` (with `entryId: "<src_>"` and the
changed `fields`), and stamp assertions with that existing `src_` id.

Every persona gets one append op — never a range op, never compressed.
Batching changes the number of *calls*, not the per-fact granularity.

**5c. Write the tree side in ONE batched `tree_edit` call** — the
source `S` entry plus any sibling `add_person` ops (5d below). The
`tree_edit` batch is separate from `research_append`'s; the tool
assigns every id (`S`, `I`, `N`), validates once, writes once with a
one-deep `.bak`, and on any per-op failure returns
`{ ok: false, errors: ["ops[i]: <msg>"] }` and writes NOTHING. For the
`add_source` op, pass `title` (required) plus the optional
`author`/`url`; omit any field that doesn't apply (never `null`, never
pass `id`). Correct a later `S` entry via an `update_source` op.

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
4. **Emit a compact enumeration checklist** (required before writing —
   a few lines, no deliberation prose):
   - Parents in tree: `<name> = I<id>`, … (or "none → skip stubs")
   - Siblings: `<name>` → create / `<name>` → already I<id>

   Don't claim *"all siblings already existed"* or *"trigger skipped"*
   without this list — the skip must be confirmable from the enumeration,
   not a bare assertion.

**Write the stubs and edges in two `tree_edit` batches** (tree `I` ids
mix synthesized + FamilySearch ids and aren't safe to predict, so read
each sibling's assigned `I` back from the first batch before
referencing it in the second):

1. **Person stubs — in the SAME batch as the 5c `add_source`.** One
   `add_person` op per in-scope sibling. Person shape: `gender`
   (`Male`/`Female`) + a single `names` entry with `given`, `surname`,
   `preferred: true`, `type: "BirthName"` — no `id`, no facts (facts
   stay on the per-sibling assertions; later record-extraction passes
   add more). Read back each assigned `I` id from
   `results[].assignedIds`.
2. **ParentChild edges — in a SECOND `tree_edit` batch**, one
   `add_relationship` op per (sibling × in-tree parent) pair:
   `{ type: "ParentChild", parent: "<existing parent I>", child:
   "<sibling I from step 1>" }`. If both household parents are in the
   tree, emit two ops per sibling (one per parent) so the sibling
   shows up under either `buildParentMob`.

The subject's own person and ParentChild edges are out of scope —
`person-evidence` writes those.

### 6. Present results

**OUTPUT ECONOMY (latency).** The source, assertions, and any tree stubs
are ALREADY persisted — the `research_append` and `tree_edit` returns
confirm every assigned id. Wall-clock time is ~linear in the tokens the
model generates (~16-20 ms/token, independent of model tier), so the
single biggest latency lever is generating fewer tokens. Do NOT reproduce
the full per-assertion tables, per-field walkthroughs, or the
classification rationale in chat — that content lives in the persisted
artifact, and the return already confirmed each assigned id.

Present a terse summary, **≤10 lines**:
- source id (`src_` + `S`),
- assertion count grouped by `record_role`,
- tree changes (persons created, edges added),
- key findings if any (gaps / conflicts / negative evidence),
- next step: `check-warnings` for genealogical impossibilities, then
  assertion-classification or person-evidence.

One short line per tool action, not a paragraph. The per-assertion detail
belongs in `research.json`, not echoed here.

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

## Re-invocation behavior

On repeat invocation, detect whether a source for this record already
exists (by `gedcomx_source_description_id` or working citation). If so,
refine it via `research_append` `op: "update"` instead of creating a
duplicate; refine its assertions the same way. The log is append-only —
always append a new `log_` entry, never modify existing ones (see
`docs/specs/research-schema-spec.md` §4).
