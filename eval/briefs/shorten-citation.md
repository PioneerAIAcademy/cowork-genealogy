# Shorten: citation

**Bucket:** B (craft compression)
**Primary owner:** genealogist (developer assists with structure: dedupe, table layout)
**Current size:** 555 lines → **Target:** ~360–390 lines (~30% reduction)
**Tool migration:** n/a (no new tool) — reads/writes via `validate_research_schema` only (the single declared tool; refines `citation`/`citation_detail` on existing `src_` entries in `research.json`).
**Still needed as a skill?** yes — Evidence-Explained citation form, the Who/What/When/Where/Wherein framework, source-fidelity (never-invent) rules, and the per-source-type templates are all genealogical craft the LLM judge grades directly. None of it is mechanics a tool could own.

## TL;DR
This is the 3rd-longest skill and almost all of the win is **deduplication, not deletion**: the source-fidelity rules, the locator/unknown-marker rule, the "never create a new source" rule, and the "review path is read-only" rule are each stated 3–5 times across ROUTING, the early "When the user asks…" preamble, Steps, Source fidelity rules, Decision rules, and Re-invocation behavior. State each load-bearing rule once and reference it. The Evidence-Explained templates, the W/W/W/W/W framework table, and the fidelity rule-set must all survive intact — they are exactly what the rubric grades.

## Why this skill is shortenable
Not because mechanics moved to a tool (none did) but because the same craft rule is restated verbatim in many places. The most-repeated rules:

- **"Write `[LOCATOR NOT RECORDED]`, don't pause to ask the user"** appears at lines 46–51 (preamble), 126–134 (Step 2), 144 (Common problems), 201–212 (fidelity rules 4–5), 535 (Decision rules row) — five times.
- **"Never invent locators/detail; examples illustrate shape not data"** appears at lines 178–233 (fidelity rules 1–7), 195–200 (rule 3 + the inline "illustrative only" disclaimers repeated on every template), and 51 (rubric-restating).
- **"Never create a new source — route to record-extraction"** appears at lines 29–34 (ROUTING), 449–453 (Step 5), 530 (Decision rules), 542–555 (Re-invocation) — four times.
- **"Review path is read-only / don't enhance a compliant citation"** appears at lines 236–242 and again at Decision-rules row 532.
- The **worked Before/After example** (488–523) and the **per-template inline examples** (some marked "illustrative only") repeat the same census/Flynn data the framework table already shows.

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_citation.py` + universal):
  - `test_does_not_add_new_source_entries` — no new `src_` id may appear after the skill runs (positive tests).
  - `test_preserves_src001_original_classification` — tag-gated (`preserves-src001-original`): `src_001.source_classification` stays `"original"`.
  - Universal: `test_ownership_table` (citation may write only `sources`), `test_tool_allowlist` (only `validate_research_schema`), `test_log_append_only`, `test_no_entries_deleted`, `test_id_references_resolve`, `test_research_json_validates_schema`.
- **Rubric dims** (`eval/tests/unit/citation/rubric.md`): Evidence Explained compliance, Replication test, Source vs information distinction, Does not create new source entries, Source fidelity — no fabricated detail. All five read the narrative/written fields; all judge-graded.
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** `negative-search-request` (→ search-records), `refuse-new-source-creation` (→ record-extraction, even when "add and format" is one message), `boundary-record-extraction` (extract-facts → record-extraction), `boundary-assertion-classification` (primary/secondary → assertion-classification), `negative-search-citation`, `terminology-guardrail`. These pin the ROUTING block and the terminology guardrail.
- **Key test files:** `refuse-new-source-creation.json`, `boundary-record-extraction.json`, `boundary-assertion-classification.json`, `negative-search-request.json`, `terminology-guardrail.json`, `missing-locator-flagging.json`, `fabrication-guardrail-probate.json`, `refine-census-citation.json` (tag `preserves-src001-original`), `url-only-expansion.json`.

## CUT — safe to remove (redundancy / over-explanation)
- **[lines 46–51] "When the user asks you to add or fix a locator…" preamble** — duplicated in full by Step 2 (126–134) and fidelity rules 4–5 (201–212). The locator/unknown-marker rule belongs in exactly one place (the fidelity rules). Remove this top-of-file restatement; keep one ROUTING-level pointer if needed.
- **[lines 136–147] "Common problems to fix" bullets** — every bullet restates a field-quality point already made by the W/W/W/W/W table (73–78: who=creator not repository; what=specific title) and the locator rule. Cut; the table is the authoritative version.
- **[lines 148–159] "Fixing auto-generated citations"** — a checklist that re-enumerates the same four field defects (creator=website, collection-not-document, missing locators, missing informant) already covered by the table + URL best practices. Collapse to one line ("FamilySearch/Ancestry auto-citations are starting points: fix creator, add the document-level locator, add access date").
- **[lines 488–523] the worked Before/After Flynn-census example** — duplicates the census template (252–264) and the `citation_detail` example (115–124) with the same data. The census template already teaches the pattern. Cut or shrink to a 3-line "what changed" note.
- **[lines 542–555] "Re-invocation behavior"** — boilerplate; "writes citation/citation_detail in place, never creates new sources, idempotent" is already in the description, Step 5, and Decision rules. One line at most.
- **Per-template "(illustrative only — never copy example values…)" disclaimers** (286–287, 304–305, 334–335) — the source-fidelity rule 3 (195–200) states this once for all templates. Keep ONE global "examples show shape, not data — never copy a sample number into a real citation" line near the templates; drop the per-template repeats.

## KEEP — load-bearing craft (do NOT cut)
- **"The Who/What/When/Where/Wherein Framework" table (65–78)** — protects Evidence Explained compliance (the framework IS the rubric's pass criterion). Keep whole.
- **"Cite What You See" principle + Collection vs Document citation (80–97)** — protects Replication test (document-level locator is what distinguishes a citable record). Keep.
- **The per-source-type templates (250–395): census, vital (death/birth), probate, church, land/deed, newspaper, derivative index, FindAGrave** — these ARE the Evidence-Explained craft the judge grades. Keep all template *shapes*; trim only the duplicated worked-example data and the per-template disclaimers (see TIGHTEN). The `where_within` probate rule (314–319), the derivative-index "digital index not digital image" + collection-name rule (372–387), and the deed execution-vs-recording-date rule (343–346) are each a distinct craft point — keep.
- **"Source fidelity rules" 1–7 (178–233)** — protects the Source fidelity rubric dim (the heaviest dim) and the `fabrication-guardrail-probate` test. Rule 6 ("on file spans the whole project") and rule 7 ("name the person the source names, not the research subject") are subtle and rubric-cited — keep both. This is the one block where each rule earns its words.
- **URL best practices (160–177)** — protects `url-only-expansion` test (strip query string, ARK is opaque, never infer record facts). Keep.
- **"Review path is read-only" (236–242)** — protects the Source fidelity dim's "already-compliant citations left unchanged" pass criterion. Keep once (fold the Decision-rules row 532 into it or vice versa — see TIGHTEN).
- **Negative-search handling (396–430)** — distinct craft (use `query` field not notes-context for scope; don't infer a second search; PRESENT don't persist). Protects `negative-search-citation`. Keep.
- **Terminology guardrail (479–486)** — protects `terminology-guardrail` test. Keep.
- **The ROUTING block (25–41)** — protects four negative tests (search-records, record-extraction ×2, assertion-classification). Keep the trigger phrases and the one-sentence redirects; this is the routing the negative tests check.

## TIGHTEN — keep the point, cut the words
- Merge the **Decision rules table (525–540)** with the prose rules it duplicates: rows for "user provides only a URL," "add/create a source," "find more records," "already EE-compliant," "missing locator," "primary/secondary" all restate ROUTING + fidelity + review-path prose. Keep the table OR the prose for each, not both. The table is the more compact form — prefer collapsing prose INTO the table where the table already covers it, and delete the standalone prose paragraph.
- State the **unknown-marker rule once** (in fidelity rules) and reference it from Step 2 and the Decision-rules "missing locator" row with a pointer, not a re-statement.
- The **`citation_detail` six-field JSON block (115–124)** and the W/W/W/W/W table (65–78) show the same fields twice. Keep the table as the explainer; keep the JSON only if a literal shape is needed, trimmed.

## JUDGMENT CALLS (genealogist decides)
- **How much of the Before/After example (488–523) to keep.** The census template already teaches the pattern, but the side-by-side "who corrected from repository to creator / what expanded / where_within expanded" delta (520–523) is a compact teaching of the *refinement* act, which no single template shows. A genealogist should decide whether to keep the short delta and drop the two JSON blocks, or cut the whole section.
- **Whether "Fixing auto-generated citations" (148–159) is fully redundant or carries a unique cue** ("informant not identified — critical for death certificates"). That informant cue may not be elsewhere — genealogist confirms before cutting the block to one line.
- **Collapsing the Decision-rules table into prose vs keeping both.** I flag the duplication as provable, but *which* representation to keep per row is a craft preference (the table is scannable; the prose carries nuance). Genealogist picks per row rather than a blanket cut.
- **The per-template inline worked examples** (e.g. 258–264, 272–277): I assert the *disclaimers* are dedupable; whether each worked example itself is teaching value beyond the template skeleton is a genealogist call — keep at least one filled example per *pattern family* (one census, one vital, one probate/land), drop the rest.

## Suggested target structure (~370 lines)
1. Frontmatter + Narration.
2. ROUTING block (trigger phrases + one-sentence redirects) — kept.
3. Purpose (3 sentences) + the replication test (one line).
4. **W/W/W/W/W framework table** + Cite-What-You-See + Collection-vs-Document — kept.
5. **Source fidelity rules 1–7** — the single authoritative home for never-invent, unknown-markers, on-file-spans-project, name-the-source's-person. Review-path-is-read-only folded in here.
6. Steps (read sources → refine fields → format string → special cases → write → validate → present), with each step pointing to §5 rather than restating its rules; one global "examples show shape not data" line.
7. **Per-source-type templates** — kept (shapes), one filled example per pattern family, disclaimers removed.
8. Negative-search handling — kept.
9. Terminology guardrail — kept.
10. Decision rules table — kept only for rows NOT already covered above; one-line Re-invocation note.

## Verify
```
cd eval/harness && uv run python run_tests.py --skill citation
```
Watch: Evidence Explained compliance, Replication test, and Source fidelity must stay green across the per-type tests (census/vital/probate/land/newspaper/derivative); the four routing negatives must still decline; `terminology-guardrail` and `missing-locator-flagging` must still pass; `test_preserves_src001_original_classification` and `test_does_not_add_new_source_entries` must stay green.

## Owner notes
Genealogist-led because every "keep" item is graded craft and the file is dense with subtle, rubric-cited rules (fidelity rules 6–7, the derivative-index/probate `where_within` distinctions) that look redundant but aren't. A **developer can safely** do the pure structural work: collapse the Decision-rules/prose duplication, remove the per-template disclaimer repeats (rule 3 covers them), cut the Re-invocation boilerplate, and remove the early locator preamble that fidelity rules 4–5 fully duplicate. A developer should **not** decide which worked examples or which "Common problems"/"auto-generated" cues are unique — those are genealogist judgment calls above.
