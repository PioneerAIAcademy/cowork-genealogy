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
   For **the person you searched**, the sidecar carries the same facts, the
   source citation, and correctly standardized places (more reliable than a live
   read, whose place standardization can misfire) — use it for extracting that
   person's evidence; it saves a network round-trip and never re-fetches a record
   you already searched. **Do NOT `Read` the sidecar file yourself to find record IDs** — you already hold each `recordId` from the search / ranked results, and `record_read` pulls just the one record you name out of the sidecar; reading the whole `results/<log_id>.json` reloads every staged result's gedcomx into context and defeats the compaction. Do a **live**
   read (omit `resultsRef`) only when (a) you need the **full facts of a
   co-resident** — a household member you did NOT search for (a parent, spouse, or
   sibling in a census). The sidecar fully populates only the person you searched
   and returns co-residents stubbed to a name plus a fact or two; a live read
   fills them in. Or (b) the record was not part of a staged search (a bare ARK
   handed to you). And never `record_read` a record you already read this
   session — reuse the content you have.

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

   **A required identifying name you flag as suspect is not confirmed by
   the index alone.** When the element that *keys identity* — a
   patronymic, a surname, a father's name on a baptism — is transcribed
   in a way you judge a likely mistranscription (an out-of-place
   patronymic, a spelling no other record corroborates), treat the
   indexed value as a lead, not a conclusion: read the original register
   image (`image_read`, or `volume_search` to locate it) to confirm the
   spelling before recording the assertion as established. If the image
   is unreachable, record the name **tentative** — keep the uncertain
   text in `value` with `[?]`, explain the doubt in `notes`, and name
   original-image confirmation as the outstanding step. (This is how an
   index OCR slip — a patronymic like "Aadnesen" read as "Nadnesen" —
   becomes a wrong father in the tree.)

## Steps

**Read inputs once, up front.** Before Step 1, read `research.json` and
`tree.gedcomx.json` a single time and keep both in context for the whole
extraction — you reuse them for duplicate checks and existing-person
(`I` id) lookups. Do not re-open either file before each such check; the
copy you read at the start is authoritative for this pass, and
`research_append` / `tree_edit` return every id they assign, so you
never need to re-read to learn a new id. (This is the pre-write
counterpart to the no-re-read-after-write rule below.)

### 1. Identify the source

Determine the source of the record:
- What type of record is it? (census, vital record, probate, etc.)
- Who created it? (U.S. Census Bureau, state health department, etc.)
- When was it created?
- Where is it held? (FamilySearch, Ancestry, NARA, etc.)
- What is the specific locator? (page, dwelling, certificate number)
- Is this an original, derivative, or authored source?

Create or find the source entry:
- A `src_` entry for this record + repository already in
  `research.json` → reuse it (refine via `research_append`
  `op: "update"`); otherwise append it in step 5.
- The matching `tree.gedcomx.json` `S` entry is created by the same
  step-5 call (`sourceDescription`) — or reused: multiple research
  sources can reference the same `gedcomx_source_description_id`
  (e.g., same census via FamilySearch and Ancestry); pass the
  existing `S` id instead of `sourceDescription`.

**Source entry fields — closed set, schema rejects extras.**
**Required:** `citation` (working Evidence Explained citation),
`citation_detail` (object with six required keys: `who`, `what`,
`when_created`, `when_accessed`, `where`, `where_within`),
`source_classification` (`original`/`derivative`/`authored`),
`repository`, `access_date`. **Tool-stamped:** `id` and
`gedcomx_source_description_id` (set the latter yourself only when
reusing an existing `S`). **Optional:** `url`, `url_archived`,
`notes` (provenance/quality), `transcription` (verbatim image text),
`log_entry_id`. Do not invent fields —
`record_id` is an assertion field, not a source field; `record_type`
is not a field at all. `when_accessed` / `access_date` are the real
date you accessed the record (today's date for a record you just
fetched) — never a template placeholder, a raw timestamp, or the
record's publication date.

Set the source's `log_entry_id` to the same step-4 `logId` the
assertions carry — the source→search provenance link; the log entry
itself is never modified.

