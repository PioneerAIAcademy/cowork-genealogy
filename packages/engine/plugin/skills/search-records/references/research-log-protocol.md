# Research Log Protocol

This protocol must be followed by every skill that searches for or
processes genealogical records. The research log is the GPS audit trail
that makes "reasonably exhaustive" claims provable.

The mechanical side of logging is owned by the **`research_log_append`**
MCP tool: it assigns the `log_` id, stamps the timestamp, finalizes the
staged search payload into the `results/<log_id>.json` sidecar (counting
the results itself), validates before persisting, and appends to the
tail of `log[]` atomically. You never hand-assemble the entry, count
results, write a sidecar, or chunk a large payload. This protocol covers
the **analytical** rules — what to log, when an outcome is negative,
what belongs in `query`/`notes` — that remain your judgment.

## Rules

1. **Every search produces a log entry.** No exceptions. If you called
   a search tool or generated a search URL, log it.

2. **Nil results are recorded explicitly.** When a search returns no
   results, write a log entry with `outcome: "negative"` and
   `results_examined: 0`. The absence of a result is itself a finding.

3. **Log entries are append-only.** Never modify or delete an existing
   log entry. The log is the primary audit trail — if entries could be
   edited, the exhaustive search declaration would be unfalsifiable.

4. **Include search parameters.** The `query` object must capture
   enough detail to reproduce the search: names, dates, places,
   collection, and any filters used.

5. **Link to plan items.** If the search was part of a research plan,
   set `plan_item_id` to the `pli_` ID. For ad-hoc searches, use null.

6. **Link outputs back to the search.** The log entry is immutable
   (Rule 3). When sources and assertions are extracted from a logged
   search, the extracting skill stamps each new source and assertion
   with a `log_entry_id` pointing at the log entry. "What did this
   search produce" is a reverse lookup over those fields — the log
   entry itself is never revisited.

7. **Retain the raw results.** A log entry records *that* a search ran;
   the results it returned are retained too, so a later step can
   re-examine or refute them (GPS Element 1 — reasonably exhaustive
   research). For tool-payload searches (`record_search`,
   `fulltext_search`) you pass the search response's `staged.resultsRef`
   to `research_log_append` as `stagedResultsRef`, and the tool retains
   the raw payload in `results/<log_id>.json` for you — no hand-written
   sidecar, no chunking. External-site searches retain the captured
   PDF/HTML instead, via `external_site.capture_filename`. A search that
   returns nothing retains nothing — omit `stagedResultsRef` and the
   tool sets `results_ref` to null.

## The fields you supply to `research_log_append`

You provide the analytical content; the tool assigns the id, timestamp,
`results_ref`, and the sidecar.

- `tool` — the search tool used (`record_search`, `fulltext_search`, …).
- `query` — enough detail to reproduce the search.
- `outcome` — `positive` / `negative` / `partial` / `error`.
- `resultsExamined` — how many results you actually triaged.
- `resultsAvailable` — the total hit count the tool reported, or null.
- `planItemId` — the `pli_` this search addresses, or null for ad-hoc.
- `notes` — a one-line human summary of what the search returned.
- `stagedResultsRef` — `staged.resultsRef` from the search response
  (omit for a nil or external-site search).

**Recovery.** If `research_log_append` returns `{ ok: false, errors }`
it wrote nothing — surface the errors rather than retrying blindly. A
stale `stagedResultsRef` (staged result files are pruned after ~24h) is
the common case: re-run the search to re-stage, then log with the fresh
`staged.resultsRef`.

## When record-extraction writes log entries

record-extraction writes a log entry **only** when processing a
record that was not produced by search-records or
search-external-sites — e.g., a user-provided PDF uploaded directly.
When a search skill already logged the search, link to that log
entry by setting `log_entry_id` on each new source and assertion,
rather than creating a duplicate log entry.
