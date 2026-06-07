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
   `fulltext_search`) the raw response is written to a sidecar file —
   see "Result sidecar files" below. External-site searches retain the
   captured PDF/HTML instead, via `external_site.capture_filename`. A
   search that returns nothing retains nothing — `results_ref` is null.

## Log entry structure

```json
{
  "id": "log_001",
  "plan_item_id": "pli_001",
  "performed": "2026-05-04T10:15:00Z",
  "tool": "record_search",
  "query": {
    "surname": "Flynn",
    "given": "Patrick",
    "birth_year": 1845,
    "birth_place": "Pennsylvania",
    "collection": "1850 Census"
  },
  "outcome": "positive",
  "results_examined": 8,
  "results_available": 1240,
  "results_ref": "results/log_001.json",
  "notes": "1,240 1850-census hits; 8 examined; Patrick Flynn age 5 found in household of Thomas Flynn.",
  "external_site": null
}
```

- `results_examined` — how many results you actually triaged.
- `results_available` — the total hit count the tool reported, or null
  when the tool reports no total.
- `results_ref` — path to the result sidecar (see below), or null.
- `notes` — a one-line human summary of what the search returned.

## Result sidecar files

The raw results of a tool-payload search are not stored inline in
`research.json` — that file is read by every skill at startup and must
stay lean. Instead the search skill writes the full response to a
sidecar file `results/<log_id>.json` in the project folder and sets
`results_ref` on the log entry to point at it.

Sidecar file shape:

```json
{
  "log_id": "log_001",
  "tool": "record_search",
  "retrieved": "2026-05-04T10:15:00Z",
  "returned_count": 12,
  "payload": { "...": "the verbatim MCP tool response" }
}
```

- `returned_count` must equal the number of results in `payload` — it
  is the integrity check that catches a truncated write.
- **Write fidelity.** Reproducing a large payload into a single `Write`
  is reliable up to ~50 results. Write single-shot for **≤40 results**;
  for larger payloads write in **~40-result chunks** (appended).
  validate-schema verifies `returned_count` against the payload either
  way.
- **Nil searches write no sidecar.** When a search returns zero
  results, leave `results_ref` null — the log entry's `outcome` and
  counts already record the nil.
- **If retention fails.** If the sidecar cannot be written faithfully
  (the integrity check keeps failing after a retry), set `results_ref`
  to null, note it in the log entry's `notes`, and tell the user
  plainly that the search's results could not be retained.
- External-site searches write no sidecar; their capture is retained
  via `external_site.capture_filename`.

## When record-extraction writes log entries

record-extraction writes a log entry **only** when processing a
record that was not produced by search-records or
search-external-sites — e.g., a user-provided PDF uploaded directly.
When a search skill already logged the search, link to that log
entry by setting `log_entry_id` on each new source and assertion,
rather than creating a duplicate log entry.