**GedcomX source description (`tree.gedcomx.json` `S` entry):**
created by step 5's `sourceDescription: { title, author?, url? }` —
`title` required; **omit optional fields entirely when not
applicable** (`"url": null` fails validation). No `description`,
`notes`, or other fields, and never an `id` — the tool assigns the `S`.

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

**"Original not examined" checkpoint — decide it now, not later.** If
what you examined is a derivative (index entry, abstract, transcript,
translation) and you did NOT reach the underlying original, make it
explicit here: set `source_classification: "derivative"`, record
`"original not examined — <reason: browse-only, image-reader returned
NOT READ, undigitized, etc.>"` in the source `notes`, and state it
in your Step 6 summary. This is a first-class extraction finding —
research-exhaustiveness must inherit it, not rediscover it. Never let a
derivative-only extraction read as if the original was seen.

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
- **A differently-surnamed household head is a FAN lead, not noise.**
  When the subject's family group is enumerated inside a household
  headed by someone with a different surname, do not default to
  "boardinghouse" or "lodgers." Note the head as possible kin of
  unspecified relationship — a parent, sibling, or in-law of either
  spouse are all plausible, and any of them could surface a maiden
  name or other lead — and surface the possibility in your
  presentation for `hypothesis-tracking` to investigate. Do not assert
  a specific relationship (e.g., "the wife's father") without
  evidence. Other unrelated surnames in the dwelling may still
  indicate a boardinghouse; report the ambiguity rather than resolving
  it silently.

### 3. Extract assertions

For each person-role in the record, extract atomic assertions —
**one fact per assertion.** Separate age/birth year from birthplace:
these are distinct facts with different informant proximity
assessments and must be separate `a_` entries. Do not combine them
into a single assertion like "age 5, born Ireland." (An event's `date`
and `place` are attributes of ONE fact — a single death assertion
carries both fields. Atomicity separates distinct facts, not
attributes of one event.)

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
**Required:** `record_id`, `record_role`, `fact_type`,
`value`, `information_quality`, `informant`, `informant_proximity`,
`evidence_type`, `extracted_for_question_ids` (empty array if none),
and `source_id` — though in the step-5 batch the tool auto-stamps
`source_id` from the batch's source op, so omit it there; supply it
only when appending outside that batch (e.g. a later standalone
negative). **Optional:** `record_persona_id` (tool-enforced from the
sidecar — see below), `structured_value`, `date`, `date_certainty`
(closed set:
`exact`/`approximate`/`estimated`/`calculated`/`before`/`after`/`between`
— do not use `certain`, `about`, `circa`, etc.), `place`,
`standard_place`, `informant_bias_notes`, `log_entry_id`. The tool
assigns `id`. Do not invent fields — `notes` is a source field, not
an assertion field. The per-field craft is detailed below.

**Standardizing places (`standard_place`):** leave it out on
assertions — `research_append` resolves it at persist time (it copies
the source record's already-resolved `standard_place` from the search
sidecar, else geocodes the place text) and echoes every resolution in
`resolvedPlaces`; sanity-check those (a wrong-country resolution is
rejected by the tool). Supply a value yourself only when you already
hold the correct standard form (e.g. copied from a `record_read`
fact); supply `null` to record a place with no standard form.

**Critical rules for each field:**

**`record_id`** — For FamilySearch records, copy the result's
`recordId`; any ARK form is accepted (URL, bare
`ark:/61903/1:1:<id>`, or entity id) — for sidecar-backed assertions
`research_append` canonicalizes it to the sidecar's stored form. For
non-FamilySearch sources use `ancestry:<collection>:<id>` or a
`capture:<descriptive>` id. Use the same `record_id` on every
assertion from one record.

**`record_role`** — The role of THIS person in THIS record. Not who
the person is in the research project — that's person-evidence's job.
Assertions attach to records, not persons.

**`record_persona_id`** — the GedcomX person `id` of this persona in
the search sidecar. `research_append` enforces it from the assertion's
`log_entry_id`: sidecar present (`record_search`) → the tool verifies a
supplied id and auto-fills the searched persona when you omit it; no
sidecar (`record_read`, image, PDF, full-text) → leave it null —
supplying one is a hard error. Set it yourself only for non-focus
household members/witnesses: the matching `gedcomx.persons[]` id.

