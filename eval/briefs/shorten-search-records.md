# Shorten: search-records

**Bucket:** A (dead-mechanics removal)
**Primary owner:** both (developer strips the tool-mechanics narration; the
genealogist signs off on the triage / nil-escalation / collection-mismatch
judgment that stays)
**Current size:** 591 lines → **Target:** ~320–350 lines (~42% reduction)
**Tool migration:** **done** — calls `record_search` (with `projectPath`),
`record_read`, `same_person`, `source_attachments`, `research_log_append`,
`research_append`. No leftover post-write `validate_research_schema`.
**Still needed as a skill?** **Yes, unambiguously** — the search-parameter
strategy, the same_person + logical-cross-check triage, the collection-mismatch
honesty, and nil-escalation are all rubric-graded judgment the bare tool can't
supply.

## TL;DR
The big cut is the tool-mechanics narration: the verbose `record_search({…})`
and `research_log_append({…})` JSON example blocks, the "the tool assigns the
`log_` id, finalizes the staged results into `results/<log_id>.json`, counting
them itself" sidecar/verify-count prose, and the boilerplate "Re-invocation
behavior" block — the schema documents the params and the tool guarantees the
mechanics. What must survive untouched: the three-gate routing header, the
search-parameter and name-variant strategy, the `same_person`-plus-logical-
cross-check triage, the collection-mismatch handling, and the full nil-result
escalation.

