# Research Schema Specification

This document defines the complete schema for `research.json`, the GPS audit trail and working artifact for genealogy research projects. It supersedes the earlier draft in `docs/gps/schema.md`.

## 1. Overview

A genealogy research project consists of two files:

- **`tree.gedcomx.json`** — The deliverable. Contains resolved persons, relationships, facts, and source descriptions in simplified GedcomX format (defined in `docs/gps/simplified-gedcomx.md`). This is what uploads to FamilySearch.
- **`research.json`** — The working artifact. Contains all analytical state: research questions, plans, search log, source metadata, assertions, person-to-record links, conflicts, hypotheses, timelines, and proof summaries. This is the GPS audit trail that proves the conclusions in the GedcomX file are sound.

### The two-file boundary

`research.json` references `tree.gedcomx.json` at two points:

1. **Person IDs** — `project.subject_person_ids`, `person_evidence.person_id`, and `timelines.person_ids` reference person IDs in `tree.gedcomx.json`.
2. **Source description IDs** — `sources.gedcomx_source_description_id` references source description IDs in `tree.gedcomx.json`.

At upload time, resolved person identities flow into `tree.gedcomx.json` while the assertion-to-record-role linkages stay in `research.json` as the audit trail.

### Bootstrap sequence

A project often starts with a question about a person who does not yet exist in `tree.gedcomx.json`. The init process creates a stub person in the GedcomX file (with whatever is known — a name, an approximate birth, a place) and sets `subject_person_ids` to that stub's ID. The stub is refined as research produces assertions and person_evidence links. `subject_person_ids` may also be null at creation and set after the first person_evidence link is established — for example, when the research objective is "identify the parents of the child in this record" and the child's identity is itself provisional.

### Top-level structure

```json
{
  "project": { },
  "questions": [ ],
  "plans": [ ],
  "log": [ ],
  "sources": [ ],
  "assertions": [ ],
  "person_evidence": [ ],
  "conflicts": [ ],
  "hypotheses": [ ],
  "timelines": [ ],
  "proof_summaries": [ ]
}
```

All arrays start empty. The file is created at project initialization.

---

## 2. Status Enums

All enums are defined here once and referenced by section schemas. Skills must use these exact values.

