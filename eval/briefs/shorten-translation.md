# Shorten: translation

**Bucket:** B (craft compression)
**Primary owner:** genealogist (developer assists with structure)
**Current size:** 213 lines → **Target:** ~165–180 lines (~18% reduction)
**Tool migration:** n/a (no new tool). **Reads/writes nothing** — translation is a pure model task with **no `allowed-tools`** at all (frontmatter has none). It reads images already in the conversation but makes no MCP tool calls; `test_no_mcp_tools_called` enforces that it calls no research MCP tool (only the built-in `validate_research_schema` is exempted, and it has no reason to call even that).
**Still needed as a skill?** yes — genealogy-specific paleography (Kurrent/Sütterlin), Latin/period abbreviation expansion, the derivative-source principle (original governs), exact transcription, uncertainty flagging, and genealogical-term significance are the translation craft the rubric grades. This is the densest "pure judgment" skill of the five.

## TL;DR
This is the smallest of the five and almost entirely irreducible craft — it has no tool to call and no file to write, so there are no mechanics to remove. The only safe compression is **deduplicated convention statements** (the derivative-source / exact-transcription / uncertainty-flagging / original-form-names rules are stated in GPS-grounding, Steps, Output-conventions, AND the worked example — and SKILL.md even flags the overlap itself at lines 177–181) and the **Re-invocation boilerplate**. Be especially conservative here: nearly every line is graded craft.

## Why this skill is shortenable
The core conventions are stated in up to four places, and the skill itself acknowledges it:

- **Output conventions (176–181)** opens with: *"The derivative-source principle, exact transcription, uncertainty flagging, period meanings, and original-form names are covered in GPS grounding and the Steps above."* — i.e. the author already noted the duplication between GPS grounding (30–51), Steps 2–3 (94–125), and this section. Only the *new* output rules in this section (date conventions, genitive normalization, foreign-text italics) are unique.
- **"Preserve the original alongside any translation / original governs"** appears in GPS grounding (42–44), the worked example label (145), and implicitly in Step 3. 
- **Uncertainty flagging (`[?]`, `[illegible]`)** appears in Step 2 (101), Step 3 (111), the example (147, 159), and Output conventions.
- **Names in original form, not anglicized** appears in Step 4 (118–119) and the example (158).

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_translation.py` + universal):
  - `test_no_mcp_tools_called` — translation must call no research MCP tool (positive tests; `validate_research_schema` exempt).
  - Universal: `test_tool_allowlist` (frontmatter declares none → calling any is a violation), ownership table (owns no section → any write fails).
- **Rubric dims** (`eval/tests/unit/translation/rubric.md`): Accuracy (genealogical terms preserve precise meaning), Notation of uncertainty (flag, don't silently guess), Genealogical context (explain significant terms). All narrative, all judge-graded.
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** `negative-search-wikipedia` (don't go look something up), `negative-find-more-records` (find records → search/record-extraction). Decision-rules rows also pin handoffs to historical-context ("why") and citation (after record-extraction).
- **Key test files:** `german-kurrent-baptism.json`, `latin-marriage-record.json`, `latin-will-ambiguous-nepos.json` (uncertainty/ambiguity), `damaged-kurrent-uncertainty.json` (flag damage, don't guess), `single-term-lookup.json` (answer a one-term question directly, no full workflow), `dutch-reformed-baptism-patronymics.json`, `french-civil-birth.json`, `spanish-colonial-baptism.json`, `italian-mixed-latin-burial.json`, `portuguese-brazilian-marriage.json`, the two negatives.

## CUT — safe to remove (redundancy / over-explanation)
- **[lines 204–213] "Re-invocation behavior"** — boilerplate ("writes nothing, safe to repeat, N/A no writes"). Already in the description ("does not modify project files"). One line at most.
- **[lines 30–44] GPS grounding bullet list of BCG standards** — the five-bullet restatement of standards 23/24/29/32/6 (read handwriting, understand period words, transcribe entire item, reproduce exactly, Chicago conventions) is then re-operationalized in Steps 2–3 and Output conventions. Keep the **"Critical principle: translation is a derivative source; original governs" (42–44)** — that's the most-cited rule — but collapse the standards bullet list to a one-line citation ("Follows BCG standards 23, 24, 29, 32, 6 — see `references/gps-translation-standards.md`"); the operational content lives in Steps.
- **Output conventions opening sentence's listed-but-already-covered items (176–181)** — keep only the genuinely-new output rules (date conventions vary / convert to ISO 8601; genitive names normalize to nominative; foreign-text italics + quotation conventions). The "derivative-source principle, exact transcription, uncertainty flagging, period meanings, original-form names" enumeration is explicitly redundant per the section's own opening — cut the enumeration, keep the three new rules.
- **Duplicate uncertainty-flagging statements** — state the `[?]`/`[illegible]`/`[damaged]` convention once (Step 2), reference it from Step 3 rather than re-listing.

## KEEP — load-bearing craft (do NOT cut)
- **"Critical principle: a translation is a derivative source; preserve the original; the original governs" (42–44)** — protects Accuracy + the worked example's framing. Keep (the single most load-bearing line).
- **Languages-supported table with period concerns (53–64)** — Kurrentschrift/Sütterlin/Fraktur dates, colonial abbreviations, Latin-Italian mix, etc. This is the paleography craft the rubric's Accuracy dim leans on across the per-language tests. Keep.
- **"Reading images" section (66–79)** — read in-context vs. ask-to-paste-for-URL. Protects Tool Arguments / Correctness and the no-tool-calls invariant (it explains why no fetch tool is needed). Keep.
- **Step 2 exact-transcription rules: obsolete letterforms (long-s→s not f, thorn→th not y), include entire item, annotate damage (94–105)** — protects Notation of uncertainty + `damaged-kurrent-uncertainty`. Keep.
- **Step 3 translate-and-annotate: ambiguous readings flagged `[?]`, abbreviation expansions shown alongside, period-specific meanings (107–113)** — protects Notation of uncertainty + Accuracy + `latin-will-ambiguous-nepos`. Keep.
- **Step 4 extract-relevant-info: names with roles in original form, event vs document date, status (115–125)** — protects Genealogical context. Keep.
- **The worked German-baptism example (134–161)** — protects all three dims (the gebohren/getauft birth-vs-baptism distinction, Pathe=godfather-not-parent FAN significance, `[?]` on the godfather surname). This is the most concentrated teaching of the rubric's three dims; keep it. (Unlike historical-context, there is only ONE example here — do not cut it.)
- **Paleography guidance (163–174)**: Kurrent confusion pairs (e/n, u/n, m/nn), "identify record type first — formulaic structure constrains words." Protects Accuracy on the Kurrent tests. Keep.
- **Output conventions' three NEW rules (date conventions/ISO 8601, genitive→nominative, foreign-text italics) (182–188)** — protects Accuracy (genitive normalization, e.g. "Johannis"→"Johannes") and Genealogical context. Keep.
- **Decision rules table (190–202)** — the single-term-direct-answer row protects `single-term-lookup`; the partly-English, mixed-Latin/vernacular, dialect, and handoff rows (historical-context, citation) protect Accuracy + the two negatives. Keep.

## TIGHTEN — keep the point, cut the words
- Collapse the GPS-grounding BCG-standards bullet list to a one-line citation; keep the derivative-source critical principle.
- Cut the redundant enumeration that opens Output conventions; keep the three new rules.
- State uncertainty-flagging conventions once (Step 2), reference from Step 3.
- Re-invocation → one line.

## JUDGMENT CALLS (genealogist decides)
- **How far to collapse the GPS-grounding standards list.** The five named BCG standards may carry rubric-anchoring value beyond the reference doc (the judge's Source/Accuracy expectations may echo them). A genealogist confirms a one-line citation doesn't weaken the graded behavior before cutting the bullets.
- **Whether any per-language table rows are demotable to `references/vocabulary-and-record-structures.md`** (111 lines). The period-concerns column is quick-reference craft; I treat it as keep, but a genealogist may judge some rows safely demotable to the reference.
- **The worked example: keep whole.** I assert it must stay (it's the only example and teaches all three dims). If a genealogist wants to trim it, that is a craft call — but flag that this is the highest-risk cut in the file and likely not worth it.

## Suggested target structure (~170 lines)
1. Frontmatter + Narration.
2. Purpose + Critical principle (derivative source; original governs) + one-line BCG-standards citation.
3. Languages-supported table (period concerns) — kept.
4. Reading images — kept.
5. Steps: 1 identify language/record type → 2 transcribe (exact, letterforms, damage annotation — the single uncertainty-convention home) → 3 translate/annotate → 4 extract relevant info → 5 suggest next steps.
6. Worked German-baptism example — kept whole.
7. Paleography guidance — kept.
8. Output conventions — only the three new rules (dates/ISO, genitive, italics).
9. Decision rules table — kept.
10. One-line Re-invocation note.

## Verify
```
cd eval/harness && uv run python run_tests.py --skill translation
```
Watch: Accuracy + Notation of uncertainty + Genealogical context stay green across the per-language tests (German Kurrent, Latin marriage/will, Dutch patronymics, French/Spanish/Italian/Portuguese); `damaged-kurrent-uncertainty` still flags rather than guesses; `single-term-lookup` still answers directly without the full workflow; both negatives decline; `test_no_mcp_tools_called` green.

## Owner notes
Genealogist-led, and the most conservative of the five — translation has no tool and no writes, so there are no dead mechanics; nearly every line is graded paleography/translation craft. The only provably-safe cuts are deduplication the file already flags (Output-conventions enumeration, the GPS-standards list vs Steps) and the Re-invocation boilerplate. A **developer can safely** cut the Re-invocation section and the explicitly-redundant Output-conventions enumeration, and collapse the BCG-standards bullets to a one-line citation. A developer should **not** touch the worked example, the per-language/paleography tables, or the transcription/uncertainty rules — and should treat any "trim the example" idea as out of scope.
