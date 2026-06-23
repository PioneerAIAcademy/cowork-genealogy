# Shorten: search-external-sites

**Bucket:** A (dead-mechanics removal)
**Primary owner:** both (developer strips the tool-call narration and dedupes
the two `research_log_append` blocks; the genealogist signs off on the
URL/parameter construction, subscription handling, and triage judgment)
**Current size:** 412 lines → **Target:** ~300–330 lines (~25% reduction)
**Tool migration:** **done** — calls `place_search`, `external_links_search`,
`research_log_append` (with `tool:"external_site"` + `externalSite`, **no**
`stagedResultsRef`), `research_append`. No leftover post-write
`validate_research_schema`.
**Still needed as a skill?** **Yes, unambiguously** — the whole click-capture
workflow, the curated-link consumption rules, the per-site URL templates, and
the subscription tie-breaker are judgment the bare tools can't supply.

## TL;DR
This is the **lightest** of the three cuts. The append-twice-per-loop pattern
(URL-generated, then capture-received) is real workflow that the validators
check — keep both calls. The cut is the duplicated `research_log_append({…})`
JSON block (it appears nearly verbatim in step 4 and step 6 — show the shape
once), the `research_append({…})` plan-item block, and the "Re-invocation
behavior" boilerplate. What must survive: the `place_search` →
`external_links_search` tool-flow, the curated-link consumption rules, the per-
site URL templates, and the `outcome:"partial"` + `captureReceived:false`
shape on the URL-generation step.