| Enum name | Values | Used by |
|-----------|--------|---------|
| `question_status` | `open`, `in_progress`, `exhaustive_declared`, `resolved` | questions |
| `plan_status` | `active`, `completed`, `superseded` | plans |
| `plan_item_status` | `planned`, `in_progress`, `completed`, `skipped` | plan items |
| `log_outcome` | `positive`, `negative`, `partial`, `error` | log |
| `source_classification` | `original`, `derivative`, `authored` | sources |
| `information_quality` | `primary`, `secondary`, `indeterminate` | assertions |
| `evidence_type` | `direct`, `indirect`, `negative` | assertions |
| `conflict_type` | `fact`, `identity` | conflicts |
| `conflict_status` | `unresolved`, `resolved`, `moot` | conflicts |
| `hypothesis_status` | `active`, `supported`, `ruled_out` | hypotheses |
| `proof_tier` | `proved`, `probable`, `possible`, `not_proved`, `disproved` | proof_summaries |
| `proof_vehicle` | `statement`, `summary`, `argument` | proof_summaries |
| `person_evidence_confidence` | `confident`, `probable`, `speculative` | person_evidence |
| `project_status` | `active`, `paused`, `completed` | project |
| `priority` | `high`, `medium`, `low` | questions |
| `selection_basis` | `timeline_gap`, `unresolved_conflict`, `fan_pivot`, `hypothesis_test`, `objective_decomposition`, `new_evidence`, `record_found_incidentally`, `user_directed` | questions |
| `informant_proximity` | `self`, `witness`, `household_member`, `family_not_present`, `official_duty`, `unknown` | assertions |
| `date_certainty` | `exact`, `approximate`, `estimated`, `calculated`, `before`, `after`, `between` | assertions |
| `date_certainty_timeline` | `exact`, `approximate`, `estimated`, `calculated` | timeline events (subset of date_certainty — directional qualifiers like before/after don't apply to timeline positioning) |

The following are **open enums** — recommended values that skills should prefer, but new values may be added when existing values don't fit. Document new values in the assertion/plan/timeline entry's notes.

| Enum name | Recommended values | Used by |
|-----------|-------------------|---------|
| `fact_type` | `name`, `birth`, `death`, `burial`, `marriage`, `residence`, `occupation`, `immigration`, `emigration`, `military_service`, `religion`, `relationship`, `property`, `education`, `other` | assertions |
| `record_type` | `census`, `vital_record`, `probate`, `land`, `church`, `military`, `newspaper`, `cemetery`, `tax`, `immigration`, `court`, `other` | plan items |
| `event_type` | `birth`, `baptism`, `marriage`, `death`, `burial`, `residence`, `census`, `military`, `immigration`, `emigration`, `land_transaction`, `probate`, `other` | timeline events |
| `record_role` | See naming convention below | assertions |
| `repository` | `FamilySearch`, `Ancestry`, `MyHeritage`, `FindMyPast`, `NARA`, `state_archives`, `county_courthouse`, `other` | plan items, sources. Use the same spelling between plans and sources so searches can match plan items to their resulting sources. |

**`record_role` naming convention:** Use lowercase_with_underscores. Numbered roles use the pattern `{role}_{n}` (e.g., `child_1`, `child_2`, `heir_1`). Standard roles: `head_of_household`, `wife`, `child_{n}`, `deceased`, `informant`, `father_of_bride`, `mother_of_bride`, `father_of_groom`, `mother_of_groom`, `grantee`, `grantor`, `testator`, `heir_{n}`, `witness_{n}`, `godparent_{n}`, `absent` (for negative evidence — a person expected but not found in the record).

---

## 3. ID Conventions

All IDs are strings with a prefix indicating the section. IDs are immutable once created and never reused.

| Prefix | Section | Example |
|--------|---------|---------|
| `rp_` | project | `rp_001` |
| `q_` | questions | `q_001` |
| `pl_` | plans | `pl_001` |
| `pli_` | plan items | `pli_001` |
| `log_` | log | `log_001` |
| `src_` | sources | `src_001` |
| `a_` | assertions | `a_001` |
| `pe_` | person_evidence | `pe_001` |
| `c_` | conflicts | `c_001` |
| `h_` | hypotheses | `h_001` |
| `t_` | timelines | `t_001` |
| `ps_` | proof_summaries | `ps_001` |

GedcomX IDs (person IDs like `I1`, source description IDs like `S1`) use their own conventions from `tree.gedcomx.json` and are referenced as foreign keys.

---

## 4. Ownership Table

Each skill writes to its own section and reads from others. Skills must never write across section boundaries.

| Section | Written by | Read by | Mutation rule |
|---------|-----------|---------|---------------|
| `project` | init, proof-conclusion (status, updated) | all | Mutable (status, updated) |
| `questions` | question-selection | research-plan, all downstream | Mutable; never delete, supersede with status |
| `plans` | research-plan | log, question-selection | Mutable; old plans set to `superseded`, never deleted |
| `log` | search-records, search-external-sites, record-extraction (all embed research-log-protocol) | question-selection, all | **Append-only; entries never modified or deleted** |
| `sources` | record-extraction, citation | all | Mutable (citation can be refined); never delete |
| `assertions` | record-extraction, assertion-classification, convert-dates | timeline, conflict-resolution, proof-conclusion, question-selection | Mutable (classification fields, date fields); never delete |
| `person_evidence` | person-evidence | all downstream | Mutable (confidence, rationale); never delete, use superseded_by |
| `conflicts` | conflict-resolution | question-selection, proof-conclusion | Mutable (status, analysis, preferred_assertion_id) |
| `hypotheses` | hypothesis-tracking | question-selection, proof-conclusion | Mutable (status, assertion lists, ruled_out fields) |
| `timelines` | timeline | question-selection, conflict-resolution | Regeneratable; replaced wholesale when regenerated |
| `proof_summaries` | proof-conclusion | (terminal) | Mutable (tier, narrative can be revised) |

**General rule:** Append-only sections (`log`) are never rewritten. All other sections allow field updates but skills must preserve IDs and never delete entries — supersede with a status field instead. This lets you reconstruct project history from the file alone.

---

## 5. Section Schemas

### 5.1 `project`

Single object (not an array).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Project ID (`rp_` prefix) |
| `objective` | string | yes | The overarching research goal |
| `subject_person_ids` | string[] or null | no | GedcomX person IDs of the research subjects. Null at creation if no GedcomX person exists yet; set after the first person_evidence link. Array supports multi-subject projects (tracing a couple, resolving which of several same-name candidates is the target). |
| `status` | `project_status` | yes | Current status |
| `created` | string | yes | ISO 8601 date |
| `updated` | string | yes | ISO 8601 date |

### 5.2 `questions`

Array of question objects.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Question ID (`q_` prefix) |
| `question` | string | yes | The specific research question |
| `rationale` | string | yes | Why this question matters to the objective |
| `selection_basis` | `selection_basis` | yes | Why this question was chosen |
| `priority` | `priority` | yes | Question priority |
| `status` | `question_status` | yes | Current status |
| `depends_on` | string[] | yes | Question IDs this question depends on (may be empty) |
| `unblocks` | string[] | yes | Question IDs this question unblocks (may be empty) |
| `created` | string | yes | ISO 8601 date |
| `resolved` | string or null | yes | ISO 8601 date when resolved, or null |
| `resolution_assertion_ids` | string[] | yes | Assertion IDs that resolved this question (may be empty) |
| `exhaustive_declaration` | object | yes | See below |

**`exhaustive_declaration`** — The GPS requires an explicit claim that research on a question is reasonably exhaustive, with references to the log entries that justify it. The `stop_criteria` object maps to the 7-Point Stop Criteria from GPS Step 1.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `declared` | boolean | yes | Whether exhaustive search has been declared |
| `justification` | string or null | no | Prose explaining why the search is exhaustive |
| `log_entry_ids` | string[] | yes | Log entry IDs supporting the exhaustive claim (required non-empty when `declared` is true) |
| `stop_criteria` | object or null | yes | Null when `declared` is false; required object when `declared` is true. Always present as a key (null, not omitted) for consistency. See below |

**`stop_criteria`** — Structured assessment against the GPS 7-Point Stop Criteria. Each field is a brief assessment (1-2 sentences).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `goal_alignment` | string | yes | Have the results provided a convincing answer to the research question? |
| `repository_breadth` | string | yes | Have all potentially relevant repositories and informants been addressed? For identity and relationship questions, also consider whether FAN (Family, Associates, Neighbors) research has been attempted when direct evidence is insufficient. |
| `original_substitution` | string | yes | Has derivative information been replaced by original records wherever possible? |
| `independent_verification` | string | yes | Have at least two independent sources been used to verify the data? |
| `evidence_class` | string | yes | Does the evidence include at least one original record with primary information? |
| `conflict_resolution` | string | yes | Have all discrepancies been resolved through reasoning? |
| `overturn_risk` | string | yes | What is the likelihood that new evidence would overturn this conclusion? |

### 5.3 `plans`

Array of plan objects. When a plan fails and is re-planned for the same question, a new plan is created and the old one is set to `superseded`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Plan ID (`pl_` prefix) |
| `question_id` | string | yes | The question this plan addresses (`q_` reference) |
| `status` | `plan_status` | yes | Current status |
| `created` | string | yes | ISO 8601 date |
| `items` | object[] | yes | At least one plan item (see below) |

**Plan items:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Plan item ID (`pli_` prefix) |
| `sequence` | number | yes | 1-based execution order |
| `record_type` | string | yes | Type of record to search: `census`, `vital_record`, `probate`, `land`, `church`, `military`, `newspaper`, `cemetery`, `tax`, `immigration`, `court`, `other` |
| `jurisdiction` | string | yes | Human-readable place description (e.g., "Schuylkill County, Pennsylvania") |
| `date_range` | string | yes | Target date range (e.g., "1840", "1830-1850") |
| `repository` | `repository` | yes | Where to search (see open enums in Section 2) |
| `rationale` | string | yes | Why this record set for this question |
| `fallback_for` | string or null | yes | `pli_` ID of the plan item this is a fallback for, or null |
| `status` | `plan_item_status` | yes | Current status |

### 5.4 `log`

Array of log entry objects. **Append-only — entries are never modified or deleted.** This is the core GPS audit trail. Every tool call that searches for records must produce a log entry, including searches that return no results.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Log entry ID (`log_` prefix) |
| `plan_item_id` | string or null | yes | `pli_` reference, or null for ad-hoc searches |
| `performed` | string | yes | ISO 8601 datetime with timezone |
| `tool` | string | yes | The MCP tool or method used (e.g., `record_search`, `fulltext_search`, `tree_read`, `image_search`, `external_site`) |
| `query` | object | yes | Freeform object capturing the search parameters used |
| `outcome` | `log_outcome` | yes | Result of the search |
| `results_examined` | number | yes | Number of results examined (0 for negative) |
| `captured_source_ids` | string[] | yes | Source IDs created from this search (may be empty) |
| `produced_assertion_ids` | string[] | yes | Assertion IDs created from this search (may be empty) |
| `notes` | string or null | no | Free text observations |
| `external_site` | object or null | yes | External site details when `tool` is `external_site`, otherwise null. See below |

**`external_site`** — Present only when the search was conducted via the generate-click-capture-analyze workflow on a commercial genealogy site.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `site` | string | yes | `ancestry`, `myheritage`, `findmypast`, or `familysearch_web` |
| `url_generated` | string | yes | The search URL presented to the user |
| `capture_received` | boolean | yes | Whether the user returned a PDF/capture |
| `capture_filename` | string or null | no | Filename of the returned capture |

### 5.5 `sources`

Array of source objects. Sources in `research.json` carry analytical metadata (classification, structured citation detail). The source descriptions themselves also appear in `tree.gedcomx.json` in simplified GedcomX format for upload.

**1:many relationship with GedcomX:** Multiple research sources can reference the same `gedcomx_source_description_id`. This is the expected pattern when the same underlying record is accessed through different repositories — e.g., the 1850 census via FamilySearch (original image, `source_classification: "original"`) and via Ancestry (derivative index, `source_classification: "derivative"`). They are different sources of the same record, per GPS practice. The GedcomX source description represents the underlying record; the research sources represent distinct access paths with distinct classifications.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Source ID (`src_` prefix) |
| `gedcomx_source_description_id` | string | yes | Foreign key to `tree.gedcomx.json` `sources[].id` |
| `citation` | string | yes | Formatted citation per Evidence Explained |
| `citation_detail` | object | yes | Structured citation breakdown. See below |
| `source_classification` | `source_classification` | yes | Original, Derivative, or Authored — classified at the source level |
| `repository` | string | yes | Where this source is held |
| `access_date` | string | yes | ISO 8601 date when the source was accessed |
| `url` | string or null | no | URL to the digital source |
| `url_archived` | string or null | no | Web archive URL |
| `notes` | string or null | no | Quality observations and provenance chain concerns. Use this field to flag risks introduced by the access path — e.g., microfilm quality issues, OCR errors in the digitization, known indexing problems for this collection, or the number of derivative steps between the agent's access and the true original (e.g., "accessed as digital image of microfilm of original census page — two derivative steps from the original"). GPS guardrail: every step from creation to digitization can introduce error. |

**`citation_detail`** — Enforces the Who/What/When/Where/Where-within framework from Evidence Explained.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `who` | string | yes | Creator, agency, or informant |
| `what` | string | yes | Title or description of the record |
| `when_created` | string | yes | Date the record was created |
| `when_accessed` | string | yes | Date of digital access |
| `where` | string | yes | Repository (physical or digital) |
| `where_within` | string | yes | Page, entry, image number, microfilm roll, certificate number |

### 5.6 `assertions`

Array of assertion objects. Each assertion is an atomic claim extracted from a record. **Assertions attach to `record_id` + `record_role`, not to a person.** Person attachment happens separately in `person_evidence`.

**Extraction policy:** Extract all facts that are relevant to any open research question, plus identifying facts (name, age, birthplace) for every person in the record who might be the subject or a FAN associate. Do not extract every field from every household member — e.g., the occupation or school attendance of an unrelated neighbor is not useful unless a question specifically targets it. The `extracted_for_question_ids` field tracks relevance; assertions extracted opportunistically (bearing on questions not yet asked) use an empty array and will be linked to questions later.

**Negative evidence (the "dog not barking"):** When the absence of information is itself a finding — e.g., "Patrick is absent from the 1870 census where he should appear" — this is an analytical inference drawn from a negative log entry. It is recorded as an assertion with `evidence_type: "negative"`. The `record_id` references the record that was searched (e.g., the 1870 census for Schuylkill County), `record_role` is `"absent"`, and `value` describes the expected-but-missing information. The `source_id` references the source that was searched. This distinguishes a negative log entry (just "nil results") from a negative assertion (the analytical conclusion that the absence is meaningful).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Assertion ID (`a_` prefix) |
| `source_id` | string | yes | `src_` reference to the source this was extracted from |
| `record_id` | string | yes | The record identifier (e.g., FamilySearch record ARK, Ancestry record ID, or a descriptive ID for captures) |
| `record_role` | string | yes | The role of the person within the record (e.g., `head_of_household`, `wife`, `child_1`, `deceased`, `father_of_bride`, `grantee`, `testator`, `heir_1`, `informant`) |
| `fact_type` | string | yes | The type of fact: `name`, `birth`, `death`, `burial`, `marriage`, `residence`, `occupation`, `immigration`, `emigration`, `military_service`, `religion`, `relationship`, `property`, `education`, `other` |
| `value` | string | yes | The extracted value (human-readable) |
| `structured_value` | object or null | no | Machine-readable structured form of the value. Shape depends on `fact_type`. See below |
| `date` | string or null | no | Date of the event/fact |
| `date_certainty` | string or null | no | `exact`, `approximate`, `estimated`, `calculated`, `before`, `after`, or `between` |
| `place` | string or null | no | Place description |
| `information_quality` | `information_quality` | yes | Primary, Secondary, or Indeterminate — classified at the assertion level |
| `informant` | string | yes | Who provided this specific information (e.g., "census enumerator", "attending physician", "son-in-law James Brown", "unknown household member") |
| `informant_proximity` | string | yes | `self`, `witness`, `household_member`, `family_not_present`, `official_duty`, or `unknown` |
| `informant_bias_notes` | string or null | no | Notes on potential bias (e.g., "may have misreported age for military eligibility") |
| `evidence_type` | `evidence_type` | yes | Direct, Indirect, or Negative |
| `log_entry_id` | string or null | no | `log_` reference to the search that produced this assertion. Makes the provenance chain bidirectional: log → assertion and assertion → log. Null for assertions created outside the search workflow (e.g., from manual record analysis). |
| `extracted_for_question_ids` | string[] | yes | Question IDs this assertion bears on (may be empty; many assertions are extracted opportunistically) |

**`structured_value`** — Optional machine-readable form of `value` that enables programmatic comparison (timeline construction, conflict detection) without parsing prose. The freeform `value` stays for human readability. See Section 5.6.1 for recommended shapes by fact_type.

### 5.6.1 `structured_value` Shapes

Recommended shapes by `fact_type`. The shape is not strictly enforced — it is guidance for consistency. Skill writers adding new fact types should document the shape here.

| `fact_type` | Shape | Example |
|-------------|-------|---------|
| `name` | `{ "given", "surname" }` | `{ "given": "Patrick", "surname": "Flynn" }` |
| `birth`, `death`, `burial` | `{ "year", "place" }` | `{ "year": 1845, "place": "Ireland" }` — `year` as number for comparison |
| `residence` | `{ "place" }` | `{ "place": "Schuylkill County, Pennsylvania" }` |
| `marriage` | `{ "spouse_given", "spouse_surname", "place" }` | `{ "spouse_given": "Mary", "spouse_surname": "Kelly" }` |
| `relationship` | `{ "relationship_type", "related_person_role" }` | `{ "relationship_type": "son", "related_person_role": "head_of_household" }` |
| `occupation` | `{ "occupation" }` | `{ "occupation": "coal miner" }` |
| `immigration` | `{ "year", "origin", "destination", "port" }` | `{ "year": 1848, "origin": "Ireland", "destination": "Philadelphia" }` |

**Authority:** `structured_value` is derived from `value`, `date`, and `place` — not the other way around. If they disagree, the human-readable fields (`value`, `date`, `place`) govern. This follows the same authority pattern as `narrative_markdown` vs. structured fields in proof summaries.

**`_inferred` suffix convention:** Use `_inferred` suffix on `relationship_type` (e.g., `child_inferred`) when the relationship is deduced from household position rather than explicitly stated in the record. This distinguishes the 1850 census (no relationship column) from the 1860 census (explicit relationship column). This convention is specific to `relationship_type` — other fact types handle uncertainty through the assertion's `evidence_type` (indirect) and `informant_bias_notes` rather than through the structured value itself.

### 5.7 `person_evidence`

Array of person-evidence link objects. **This section bridges assertions (attached to records/roles) to persons (in GedcomX).** It is the identity-resolution step — evaluating whether the person in role X of record Y is the same as GedcomX person Z.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Person-evidence ID (`pe_` prefix) |
| `assertion_id` | string | yes | `a_` reference to the assertion being linked |
| `person_id` | string | yes | GedcomX person ID in `tree.gedcomx.json` |
| `confidence` | `person_evidence_confidence` | yes | How confident is this link |
| `rationale` | string | yes | Why this assertion's record_role is believed to be this person |
| `match_score` | number or null | no | ML match score from the Match tool (0.0-1.0) |
| `created` | string | yes | ISO 8601 date |
| `superseded_by` | string or null | no | `pe_` ID if this linking was revised |

**Cardinality:** One assertion can have multiple person_evidence entries linking it to different persons. This is the expected pattern for assertions that imply relationships — e.g., a_004 ("Listed in household of Thomas Flynn, position consistent with child") is evidence for both I1 (Patrick, the child) and I2 (Thomas, the head). Create one `pe_` entry per person the assertion bears on. The `person-evidence` skill writes all links; `record-extraction` does not create provisional links.

When a link is revised (e.g., the assertion is re-linked to a different person), the old entry gets `superseded_by` set to the new entry's ID. The old entry is never deleted.

### 5.8 `conflicts`

Array of conflict objects. Conflicts are both fact-level (three different birthplaces) and identity-level (is this census record our subject?).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Conflict ID (`c_` prefix) |
| `conflict_type` | `conflict_type` | yes | `fact` or `identity` |
| `description` | string | yes | Human-readable description of the conflict |
| `disputed_attribute` | string or null | conditional | Required when `conflict_type` is `fact`. The specific attribute in dispute (e.g., `birthplace`, `birth_year`, `death_date`, `surname_spelling`). This is finer-grained than the assertion-level `fact_type` — a `birth` fact can have sub-conflicts on year vs. place, so the conflict names the specific attribute. |
| `identity_question` | string or null | conditional | Required when `conflict_type` is `identity`. The identity question (e.g., "Is the Patrick Flynn in Thomas Flynn's 1850 household our subject?") |
| `competing_assertion_ids` | string[] | yes | `a_` references. At least 2 for `fact` conflicts (two assertions disagree). At least 1 for `identity` conflicts (a single assertion whose person linkage is uncertain). |
| `independence_analysis` | string or null | no | Analysis of whether the competing sources are independent |
| `weighing_analysis` | string or null | no | Application of the preponderance hierarchy |
| `preferred_assertion_id` | string or null | no | `a_` reference to the favored assertion |
| `resolution_rationale` | string or null | no | Why the preferred assertion was chosen |
| `status` | `conflict_status` | yes | Current status |
| `blocks_question_ids` | string[] | yes | Question IDs blocked by this unresolved conflict (may be empty) |

`independence_analysis` and `weighing_analysis` are kept as separate fields because source independence is a distinct analytical step from evidence weighing per the GPS.

### 5.9 `hypotheses`

Array of hypothesis objects.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Hypothesis ID (`h_` prefix) |
| `claim` | string | yes | The hypothesis being tested |
| `status` | `hypothesis_status` | yes | Current status |
| `supporting_assertion_ids` | string[] | yes | `a_` references (may be empty) |
| `contradicting_assertion_ids` | string[] | yes | `a_` references (may be empty) |
| `ruled_out` | boolean | yes | Whether this hypothesis has been eliminated |
| `ruled_out_reason` | string or null | conditional | Required when `ruled_out` is true |
| `notes` | string or null | no | Additional context |
| `related_question_ids` | string[] | yes | Question IDs this hypothesis relates to (may be empty) |

FAN findings are regular assertions about the subject's associates. There is no separate `fan_evidence_ids` field — hypothesis support links to FAN assertions via `supporting_assertion_ids`.

**Status transitions:** A hypothesis moves to `supported` when at least one line of direct evidence supports the claim and no unresolved contradictions remain. It moves to `ruled_out` when evidence affirmatively refutes the claim, exhaustive elimination logic excludes the candidate, or a chronological impossibility makes the hypothesis untenable. A hypothesis at `active` has supporting or contradicting evidence accumulating but has not yet crossed either threshold.

### 5.10 `timelines`

Array of timeline objects. Timelines are keyed by a unique ID with a human-readable label, **not by person ID**. This supports building candidate timelines to test whether records cohere into one life.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Timeline ID (`t_` prefix) |
| `label` | string | yes | Human-readable label (e.g., "John Smith assuming Augusta = Rockingham", "Thomas Smith candidate father") |
| `hypothesis_id` | string or null | no | `h_` reference if this timeline tests a specific hypothesis |
| `person_ids` | string[] | yes | GedcomX person IDs this timeline aggregates (may be multiple for merge-testing) |
| `generated` | string | yes | ISO 8601 datetime when this timeline was last generated |
| `events` | object[] | yes | Timeline events (see below) |
| `gaps` | object[] | yes | Identified gaps (may be empty, see below) |
| `impossibilities` | object[] | yes | Chronological impossibilities (may be empty, see below) |

**Timeline events:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `date` | string | yes | Date of the event |
| `date_certainty` | string | yes | `exact`, `approximate`, `estimated`, or `calculated` |
| `event_type` | string | yes | `birth`, `baptism`, `marriage`, `death`, `burial`, `residence`, `census`, `military`, `immigration`, `emigration`, `land_transaction`, `probate`, `other` |
| `place` | string or null | no | Place description |
| `description` | string | yes | Human-readable event description |
| `assertion_ids` | string[] | yes | `a_` references backing this event |

**Timeline gaps:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `start` | string | yes | ISO 8601 date |
| `end` | string | yes | ISO 8601 date |
| `expected_events` | string[] | yes | Event types expected in this gap |
| `severity` | string | yes | `high`, `medium`, or `low` |

**Timeline impossibilities:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | yes | What makes this impossible (e.g., "Born in Virginia 1820 but enumerated in Ohio 1819") |
| `event_1_assertion_id` | string | yes | `a_` reference |
| `event_2_assertion_id` | string | yes | `a_` reference |

### 5.11 `proof_summaries`

Array of proof summary objects. Each proof summary is a self-contained GPS conclusion for a specific research question.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Proof summary ID (`ps_` prefix) |
| `question_id` | string | yes | `q_` reference to the question being concluded |
| `tier` | `proof_tier` | yes | Confidence tier |
| `vehicle` | `proof_vehicle` | yes | Proof vehicle |
| `supporting_assertion_ids` | string[] | yes | `a_` references forming the body of evidence |
| `resolved_conflict_ids` | string[] | yes | `c_` references to conflicts resolved in this proof (may be empty) |
| `exhaustive_search_summary` | string | yes | Brief summary of search scope, referencing log entries |
| `narrative_markdown` | string | yes | Self-contained GPS conclusion narrative |

**Timing:** Proof summaries may be written for questions at any status. A summary for an `in_progress` question represents a preliminary conclusion; its tier should reflect the incomplete state of research (typically `probable` or `possible`, not `proved`). Writing preliminary conclusions is encouraged — it forces the skill to articulate the current state of evidence and identify what's missing.

The `narrative_markdown` is the authoritative GPS conclusion — the written proof per GPS Step 5. The structured fields (`tier`, `vehicle`, `supporting_assertion_ids`, `resolved_conflict_ids`) are metadata about it, not replacements for it. If the narrative and the structured fields disagree, the narrative governs; the skill should update the structured fields to match. The narrative must be readable as a standalone document without reference to the rest of the JSON, written in a form uploadable to FamilySearch as a Memory/Document. It includes inline citations, the evidence summary, conflict resolution rationale, and the confidence tier declaration. It cannot include images (it lives inside a JSON string field); image references should be described by citation.

---

## 6. Cross-Reference Map

```
project
  └─ subject_person_ids ─────────────────────────► tree.gedcomx.json persons[].id

questions
  ├─ depends_on / unblocks ──────────────────────► questions[].id
  └─ resolution_assertion_ids ───────────────────► assertions[].id

plans
  └─ question_id ────────────────────────────────► questions[].id

log
  ├─ plan_item_id ───────────────────────────────► plans[].items[].id
  ├─ captured_source_ids ────────────────────────► sources[].id
  └─ produced_assertion_ids ─────────────────────► assertions[].id

sources
  └─ gedcomx_source_description_id ──────────────► tree.gedcomx.json sources[].id

assertions
  ├─ source_id ──────────────────────────────────► sources[].id
  ├─ log_entry_id ───────────────────────────────► log[].id
  └─ extracted_for_question_ids ─────────────────► questions[].id

person_evidence
  ├─ assertion_id ───────────────────────────────► assertions[].id
  ├─ person_id ──────────────────────────────────► tree.gedcomx.json persons[].id
  └─ superseded_by ──────────────────────────────► person_evidence[].id

conflicts
  ├─ competing_assertion_ids ────────────────────► assertions[].id
  ├─ preferred_assertion_id ─────────────────────► assertions[].id
  └─ blocks_question_ids ───────────────────────► questions[].id

hypotheses
  ├─ supporting_assertion_ids ───────────────────► assertions[].id
  ├─ contradicting_assertion_ids ────────────────► assertions[].id
  └─ related_question_ids ──────────────────────► questions[].id

timelines
  ├─ hypothesis_id ──────────────────────────────► hypotheses[].id
  ├─ person_ids ─────────────────────────────────► tree.gedcomx.json persons[].id
  └─ events[].assertion_ids ─────────────────────► assertions[].id

proof_summaries
  ├─ question_id ────────────────────────────────► questions[].id
  ├─ supporting_assertion_ids ───────────────────► assertions[].id
  └─ resolved_conflict_ids ─────────────────────► conflicts[].id
```

---

## 7. Design Decisions

**Why assertions attach to `record_id` + `record_role`, not to a person.** Most genealogy research is about deciding whether two records refer to the same person. If assertions are attached to a person ID before that decision is made, you either force premature identity decisions or corrupt data when persons get merged. Assertions attach to the record and the role within it (the "persona" in GedcomX terms). Person attachment is a separate, revisable step in `person_evidence`.

**Why timelines are keyed by ID and label, not by person ID.** Timeline construction is itself an identity-resolution exercise. You build a candidate timeline to test whether records cohere into one life. Keying by person ID forces you to decide identity before testing it. A labeled timeline like "John Smith assuming Augusta = Rockingham" can aggregate multiple GedcomX person IDs that might merge.

**Why `independence_analysis` and `weighing_analysis` are separate fields.** Source independence is a distinct analytical step in the GPS. Two derivative indexes of the same original record are not independent sources — determining this requires analysis separate from weighing the evidence. Keeping them separate forces the conflict-resolution skill to actually perform both steps rather than folding independence into general weighing prose.

**Why `log` is append-only but other sections are mutable.** The log is the primary audit trail for "reasonably exhaustive" claims. If log entries could be edited or deleted, the exhaustive search declaration would be unfalsifiable. Other sections allow updates (refining a citation, revising a classification, resolving a conflict) because analytical conclusions legitimately evolve. But no section allows deletion — entries are superseded with status fields.

**Why `source_classification` is on sources but `information_quality` is on assertions.** A single original source can contain both primary and secondary information. A death certificate is an original source; the death date reported by the attending physician is primary information, but the birth date reported by a son-in-law is secondary information. Classifying the source at the source level and the information at the assertion level prevents the common error of labeling an entire source as "primary."

**Why there is no `schema_version` field.** Schema migration is not a goal during the build-out phase. If the schema changes, old project files break, and that is acceptable. Adding a version field creates a maintenance burden (migration logic in every skill) for a benefit (graceful migration) that isn't needed yet.

**Why `fan_evidence_ids` was removed from hypotheses.** FAN (Family, Associates, Neighbors) findings are regular assertions about persons associated with the research subject. A witness pattern on land deeds, a neighbor correlation in census records — these are assertions like any other. The hypothesis links to them via `supporting_assertion_ids`. A separate `fan_evidence_ids` field would reference an entity type that was never defined.

**Why `independence_analysis` is per-conflict, not per-source-pair.** Independence depends on context. Two sources may be independent for one fact but not another — e.g., two census records with different enumerators are independent as sources, but if the same household member answered both times, their assertions about birth facts may share a single informant and are not fully independent for those facts. The skill writer must assess independence in the context of the specific conflict, not globally.

---

## 8. Operational Guidance

### File I/O

Skills read the entire `research.json` file at the start and write the entire file at the end. There is no partial/section-level I/O. This is the expected pattern in Cowork, where skills operate on project files atomically. For projects that grow large (hundreds of assertions, dozens of log entries), this remains acceptable — the file is structured JSON, not a database, and Cowork's file operations handle files of this size without issue.

### Manual edits to `tree.gedcomx.json`

Users may manually edit `tree.gedcomx.json` — adding a person, correcting a fact, merging duplicates. When this happens, foreign key references in `research.json` (person IDs in `person_evidence` and `timelines`, source description IDs in `sources`) may become stale. Skills should treat broken foreign keys as warnings, not errors: log the broken reference, continue operating, and surface the discrepancy to the user. The `tree.gedcomx.json` file is the source of truth for resolved persons; `research.json` is the source of truth for the research process. Manual edits to the GedcomX file are legitimate and expected — they represent the user exercising judgment that the research pipeline has not yet automated.

### `tree.gedcomx.json` update timing

The `probable`-or-higher update rule applies to **persons, relationships, and facts** in `tree.gedcomx.json` — the concluded genealogical data. It is updated when a proof summary at tier `probable` or higher is written. During early research (before any proof summary exists), the GedcomX file contains stub persons with whatever is known at project initialization. As proof summaries are written or revised, the corresponding facts, relationships, and sources in `tree.gedcomx.json` are updated to match the concluded state. The worked example shows this: the GedcomX birthplace is "Ireland" (matching the resolved conflict c_001 and the `probable` proof summary ps_001), and the ParentChild relationship R1 is present because ps_001 concludes parentage at `probable`. If ps_001 were later revised to `not_proved`, R1 should be removed from the GedcomX file.

**Exceptions to the proof-conclusion-only rule:**
- **Source descriptions** are created by record-extraction during active research, because `research.json` sources need `gedcomx_source_description_id` references to exist. Source descriptions in the GedcomX file represent "this source was consulted," not "this source's conclusions are finalized."
- **Person stubs** may be created by person-evidence when a newly discovered person doesn't yet exist in the GedcomX file. These stubs have minimal data (name, gender) and are refined as research progresses.

### Source ownership: record-extraction vs. citation

Both `record-extraction` and `citation` write to the `sources` section. The protocol: `record-extraction` creates the source entry with a working citation (best-effort from available metadata) and sets `source_classification`. The `citation` skill later refines the same entry — updating `citation` and `citation_detail` fields to Evidence Explained standards. This is an in-place update to the existing `src_` entry, not a new entry. The `citation` skill never creates new source entries; it only refines entries created by `record-extraction`.

---

## 9. Worked Example

Research objective: Identify the parents of Patrick Flynn, born ~1845 in Pennsylvania, died 1908. The example shows two active questions (q_001, q_002). References to q_003 in `unblocks` represent a planned future question about siblings that has not yet been created.

### `tree.gedcomx.json` (simplified GedcomX, abbreviated)

```json
{
  "persons": [
    {
      "id": "I1",
      "gender": "Male",
      "names": [
        {
          "id": "N1",
          "preferred": true,
          "given": "Patrick",
          "surname": "Flynn",
          "type": "BirthName"
        }
      ],
      "facts": [
        {
          "id": "F1",
          "type": "Birth",
          "primary": true,
          "date": "~1845",
          "place": "Ireland",
          "sources": [{ "ref": "S1", "page": "1850 Census, Schuylkill Co., dwelling 84" }]
        },
        {
          "id": "F2",
          "type": "Death",
          "date": "1908-03-12",
          "place": "Schuylkill County, Pennsylvania",
          "sources": [{ "ref": "S3", "page": "Death cert. no. 4521" }]
        }
      ]
    },
    {
      "id": "I2",
      "gender": "Male",
      "names": [
        {
          "id": "N2",
          "preferred": true,
          "given": "Thomas",
          "surname": "Flynn",
          "type": "BirthName"
        }
      ],
      "facts": [
        {
          "id": "F3",
          "type": "Birth",
          "primary": true,
          "date": "~1818",
          "place": "Ireland"
        }
      ]
    }
  ],
  "relationships": [
    {
      "id": "R1",
      "type": "ParentChild",
      "parent": "I2",
      "child": "I1",
      "sources": [
        { "ref": "S1", "page": "1850 Census, Schuylkill Co., dwelling 84", "quality": 2 },
        { "ref": "S2", "page": "1860 Census, Schuylkill Co., dwelling 112", "quality": 3 },
        { "ref": "S3", "page": "Death cert. no. 4521", "quality": 2 }
      ]
    }
  ],
  "sources": [
    { "id": "S1", "title": "1850 U.S. Federal Census", "author": "U.S. Census Bureau" },
    { "id": "S2", "title": "1860 U.S. Federal Census", "author": "U.S. Census Bureau" },
    { "id": "S3", "title": "Pennsylvania Death Certificates", "author": "Pennsylvania Dept. of Health" },
    { "id": "S4", "title": "Schuylkill County Probate Records", "author": "Schuylkill County Register of Wills" }
  ]
}
```

### `research.json`

```json
{
  "project": {
    "id": "rp_001",
    "objective": "Identify the parents of Patrick Flynn, born ca. 1845 in Pennsylvania, died 1908 in Schuylkill County, PA",
    "subject_person_ids": ["I1"],
    "status": "active",
    "created": "2026-05-01",
    "updated": "2026-05-04"
  },

  "questions": [
    {
      "id": "q_001",
      "question": "Who were the parents of Patrick Flynn (b. ~1845, PA, d. 1908)?",
      "rationale": "This is the primary research objective.",
      "selection_basis": "objective_decomposition",
      "priority": "high",
      "status": "in_progress",
      "depends_on": [],
      "unblocks": ["q_003"],
      "created": "2026-05-01",
      "resolved": null,
      "resolution_assertion_ids": [],
      "exhaustive_declaration": {
        "declared": false,
        "justification": null,
        "log_entry_ids": [],
        "stop_criteria": null
      }
    },
    {
      "id": "q_002",
      "question": "Where was Patrick Flynn in the 1850 census?",
      "rationale": "The 1850 census is the earliest enumeration where Patrick would appear by name (age ~5). Locating him in a household identifies candidate parents.",
      "selection_basis": "objective_decomposition",
      "priority": "high",
      "status": "resolved",
      "depends_on": [],
      "unblocks": ["q_001"],
      "created": "2026-05-01",
      "resolved": "2026-05-02",
      "resolution_assertion_ids": ["a_001", "a_002", "a_003"],
      "exhaustive_declaration": {
        "declared": true,
        "justification": "Searched 1850 census for Schuylkill County on FamilySearch (indexed and browse), Ancestry (indexed), and MyHeritage (indexed). All three returned the same household. No other Patrick Flynn of matching age found in the county.",
        "log_entry_ids": ["log_001", "log_002", "log_003"],
        "stop_criteria": {
          "goal_alignment": "Yes — Patrick Flynn located in a specific 1850 household, answering the question.",
          "repository_breadth": "Three major repositories searched (FamilySearch, Ancestry, MyHeritage). No additional known indexes of the 1850 Schuylkill County census exist.",
          "original_substitution": "FamilySearch provides the original census image; Ancestry index is derivative but confirmed consistent.",
          "independent_verification": "FamilySearch (original) and Ancestry (derivative) both return the same household. Two access paths, one underlying original.",
          "evidence_class": "Yes — FamilySearch provides original census image with indeterminate-quality information.",
          "conflict_resolution": "No conflicts on the 1850 census placement question.",
          "overturn_risk": "Low — all three repositories agree, and no competing Patrick Flynn of matching age exists in the county."
        }
      }
    }
  ],

  "plans": [
    {
      "id": "pl_001",
      "question_id": "q_002",
      "status": "completed",
      "created": "2026-05-01",
      "items": [
        {
          "id": "pli_001",
          "sequence": 1,
          "record_type": "census",
          "jurisdiction": "Schuylkill County, Pennsylvania",
          "date_range": "1850",
          "repository": "FamilySearch",
          "rationale": "1850 census fully indexed on FamilySearch. Free access, start here.",
          "fallback_for": null,
          "status": "completed"
        },
        {
          "id": "pli_002",
          "sequence": 2,
          "record_type": "census",
          "jurisdiction": "Schuylkill County, Pennsylvania",
          "date_range": "1850",
          "repository": "Ancestry",
          "rationale": "Ancestry has independent indexing; cross-check for transcription errors.",
          "fallback_for": null,
          "status": "completed"
        },
        {
          "id": "pli_003",
          "sequence": 3,
          "record_type": "census",
          "jurisdiction": "Schuylkill County, Pennsylvania",
          "date_range": "1850",
          "repository": "MyHeritage",
          "rationale": "Third independent index for coverage confirmation.",
          "fallback_for": null,
          "status": "completed"
        }
      ]
    },
    {
      "id": "pl_002",
      "question_id": "q_001",
      "status": "active",
      "created": "2026-05-02",
      "items": [
        {
          "id": "pli_004",
          "sequence": 1,
          "record_type": "census",
          "jurisdiction": "Schuylkill County, Pennsylvania",
          "date_range": "1860",
          "repository": "FamilySearch",
          "rationale": "Confirm Patrick still in Thomas Flynn household in 1860. Strengthens parent-child identification.",
          "fallback_for": null,
          "status": "completed"
        },
        {
          "id": "pli_005",
          "sequence": 2,
          "record_type": "vital_record",
          "jurisdiction": "Schuylkill County, Pennsylvania",
          "date_range": "1908",
          "repository": "FamilySearch",
          "rationale": "Death certificate may name parents directly.",
          "fallback_for": null,
          "status": "completed"
        },
        {
          "id": "pli_006",
          "sequence": 3,
          "record_type": "probate",
          "jurisdiction": "Schuylkill County, Pennsylvania",
          "date_range": "1870-1890",
          "repository": "FamilySearch",
          "rationale": "Thomas Flynn probate/will may name Patrick as son.",
          "fallback_for": null,
          "status": "in_progress"
        }
      ]
    }
  ],

  "log": [
    {
      "id": "log_001",
      "plan_item_id": "pli_001",
      "performed": "2026-05-01T10:15:00Z",
      "tool": "record_search",
      "query": { "surname": "Flynn", "given": "Patrick", "birth_year": 1845, "birth_place": "Pennsylvania", "collection": "1850 Census" },
      "outcome": "positive",
      "results_examined": 8,
      "captured_source_ids": ["src_001"],
      "produced_assertion_ids": ["a_001", "a_002", "a_003", "a_004", "a_005"],
      "notes": "Found Patrick Flynn age 5 in household of Thomas Flynn, dwelling 84, Schuylkill Co. Three other Flynn results examined — ages and locations don't match.",
      "external_site": null
    },
    {
      "id": "log_002",
      "plan_item_id": "pli_002",
      "performed": "2026-05-01T11:30:00Z",
      "tool": "external_site",
      "query": { "surname": "Flynn", "given": "Patrick", "birth_year": 1845, "birth_place": "Pennsylvania" },
      "outcome": "positive",
      "results_examined": 12,
      "captured_source_ids": ["src_002"],
      "produced_assertion_ids": ["a_006", "a_007"],
      "notes": "Ancestry index confirms same household. Transcription matches FamilySearch except Ancestry reads dwelling as 84, FamilySearch as 84 — consistent.",
      "external_site": {
        "site": "ancestry",
        "url_generated": "https://www.ancestry.com/search/collections/8054/?name=Patrick_Flynn&birth=1845&birthplace=Pennsylvania",
        "capture_received": true,
        "capture_filename": "ancestry-1850-flynn-results.pdf"
      }
    },
    {
      "id": "log_003",
      "plan_item_id": "pli_003",
      "performed": "2026-05-01T14:00:00Z",
      "tool": "external_site",
      "query": { "surname": "Flynn", "given": "Patrick", "birth_year": 1845, "birth_place": "Pennsylvania" },
      "outcome": "negative",
      "results_examined": 0,
      "captured_source_ids": [],
      "produced_assertion_ids": [],
      "notes": "MyHeritage returned no results for Patrick Flynn in 1850 Schuylkill County. Site may not have this collection indexed. Searched broader Pennsylvania — still no match.",
      "external_site": {
        "site": "myheritage",
        "url_generated": "https://www.myheritage.com/research?action=query&first=Patrick&last=Flynn&birth_year=1845&birth_place=Pennsylvania",
        "capture_received": true,
        "capture_filename": "myheritage-1850-flynn-nil.pdf"
      }
    },
    {
      "id": "log_004",
      "plan_item_id": "pli_004",
      "performed": "2026-05-02T09:00:00Z",
      "tool": "record_search",
      "query": { "surname": "Flynn", "given": "Patrick", "birth_year": 1845, "birth_place": "Pennsylvania", "collection": "1860 Census" },
      "outcome": "positive",
      "results_examined": 5,
      "captured_source_ids": ["src_003"],
      "produced_assertion_ids": ["a_008", "a_009", "a_010"],
      "notes": "Patrick Flynn age 15 in household of Thomas Flynn, Schuylkill Co. Consistent with 1850 placement.",
      "external_site": null
    },
    {
      "id": "log_005",
      "plan_item_id": "pli_005",
      "performed": "2026-05-03T10:00:00Z",
      "tool": "record_search",
      "query": { "surname": "Flynn", "given": "Patrick", "death_year": 1908, "death_place": "Schuylkill County, Pennsylvania" },
      "outcome": "positive",
      "results_examined": 2,
      "captured_source_ids": ["src_004"],
      "produced_assertion_ids": ["a_011", "a_012", "a_013"],
      "notes": "Death certificate found. Names Thomas Flynn as father. Informant was son-in-law James Brown.",
      "external_site": null
    }
  ],

  "sources": [
    {
      "id": "src_001",
      "gedcomx_source_description_id": "S1",
      "citation": "1850 U.S. Census, Schuylkill County, Pennsylvania, population schedule, dwelling 84, family 91, Thomas Flynn household; NARA microfilm publication M432, roll 810; digital image, FamilySearch.org, accessed 1 May 2026.",
      "citation_detail": {
        "who": "U.S. Census Bureau",
        "what": "1850 U.S. Federal Census, population schedule",
        "when_created": "1850",
        "when_accessed": "2026-05-01",
        "where": "FamilySearch.org (NARA microfilm M432, roll 810)",
        "where_within": "Schuylkill County, dwelling 84, family 91"
      },
      "source_classification": "original",
      "repository": "FamilySearch",
      "access_date": "2026-05-01",
      "url": "https://www.familysearch.org/ark:/61903/1:1:MXYZ",
      "url_archived": null,
      "notes": "Image quality good. Enumerator handwriting clear."
    },
    {
      "id": "src_002",
      "gedcomx_source_description_id": "S1",
      "citation": "1850 U.S. Census, Schuylkill County, Pennsylvania, population schedule, dwelling 84, Thomas Flynn household; digital image, Ancestry.com, accessed 1 May 2026.",
      "citation_detail": {
        "who": "U.S. Census Bureau",
        "what": "1850 U.S. Federal Census, population schedule (Ancestry index)",
        "when_created": "1850",
        "when_accessed": "2026-05-01",
        "where": "Ancestry.com",
        "where_within": "Schuylkill County, dwelling 84"
      },
      "source_classification": "derivative",
      "repository": "Ancestry",
      "access_date": "2026-05-01",
      "url": null,
      "url_archived": null,
      "notes": "Ancestry's index of the same original census. Transcription consistent with FamilySearch."
    },
    {
      "id": "src_003",
      "gedcomx_source_description_id": "S2",
      "citation": "1860 U.S. Census, Schuylkill County, Pennsylvania, population schedule, dwelling 112, family 119, Thomas Flynn household; NARA microfilm publication M653, roll 1141; digital image, FamilySearch.org, accessed 2 May 2026.",
      "citation_detail": {
        "who": "U.S. Census Bureau",
        "what": "1860 U.S. Federal Census, population schedule",
        "when_created": "1860",
        "when_accessed": "2026-05-02",
        "where": "FamilySearch.org (NARA microfilm M653, roll 1141)",
        "where_within": "Schuylkill County, dwelling 112, family 119"
      },
      "source_classification": "original",
      "repository": "FamilySearch",
      "access_date": "2026-05-02",
      "url": "https://www.familysearch.org/ark:/61903/1:1:MABC",
      "url_archived": null,
      "notes": null
    },
    {
      "id": "src_004",
      "gedcomx_source_description_id": "S3",
      "citation": "Pennsylvania Department of Health, death certificate no. 4521 (1908), Patrick Flynn; Pennsylvania State Archives, Harrisburg; digital image, FamilySearch.org, accessed 3 May 2026.",
      "citation_detail": {
        "who": "Pennsylvania Department of Health; informant: James Brown (son-in-law)",
        "what": "Death certificate no. 4521",
        "when_created": "1908-03-14",
        "when_accessed": "2026-05-03",
        "where": "FamilySearch.org (Pennsylvania State Archives, Harrisburg)",
        "where_within": "Certificate no. 4521"
      },
      "source_classification": "original",
      "repository": "FamilySearch",
      "access_date": "2026-05-03",
      "url": "https://www.familysearch.org/ark:/61903/1:1:MDEF",
      "url_archived": null,
      "notes": "Informant is son-in-law James Brown. Primary for death facts, secondary for birth facts."
    }
  ],

  "assertions": [
    {
      "id": "a_001",
      "source_id": "src_001",
      "record_id": "ark:/61903/1:1:MXYZ",
      "record_role": "child_1",
      "fact_type": "name",
      "value": "Patrick Flynn",
      "structured_value": { "given": "Patrick", "surname": "Flynn" },
      "date": null,
      "date_certainty": null,
      "place": null,
      "information_quality": "indeterminate",
      "informant": "Unknown household member reporting to census enumerator",
      "informant_proximity": "unknown",
      "informant_bias_notes": "Census enumerator is the recorder, not the informant. The household member who provided the name is unknown. Proximity is 'unknown' rather than 'household_member' because for names specifically, the enumerator may have read a sign, heard a neighbor, or made an assumption — the name fact doesn't necessarily require active reporting the way age/birthplace does.",
      "evidence_type": "direct",
      "log_entry_id": "log_001",
      "extracted_for_question_ids": ["q_002"]
    },
    {
      "id": "a_002",
      "source_id": "src_001",
      "record_id": "ark:/61903/1:1:MXYZ",
      "record_role": "child_1",
      "fact_type": "birth",
      "value": "age 5",
      "structured_value": { "year": 1845, "place": "Ireland" },
      "date": "~1845",
      "date_certainty": "estimated",
      "place": "Ireland",
      "information_quality": "indeterminate",
      "informant": "Unknown household member (likely Thomas Flynn or wife)",
      "informant_proximity": "household_member",
      "informant_bias_notes": "Age and birthplace require active reporting by a household member — someone had to tell the enumerator these facts. Proximity is 'household_member' rather than 'unknown' because these facts could only come from someone in the household.",
      "evidence_type": "indirect",
      "log_entry_id": "log_001",
      "extracted_for_question_ids": ["q_002"]
    },
    {
      "id": "a_003",
      "source_id": "src_001",
      "record_id": "ark:/61903/1:1:MXYZ",
      "record_role": "child_1",
      "fact_type": "residence",
      "value": "Schuylkill County, Pennsylvania",
      "date": "1850",
      "date_certainty": "exact",
      "place": "Schuylkill County, Pennsylvania",
      "information_quality": "primary",
      "informant": "Census enumerator (witness to residence by visiting the dwelling)",
      "informant_proximity": "witness",
      "informant_bias_notes": "For residence facts specifically, the enumerator is a direct witness — they physically visited the dwelling and recorded who lived there. This distinguishes residence from other census facts where the household member is the true informant.",
      "evidence_type": "direct",
      "log_entry_id": "log_001",
      "extracted_for_question_ids": ["q_002"]
    },
    {
      "id": "a_004",
      "source_id": "src_001",
      "record_id": "ark:/61903/1:1:MXYZ",
      "record_role": "child_1",
      "fact_type": "relationship",
      "value": "Listed in household of Thomas Flynn (head), position consistent with child",
      "structured_value": { "relationship_type": "child_inferred", "related_person_role": "head_of_household" },
      "date": "1850",
      "date_certainty": "exact",
      "place": "Schuylkill County, Pennsylvania",
      "information_quality": "indeterminate",
      "informant": "Inferred from household structure — no explicit informant for relationships in 1850 census",
      "informant_proximity": "unknown",
      "informant_bias_notes": "1850 census does not state relationships; this assertion is inferred from household position and shared surname, not directly reported by any informant. The relationship is indirect evidence constructed by the researcher, not information provided by a census informant.",
      "evidence_type": "indirect",
      "log_entry_id": "log_001",
      "extracted_for_question_ids": ["q_001"]
    },
    {
      "id": "a_005",
      "source_id": "src_001",
      "record_id": "ark:/61903/1:1:MXYZ",
      "record_role": "head_of_household",
      "fact_type": "name",
      "value": "Thomas Flynn",
      "date": null,
      "date_certainty": null,
      "place": null,
      "information_quality": "indeterminate",
      "informant": "Unknown household member (likely Thomas Flynn himself) reporting to census enumerator",
      "informant_proximity": "unknown",
      "informant_bias_notes": "Census enumerator is the recorder, not the informant. As head of household, Thomas likely provided his own name, but the 1850 census does not identify the informant.",
      "evidence_type": "indirect",
      "log_entry_id": "log_001",
      "extracted_for_question_ids": ["q_001"]
    },
    {
      "id": "a_006",
      "source_id": "src_002",
      "record_id": "ancestry:8054:patrick-flynn-1850",
      "record_role": "child_1",
      "fact_type": "name",
      "value": "Patrick Flynn",
      "date": null,
      "date_certainty": null,
      "place": null,
      "information_quality": "indeterminate",
      "informant": "Ancestry transcriber (derivative of census enumerator)",
      "informant_proximity": "unknown",
      "informant_bias_notes": "Derivative index — transcription errors possible",
      "evidence_type": "direct",
      "log_entry_id": "log_002",
      "extracted_for_question_ids": ["q_002"]
    },
    {
      "id": "a_007",
      "source_id": "src_002",
      "record_id": "ancestry:8054:patrick-flynn-1850",
      "record_role": "child_1",
      "fact_type": "birth",
      "value": "age 5",
      "date": "~1845",
      "date_certainty": "estimated",
      "place": "Ireland",
      "information_quality": "indeterminate",
      "informant": "Ancestry transcriber (derivative)",
      "informant_proximity": "unknown",
      "informant_bias_notes": null,
      "evidence_type": "indirect",
      "log_entry_id": "log_002",
      "extracted_for_question_ids": ["q_002"]
    },
    {
      "id": "a_008",
      "source_id": "src_003",
      "record_id": "ark:/61903/1:1:MABC",
      "record_role": "child_2",
      "fact_type": "name",
      "value": "Patrick Flynn",
      "date": null,
      "date_certainty": null,
      "place": null,
      "information_quality": "indeterminate",
      "informant": "Unknown household member reporting to census enumerator",
      "informant_proximity": "unknown",
      "informant_bias_notes": "Census enumerator is the recorder, not the informant. Proximity is 'unknown' for names (same reasoning as a_001 — name facts don't necessarily require active reporting).",
      "evidence_type": "direct",
      "log_entry_id": "log_004",
      "extracted_for_question_ids": ["q_001"]
    },
    {
      "id": "a_009",
      "source_id": "src_003",
      "record_id": "ark:/61903/1:1:MABC",
      "record_role": "child_2",
      "fact_type": "birth",
      "value": "age 15",
      "date": "~1845",
      "date_certainty": "estimated",
      "place": "Ireland",
      "information_quality": "indeterminate",
      "informant": "Unknown household member (likely Thomas Flynn or wife)",
      "informant_proximity": "household_member",
      "informant_bias_notes": "Age and birthplace require active reporting by a household member (same reasoning as a_002).",
      "evidence_type": "indirect",
      "log_entry_id": "log_004",
      "extracted_for_question_ids": ["q_001"]
    },
    {
      "id": "a_010",
      "source_id": "src_003",
      "record_id": "ark:/61903/1:1:MABC",
      "record_role": "child_2",
      "fact_type": "relationship",
      "value": "Listed as 'son' in household of Thomas Flynn (head)",
      "structured_value": { "relationship_type": "son", "related_person_role": "head_of_household" },
      "date": "1860",
      "date_certainty": "exact",
      "place": "Schuylkill County, Pennsylvania",
      "information_quality": "primary",
      "informant": "Household member (likely Thomas Flynn or wife) reporting to census enumerator",
      "informant_proximity": "household_member",
      "informant_bias_notes": "1860 census states relationships explicitly, unlike 1850. The informant is the household member who answered the enumerator's questions, not the enumerator himself — the enumerator is the recorder, not the informant. The household member (likely Thomas or wife) is a direct witness to the relationship, so primary information is defensible.",
      "evidence_type": "direct",
      "log_entry_id": "log_004",
      "extracted_for_question_ids": ["q_001"]
    },
    {
      "id": "a_011",
      "source_id": "src_004",
      "record_id": "ark:/61903/1:1:MDEF",
      "record_role": "deceased",
      "fact_type": "death",
      "value": "Died 12 March 1908",
      "date": "1908-03-12",
      "date_certainty": "exact",
      "place": "Schuylkill County, Pennsylvania",
      "information_quality": "primary",
      "informant": "Attending physician (signature on certificate)",
      "informant_proximity": "witness",
      "informant_bias_notes": null,
      "evidence_type": "direct",
      "log_entry_id": "log_005",
      "extracted_for_question_ids": []
    },
    {
      "id": "a_012",
      "source_id": "src_004",
      "record_id": "ark:/61903/1:1:MDEF",
      "record_role": "deceased",
      "fact_type": "birth",
      "value": "Born 1845, Pennsylvania",
      "structured_value": { "year": 1845, "place": "Pennsylvania" },
      "date": "1845",
      "date_certainty": "approximate",
      "place": "Pennsylvania",
      "information_quality": "secondary",
      "informant": "James Brown (son-in-law)",
      "informant_proximity": "family_not_present",
      "informant_bias_notes": "Son-in-law reporting birth facts decades after the event. Note: death cert says Pennsylvania, but census records say Ireland. Son-in-law may not have known Patrick was born in Ireland.",
      "evidence_type": "direct",
      "log_entry_id": "log_005",
      "extracted_for_question_ids": ["q_001"]
    },
    {
      "id": "a_013",
      "source_id": "src_004",
      "record_id": "ark:/61903/1:1:MDEF",
      "record_role": "deceased",
      "fact_type": "relationship",
      "value": "Father: Thomas Flynn",
      "structured_value": { "relationship_type": "father", "related_person_role": "deceased" },
      "date": null,
      "date_certainty": null,
      "place": null,
      "information_quality": "secondary",
      "informant": "James Brown (son-in-law)",
      "informant_proximity": "family_not_present",
      "informant_bias_notes": "Secondary information — son-in-law reporting what he was told about father-in-law's parentage",
      "evidence_type": "direct",
      "log_entry_id": "log_005",
      "extracted_for_question_ids": ["q_001"]
    }
  ],

  "person_evidence": [
    {
      "id": "pe_001",
      "assertion_id": "a_001",
      "person_id": "I1",
      "confidence": "confident",
      "rationale": "Name matches (Patrick Flynn), age consistent with ~1845 birth, located in Schuylkill County where subject is known to have lived. Only Patrick Flynn of this age in the county in 1850.",
      "match_score": null,
      "created": "2026-05-01",
      "superseded_by": null
    },
    {
      "id": "pe_002",
      "assertion_id": "a_004",
      "person_id": "I1",
      "confidence": "probable",
      "rationale": "Same record as pe_001, same person. Household position and shared surname with head Thomas Flynn suggest parent-child relationship, but 1850 census does not state relationships explicitly.",
      "match_score": null,
      "created": "2026-05-01",
      "superseded_by": null
    },
    {
      "id": "pe_006",
      "assertion_id": "a_004",
      "person_id": "I2",
      "confidence": "probable",
      "rationale": "Same assertion as pe_002 but linked to Thomas Flynn (I2). The relationship assertion ('position consistent with child') equally bears on the head of household. Thomas Flynn is the other party in the implied parent-child relationship.",
      "match_score": null,
      "created": "2026-05-01",
      "superseded_by": null
    },
    {
      "id": "pe_003",
      "assertion_id": "a_005",
      "person_id": "I2",
      "confidence": "probable",
      "rationale": "Thomas Flynn, head of household where Patrick was found. Age (~32 in 1850, born ~1818) is consistent with being Patrick's father. Name matches candidate father.",
      "match_score": 0.82,
      "created": "2026-05-01",
      "superseded_by": null
    },
    {
      "id": "pe_004",
      "assertion_id": "a_010",
      "person_id": "I1",
      "confidence": "confident",
      "rationale": "Patrick Flynn age 15 in Thomas Flynn household, 1860 census. Same county, age consistent with 1850 enumeration. 1860 census explicitly states relationship as 'son'.",
      "match_score": null,
      "created": "2026-05-02",
      "superseded_by": null
    },
    {
      "id": "pe_005",
      "assertion_id": "a_013",
      "person_id": "I1",
      "confidence": "confident",
      "rationale": "Death certificate for Patrick Flynn, d. 1908, Schuylkill County. Names match, death location matches known residence. Names Thomas Flynn as father.",
      "match_score": null,
      "created": "2026-05-03",
      "superseded_by": null
    }
  ],

  "conflicts": [
    {
      "id": "c_001",
      "conflict_type": "fact",
      "description": "Patrick Flynn's birthplace: Ireland (1850 and 1860 censuses) vs. Pennsylvania (1908 death certificate)",
      "disputed_attribute": "birthplace",
      "identity_question": null,
      "competing_assertion_ids": ["a_002", "a_009", "a_012"],
      "independence_analysis": "The two census records (1850, 1860) are independent original sources with different enumerators. The death certificate is a third independent original source. However, the census informants are likely the same household member (Thomas Flynn or wife), so the two census assertions may share a single informant — potentially not fully independent for this fact.",
      "weighing_analysis": "The census records are contemporary recordings made near the time of Patrick's birth, while the death certificate was created 63 years later. The census informant was likely a household member with firsthand knowledge (primary or indeterminate), while the death certificate informant (son-in-law) is clearly secondary for birth facts. Two contemporary sources outweigh one later recollection by a secondary informant.",
      "preferred_assertion_id": "a_002",
      "resolution_rationale": "Ireland is accepted as the birthplace. The 1908 death certificate birthplace of 'Pennsylvania' is rejected as a likely error by the son-in-law informant, who may have confused Patrick's place of residence with his place of birth, or may not have known Patrick was born in Ireland before immigrating as a young child.",
      "status": "resolved",
      "blocks_question_ids": []
    }
  ],

  "hypotheses": [
    {
      "id": "h_001",
      "claim": "Patrick Flynn's father was Thomas Flynn of Schuylkill County, Pennsylvania",
      "status": "supported",
      "supporting_assertion_ids": ["a_004", "a_010", "a_013"],
      "contradicting_assertion_ids": [],
      "ruled_out": false,
      "ruled_out_reason": null,
      "notes": "Three independent pieces of evidence: 1850 census co-enumeration (indirect), 1860 census explicit 'son' relationship (direct), death certificate naming Thomas as father (direct, secondary informant). Awaiting probate records for additional confirmation.",
      "related_question_ids": ["q_001"]
    }
  ],

  "timelines": [
    {
      "id": "t_001",
      "label": "Patrick Flynn — assuming Thomas Flynn parentage",
      "hypothesis_id": "h_001",
      "person_ids": ["I1"],
      "generated": "2026-05-03T12:00:00Z",
      "events": [
        {
          "date": "~1845",
          "date_certainty": "estimated",
          "event_type": "birth",
          "place": "Ireland",
          "description": "Born in Ireland, estimated from census ages",
          "assertion_ids": ["a_002", "a_009"]
        },
        {
          "date": "1850",
          "date_certainty": "exact",
          "event_type": "census",
          "place": "Schuylkill County, Pennsylvania",
          "description": "Enumerated age 5 in Thomas Flynn household, dwelling 84",
          "assertion_ids": ["a_003", "a_004"]
        },
        {
          "date": "1860",
          "date_certainty": "exact",
          "event_type": "census",
          "place": "Schuylkill County, Pennsylvania",
          "description": "Enumerated age 15 as son in Thomas Flynn household, dwelling 112",
          "assertion_ids": ["a_008", "a_009", "a_010"]
        },
        {
          "date": "1908-03-12",
          "date_certainty": "exact",
          "event_type": "death",
          "place": "Schuylkill County, Pennsylvania",
          "description": "Died, death certificate names Thomas Flynn as father",
          "assertion_ids": ["a_011", "a_013"]
        }
      ],
      "gaps": [
        {
          "start": "1860-01-01",
          "end": "1908-03-12",
          "expected_events": ["marriage", "1870_census", "1880_census", "1900_census", "residence", "occupation"],
          "severity": "high"
        }
      ],
      "impossibilities": []
    }
  ],

  "proof_summaries": [
    {
      "id": "ps_001",
      "question_id": "q_001",
      "tier": "probable",
      "vehicle": "summary",
      "supporting_assertion_ids": ["a_004", "a_010", "a_013"],
      "resolved_conflict_ids": ["c_001"],
      "exhaustive_search_summary": "Searched 1850 census (FamilySearch, Ancestry, MyHeritage — log_001, log_002, log_003), 1860 census (FamilySearch — log_004), and death certificate (FamilySearch — log_005). Probate search in progress. 1870, 1880, and 1900 censuses not yet searched.",
      "narrative_markdown": "## Parentage of Patrick Flynn (ca. 1845–1908)\n\nPatrick Flynn is **Probably** the son of Thomas Flynn of Schuylkill County, Pennsylvania.\n\n### Evidence Summary\n\nThree independent lines of evidence support this conclusion:\n\n1. **1850 U.S. Census** (Original Source). Patrick Flynn, age 5, born Ireland, appears in the household of Thomas Flynn, age 32, born Ireland, in Schuylkill County, Pennsylvania (dwelling 84, family 91). The 1850 census does not state relationships, but Patrick's position in the household and shared surname are consistent with a parent-child relationship. The informant is indeterminate but likely a household member. This constitutes indirect evidence of parentage.\n\n2. **1860 U.S. Census** (Original Source). Patrick Flynn, age 15, born Ireland, appears as \"son\" in the household of Thomas Flynn in Schuylkill County (dwelling 112, family 119). Unlike the 1850 census, the 1860 census explicitly states the relationship. The household member who answered the enumerator's questions — likely Thomas Flynn or his wife — was a direct witness to the parent-child relationship, making this primary information. This constitutes direct evidence of parentage.\n\n3. **1908 Death Certificate** (Original Source). Patrick Flynn's death certificate (no. 4521, Pennsylvania Department of Health) names \"Thomas Flynn\" as his father. The informant was James Brown, identified as Patrick's son-in-law. As a son-in-law reporting his father-in-law's parentage, Brown is a secondary informant for this fact — he was not a witness to Patrick's birth and is reporting what he was told. Nevertheless, this is direct evidence naming the father.\n\n### Conflict Resolution\n\nA birthplace conflict exists: the 1850 and 1860 censuses list Patrick's birthplace as Ireland, while the 1908 death certificate states Pennsylvania. The two census records are contemporary recordings with informants likely present in the household, while the death certificate was created 63 years after Patrick's birth by a son-in-law with no firsthand knowledge of the event. Per the GPS preponderance hierarchy, contemporary recordings by closer informants outweigh later recollections by secondary informants. Ireland is accepted as the birthplace; the death certificate entry is attributed to informant error.\n\n### Assessment\n\nThe conclusion is rated **Probable** rather than **Proved** because: (a) the 1850 census evidence is indirect (relationships not stated), (b) the death certificate informant is secondary, and (c) research is not yet exhaustive — the 1870, 1880, and 1900 censuses have not been searched, and Thomas Flynn's probate records have not been located. If Thomas Flynn's will names Patrick as a son, or if additional census records confirm the relationship, the conclusion would advance to **Proved**.\n\n### Citations\n\n1. 1850 U.S. Census, Schuylkill County, Pennsylvania, population schedule, dwelling 84, family 91, Thomas Flynn household; NARA microfilm publication M432, roll 810; digital image, FamilySearch.org, accessed 1 May 2026.\n2. 1860 U.S. Census, Schuylkill County, Pennsylvania, population schedule, dwelling 112, family 119, Thomas Flynn household; NARA microfilm publication M653, roll 1141; digital image, FamilySearch.org, accessed 2 May 2026.\n3. Pennsylvania Department of Health, death certificate no. 4521 (1908), Patrick Flynn; Pennsylvania State Archives, Harrisburg; digital image, FamilySearch.org, accessed 3 May 2026."
    }
  ]
}
```

---

## 10. Changes from Draft Schema

This section documents what changed from the earlier draft in `docs/gps/schema.md` and why.

| Change | Rationale |
|--------|-----------|
| `subject_person_id` removed from assertions | Assertions attach to `record_id` + `record_role` to prevent premature identity decisions |
| `person_evidence` section added | Handles the record-to-person linking as a separate, revisable step |
| `exhaustive_declaration` added to questions | GPS requires an explicit "reasonably exhaustive" claim with log references |
| `citation_detail` added to sources | Enforces Evidence Explained's Who/What/When/Where/Where-within structure |
| `external_site` added to log entries | Tracks the generate-click-capture-analyze workflow for commercial sites |
| `conflict_type` and `identity_question` added to conflicts | Supports identity-level conflicts, not just fact-level |
| `resolution_rationale` added to conflicts | Captures why the preferred assertion was chosen |
| Timelines keyed by `t_` ID with label, not person ID | Timeline construction is itself identity resolution; labels support hypothesis testing |
| `hypothesis_id` and `person_ids` added to timelines | Connects timelines to the hypotheses they test |
| `impossibilities` added to timelines | Flags chronological impossibilities explicitly |
| `fan_evidence_ids` removed from hypotheses | FAN findings are regular assertions; no special entity needed |
| `related_question_ids` added to hypotheses | Connects hypotheses to the questions they help answer |
| `exhaustive_search_summary` added to proof summaries | Ties conclusions back to search scope for GPS compliance |
| `superseded_by` added to person_evidence | Tracks revision history for identity links without deletion |
| `date_certainty` added to assertions | GPS-quality date handling |
| `jurisdiction_place_id` replaced with `jurisdiction` string | Place IDs vary across APIs; plans should be human-readable |
| `schema_version` not added | Migration not a goal during build-out; acceptable breakage |
| Status enums consolidated | Defined once, referenced everywhere, prevents drift |
| `structured_value` added to assertions | Machine-readable form for programmatic comparison (timeline construction, conflict detection) |
| `log_entry_id` added to assertions | Bidirectional provenance chain: assertion → log and log → assertion |
| `subject_person_id` → `subject_person_ids` (array, nullable) | Supports multi-subject projects and deferred identity resolution |
| `stop_criteria` added to `exhaustive_declaration` | Structured 7-Point Stop Criteria assessment per GPS Step 1 |
| `conflicts.fact_type` renamed to `disputed_attribute` | Avoids naming collision with assertions.fact_type; finer-grained (birthplace vs birth) |
