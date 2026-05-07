---
name: search-records
description: Executes searches against FamilySearch historical records per
  the research plan. Routes to the correct MCP search tool based on record
  type, triages results using match scoring, logs every search including nil
  results, and passes promising records to record-extraction. GPS Step 1 —
  Reasonably Exhaustive Research (execution phase). Use when the user says
  "search for [person]", "find [person] in [record type]", "execute the
  plan", "run the next search", "search FamilySearch", or when a plan item
  targets a FamilySearch repository. Do NOT use when the target is
  Ancestry, MyHeritage, FindMyPast, FindAGrave, or Newspapers.com (use
  search-external-sites), when the user wants to plan what to search (use
  research-plan), or when the user wants to analyze a record already found
  (use record-extraction).
---

# Search Records

Executes searches against FamilySearch per the research plan. This
skill is the bridge between planning (research-plan) and analysis
(record-extraction) — it calls MCP search tools, evaluates results,
logs everything, and feeds promising records into the extraction
pipeline.

## MCP tools and routing

This skill uses four search tools. Route based on the plan item's
`record_type`:

| Plan item record_type | MCP tool | When to use |
|----------------------|----------|-------------|
| `census`, `vital_record`, `probate`, `land`, `church`, `military`, `immigration`, `court`, `tax` | `record_search` | Structured searches by person attributes (name, dates, places, relationships). The primary search tool for most record types |
| `newspaper`, or any witness/FAN mention search | — | **Delegate to search-full-text skill.** FTS has different query syntax and strategies. Use full-text-search when: searching for obituaries/marriage announcements, searching for a person mentioned as witness/neighbor/heir/surety/appraiser, pre-1850 US research with thin indexed coverage, Latin American notarial records, or narrative paragraph records (court minutes, meetings) |
| `cemetery` | `record_search` | FamilySearch indexes some cemetery records. Also consider suggesting search-external-sites for FindAGrave |
| Any record type (image browsing) | `image_search` | When the plan calls for browsing images by metadata (date, place, collection) rather than searching by person. Used for unindexed collections |
| (FamilySearch tree lookup) | `tree_read` | When checking if a person already exists in the FamilySearch tree with additional data. Not a historical record search |

Additional tool:
| `match_persons` | Results triage — scoring how well a search result matches the research subject |

## Steps

### 1. Identify the plan item to execute

Read `research.json` `plans[]` and find the next plan item with
`status: "planned"` in the active plan for the current question.
If the user specifies a particular search, match it to a plan item
or create an ad-hoc search (with `plan_item_id: null` in the log).

### 2. Construct the search query

Build search parameters from:
- The plan item (record_type, jurisdiction, date_range, repository)
- Known facts about the subject (from tree.gedcomx.json and
  research.json assertions)

**For `record_search` queries:** Read `references/name-search-mechanics.md`
for wildcard rules, fuzzy matching behavior, and indexing error
patterns. Read `references/place-date-mechanics.md` for place
hierarchy expansion, date range behavior, and relationship parameters.
If searching a specific collection family (US census, English parish,
Mexico civil, etc.), read `references/collection-quirks.md` for
collection-specific compensation strategies.

**For `fulltext_search` queries:** Delegate to the full-text-search
skill. FTS uses completely different query syntax (`+`/`-`/`"…"`
operators) and search strategies (name-only-then-filter, explicit
abbreviation queries, boilerplate phrase searches).

**Search parameter guidance (`record_search`):**

| Parameter | Source | Notes |
|-----------|--------|-------|
| Surname | tree.gedcomx.json person name | Try exact first, then fuzzy variants |
| Given name | tree.gedcomx.json person name | Use first name only — middle names often absent in records |
| Birth year | Assertions or facts | Use a range (±5 years) for census searches |
| Birth place | Assertions or facts | Use the broadest useful level (state, not city) |
| Residence | Plan item jurisdiction | The primary geographic filter |
| Collection | From `place_collections` output or plan rationale | Narrow to a specific collection when possible |
| Relationships | Known spouse/parent names | Add when available to improve result quality |

**Name variant strategy:** If the exact name returns few results,
try:
- Phonetic variants (Flynn → Flyn, Flinn, Flinn)
- Spelling variants (Patrick → Patric, Paddy, Pat)
- Abbreviations (William → Wm, Thomas → Thos)
- Initials (J. Smith)
- Maiden names for married women
- Wildcard on suspect letters (Sm?th, ?ones) — see
  `references/name-search-mechanics.md` for common misread patterns

### 3. Execute the search

Call the appropriate MCP tool:

```
record_search({
  surname: "Flynn",
  givenName: "Patrick",
  birthYear: 1845,
  birthPlace: "Pennsylvania",
  residencePlace: "Schuylkill County, Pennsylvania",
  residenceYear: 1850
})
```

**If the search fails due to authentication:** Instruct the user
to log in: "The search requires FamilySearch authentication. Please
ask me to log you in, or type `login`."

### 4. Triage results

**Default strategy: broad-to-narrow.** Start with surname + place
(state-level) + wide year range. Narrow by adding collection filter,
then relationship names, then tighter place/date. Use narrow-to-broad
only when you have high-confidence facts and expect a specific record.

**Decision rules by hit count:**
- **>5,000 hits** → narrow by collection first, then place, then
  add spouse/parent
- **100–5,000 hits** → add collection filter and sex; add parent name
- **10–100 hits** → evaluate top results directly
- **0 hits** → see step 8 (handle nil results)

For each result returned, evaluate match quality:

