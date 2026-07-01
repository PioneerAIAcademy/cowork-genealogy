# Shorten: record-extraction

**Bucket:** A (dead-mechanics removal) — large protected craft core
**Primary owner:** both (developer strips the JSON shape-dumps, id-alloc,
sidecar/staged-handle protocol, and the post-write validate framing;
**genealogist signs off on what stays** — every classification and
objectivity rule is craft)
**Current size:** 600 lines → **Target:** ~300–340 lines (~45% reduction)
**Tool migration:** **done** — calls `research_append` (sources +
assertions, `op: "append"` / `op: "update"`) and `research_log_append`
(`user_provided` and `record_search` log entries). No post-write
`validate_research_schema` remains in the body; the chunking dance is
already gone (the prose now loops one append per fact).
**Still needed as a skill?** **Yes, unambiguously** — the tool assigns ids
and validates structure, but it cannot decide *what* is one atomic fact,
*who* the informant was, whether evidence is direct/indirect/negative, or
whether to reuse a source. That judgment is the skill, and it maps 1:1
onto the rubric. It is also the routing gatekeeper that four negative
tests check.

## TL;DR
The big cut is the schema-duplicating JSON blocks (a 21-line source shape,
a 24-line assertion shape, a 19-line negative-assertion shape, and four
`research_*({...})` call blocks) plus the staged-handle/sidecar log
protocol and the repeated "tool assigns the id, validates before persist,
do not invent one" narration — all of which the tool now owns. **Do not
touch** the GPS extraction judgment: one-fact-per-assertion atomicity, the
BCG-27 objectivity rule, the census informant table, the
`information_quality` / `evidence_type` first-pass classification trees,
the pre-1880-`indirect` / `_inferred` rule, the source-reuse decision, and
the negative/absence convention. Those back every rubric dim and the
tag-gated validators.