## Why this skill is shortenable
`record_search` now stages its raw results host-side and returns
`staged.resultsRef`; `research_log_append` assigns the `log_` id, stamps the
timestamp, writes the `results/<log_id>.json` sidecar, **counts the results
itself**, validates-before-persist, and appends atomically. `research_append`
(`op:"update"`) locates a plan item by id and persists the status change. A
large fraction of the prose narrates that clerical work step by step — that is
dead text the tools own.

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_search_records.py`):
  - `test_positive_appends_log_entry` — every positive test must append ≥1 new
    `log[]` entry.
  - `test_log_outcome_positive_record_search` (tag `log-positive-record-search`)
    — new entry has `tool:"record_search"`, `outcome:"positive"`.
  - `test_log_outcome_honest_no_match` (tag `log-honest-no-match`) — when the
    fixture doesn't match, the new entry must **not** be `outcome:"positive"`;
    must be negative/partial/error.
  - `test_sidecar_written_for_positive_search` (tag `sidecar-write`) — new entry
    carries a non-null `results_ref`, the named `results/<log_id>.json` sidecar
    exists, and `returned_count == len(payload.results)`. **The tool now
    produces all of this**; the skill only has to pass `stagedResultsRef`.
  - `test_no_sidecar_for_nil_search` (tag `sidecar-nil`) — nil search leaves
    `results_ref` null and writes no `results/` file (skill omits
    `stagedResultsRef`).
  - Universal: `test_log_append_only`, `test_no_entries_deleted`,
    `test_id_references_resolve`, `test_ownership_table`
    (search-records may write only `log` + `plans`), `test_tool_allowlist`.
- **Rubric dims** (`eval/tests/unit/search-records/rubric.md`): Search strategy,
  Result triage, Log quality, Sidecar correctness, Nil escalation.
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** `negative-ancestry-request.json` and
  `negative-newspapers-request.json` (→ search-external-sites),
  `negative-research-plan-request.json` (→ research-plan; **must NOT** detour
  through project-status), `negative-extract-request.json` (→ record-extraction).
- **Key test files:** `execute-census-search`, `write-result-sidecar`,
  `nil-search-no-sidecar`, `negative-no-match-results`, `attachment-triage`,
  `same-person-conflict-triage`, `same-person-near-match-triage`.

Note: the Sidecar-correctness rubric dim and the `sidecar-write`/`sidecar-nil`
validators still grade the sidecar *outcome* — but the skill now achieves it by
passing/omitting `stagedResultsRef`, **not** by writing the file. Keep the
"omit `stagedResultsRef` on a nil search" instruction (one line); cut the prose
that explains how the sidecar gets written.

## CUT — safe to remove
- **[227–239] the full `record_search({…})` JSON example block** — the tool
  schema documents every param. Keep at most a one-line inline mention
  ("call `record_search` with the constructed params plus `projectPath`").
- **[330–354] the `research_log_append({…})` JSON example block + the "the tool
  assigns the `log_` id, stamps the timestamp, finalizes the staged results
  into the `results/<log_id>.json` sidecar (counting them itself), validates …
  appends to the tail of `log[]` atomically — so you never hand-assemble the
  entry, count results, or worry about ordering" narration** — pure
  tool-mechanics. Collapse to a one-line call + the field list already in
  `references/research-log-protocol.md`.
- **[574–590] "Re-invocation behavior" / "Writes:"** — boilerplate that
  re-describes the sidecar finalize and the append-only contract a third time.
  Delete; the one load-bearing line ("re-running a search is itself a logged
  event") already lives under Important rules.
- **[567–572] "No post-write validation needed" bullet** — restates
  `references/validation-protocol.md`. Reduce to a single clause: "the write
  tools validate-before-persist; `check-warnings` doesn't apply here (no
  assertions)."
- **[412–421] the `research_append({…})` plan-item JSON block** — keep a
  one-line call; the schema documents `section/op/planId/entryId/fields`.
- **[240–243] "The response carries the full `results[]` … Hold
  `staged.resultsRef` …"** and **[356–368] the bullet re-listing every
  `research_log_append` field + "The tool returns a compact summary — {…}"** —
  the field semantics are in the protocol reference; keep only the one rule the
  judge needs (omit `stagedResultsRef` for a nil search) and "narrate from the
  summary, don't echo the payload."

## KEEP — load-bearing judgment (do NOT cut)
- **[27–60] the three-gate ROUTE CHECK header** and **[110–137] "Step 0: Scope
  check"** — these back all four negative tests, including the explicit "do NOT
  call `Skill("project-status")` before routing" rule that
  `negative-research-plan-request` checks. (The two are near-duplicates — see
  TIGHTEN; keep the routing content, dedupe the form.)
- **[146–217] Step 2 "Construct the search query"** — the broad-to-narrow
  default, the **anchor rule** (surname or recordCountry; the tool rejects
  anchor-less queries — also the `fail` condition in the Search-strategy dim),
  the name-variant strategy, the "no wildcards in record_search" rule, and
  "always keep givenName" — all map onto the Search-strategy rubric dim.
- **[249–321] Step 4 "Triage results"** — hit-count decision rules, `same_person`
  thresholds, the **"low score is one data point" + "even a high score requires
  a logical cross-check"** rules, and the attachment-status handling — map 1:1
  onto the Result-triage dim and the `same-person-*` and `attachment-triage`
  tests.
- **[370–384] the collection-mismatch protocol** (`outcome:"partial"`, stop, do
  not suggest variant spellings) — distinct honest-logging behavior with no
  separate test but directly under Log-quality + Correctness; keep, tighten.
- **[484–521] Step 8 "Handle nil results"** — the escalation levers, "never drop
  given name," "log each retry separately," the three-condition meaningful-
  absence assessment, and "not found ≠ does not exist" — this is the entire
  Nil-escalation rubric dim. Keep nearly intact.
- **[442–481] Step 7 index-vs-original + the `record_read` `recordId`-param
  rule** — the param-name guardrail prevents a Tool-Arguments failure; keep it.
- **One line:** "omit `stagedResultsRef` for a nil search" — backs the
  `sidecar-nil` validator and the Sidecar-correctness dim.

## TIGHTEN — keep the point, cut the words
- **Merge the ROUTE CHECK header (27–60) and Step 0 (110–137).** They state the
  same three routing gates twice in different formats. Keep one canonical
  routing block (the header form is tighter); delete the duplicate.
- State the "the write tools validate-before-persist; surface `{ ok:false }`
  rather than retrying; a stale `stagedResultsRef` → re-run the search" rule
  **once** (it currently appears in Step 5 [394–398], Step 6 [437–438], and
  Important rules). The recovery detail also already lives in the protocol ref.
- The "Log every search / append-only / never fabricate" rules under Important
  rules (554–566) restate Steps 5 and 8 — keep one tight bullet list, drop the
  re-explanations.

## Related trim (references — note only; the brief is about SKILL.md)
`references/research-log-protocol.md` (83 lines) and
`references/validation-protocol.md` (20 lines) are **already migrated** — they
describe the tool owning id/sidecar/count/validation and keep only the
analytical rules. No obsolete sidecar/chunking mechanics remain there. The real
redundancy is between SKILL.md and these refs: SKILL.md re-narrates the
sidecar/validation mechanics the protocol already covers. The fix is on the
SKILL.md side (cut the narration, point to the ref), not in the refs.

## Suggested target structure (~330 lines)
1. Frontmatter + Narration line.
2. One canonical ROUTE CHECK / scope block (merged).
3. GPS grounding (4 principles) — keep, it's short.
4. MCP tools + record_type routing table.
5. Step: identify plan item.
6. Step: construct query — strategy, anchor rule, variants (KEEP in full).
7. Step: execute — one-line call, pass `projectPath`, hold `staged.resultsRef`.
8. Step: triage — same_person + logical cross-check + attachment (KEEP).
9. Step: collection-mismatch (tightened) + log — one-line `research_log_append`
   call, "omit `stagedResultsRef` for nil," point to the protocol ref.
10. Step: plan-item status via one-line `research_append`.
11. Step: index-vs-original + `record_read` param guardrail.
12. Step: nil escalation (KEEP).
13. Step: present results.
14. Important rules — one deduped list.

## Verify
```
cd eval/harness && uv run python run_tests.py --skill search-records
```
Watch all five rubric dims (especially Nil escalation and Sidecar correctness),
all five validators, and confirm the four negative tests still route — including
that `negative-research-plan-request` goes straight to research-plan with **no**
project-status detour.

## Owner notes
**Developer** safely cuts the JSON example blocks, the sidecar/count/validation
narration, "Re-invocation behavior," and the deduped recovery repeats.
**Genealogist** owns Steps 2, 4, and 8 (search strategy, triage, nil
escalation) and the collection-mismatch protocol — these back four of the five
rubric dims; don't let a mechanical pass thin them.
