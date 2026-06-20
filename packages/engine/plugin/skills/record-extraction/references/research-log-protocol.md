# Research Log Protocol

This protocol must be followed by every skill that searches for or
processes genealogical records. The research log is the GPS audit trail
that makes "reasonably exhaustive" claims provable.

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
   `fulltext_search`) the raw response is retained as a sidecar at
   `results/<log_id>.json`. External-site searches retain the captured
   PDF/HTML instead, via `external_site.capture_filename`. A search that
   returns nothing retains nothing.

## Writing log entries with `research_log_append`

Log entries — and their sidecars — are written by the
`research_log_append` MCP tool, not by hand. The tool assigns the
`log_` id, stamps `performed`, sets `results_ref`, and (when a search's
results were retained) finalizes the `results/<log_id>.json` sidecar
from the staged handle the search tool returned, recomputing
`returned_count` itself. You never serialize the payload, allocate the
id, or wire `results_ref` by hand — pass the analytical inputs and the
`stagedResultsRef` handle, and the tool does the clerical work.

- `resultsExamined` — how many results you actually triaged.
- `resultsAvailable` — the total hit count the tool reported, or null
  when the tool reports no total.
- `notes` — a one-line human summary of what the search returned.
- `stagedResultsRef` — the `staged.resultsRef` handle from a
  `record_search` / `fulltext_search` you called with `projectPath`.
  Omit it for nil searches and external-site searches (no sidecar).
- A staged handle can expire (TTL ~24h); on a stale handle
  `research_log_append` returns `{ ok: false }` and writes nothing.
  Re-run the search (it re-stages cheaply) and pass the fresh handle.

## When record-extraction writes log entries

record-extraction calls `research_log_append` **only** when processing
a record that was not produced by search-records or
search-external-sites — e.g., a user-provided PDF uploaded directly.
When a search skill already logged the search, link to that log
entry by setting `log_entry_id` on each new source and assertion,
rather than appending a duplicate log entry.
