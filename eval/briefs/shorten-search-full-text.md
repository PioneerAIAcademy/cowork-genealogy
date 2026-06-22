# Shorten: search-full-text

**Bucket:** A (dead-mechanics removal)
**Primary owner:** both (developer strips the tool-mechanics narration; the
genealogist signs off on the FTS query-construction, FAN, and negative-result
judgment that stays)
**Current size:** 383 lines → **Target:** ~250–270 lines (~32% reduction)
**Tool migration:** **done** — calls `fulltext_search` (with `projectPath`),
`source_attachments`, `research_log_append`, `research_append`. No leftover
post-write `validate_research_schema`.
**Still needed as a skill?** **Yes** — FTS is a fundamentally different search
surface (no fuzzy matching, Lucene operators, find-non-principals); the query
construction and the negative-result detail are rubric-graded judgment the bare
tool can't supply.

## TL;DR
Same dead-mechanics cut as search-records, full-text variant: drop the long
`fulltext_search` example menu down to a few representative lines, cut the
`research_log_append({…})` JSON block + the "the tool assigns the log id …
finalizes the staged results into `results/<log_id>.json` … recomputing the
count" sidecar narration, and delete the "Re-invocation behavior" boilerplate.
What must survive: the indexed-vs-FTS contrast (the routing boundary), the
Lucene operator rules, and the detailed negative-result logging — the
highest-value rubric dim here.