**`value`** — Human-readable, what the record says (not your
interpretation). "age 5" not "born 1845". Use `[?]` for uncertain
readings, `[illegible]`/`[torn]` for damage. One fact only, no
reasoning prose — the justification for an inferred relationship or a
doubted reading belongs in `informant_bias_notes`, never inside
`value`.

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
| Relationship (pre-1880) | none — inferred from household position | unknown | no relationship column exists; nobody reported the relationship — the inference is the researcher's, so no record informant exists (same convention as negative evidence) |

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
`evidence_type`. The exception is the death-certificate case above,
where the certificate creator only records what the informant said —
and a fact recorded from an informant who did **not** witness the event
it describes is `indirect` even when stated. This is **not** limited to
the parents' names: on a death certificate the *deceased's own* birth
date, birthplace, and parents are all `indirect` when the informant
(e.g., the surviving spouse) was not present at that birth abroad and
is relaying secondhand knowledge. Contrast a census, where a household
member reporting facts about their own household has firsthand
knowledge, so those stated facts stay `direct`. The test: did the
informant have primary knowledge of *this* fact? If not, it is
`indirect` even though the record states it plainly.

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
`results/<log_id>.json` sidecar (step 5's persona enforcement keys on
it). Use the returned `logId` as step 5's `log_entry_id`. Staged
handles expire (~24h) — on a stale-handle `{ ok: false }`, re-run the
search and pass the fresh one.

A **`record_read`**-fetched record has no staged sidecar: log it (tool
`record_read`) with no `stagedResultsRef`, and do **not** hand-write a
`results/<log_id>.json` for it — a manual sidecar is flagged as an
orphan by the validator and blocks every subsequent write until
removed. Its assertions carry `record_persona_id: null` (step 3).

### 5. Persist source and assertions

**Call the tool BEFORE narrating it.** No "Now I'll persist…" preamble
before the call fires — the audit log must show the actual
`research_append` invocation, not text claiming you made it. Narrating
the persistence then ending the response is a hard test failure.

**5a/5b. ONE `research_append` call per record**, with top-level
`sourceDescription: { title, author?, url? }` (omit inapplicable
fields — never `null`, never an `id`) and `ops` = one `sources` append
(leave `gedcomx_source_description_id` out — tool-stamped) followed by
one `assertions` append per persona-fact, negatives included, each
carrying step 4's `logId` as `log_entry_id`. Every persona-fact is its
own op — batching changes the number of *calls*, never the per-fact
granularity.

The tool assigns every id (`S`, `src_`, `a_`), creates the tree `S`
entry, stamps the source op's `gedcomx_source_description_id` and each
assertion's `source_id`, auto-fills `record_persona_id` and
canonicalizes `record_id` from the search sidecar, resolves
`standard_place` (sidecar copy first; check the echoed
`resolvedPlaces`), validates once, and writes both files. Never
predict an id; never call `tree_edit` for the source.

**Reuse instead of duplicating.** Record already described in the tree
(same record via another repository): omit `sourceDescription`; set
the sources op's `gedcomx_source_description_id` to the existing `S`
id. Same record + same repository already in research.json: an
`update` op (`entryId: "<src_>"`) instead of the append, with each
assertion's `source_id` set to that `src_` explicitly (the auto-stamp
requires a sources append).

**On `{ ok: false, errors, opsReceived }`** nothing was written: fix
ONLY the ops named in `errors` (`ops[i]: …`), keep the rest identical,
and resubmit the whole batch; `opsReceived` must match the op count
you sent (fewer = truncated batch — resend it). Never retry blindly
or drop unnamed ops.