## Why this skill is shortenable
`research_append` now assigns each `src_` / `a_` id, validates the whole
project before writing, and writes nothing on `{ ok:false, errors }`;
`research_log_append` assigns the `log_` id, stamps `performed`, sets
`results_ref`, and finalizes the `results/<log_id>.json` sidecar from the
staged handle. Roughly a third of the file narrates that clerical work
step by step — the field-by-field JSON shapes, the "next `src_`/`a_` id; do
not invent one" repeats, the sidecar/staged-handle protocol, the
double-check-before-the-call list, and the "Re-invocation behavior /
Writes:" boilerplate. That prose is dead: the tool guarantees the
behavior, and the input schema already documents the params.

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_record_extraction.py`
  + universal):
  - `test_assertions_are_append_only` / `test_sources_are_append_only` —
    no existing entry in either section may be deleted.
  - `test_new_assertions_reference_valid_source` /
    `test_new_assertions_reference_valid_log_entry` — every new
    assertion's `source_id` must resolve to a real `sources` entry;
    `log_entry_id`, when non-null, must resolve to a `log` entry
    (foreign-key integrity).
  - `test_new_assertions_have_required_classification` — every new
    assertion must carry **`information_quality`, `informant_proximity`,
    `evidence_type`** (non-empty).
  - `test_new_assertions_attached_to_record_role` — every new assertion
    must have both **`record_id`** and **`record_role`** (assertions
    attach to records, not persons).
  - `test_negative_evidence_uses_absent_role` — any
    `evidence_type: "negative"` assertion must have
    `record_role: "absent"`.
  - `test_new_sources_have_citation_detail` — every new source's
    `citation_detail` must contain all six keys (`who`, `what`,
    `when_created`, `when_accessed`, `where`, `where_within`).
  - `test_only_allowed_mcp_tools` (universal-style) — every `mcp__` call
    must be in `allowed-tools`.
  - Universal ownership table — record-extraction may write `sources` +
    `assertions` (+ `log` via the log tool) in `research.json` and
    `sources` in `tree.gedcomx.json`; nothing else.
- **Tag-gated validators (fire only on the matching scenario):**
  - `test_1850_census_uses_inferred_suffix` (tag `1850` / `1850-census`)
    — relationship assertions must use the `_inferred` suffix on
    `structured_value.relationship_type`.
  - `test_negative_evidence_assertion_created` +
    `test_negative_evidence_value_describes_expectation` (tag
    `negative-evidence`) — must create a new `negative`/`absent`
    assertion whose `value` describes the expected-but-missing fact (not
    blank, not just "absent").
  - `test_record_persona_id_set` (tag `record-persona-id`) — assertions
    from a `record_search` result must carry `record_persona_id` and a
    full-arkUrl `record_id` (`startswith("http")`).
- **Rubric dims** (`eval/tests/unit/record-extraction/rubric.md`):
  *Assertion atomicity*, *Informant identification*, *Evidence type
  accuracy*.
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests (routing):**
  `negative-search-vs-extract.json` (→ search-records),
  `negative-classify-vs-extract.json` (→ assertion-classification),
  `negative-citation-format-boundary.json` (→ citation). The
  extract-vs-search / extract-vs-refine / extract-vs-format boundaries
  live in the frontmatter `description` — leave those three clauses
  intact.
- **Key test files:** `census-1850-single-household.json`,
  `census-1850-multi-person-household.json`,
  `death-certificate-named-informant.json`,
  `marriage-record-direct-vs-indirect.json`,
  `negative-evidence-absent-role.json`, `sets-record-persona-id.json`,
  `record-read-via-ark.json`, `record-person-matches.json`,
  `record-record-matches.json`, plus the three routing negatives above.

## CUT — safe to remove
- **[122–143] the 21-line "Source entry fields" JSON block** — the
  `research_append` schema for the `sources` section already documents
  these fields. Replace with a one-line list of the fields that are
  *judgment* (citation, `citation_detail` six keys, `source_classification`,
  `notes`/provenance), since `test_new_sources_have_citation_detail`
  needs all six `citation_detail` keys named once — but drop the full
  shape dump.
- **[211–235] the 24-line "Each assertion must have" JSON block** — same
  reason. The per-field judgment that follows (value/structured_value/
  classification, "Critical rules for each field," 247–361) is where the
  craft lives; keep that and delete the upfront shape dump it duplicates.
- **[376–415] the staged-handle / sidecar log protocol** (the two
  `research_log_append({...})` blocks, the `stagedResultsRef`
  explanation, the TTL/`{ok:false}` recovery paragraph) — the tool owns
  the sidecar and id allocation. Collapse to: "When no search skill
  logged this record, call `research_log_append` (`tool: "user_provided"`)
  and use the returned `logId`. If the record came from a
  `record_search` you ran with `projectPath`, pass its
  `staged.resultsRef` so the sidecar is finalized." Two sentences, no
  JSON.
- **[430–455] the two `research_append({...})` call blocks in Step 5a/5b**
  — schema dupes. One sentence each: append the source, then loop one
  append per assertion (incl. negatives); the tool assigns each id and
  validates each entry.
- **[461–472] "5c double-check" list + the per-call "before appending,
  double-check the fields the validator is strict about" block** — this
  re-derives the validator. The tool returns `{ ok:false, errors }` and
  the skill surfaces/corrects; restating the validator's own checks is
  redundant. Keep only the genuinely non-obvious format rule
  (full-arkUrl `record_id`, which a *judge* dim and the
  `record-persona-id` validator care about) — fold it into the
  `record_id` craft bullet (249–264) where it already partly lives.
- **[523–542] the 19-line negative-assertion JSON example** — keep the
  prose convention (negative only when analytically meaningful;
  `record_role: "absent"`; `value` describes the expected-but-missing
  fact; researcher/analyst informant) but cut the full JSON shape.
- **[579–600] "Re-invocation behavior" / "Writes:"** — boilerplate. The
  one real point (reuse the existing `src_`, refine via `op:"update"`,
  never duplicate a source; log is append-only) is already stated in
  Step 1 (109–117) and the Decision rules (490–495). State it once there
  and delete this whole trailer.
- **Repeated "the tool assigns the next `src_`/`a_` id; do not invent
  one" narration** — appears at 112–113, 119–120, 211–212, 374, 426,
  443–446, 458–459. State **once** in a short Persistence section, delete
  the rest.
- **Related references trim (not the body, but flag it):**
  `references/research-log-protocol.md` and
  `references/validation-protocol.md` are now obsolete dead-mechanics
  docs (sidecar/staged-handle protocol; "structural validation is handled
  by the write tools"). **Neither is named anywhere in SKILL.md** (the
  body loads only `places-guidance.md`, `source-classification-guide.md`,
  `information-classification-at-extraction.md`, `note-taking-standards.md`).
  Any edit under the skill dir flips run logs inactive and forces a
  re-run regardless (snapshot model), so leaving them is cost-free to the
  tests but is stale documentation; deleting them is a clean separate
  trim. **Caveat:** confirm no other skill references them before
  deleting (don't delete others' work) — this brief targets SKILL.md, so
  treat the references as a follow-up note, not part of the cut.

## KEEP — load-bearing judgment (do NOT cut)
- **GPS Foundation (44–53)** — faithful capture, objectivity, per-fact
  analysis. The three-line principles that the three rubric dims
  operationalize. Keep; tighten prose only.
- **Step 3 atomicity (187–198)** — "one fact per assertion," separate
  age/birth from birthplace, "only extract facts present in the record"
  (the blank-column rule). Directly the *Assertion atomicity* dim. **Do
  not cut.**
- **Extraction policy / objectivity (200–209)** — BCG-27, extract
  contradicting facts with equal care, suspend judgment. Backs
  Correctness/Completeness and the objectivity principle. Keep.
- **Census informant table (313–321)** + "recorder ≠ informant" (307–309)
  + non-census handoff to the reference (322–324) — this *is* the
  *Informant identification* dim. **Protect it entirely.**
- **`information_quality` two-question decision tree (296–304)** and
  **`evidence_type` rules (326–339)** — the first-pass classification
  values record-extraction fills in. These produce the three required
  fields the validator checks and feed *Evidence type accuracy*. Keep.
- **Pre-1880-census-relationships-are-`indirect` + `_inferred` rule
  (340–350, and structured_value 291–294)** — backs the
  `test_1850_census_uses_inferred_suffix` validator and the
  *Evidence type accuracy* dim. Keep verbatim.
- **`record_id` format craft (249–264)** and **`record_persona_id`
  required-for-`record_search` rule (270–279)** — backs
  `test_record_persona_id_set` and *Tool Arguments*. Keep; fold the
  full-arkUrl double-check here (don't repeat it in Step 5).
- **`record_role` / `absent` convention (171–184)** — the literal
  `absent` token; backs `test_negative_evidence_uses_absent_role` and the
  negative-evidence validators. Keep the no-variants warning.
- **Source-reuse decision (108–117 + Decision rules 488–495)** — same
  repository → reuse `src_`; different repository → new `src_`, same `S`;
  different record → both new. Judgment the tool can't make. Keep (state
  once, in Decision rules; trim the Step 1 duplicate to a pointer).
- **`source_classification` quick rules (157–165)** + load-the-reference
  pointer (166) — original/derivative/authored is analytical. Keep.
- **Negative-evidence convention prose (516–547)** — when to create one;
  `value` must describe the expectation (backs
  `test_negative_evidence_value_describes_expectation`); researcher/analyst
  informant. Keep the prose, cut only the JSON.
- **Image transcription review (84–94, 479–486)** — "transcription review
  is mandatory," `[?]`/`[illegible]`/`[torn]`, the `image_read`
  ARK-only constraint. Distinct user-facing behavior; keep, tighten.
- **Match-checking section (500–513)** — `record_person_matches` /
  `record_record_matches` are optional, informational only, **do NOT
  write to `research.json`**. Has its own tests
  (`record-person-matches.json`, `record-record-matches.json`); the
  "don't persist match results" rule is a correctness guard. Keep.
- **Frontmatter `description` boundary clauses** — the Do-NOT-use
  (search-records / assertion-classification / citation) routing that the
  three negative tests check. **Do not touch.**

## TIGHTEN — keep the point, cut the words
- **Add a one-line check-warnings handoff in this PR (the body is
  currently missing it).** SKILL.md never mentions `check-warnings`; that
  step lives only in the orphaned `references/validation-protocol.md`. The
  overview's cut/keep rule says keep the genealogical `check-warnings` step
  (drop only the post-write *structural* validate). Since the body has no
  post-write validate to cut and no check-warnings step to keep, add a
  single line in Step 6 ("after persisting assertions, suggest
  `check-warnings` to catch genealogical impossibilities") rather than
  re-importing the dead validation-protocol doc. Genealogist confirms
  this is the desired behavior.
- The "tool validates before persisting; surface `{ ok:false, errors }`
  rather than retrying blindly" rule appears at 419–424, 412–415, and
  461–472. State it **once** in a short Persistence section.
- Step 1's source-creation prose (108–169) overlaps the Decision-rules
  source-reuse block (488–495). Keep the reuse logic in Decision rules;
  reduce Step 1 to "identify the source (type/creator/date/repository/
  locator), classify it, reuse or create per the Decision rules."
- The worked **1850 census example (549–577)** is genuinely useful as a
  filled-in informant/`_inferred` exemplar (it demonstrates the table and
  the indirect-relationship rule together) — keep it, but it can lose the
  redundant bullet recap (568–577) that restates the table rows already
  shown.

## Suggested target structure (~320 lines)
1. Frontmatter (unchanged routing description) + Narration + Places line.
2. Purpose (3 lines) + GPS Foundation (3 principles) + load-references-on-demand.
3. Inputs (the four arrival paths) — tighten to a short list.
4. Step 1 — Identify the source: type/creator/date/repository/locator +
   `source_classification` quick rules + "reuse or create per Decision
   rules." (No JSON shape; name the six `citation_detail` keys in one
   line.)
5. Step 2 — Roles + the `absent` convention.
6. Step 3 — Extract assertions (**the protected core**): atomicity,
   objectivity/blank-column, the per-field craft (value, structured_value,
   `information_quality` tree, informant table, `evidence_type` rules,
   pre-1880 `_inferred`, `record_id` format, `record_persona_id`,
   standard_place). Keep in full.
7. Persistence (one short section): append the source, loop one append per
   assertion incl. negatives; the tool assigns ids + validates + writes
   the sidecar from a staged handle; surface `{ ok:false }`, don't retry
   blindly. Log entry only when no search skill logged it. ~8 lines, no
   JSON.
8. Image transcription review.
9. Match checking (optional, informational-only, no writes).
10. Negative evidence (prose convention, no JSON).
11. Decision rules (source-reuse; partial/damaged records).
12. One filled-in 1850-census example + a one-line check-warnings handoff.

## Verify
```
cd eval/harness && uv run python run_tests.py --skill record-extraction
```
Watch all three rubric dims (atomicity, informant identification,
evidence-type accuracy) and confirm: the three routing negatives still
decline + route (search-records / assertion-classification / citation);
the `1850-census` `_inferred` validator and both `negative-evidence`
validators still pass; `sets-record-persona-id` still produces full-arkUrl
`record_id` + non-null `record_persona_id`; and
`test_new_sources_have_citation_detail` still finds all six detail keys
(don't over-trim the source section). Editing the skill dir flips prior
run logs inactive — a re-run is expected, not a regression.

## Owner notes
**Developer** safely cuts: the source/assertion/negative JSON shape
blocks, the four `research_*({...})` call blocks, the staged-handle/sidecar
log protocol, the Step-5 "double-check the validator's fields" list, the
repeated id-allocation narration, and the "Re-invocation behavior /
Writes:" trailer. **Genealogist** owns and must protect: the atomicity
rule, the objectivity/blank-column policy, the census informant table, the
`information_quality` and `evidence_type` first-pass classification, the
pre-1880 `_inferred` rule, the source-reuse decision, and the
negative-evidence convention — these are the graded craft and the
tag-gated validators. Two same-PR cleanups for the genealogist: (a) add the
one-line check-warnings handoff (the body has none today) and confirm the
wording; (b) the obsolete `references/research-log-protocol.md` and
`references/validation-protocol.md` are unreferenced by the body — verify no
other skill uses them (these `references/` copies are per-skill duplicates per
CLAUDE.md, so deletion is normally safe) and delete them in this PR.
