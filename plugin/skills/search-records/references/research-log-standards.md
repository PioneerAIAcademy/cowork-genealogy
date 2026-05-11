# Research Log Standards

Reference for maintaining GPS-compliant research logs during
search execution. The research log is the primary audit trail
that proves research was reasonably exhaustive.

## Purpose of the Research Log

The log serves three functions:

1. **Proof of exhaustiveness**: Demonstrates which sources were
   consulted and what was (or was not) found. Without a log,
   claims of thorough research are unverifiable.
2. **Prevention of duplication**: A complete log prevents the
   researcher from repeating searches already performed.
3. **Reproducibility**: Any other researcher should be able to
   recreate the exact search from the log entry.

## Nine Essential Elements

Every log entry must capture these nine elements. An entry
missing any element is incomplete.

| # | Element | What to Record |
|---|---------|----------------|
| 1 | **Date performed** | When the search was executed (ISO timestamp) |
| 2 | **Repository / tool** | Which database, website, or MCP tool was used |
| 3 | **Source citation** | Full identification of the collection or source consulted (collection name, ID, repository) |
| 4 | **Search description** | Exact parameters used: names, dates, places, filters, wildcards. Must be detailed enough to reproduce |
| 5 | **Purpose** | Which research question or plan item this search addresses |
| 6 | **Results** | What was found OR what was NOT found. Both are equally important |
| 7 | **Document identifiers** | Record IDs, ARK identifiers, image numbers, page references for anything located |
| 8 | **Analysis notes** | Interpretation of results — why a match is strong or weak, what the absence means, preliminary assessment |
| 9 | **Follow-up actions** | What needs to happen next: examine original, search variant spelling, check adjacent collection, etc. |

## Mapping to the Log Entry Schema

The `research.json` log entry schema maps to these nine elements:

| Element | Schema field(s) |
|---------|----------------|
| Date performed | `performed` |
| Repository / tool | `tool`, `external_site` |
| Source citation | `query.collection` + tool context |
| Search description | `query` object (all parameters) |
| Purpose | `plan_item_id` (links to plan item with goal) |
| Results | `outcome`, `results_examined`, `notes` |
| Document identifiers | `captured_source_ids` |
| Analysis notes | `notes` |
| Follow-up actions | `notes` (include at end of notes) |

## Rules

### Every search gets logged — no exceptions

If you called a search tool, generated a URL, or browsed images,
log it. This includes:
- Searches that returned zero results
- Searches that returned too many results to evaluate
- Searches abandoned due to authentication errors
- Searches repeated with different parameters (each attempt
  gets its own entry)

### Negative results are findings, not failures

When a search returns no results, record `outcome: "negative"`
with full search parameters. The absence of an expected record
is itself evidence. A log full of negative searches demonstrates
thoroughness — it shows the researcher looked and did not find,
rather than simply not looking.

### Log entries are append-only

Never modify or delete a previous log entry. The log is the
audit trail. If a previous entry contains an error, add a new
entry with a correction note — do not overwrite.

### Search parameters must enable reproduction

The `query` object must contain enough detail that someone could
re-execute the exact same search. Include:
- All name parameters (exact values, not "the subject's name")
- All date parameters (specific years and ranges)
- All place parameters (full place strings)
- Collection IDs or names when filtered
- Whether exact mode was used
- Any wildcards applied

### Link to plan items

Every search driven by a research plan must reference the plan
item via `plan_item_id`. For ad-hoc searches requested by the
user outside the plan, use `plan_item_id: null` and explain
the motivation in `notes`.

## Evaluating Log Completeness

Before claiming research is reasonably exhaustive, review the
log for these indicators:

- Are there entries for every plan item (completed or skipped)?
- Are negative results documented with the same detail as
  positive results?
- Were variant spellings attempted and logged?
- Were multiple jurisdictions searched?
- Were different record types consulted?
- Is every entry detailed enough to reproduce?
- Are follow-up actions either completed or explained?

A log that contains only positive results is a red flag — it
suggests either cherry-picking or incomplete documentation of
the actual search process.
