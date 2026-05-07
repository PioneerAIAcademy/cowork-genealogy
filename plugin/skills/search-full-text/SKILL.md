---
name: search-full-text
description: Executes full-text searches against FamilySearch AI-transcribed
  historical document images per the research plan. Uses the fulltext_search
  MCP tool with Lucene-style operators (+/-/"…"/?/*). Uniquely surfaces
  witnesses, neighbors, heirs, sureties, appraisers, and other non-principal
  mentions that indexed search misses. Logs every search including nil
  results and passes promising records to record-extraction. GPS Step 1 —
  Reasonably Exhaustive Research (full-text execution). Use when the user
  says "full-text search", "search for witnesses mentioning [person]",
  "search newspapers for [person]", "find [person] in deeds/probate/court
  minutes", when a plan item targets FamilySearch full-text search, when
  looking for FAN club (Family/Associates/Neighbors) mentions, when
  searching pre-1850 US records with thin indexed coverage, or when
  searching Latin American notarial records. Do NOT use when the target
  is a structured indexed search by person attributes (use search-records),
  when the target is Ancestry, MyHeritage, FindMyPast, FindAGrave, or
  Newspapers.com (use search-external-sites), when the user wants to plan
  what to search (use research-plan), or when the user wants to analyze a
  record already found (use record-extraction).
---

# Search Full-Text

Executes full-text searches against FamilySearch's AI-transcribed
historical document images. FTS searches the raw transcript text of
~1.95 billion document images — a fundamentally different search
surface than indexed Records search. FTS finds people mentioned
anywhere in a document (witnesses, neighbors, heirs, appraisers),
not just indexed principals.

This skill is the FTS counterpart to search-records (indexed search)
and search-external-sites (non-FamilySearch repositories).

## MCP tool

This skill uses one search tool:

| MCP tool | Purpose |
|----------|---------|
| `fulltext_search` | Full-text search of AI-transcribed document images using Lucene-style operators |

Also uses:
| `match_persons` | Results triage — scoring how well a search result matches the research subject |

## Key differences from indexed Records search

FTS and indexed search are completely different systems:

| | Indexed (`record_search`) | Full-text (`fulltext_search`) |
|---|---|---|
| What's searched | Structured fields (name, date, place) | Raw transcript text of document images |
| Fuzzy matching | Auto-applies nicknames, phonetic variants, Soundex | **None.** Exact text matching only. |
| Abbreviation expansion | Wm→William, Jno→John automatic | **Not expanded.** Must search Wm and William separately. |
| Operators | `q.*` parameters with `.exact=on` modifier | `+` (require), `-` (exclude), `"…"` (phrase), `?`/`*` (wildcards) |
| Default behavior | Fuzzy matching on all terms | **OR** — at least one term must appear |
| Unique strength | Finding indexed principals | Finding non-principal mentions (witnesses, neighbors, heirs) |

## Steps

### 1. Identify the plan item to execute

Read `research.json` `plans[]` and find the next plan item with
`status: "planned"` that targets full-text search. If the user
specifies a particular search, match it to a plan item or create
an ad-hoc search (with `plan_item_id: null` in the log).

### 2. Determine the search approach

Read `references/search-strategies.md` for the full strategy
catalog. Key decision: what kind of FTS search is this?

| Research goal | Query approach |
|---|---|
| Find person as witness/appraiser/heir | `+Surname` in Name field, place filter after |
| Find person in narrative records (deeds, probate, court) | `+GivenName +Surname` in Keywords, place filter after |
| FAN cluster search | `+TargetSurname +AssociateSurname` in Keywords |
| Kinship determination | `+Surname +"daughter of"` or `+Surname +"my beloved wife"` |
| Migration tracing | `+Surname` with successive place filters |
| Enslaved persons | Enslaver surname + slavery keywords (see strategies reference) |

### 3. Construct the search query

Read `references/query-syntax.md` for operator rules.

**Critical rules:**
- **Always use `+` to require terms.** Default is OR, which returns
  millions of irrelevant results.
- **Search by name only first.** Do NOT include place in the initial
  query — place matches collection metadata and causes false
  positives. Apply place as a post-search filter.
- **Abbreviations must be searched explicitly.** FTS does not
  auto-expand. If searching for William, also search Wm. If
  searching for Thomas, also search Thos.
- **Phrases tolerate one intervening word.** `"Ezekiel Pearce"`
  also matches "Ezekiel John Pearce."
- **Wildcards:** `?` (one char), `*` (zero or more). Cannot appear
  inside quotes or as first character. Minimum 3 literal characters.

**Example queries:**

```
# Basic person search (require both terms)
fulltext_search({ keywords: "+Patrick +Flynn" })

# Phrase search
fulltext_search({ keywords: '+"Patrick Flynn"' })

# Person + boilerplate phrase (will search)
fulltext_search({ keywords: '+"Thomas Flynn" +"Last Will and Testament"' })

# FAN cluster (target + associate)
fulltext_search({ keywords: "+Flynn +Brennan", place_filter: "Pennsylvania" })

# Wildcard for HTR errors
fulltext_search({ keywords: "+Fl?nn +Patrick" })

# Abbreviation variant (separate query)
fulltext_search({ keywords: "+Wm +Flynn" })
```

**When searching a specific volume:** Use the DGS (Image Group
Number) field to restrict to one digitized volume, then add keywords.

### 4. Execute and iterate

Call `fulltext_search` with the constructed query.

**Decision rules by hit count:**
- **0 results** → See step 7 (handle nil results)
- **1–50 results** → Review all
- **50–500 results** → Add Year/RecordType filter
- **>500 results** → Add a second required term (`+associate`,
  `+occupation`, `+landmark`) or add place filter

**If searching a collection-specific quirk:** Read
`references/transcription-quirks.md` for HTR error patterns,
era-specific handwriting issues, and coverage gaps.

### 5. Triage results

For each result, evaluate match quality:

**Quick triage:**
- Does the target name appear in the transcript snippet?
- Is the name in the right context (witness signature, will clause,
  deed party) or a false positive (cross-column alignment, place
  name matching)?
- Is the place and approximate date consistent?

**Present triage to the user:** List the top results with match
quality and context (what role the person plays in the document).
Let the user confirm which records to examine in detail.

For promising results with enough structured data, call
`match_persons` for quantitative scoring.

### 6. Write the log entry

**Every search gets a log entry — no exceptions.** Follow the
research-log-protocol (see `references/research-log-protocol.md`).

```json
{
  "id": "log_008",
  "plan_item_id": "pli_010",
  "performed": "2026-05-04T16:00:00Z",
  "tool": "fulltext_search",
  "query": {
    "keywords": "+Flynn +\"Last Will and Testament\"",
    "place_filter": "Schuylkill County, Pennsylvania",
    "year_filter": "1870-1890"
  },
  "outcome": "positive",
  "results_examined": 5,
  "captured_source_ids": [],
  "produced_assertion_ids": [],
  "notes": "Found Thomas Flynn's will (1881) naming wife Mary and children Patrick, John, Margaret. Also found Flynn as witness on two unrelated wills.",
  "external_site": null
}
```

### 7. Handle nil results

When a search returns no results:
1. Log the nil result with `outcome: "negative"`
2. **Before declaring the search negative, iterate through
   variants.** Read `references/search-strategies.md` for the
   full decision tree. Priority order:
   - Drop place from query (use filter only)
   - Try Keywords field instead of Name field (or vice versa)
   - Try abbreviations (Wm, Jno, Jas, Thos, Chas)
   - Try wildcards on likely-misread letters (see
     `references/transcription-quirks.md` for HTR error patterns)
   - Try last-name-first phrase: `"Surname Given"`
   - Try maiden vs. married surname for women
   - Try DGS-scoped search of the most likely volume
   - Try boilerplate phrase + place filter only
3. Verify the target collection exists in FTS (coverage is not
   complete — ~6,665 searchable collections as of mid-2026)
4. Consider whether the absence is analytically meaningful
   (negative evidence). Note in the log.
5. Check for fallback plan items. If none, suggest returning to
   research-plan or trying indexed search (search-records) instead.

### 8. Queue cross-reference searches

When reading FTS results, automatically queue sub-searches for:
- Every named non-target person (witnesses, executors, appraisers,
  heirs, neighbors)
- Distinctive landmarks or property descriptions
- Slaveholder ↔ enslaved name pairs
- Powers of attorney → search the named agent in the other county
- Marginal annotations referencing later transactions

Present these as suggestions: "This deed names John Brennan as a
witness. Would you like me to search for other documents mentioning
Brennan in this county?"

### 9. Pass records to extraction

For each promising record, invoke record-extraction to process it.
FTS results include transcript text — pass this context along.

### 10. Present results

After completing a search (or a batch of searches from the plan):
- Summarize what was searched and what was found
- Highlight non-principal mentions (witnesses, neighbors) — these
  are FTS's unique value
- Show the log entries created
- Show plan progress
- Suggest next steps:
  - More plan items → "Shall I continue with the next search?"
  - Cross-reference opportunities → "I found 3 witnesses. Search
    for them?"
  - All plan items done → "All planned searches are complete."
  - No results → "No matches in FTS. Would you like to try indexed
    search (search-records) or re-plan?"

## When to use FTS vs. indexed Records search

| Scenario | Use |
|---|---|
| Known name + indexed event (BMD, census, vital) | search-records |
| Person as witness, neighbor, heir, surety, appraiser | **search-full-text** |
| Pre-1850 US with thin indexed coverage | **search-full-text first** |
| Latin American notarial protocolos | **search-full-text strongly preferred** |
| Narrative paragraph records (court minutes, meetings) | **search-full-text** |
| Burned-county workaround (search adjacent counties) | **search-full-text** |
| Newspapers, obituaries | **search-full-text** |
| What records exist for a place/time | Catalog browse, then search-full-text to scan specific volumes |

## Important rules

- **Log every search.** The research log is the GPS audit trail.
- **Log nil results explicitly.** `outcome: "negative"` is a
  finding, not a failure.
- **Always use `+` to require terms.** Forgetting `+` produces
  OR-mode results numbering in the millions.
- **Search name first, filter place after.** Putting place in the
  initial query causes false positives from metadata matching.
- **Search abbreviations explicitly.** FTS does not auto-expand
  Wm→William. Each abbreviation is a separate search.
- **Try name variants.** If the exact name returns nil, try
  abbreviations, nicknames, and wildcard patterns before declaring
  the search negative.
- **Let the user confirm before extraction.** Show triage results
  and let the user decide which records to examine.
- **Never fabricate results.** If the MCP tool returns nothing,
  report nothing. Do not invent records, transcripts, or citations.
- **Today's nil may be tomorrow's hit.** FTS coverage grows by
  ~4–6 collections per week. Log exact queries with timestamps
  for periodic re-checking.
