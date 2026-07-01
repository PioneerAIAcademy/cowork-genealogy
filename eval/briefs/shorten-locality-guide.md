# Shorten: locality-guide

**Bucket:** B (craft compression)
**Primary owner:** genealogist (developer assists with structure)
**Current size:** 209 lines → **Target:** ~155–170 lines (~22% reduction)
**Tool migration:** n/a (no new tool). **Reads via** `wiki_search`, `wiki_read`, `wiki_place_page`, `place_search`, `place_search_all`, `place_population`, `collections_search`, `external_links_search`, `wikipedia_search`. **Writes nothing** to `research.json` / `tree.gedcomx.json` (it is absent from both ownership tables, so any write fails the universal ownership check). Note: SKILL.md "Re-invocation behavior" says it writes a `<topic-slug>.md` file, but Step 5 and the validator docstring both say "output the guide directly to the user" — the genealogist resolves this inconsistency **in this PR** (see JUDGMENT CALLS).
**Still needed as a skill?** yes — surveying record availability, jurisdictional/boundary history, digitization-level classification, and locality research strategy is GPS-grounded craft graded by the rubric. The read tools fetch raw data; the survey methodology and "what exists and where" judgment are the skill's.

## TL;DR
This is already a fairly lean skill that delegates most detail to five reference docs. The compression is in **deduplicated tool documentation** (tools are documented in a frontmatter list, an "MCP tools used" table, AND inline call examples with prose), **deduplicated scope/routing rules** (the "stay in scope / WHAT not WHY" boundary is stated 3× and the time-period-required rule 2×), and a "Reference documents" pointer block that partly restates what the steps already say. The survey craft — jurisdictional context, digitization levels, topical breadth, the `external_links_search` `totalForPlace` interpretation — must survive.

## Why this skill is shortenable
The MCP tools are documented three times: the `allowed-tools` frontmatter list (15–24), the "MCP tools used" prose table (52–65), and the inline call examples inside Steps 2–3 (83–116) with their surrounding prose. Two of those three are largely redundant.

The scope boundary is stated repeatedly:
- "Keep this brief… deep historical context belongs in historical-context" (100–104, Step 2).
- Decision-rules row "User asks 'why' → redirect to historical-context" (171).
- Important-rules "Stay in scope… does not answer 'why'…'what to search next'…'how to search'" (193–195).