**No post-write re-validation.** `research_append` and `tree_edit`
validate-on-write and keep a one-deep `.bak`; a successful return is
proof the write is valid. Do NOT call `validate_research_schema` (not
in this skill's allowed-tools) and do NOT re-read `research.json` /
`tree.gedcomx.json` to "sanity check" a successful write — that only
burns turns and tokens.

**If `research_append` or `tree_edit` are not immediately available**
(e.g., shown as deferred), call ToolSearch first with the
fully-qualified names, e.g.
`query: "select:mcp__genealogy__research_append,mcp__genealogy__tree_edit,mcp__genealogy__research_log_append,mcp__genealogy__place_search"`
(adjust the server prefix if yours differs), then proceed with 5a/5b.
**Never fall back to writing `research.json` or `tree.gedcomx.json`
directly** — direct writes bypass schema validation, id allocation,
and the `.bak` safety net, and fail the harness's tool-call validators
even when the JSON is shape-correct.

**5d. Sibling person stubs — when the subject is a child on a household
record.** When the subject's `record_role` is `child_N` (i.e., the subject
appears as a child in a household record such as a census), also create
minimal person stubs in `tree.gedcomx.json` for the subject's siblings
on this record (the household's other `child_N` roles). This is the one
tree_edit step left in this skill: a FIRST `tree_edit` batch of
`add_person` ops (one per sibling — person stubs only; the source `S`
entry was already created by the 5a/5b composite), then the
`add_relationship` edges (one per sibling × in-tree parent) in a SECOND
`tree_edit` batch, because each edge references the `I` id the tool
assigns to its sibling — see the write loop below. This is the
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
   listed persons. Match tolerantly — spelling variants and
   diminutives (Bridget/Biddy, Wm/William) are the same person.
   Siblings found in the tree are skipped (duplicate-sibling skip).
   Siblings not found are the in-scope set for the write loop below.
   If the record's children and the tree's existing children
   **contradict** each other (different sets that tolerant matching
   cannot reconcile), do not silently create both sets — stub only the
   clearly-new children and surface the discrepancy as an identity
   question for `hypothesis-tracking` in your Step 6 summary.
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

1. **Person stubs — one `tree_edit` batch of `add_person` ops** (stubs
   only, no source op). One `add_person` op per in-scope sibling.
   Person shape: `gender` (`Male`/`Female`) + a single `names` entry
   with `given`, `surname`, `preferred: true`, `type: "BirthName"` — no
   `id`, no facts (facts stay on the per-sibling assertions; later
   record-extraction passes add more). Read back each assigned `I` id
   from `results[].assignedIds`.
2. **ParentChild edges — in a SECOND `tree_edit` batch**, one
   `add_relationship` op per (sibling × in-tree parent) pair:
   `{ type: "ParentChild", parent: "<existing parent I>", child:
   "<sibling I from step 1>" }`. If both household parents are in the
   tree, emit two ops per sibling (one per parent) so the sibling
   shows up under either `buildParentMob`.

The subject's own person and ParentChild edges are out of scope —
`person-evidence` writes those.

### 6. Present results

**OUTPUT ECONOMY.** The source, assertions, and tree stubs are ALREADY
persisted — the `research_append` / `tree_edit` returns confirm every
assigned id. Do NOT reproduce the full per-assertion tables, per-field
walkthroughs, or classification rationale in chat; that lives in the
persisted artifact. Fewer tokens = lower latency.

Present a terse summary, **≤10 lines**:
- source id (`src_` + `S`),
- assertion count grouped by `record_role`,
- tree changes (persons created, edges added),
- key findings if any (gaps / conflicts / negative evidence, and any
  "original not examined" limitation from Step 1),
- next step: `check-warnings` for genealogical impossibilities, then
  assertion-classification or person-evidence.

One short line per tool action, not a paragraph. The per-assertion detail
belongs in `research.json`, not echoed here.

## Decision rules

**New vs. reuse:** same record + same repository → reuse the `src_`
entry; same underlying record via a different repository → new `src_`,
same `S` entry; different record → new `src_` and new `S` (mechanics
in step 5, "Reuse instead of duplicating").

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
| a_004 | child_1 | relationship | position consistent with child | indeterminate | none — inferred from household position | unknown |
| a_005 | head_of_household | name | Thomas Flynn | indeterminate | unknown household member (likely self or spouse) | household_member |

## Re-invocation behavior

On repeat invocation, detect whether a source for this record already
exists (by `gedcomx_source_description_id` or working citation). If so,
refine it via `research_append` `op: "update"` instead of creating a
duplicate; refine its assertions the same way. The log is append-only —
always append a new `log_` entry, never modify existing ones (see
`docs/specs/research-schema-spec.md` §4).
