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
   research). External-site searches retain the captured PDF/HTML via
   `external_site.capture_filename` — there is no result sidecar. (For
   tool-payload searches, `research_log_append` finalizes the sidecar
   itself from the search's staged handle; an external-site search never
   passes one.)

## What you supply, what the tool owns

You call `research_log_append` with the analytical fields below; the tool
assigns the `log_NNN` id, the `performed` timestamp, and `results_ref`,
validates the project, and writes atomically. The persisted entry is
snake_case; you pass the camelCase tool parameters.

- `outcome` — your judgment: `positive` / `negative` / `partial` / `error`.
- `resultsExamined` — how many results you actually triaged (0 for a nil
  search).
- `resultsAvailable` — the total hit count the tool reported, or null.
- `notes` — a one-line human summary of what the search returned.
- `externalSite` — for an external-site search, `{ site, urlGenerated,
  captureReceived, captureFilename }`. The tool maps this to the persisted
  `external_site` object.

## When record-extraction writes log entries

record-extraction writes a log entry **only** when processing a
record that was not produced by search-records or
search-external-sites — e.g., a user-provided PDF uploaded directly.
When a search skill already logged the search, link to that log
entry by setting `log_entry_id` on each new source and assertion,
rather than creating a duplicate log entry.
