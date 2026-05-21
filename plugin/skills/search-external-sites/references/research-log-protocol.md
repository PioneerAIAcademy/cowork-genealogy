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
  "notes": "Found Patrick Flynn age 5 in household of Thomas Flynn.",
  "external_site": null
}
```

## When record-extraction writes log entries

record-extraction writes a log entry **only** when processing a
record that was not produced by search-records or
search-external-sites — e.g., a user-provided PDF uploaded directly.
When a search skill already logged the search, link to that log
entry by setting `log_entry_id` on each new source and assertion,
rather than creating a duplicate log entry.
