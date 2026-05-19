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

6. **Link to outputs.** After extraction, update
   `captured_source_ids` and `produced_assertion_ids` with the IDs
   of sources and assertions created from this search.

## Log entry structure

```json
{
  "id": "log_001",
  "plan_item_id": "pli_001",
  "performed": "2026-05-04T10:15:00Z",
  "tool": "search",
  "query": {
    "surname": "Flynn",
    "given": "Patrick",
    "birth_year": 1845,
    "birth_place": "Pennsylvania",
    "collection": "1850 Census"
  },
  "outcome": "positive",
  "results_examined": 8,
  "captured_source_ids": ["src_001"],
  "produced_assertion_ids": ["a_001", "a_002", "a_003"],
  "notes": "Found Patrick Flynn age 5 in household of Thomas Flynn.",
  "external_site": null
}
```

## When record-extraction writes log entries

record-extraction writes a log entry **only** when processing a
record that was not produced by search-records or
search-external-sites — e.g., a user-provided PDF uploaded directly.
When a search skill already logged the search, reference that log
entry via each assertion's `log_entry_id` field rather than creating
a duplicate.