## Why this skill is shortenable
`fulltext_search` now stages results host-side and returns `staged.resultsRef`;
`research_log_append` assigns the log id, stamps `performed`, writes the
`results/<log_id>.json` sidecar, **recomputes the count**, and
validates-before-persist; `research_append` (`op:"update"`) flips the plan-item
status. The skill narrates that clerical pipeline in several places — dead text
the tools own.

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_search_full_text.py`):
  - `test_positive_appends_log_entry` — every positive test appends ≥1 new
    `log[]` entry whose `tool` contains "fulltext".
  - `test_negative_result_log_shape` (tag `negative-result-log`) — a new entry
    with `outcome:"negative"` and a non-empty `query` object.
  - `test_sidecar_written_for_positive_fts` (tag `sidecar-write`) — new entry
    has a non-null `results_ref`, the named `results/<log_id>.json` sidecar
    exists, and `returned_count == len(payload.results)`. **The tool produces
    this**; the skill only passes `stagedResultsRef`.
  - Universal: `test_log_append_only`, `test_no_entries_deleted`,
    `test_id_references_resolve`, `test_ownership_table` (search-full-text may
    write only `log` + `plans`), `test_tool_allowlist`.
  - (There is **no** `sidecar-nil` validator here — the nil path is graded by
    the Negative-result-handling rubric dim, not a deterministic check.)
- **Rubric dims** (`eval/tests/unit/search-full-text/rubric.md`): Query
  construction, FAN awareness, Negative result handling.
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** `negative-external-sites.json` (→
  search-external-sites), `negative-search-records.json` (indexed vs FTS — the
  key boundary), `negative-record-extraction.json` (→ record-extraction),
  `negative-research-plan.json` (→ research-plan).
- **Key test files:** `search-for-flynn-witnesses`,
  `attachment-triage-witnesses`, `lucene-operator-construction`,
  `transcription-quirk-variant`, `negative-result-with-detail`,
  `write-result-sidecar`, `nlquery-tree-person`, `latin-american-notarial`.

## CUT — safe to remove
- **[136–166] the `fulltext_search({…})` example menu (9 example queries)** —
  the tool schema documents `keywords`/`nlQuery`/`imageGroupNumber`. Keep ~3
  representative lines (a `+`-required keyword query, a phrase query, an
  `nlQuery` tree-person example for `nlquery-tree-person`) and one note that
  `projectPath` is always passed; drop the rest.
- **[214–245] the `research_log_append({…})` JSON block + "The tool assigns the
  log id and `performed` timestamp, finalizes the staged results into the
  `results/<log_id>.json` sidecar (recomputing the count), and validates-before-
  persist" narration** — pure tool mechanics. Collapse to a one-line call + the
  field list already in `references/research-log-protocol.md`.
- **[368–382] "Re-invocation behavior" / "Writes:"** — boilerplate restating
  the sidecar-finalize and append-only contract a third time. Delete.
- **[254–267] the `research_append({…})` plan-item JSON block** — keep a
  one-line call; the schema documents the params.
- **[247–251] the standalone "Recovery." paragraph** — the
  stale-`stagedResultsRef` → re-run rule already lives in
  `references/research-log-protocol.md` and is restated under Important rules;
  keep one short clause, drop the paragraph.

## KEEP — load-bearing judgment (do NOT cut)
- **[46–63] "Key differences from indexed Records search" table** — this is the
  search-records-vs-FTS distinction that `negative-search-records` checks and
  that grounds the no-fuzzy/Lucene reasoning the Query-construction dim grades.
  Keep the table; it earns its lines.
- **[112–135] Step 5 "Construct the search query" critical rules** — "always use
  `+`," "search name only first / place as post-filter," "abbreviations must be
  searched explicitly," "mine prior records for known variants," phrase/wildcard
  rules — all map onto the Query-construction dim and the
  `lucene-operator-construction` / `transcription-quirk-variant` tests.
- **[98–110] Step 4 strategy table** (witness/heir, FAN cluster, kinship) — backs
  the FAN-awareness dim and `search-for-flynn-witnesses`.
- **[189–212] Step 7 triage + attachment check** — backs
  `attachment-triage-witnesses` and the Result-correctness base dim.
- **[274–303] Step 10 "Handle nil results" — especially the rule 1 mandate that
  `notes` on a negative entry must state the collection class, place filters,
  date range, variant forms, and count of variants tried** — this is the entire
  Negative-result-handling rubric dim (and `negative-result-with-detail`). Keep
  nearly intact; do NOT thin the "what belongs in negative `notes`" detail.
- **[305–317] Step 11 cross-reference queueing** — distinctive FTS value feeding
  FAN awareness; keep, tighten prose.
- **[354–366] the "do NOT write sources/assertions" + "do NOT add extra fields to
  plan items" + "always use `keywords`, not `nlQuery` as a fallback" rules** —
  the first backs the ownership validator, the second prevents an
  additionalProperties failure, the third is a tested Tool-Arguments guardrail.
- **One line:** "omit `stagedResultsRef` on a nil search."

## TIGHTEN — keep the point, cut the words
- State "the write tools validate-before-persist; surface `{ ok:false }` rather
  than retrying; a stale `stagedResultsRef` → re-run `fulltext_search`" **once**
  (currently in Step 8 Recovery [247–251], Step 9, and Important rules).
- The Important-rules list (340–366) restates Step 5 and Step 10 (`+`, name-first,
  derivative-verify, nil-variants, log-every-search). Keep one tight list; drop
  the duplications of the per-step prose.
- The "FTS results are derivative sources" point appears at [59–64] and again at
  [346–347] — state once.

## Related trim (references — note only; the brief is about SKILL.md)
`references/research-log-protocol.md` (106 lines) and
`references/validation-protocol.md` (17 lines) are **already migrated** —
they describe the tool owning the id/sidecar/count/validation and keep only the
analytical rules. No obsolete chunking/sidecar-write mechanics remain there.
The redundancy is SKILL.md re-narrating what the protocol already states; fix it
on the SKILL.md side.

## Suggested target structure (~260 lines)
1. Frontmatter + Narration line.
2. Short purpose + the indexed-vs-FTS table (KEEP).
3. "FTS results are derivative" — one line.
4. Step: identify plan item + evaluate target database.
5. Step: search philosophy + strategy table (KEEP).
6. Step: construct query — Lucene critical rules (KEEP) + ~3 example lines.
7. Step: execute — one-line call, pass `projectPath`, hold `staged.resultsRef`.
8. Step: triage + attachment (KEEP).
9. Step: log — one-line `research_log_append`, "omit `stagedResultsRef` for
   nil," point to the protocol ref.
10. Step: plan-item status via one-line `research_append`.
11. Step: nil escalation (KEEP the negative-`notes` mandate).
12. Step: cross-reference queueing + present results.
13. Important rules — one deduped list (incl. ownership + keywords guardrails).

## Verify
```
cd eval/harness && uv run python run_tests.py --skill search-full-text
```
Watch Query-construction and Negative-result-handling especially, all three
validators, and confirm `negative-search-records` still routes (the FTS-vs-
indexed boundary) and `lucene-operator-construction` still builds `+`-required
queries.

## Owner notes
**Developer** safely cuts the example-query menu, the `research_log_append`
narration, "Re-invocation behavior," and the deduped recovery repeats.
**Genealogist** owns Step 5 (Lucene rules), Step 10 (negative-result detail),
and the FAN strategy table — these back all three rubric dims; keep them intact.