**Quick triage (by eye):**
- Name: Does the name match or is it a plausible variant?
- Age/birth year: Within ±3 years of expected?
- Place: Same county/state?
- Gender: Correct?

Discard results that clearly don't match (wrong gender, wrong
decade, wrong state).

**Quantitative triage (match_persons):** For promising results
with enough structured data, call `match_persons` to get a
numerical score:

```
match_persons({
  person1: { name: "Patrick Flynn", birthYear: 1845, birthPlace: "Pennsylvania" },
  person2: { name: "Patrick Flyn", birthYear: 1844, birthPlace: "Pennsylvania" }
})
```

Use the score to rank results:
- Score > 0.7: Strong match — prioritize for extraction
- Score 0.4–0.7: Possible match — examine the record details
- Score < 0.4: Weak match — skip unless nothing better exists

**Present triage to the user:** List the top results with match
quality. Let the user confirm which records to examine in detail
before proceeding to extraction.

### 5. Write the log entry

**Every search gets a log entry — no exceptions.** Even nil results.
Follow the research-log-protocol (see `references/research-log-protocol.md`).

```json
{
  "id": "log_006",
  "plan_item_id": "pli_007",
  "performed": "2026-05-04T14:30:00Z",
  "tool": "record_search",
  "query": {
    "surname": "Flynn",
    "givenName": "Thomas",
    "deathYear": 1881,
    "deathPlace": "Schuylkill County, Pennsylvania",
    "collection": "Pennsylvania Probate Records"
  },
  "outcome": "positive",
  "results_examined": 3,
  "captured_source_ids": [],
  "produced_assertion_ids": [],
  "notes": "Found 3 Flynn probate entries. One matches: Thomas Flynn, will dated 1881. Two others are different Thomas Flynns (wrong county, wrong dates).",
  "external_site": null
}
```

**outcome values:**
- `positive`: Matching results found
- `negative`: No matching results. Record this explicitly — nil
  results are findings, not omissions
- `partial`: Some results found but incomplete (e.g., index entry
  exists but image is unavailable)
- `error`: Search failed (authentication, server error, etc.)

Update `captured_source_ids` and `produced_assertion_ids` AFTER
record-extraction processes the records.

### 6. Update plan item status

Set the plan item's `status` to:
- `completed`: Search executed regardless of outcome
- `skipped`: The search was determined to be unnecessary (e.g.,
  the question was already answered by a prior search)

### 7. Pass records to extraction

For each promising record, Claude holds the record data in context
and invokes record-extraction to process it. The handoff is
context-based — there is no file queue.

If the record is an index entry (name, date, place only), call
`record_read` to get the full record before extraction:

```
record_read({ recordId: "ark:/61903/1:1:MXYZ" })
```

If the record is an image, call `image_search` to find the image
and then let record-extraction handle transcription via
`image_transcribe`.

### 8. Handle nil results

When a search returns no results:
1. Log the nil result with `outcome: "negative"`
2. **Before declaring the search negative, iterate through search
   strategy levers.** Read `references/search-strategy-levers.md`
   for the full lever catalog. Priority order for `record_search`:
   - Broaden year range to ±10
   - Drop given name (search surname + place + date)
   - Wildcard the surname (see `references/name-search-mechanics.md`
     for common misread patterns)
   - Switch event type to Any
   - Broaden place by one jurisdiction level
   - Switch from principal to spouse / parent / child
3. Consider whether the absence is analytically meaningful
   (negative evidence). If the subject should have appeared in
   this record but didn't, note this in the log and suggest
   record-extraction create a negative assertion.
4. Check if a fallback plan item exists (`fallback_for` on the
   next plan item). If so, proceed to the fallback.
5. If no fallback and the question remains open, suggest returning
   to research-plan for re-planning or to question-selection for
   the next question.

### 9. Present results

After completing a search (or a batch of searches from the plan):
- Summarize what was searched and what was found
- Show the log entries created
- List records passed to extraction (or explain why no records
  were extracted)
- Show plan progress: "3 of 5 plan items completed"
- Suggest next steps:
  - More plan items to execute → "Shall I continue with the next
    search?"
  - All plan items done → "All planned searches are complete.
    Would you like me to evaluate whether the research is
    exhaustive?" (question-selection mode 2)
  - No results → "No matching records found. Would you like me
    to re-plan with different parameters or adjacent
    jurisdictions?" (research-plan)

## Searching multiple repositories

When the plan includes the same record type across multiple
repositories (e.g., probate on FamilySearch and probate on Ancestry),
this skill handles the FamilySearch searches. Plan items targeting
Ancestry, MyHeritage, FindMyPast, FindAGrave, or Newspapers.com
should be directed to search-external-sites.

If the user says "search all repositories," execute the FamilySearch
items and then suggest: "The FamilySearch searches are complete.
The plan also includes searches on [Ancestry/etc.] — would you like
me to generate search URLs for those?" (triggering
search-external-sites).

## Important rules

- **Log every search.** The research log is the GPS audit trail.
  A search without a log entry is a search that didn't happen.
- **Log nil results explicitly.** `outcome: "negative"` is a
  finding, not a failure.
- **Don't skip plan items silently.** If you decide a search isn't
  worth executing, set status to `skipped` and explain why in the
  log notes.
- **Try name variants.** If the exact name returns nil, try phonetic
  and spelling variants before declaring the search negative.
- **Let the user confirm before extraction.** Don't silently extract
  every result. Show the triage results and let the user decide
  which records to examine in detail.
- **Never fabricate results.** If the MCP tool returns nothing,
  report nothing. Do not invent records, URLs, or person data.