## Why this skill is shortenable
`research_log_append` assigns the `log_NNN` id, stamps `performed`, validates-
before-persist, and appends atomically; `research_append` (`op:"update"`) flips
the plan-item status. The skill narrates that and shows the same
`research_log_append` payload twice. Unlike the other two search skills, there
is **no `stagedResultsRef` and no result sidecar** here (the capture is a PDF the
user uploads), so there's less sidecar narration to remove — hence the smaller
reduction.

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_search_external_sites.py`):
  - `test_positive_appends_external_site_log_entry` — every positive test
    appends ≥1 new `log[]` entry with `tool:"external_site"`.
  - `test_url_generation_log_entry_shape` — a new `external_site` entry with
    `outcome:"partial"` must have a non-empty `external_site.url_generated` and
    `external_site.capture_received: false`. **This is the headline shape** —
    the URL-generation (first) append of the twice-per-loop pattern.
  - `test_log_site_*` (tags `log-site-ancestry|myheritage|findmypast|findagrave|
    newspapers`) — the new entry's `external_site.site` matches the target site.
  - Universal: `test_log_append_only`, `test_no_entries_deleted`,
    `test_id_references_resolve`, `test_ownership_table` (search-external-sites
    may write only `log` + `plans`), `test_tool_allowlist`.
- **Rubric dims** (`eval/tests/unit/search-external-sites/rubric.md`): URL
  generation, Capture guidance, Result triage, Tool selection, Log entry.
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** `negative-familysearch-search.json` (→
  search-records), `negative-planning-question.json` (→ research-plan),
  `negative-record-in-hand.json` (→ record-extraction).
- **Key test files:** `ancestry-census-search`, `myheritage-url-generation`,
  `findmypast-irish-birth`, `findagrave-burial-search`,
  `newspapers-obituary-search`, `log-at-url-generation`,
  `mixed-sites-filter-dedupe`, `nil-result-logging`,
  `subscription-aware-warning`.

Note on the Tool-selection rubric dim: line 33 says
"`validate_research_schema` runs after writing research.json." That is a
**rubric** line, not the SKILL.md — and `research_log_append` /
`research_append` now validate-before-persist, so the SKILL.md correctly no
longer calls `validate_research_schema`. Don't add it back to satisfy the
rubric wording; the rubric line is stale — **fix it in this PR** (see Owner
notes: edit `rubric.md` line 33). The skill's actual tool-flow
(`place_search` → `external_links_search`, consume per the rules) is what the
dim grades and is present.

## CUT — safe to remove
- **[327–343] the second `research_log_append({…})` JSON block in step 6** — it
  is the step-4 block [220–236] with `outcome`/`captureReceived` flipped. Show
  the payload **once** (in step 4); in step 6 describe only the deltas in prose
  (`captureReceived:true`, `captureFilename` set, `outcome` from triage). This is
  the single biggest cut and removes no graded behavior — the twice-per-loop
  append stays, only the duplicate JSON goes.
- **[359–368] the `research_append({…})` plan-item JSON block in step 7** — keep
  a one-line call; the schema documents `section/op/planId/entryId/fields`.
- **[402–412] "Re-invocation behavior"** — boilerplate restating the
  append-only/two-entries contract already covered by step 4's "append a **new**
  entry — never edit this one" and Important-rules-equivalent prose. Delete.
- **[216–219] the "it assigns the `log_NNN` id, stamps `performed`, validates the
  whole project before persisting, and writes `research.json` atomically"
  narration** — tool mechanics; reduce to "call `research_log_append` (it
  assigns the id and validates-before-persist)."
- **[121–137] the prose re-explaining the `external_links_search` return shape**
  ("A flat `results[]` of `{ url, linkText }` …") — TIGHTEN to the three
  consumption rules (filter by host, dedupe, match `linkText` to record type)
  plus the `totalForPlace` cases; the response-shape narration is schema-ish.

## KEEP — load-bearing judgment (do NOT cut)
- **[105–137] step 2 `place_search` → `external_links_search` flow + the
  consumption rules (filter by host, dedupe, match `linkText`, `totalForPlace`
  semantics)** — backs the Tool-selection dim and `mixed-sites-filter-dedupe`.
- **[140–207] step 3 Case A / Case B URL building + per-site templates +
  parameter strategy** — backs the URL-generation dim and every per-site test
  (`ancestry-`, `myheritage-`, `findmypast-`, `findagrave-`, `newspapers-`).
  The per-site templates are reference the tool does NOT supply; keep all five.
- **[208–249] step 4 — the "log before you hand over the URL" rule, the
  `outcome:"partial"` + `captureReceived:false` shape, and "no
  `stagedResultsRef`"** — directly back `test_url_generation_log_entry_shape`,
  `log-at-url-generation`, and the Log-entry dim. Keep the **one** payload
  example here.
- **[253–270] the click-capture instruction template** — backs the
  Capture-guidance dim; keep.
- **[272–306] step 5 PDF triage (list / classify / rate strong-possible-no-match
  / present numbered)** — backs the Result-triage dim; keep.
- **[307–352] step 6 "Log results, including nil results" — the
  `captureReceived:true` second append and the negative-`notes` detail
  (coverage gaps, "not found online ≠ does not exist")** — backs
  `nil-result-logging` and the Log-entry dim. Keep the prose; cut only the
  duplicate JSON.
- **[58–85] "Before you search" — subscription tie-breaker + classify-the-target**
  — backs `subscription-aware-warning` (flag-don't-block). Keep.
- **The three-gate routing in the description frontmatter + the negative cases**
  — back the three negative tests. Keep.

## TIGHTEN — keep the point, cut the words
- Collapse the two `research_log_append` examples to one canonical block (step 4)
  plus a prose delta in step 6.
- State the "`{ ok:false }` → surface errors, don't retry/hand-write" rule
  **once** (currently at the end of step 4 [247–249], step 6 [345–346], and
  step 7 [370–371]).
- The "Re-invocation behavior" point ("re-running is a logged event; never edit a
  prior entry; two runs → two entries") duplicates step 4's "append a **new**
  entry — never edit this one" — keep the inline rule, drop the trailing section.

## Related trim (references — note only; the brief is about SKILL.md)
`references/research-log-protocol.md` (66 lines, the smallest of the three) and
`references/validation-protocol.md` (16 lines) are **already migrated** — the
protocol explicitly notes external-site searches retain the captured PDF via
`external_site.capture_filename` (no `stagedResultsRef`, no sidecar) and the
validation ref already drops the post-write backstop. No obsolete mechanics
remain there to remove.

## Suggested target structure (~315 lines)
1. Frontmatter + Narration + Places line.
2. Why no page-loading (the workflow rationale) + the 4-step loop.
3. Before you search — subscription tie-breaker + classify-the-target (KEEP).
4. Supported-sites table.
5. Step: find plan item.
6. Step: `place_search` → `external_links_search` + the 3 consumption rules +
   `totalForPlace` cases (tightened).
7. Step: build URL — Case A / Case B + the five per-site templates (KEEP).
8. Step: log + present URL — **one** `research_log_append` example
   (`outcome:"partial"`, `captureReceived:false`, no `stagedResultsRef`) + the
   capture-instruction template.
9. Step: triage the PDF (KEEP).
10. Step: log results incl. nil — prose deltas only (`captureReceived:true`,
    negative-`notes` detail), no second JSON block.
11. Step: plan-item status via one-line `research_append` + next-step offers.
12. Capture-problems table + user-contributed-sources note.

## Verify
```
cd eval/harness && uv run python run_tests.py --skill search-external-sites
```
Watch all five rubric dims, every validator (especially
`test_url_generation_log_entry_shape` and the five `log-site-*` checks), and
confirm the three negative tests still route. Confirm the twice-per-loop append
still fires (`log-at-url-generation` for the first entry; `nil-result-logging`
for a capture-received negative).

## Owner notes
**Developer** safely de-duplicates the two `research_log_append` blocks, cuts the
`research_append` JSON block, "Re-invocation behavior," and the repeated
`{ ok:false }` recovery lines. **Genealogist** owns the URL/parameter
construction (steps 2–3, the per-site templates), the subscription handling, and
the PDF triage — these back four of the five rubric dims; keep them intact.
**Fix in this PR:** the stale `validate_research_schema` line in the rubric
(line 33) — re-word it to the validate-before-persist tool flow (or drop the
post-write clause); it's not the skill's job anymore. Editing `rubric.md` flips
run logs inactive, so this rides the re-run + re-annotation you already do;
senior reviews the rubric change with the cuts.