The time-period-required rule appears twice: Step 1 (78) and Decision-rules row (167).

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_locality_guide.py` + universal): the per-skill validator file is a **documentation-only placeholder** (no active asserts). Read-only behavior is enforced universally by `test_ownership_table` + `test_tree_ownership_table` (locality-guide owns no section, so any write fails). `test_tool_allowlist` pins the nine read tools.
- **Rubric dims** (`eval/tests/unit/locality-guide/rubric.md`): Jurisdiction accuracy, Record availability, Research strategy — all narrative, all judge-graded.
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** `negative-search-wikipedia` (a Wikipedia-style "tell me about the place" request that should NOT become a locality guide — routes to search-wikipedia). Decision-rules rows also pin the historical-context redirect ("why" questions), the narrow-the-country rule, and the parent-jurisdiction rule.
- **Key test files:** `schuylkill-county-records.json`, `different-jurisdiction-ireland.json` (boundary/jurisdiction craft), `ut_locality_guide_004`–`020` (19 positive coverage cases), `negative-search-wikipedia.json`.

## CUT — safe to remove (redundancy / over-explanation)
- **[lines 52–65] "MCP tools used" table** — duplicates the `allowed-tools` frontmatter list (15–24) plus the inline call examples. The frontmatter declares the tools; the Step examples show how to call them with purpose context. The standalone table is the third copy. Cut it (or, if a one-line purpose per tool is wanted, keep it and instead cut the inline prose in Steps 2–3 — pick one home, not two). The `wiki_place_page` section variants (57–60) are the only unique content; preserve those four section names in one line.
- **[lines 197–209] "Re-invocation behavior"** — boilerplate. It also *contradicts* Step 5 (writes-a-file vs output-to-user). Cut to one accurate line after the owner resolves which behavior is correct.
- **[lines 38–50 partial] "Reference documents" block** — the four-bullet annotated list of references is fine to keep as a load-on-demand pointer, but the per-bullet descriptions partly restate the Steps (e.g. "step-by-step survey process, digitization levels" duplicates Step 4). Trim each bullet to filename + one phrase.
- **One of the two scope-boundary statements** — Important-rules "Stay in scope" (193–195) and the Step-2 "deep historical context belongs in historical-context" (100–104) and Decision-rules "why → historical-context" (171) overlap heavily. Keep the Decision-rules routing row (it's the one a negative/boundary test maps to) + the Step-2 "keep jurisdiction brief" cue; cut the Important-rules "Stay in scope" bullet's restatement.

## KEEP — load-bearing craft (do NOT cut)
- **Step 2 "Establish jurisdictional context" — formation date, boundary changes, `place_search_all` for changed boundaries (79–104)** — protects Jurisdiction accuracy dim and `different-jurisdiction-ireland`. The "keep this brief, don't write a historical essay" cue stays (it's the historical-context boundary). Keep.
- **Step 3 survey + the `collections_search` jurisdiction-derivation rule + the `external_links_search` flat-list/dedupe rule + the `totalForPlace` vs `results.length` interpretation (107–145)** — protects Record availability + Research strategy + Tool Arguments. The `totalForPlace > 0 but results empty` interpretation (133–138) is non-obvious craft a generic LLM would miss. Keep.
- **Step 4 "Classify access levels" / digitization levels (147–151)** — protects Record availability ("distinguishes indexed/imaged from onsite"). Keep (it points to the reference table; keep the pointer + the "online absence ≠ nonexistence" rationale).
- **Decision rules table (165–174)** — protects the boundary tests: narrow-the-country rule, parent-jurisdiction rule, "why → historical-context," destroyed-records → substitute sources. Keep.
- **Important rules: "be specific about availability," "flag physical-only records," "note gaps honestly," "cover topical breadth," "cite the wiki" (177–195)** — these map onto Record availability + Research strategy pass criteria (named record classes, pitfalls, repository specificity). Keep these bullets; cut only the "stay in scope" restatement.
- **The five reference-doc pointers (load-on-demand)** — keep as pointers (trimmed); the detailed methodology lives there, not in SKILL.md.

## TIGHTEN — keep the point, cut the words
- Pick ONE home for tool documentation: keep the inline Step call examples (they carry argument shape the Tool Arguments dim needs) + frontmatter; delete the standalone "MCP tools used" table, preserving only the four `wiki_place_page` section names in one line.
- State the WHAT-not-WHY boundary once (Decision-rules row), reference it from Step 2.
- State time-period-required once (Step 1), drop the Decision-rules duplicate row (or vice versa).
- Trim reference-doc bullet descriptions to filename + one phrase.

## JUDGMENT CALLS (genealogist decides)
- **The write-a-file vs output-to-user contradiction — resolve in this PR.** Step 5 (160–161) and the validator docstring say "output directly to the user, does NOT write to research.json." Re-invocation (198–201) says it writes `<topic-slug>.md`. These describe different behaviors. The genealogist decides which is intended and makes the doc self-consistent in this PR. (The ownership validators only police `research.json`/`tree.gedcomx.json`, so a working-folder `.md` write would not fail a test either way — this is a doc-correctness fix, not a test-gated one.)
- **Whether to keep the "MCP tools used" table or the inline examples.** I assert the duplication is provable; *which* copy is more useful is a preference. The inline examples carry argument shapes (better for Tool Arguments grading), but a genealogist may prefer the scannable table — pick one.
- **How aggressively to trim the reference-doc pointer descriptions.** The descriptions help Claude decide which doc to load; over-trimming could hurt load-on-demand routing. Genealogist sets the floor.

## Suggested target structure (~160 lines)
1. Frontmatter + Narration + Places pointer.
2. Purpose (survey of what records exist and where — the prerequisite to planning).
3. Reference-doc pointers (trimmed to filename + phrase).
4. Steps: 1 identify target (time-period-required, stated once) → 2 jurisdictional context (`place_search`/`place_search_all`, formation/boundary, keep-brief cue) → 3 survey (collections_search derivation, external_links_search flat-list/dedupe + totalForPlace interpretation) → 4 classify access levels → 5 compile/present.
5. Decision rules table (kept — carries the boundary cases).
6. Important rules (specificity, physical-only flag, gaps, topical breadth, cite-the-wiki) — "stay in scope" restatement removed.
7. One accurate one-line Re-invocation note (after the file-vs-output contradiction is resolved).

## Verify
```
cd eval/harness && uv run python run_tests.py --skill locality-guide
```
Watch: Jurisdiction accuracy stays green on `different-jurisdiction-ireland`; Record availability + Research strategy stay green across `schuylkill-county-records` and the `ut_locality_guide_*` cases; the `totalForPlace`/`external_links_search` handling still produces correct repository lists; `negative-search-wikipedia` still declines to produce a guide; ownership validators green (no writes).

## Owner notes
Genealogist-led because the survey craft (jurisdiction/boundary judgment, digitization-level classification, the `external_links_search` `totalForPlace` interpretation, topical breadth) is the graded substance and one doc-level contradiction needs a craft/spec decision. A **developer can safely** delete the standalone "MCP tools used" table (preserving the four section names), cut the Re-invocation boilerplate, de-duplicate the time-period and stay-in-scope restatements, and trim reference-doc bullet descriptions. The write-a-file-vs-output contradiction is resolved **in this PR** by the genealogist (a spec/craft call — see JUDGMENT CALLS), not by a developer unilaterally; a developer also shouldn't touch the tool-interpretation rules in Step 3.
