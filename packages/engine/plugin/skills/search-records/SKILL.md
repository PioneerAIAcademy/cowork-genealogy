---
name: search-records
model: claude-sonnet-4-6
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
allowed-tools:
  - record_search
  - record_read
  - same_person
  - source_attachments
  - research_log_append
  - research_append
---

# Search Records

**⚠ ROUTE CHECK — answer ALL three gates before ANY tool call or file read:**

**Gate 1 — External site?**
If the user names **Ancestry, MyHeritage, FindMyPast, FindAGrave, Newspapers.com, or any non-FamilySearch site** → call `Skill("search-external-sites")` as your ONLY action and stop.

❌ After this routing call, do NOT:
- Construct any URL or search link
- Call record_search or any MCP tool
- Write or read research.json
- Compute search parameters or display them
- Provide research guidance or next-step commentary

The user's request is now fully in search-external-sites' hands. Your job is done the moment you call the Skill.

**Gate 2 — Planning question?**
> **"Is the user asking me to run a specific FamilySearch search RIGHT NOW?"**
> - **YES** (e.g. "Search the 1850 census for Patrick", "Execute pli_001") → proceed below.
> - **NO** (e.g. "What should I search for?", "What next?", "What records exist?", "How do I find X?", "What should I search for next to find Patrick Flynn's parents?") → call `Skill("research-plan")` as your ONLY tool call and stop.

**Do NOT call `Skill("project-status")`.** That tool gives project context but does NOT answer planning questions — research-plan does.

❌ **WRONG** — do not do this for planning questions:
> Call `Skill("project-status")` → read project → answer with research recommendations

✅ **CORRECT** — do this instead:
> Call `Skill("research-plan")` with no prior tool calls → stop

research-plan handles its own project reading. You do not need to read the project first.

**Gate 3 — Inline record to analyze?**
- If the user wants to **analyze a record already in hand** → call `Skill("record-extraction")` as your ONLY action and stop.

❌ After this routing call, do NOT add research significance commentary, next-step recommendations, person-linking suggestions, or any genealogical interpretation. A one-line acknowledgment is the maximum permitted text. record-extraction handles all analysis.

---

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Executes searches against FamilySearch per the research plan. This
skill is the bridge between planning (research-plan) and analysis
(record-extraction) — it calls MCP search tools, evaluates results,
logs everything, and feeds promising records into the extraction
pipeline.

## GPS Grounding

This skill implements GPS Element 1 (Reasonably Exhaustive Research)
at the execution layer. Core operating principles:

- **Collect impartially.** Record evidence that contradicts the
  hypothesis with the same care as evidence that supports it.
- **Index entries are pointers, not records.** Always attempt to
  locate the underlying original before extraction.
- **Negative results are findings.** Log them with the same detail
  as positive results.
- **Evaluate the database before interpreting results.** Read the
  collection description before searching.

On demand, load these references for detailed guidance:
- `references/data-collection-standards.md` — source classification,
  information quality, evidence types
- `references/research-log-standards.md` — nine essential log
  elements, completeness criteria
- `references/validation-protocol.md` — genealogical plausibility
  checks (`check-warnings`) after a write

## MCP tools and routing

This skill uses three tools. Route searches based on the plan item's
`record_type`:

| Plan item record_type | MCP tool | When to use |
|----------------------|----------|-------------|
| `census`, `vital_record`, `probate`, `land`, `church`, `military`, `immigration`, `court`, `tax` | `record_search` | Structured searches by person attributes (name, dates, places, relationships). The primary search tool for most record types |
| `newspaper`, or any witness/FAN mention search | — | **Delegate to search-full-text skill.** FTS has different query syntax and strategies. Use full-text-search when: searching for obituaries/marriage announcements, searching for a person mentioned as witness/neighbor/heir/surety/appraiser, pre-1850 US research with thin indexed coverage, Latin American notarial records, or narrative paragraph records (court minutes, meetings) |
| `cemetery` | `record_search` | FamilySearch indexes some cemetery records. Also consider suggesting search-external-sites for FindAGrave |

Additional tools:
| `same_person` | Results triage — scoring how well a search result matches the research subject |
| `source_attachments` | Attachment check — which results are already attached to tree persons |

## Steps

### Step 0: Scope check — BEFORE FILES OR TOOLS

**Complete this check BEFORE reading research.json, tree.gedcomx.json,
or calling any MCP tool (record_search, record_read, same_person,
source_attachments). Do NOT call any MCP tool before this check.**

Read only the user's message. If ANY condition below matches, call the
Skill tool immediately and stop:

| Condition | Call immediately |
|-----------|-----------------|
| User names a site other than familysearch.org: Ancestry, MyHeritage, FindMyPast, FindAGrave, **Newspapers.com**, or any other commercial site | `Skill("search-external-sites")` |
| User asks **what** to search, **which** records to check, **whether** the research is complete, **how to find** someone, or **what to do next** — any question about research strategy rather than executing an already-planned search | `Skill("research-plan")` |
| User wants to analyze, extract from, or interpret a record already in hand | `Skill("record-extraction")` |

**The key test: is the user asking you to EXECUTE a search or to DECIDE what to search?**
- "Search for X" / "Find X in Y records" / "Execute pli_001" → execute (proceed to Step 1)
- "What should I search for?" / "What next?" / "How do I find X?" / "Is the research done?" → call `Skill("research-plan")` NOW

**CRITICAL — do NOT call Skill("project-status") before routing.** Calling project-status to get context before answering a planning question is the wrong action. research-plan handles its own project reading. Call `Skill("research-plan")` immediately with no prior tool calls.

**When in doubt, route.** If the user's message could be asking for advice or strategy, treat it as a planning question and call `Skill("research-plan")` immediately.

**After invoking the Skill tool, stop.** Do not read any files, do not
call any MCP tools, do not provide supplementary information. The routed
skill will handle the request.

If none of the above applies, proceed to Step 1.

### Step 1: Identify the plan item to execute

Find the next plan item with `status: "planned"` in the active plan for
the current question. If you already hold the active plan and its item
statuses in context from the same run (e.g. research-plan just wrote it
and you have its compact return), work from that — don't re-read
`research.json` "to be safe"; the writer tools validate the whole project
on every write, so the in-context view can't be silently stale. Re-read
`research.json` `plans[]` when you're entering this skill cold, or when a
sub-skill or the user changed the plan since you last saw it. If the user
specifies a particular search, match it to a plan item or create an
ad-hoc search (with `plan_item_id: null` in the log).

### 2. Construct the search query

**Choose a search strategy based on the situation:**

- **"Less is more" (broad start):** Begin with minimal criteria —
  surname plus broad location, or surname plus wide date range.
  Best when the name is uncommon, when you are unsure of details,
  or when indexing errors are likely. This avoids missing results
  that were indexed under variant spellings or with errors.
- **"Kitchen sink" (narrow start):** Enter as many known details
  as possible to filter a common name. Best when the surname is
  very common (Smith, Jones, Johnson) and you need to separate
  your subject from dozens of others.

The default for this skill is **broad-to-narrow** ("less is more"
first, then add filters). Use narrow-to-broad only when you have
high-confidence facts and expect to retrieve a specific known record.

Build search parameters from:
- The plan item (record_type, jurisdiction, date_range, repository)
- Known facts about the subject (from tree.gedcomx.json and
  research.json assertions)

**Anchor rule:** Every `record_search` query must include either
`surname` or `recordCountry`. The tool rejects queries without one
of these anchors — the upstream search service throttles anchor-less
queries because they're too expensive. If neither is known, fall
back to a broader plan item or skip this search.

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
| `surname` | tree.gedcomx.json person name | Try exact first, then fuzzy variants. Anchor — required if `recordCountry` is absent. |
| `givenName` | tree.gedcomx.json person name | Use first name only — middle names often absent in records |
| `birthYearFrom` / `birthYearTo` | Assertions or facts | Year range, both required when filtering by birth year (±5 years is typical for census searches) |
| `birthPlace` | Assertions or facts | Use the broadest useful level (state, not city) |
| `residenceYearFrom` / `residenceYearTo` | Plan item year | Census-style anchor. Range pair — set both to the same year for a single-census search |
| `residencePlace` | Plan item jurisdiction | The primary geographic filter |
| `recordCountry` | Plan item jurisdiction | Anchor — required if `surname` is absent |
| `collectionId` | From `collections_search` output or plan rationale | Narrow to a specific collection when possible |
| `spouseGivenName` / `fatherSurname` / etc. | Known spouse/parent names | Add when available to improve result quality |

**Name variant strategy:** If the exact name returns few results,
try:
- Phonetic variants (Flynn → Flyn, Flinn, Flinn)
- Spelling variants (Patrick → Patric, Paddy, Pat)
- Abbreviations (William → Wm, Thomas → Thos)
- Initials (J. Smith)
- Maiden names for married women
- Variant spellings (Sm_th, ?ones) — see
  `references/name-search-mechanics.md` for common misread patterns
  **Do NOT use wildcard characters (`*`, `?`, `%`) in `record_search` parameters.** The FamilySearch API does not support wildcards in structured field searches. Use explicit spelling variants instead (e.g., Flyn, Flinn, not Fl*nn).

**Always keep givenName in variant searches.** Do not drop givenName
to a surname-only query (e.g., `{surname: "Flynn"}` alone) — this
broadens results to all Flynns of any first name and makes triage
impossible. Keep both surname and givenName on every retry; change the
spelling of one or both rather than removing givenName entirely.

### 3. Execute the search

Call the appropriate MCP tool. **Always pass `projectPath`** (the
absolute path of the project directory you are operating in) so the
tool stages its raw results host-side and returns a `staged.resultsRef`
handle — you hand that to `research_log_append` in Step 5 to retain the
results without re-serializing the payload yourself:

```
record_search({
  surname: "Flynn",
  givenName: "Patrick",
  birthYearFrom: 1843,
  birthYearTo: 1847,
  birthPlace: "Pennsylvania",
  residencePlace: "Schuylkill County, Pennsylvania",
  residenceYearFrom: 1850,
  residenceYearTo: 1850,
  projectPath: "<absolute-path-to-project-directory>"
})
```

The response carries the full `results[]` for triage plus a `staged`
field: `{ resultsRef, returnedCount }` on a hit, or `null` for a nil
search. Hold `staged.resultsRef` for the log call in Step 5.

**If the search fails due to authentication:** Instruct the user
to log in: "The search requires FamilySearch authentication. Please
ask me to log you in, or type `login`."

### 4. Triage results

**Decision rules by hit count:**
- **>5,000 hits** → narrow by collection, then place, then
  spouse/parent. See `references/search-strategy-levers.md`.
- **100–5,000 hits** → add collection filter and sex; add parent name
- **10–100 hits** → evaluate top results directly
- **0 hits** → see step 8 (handle nil results)

**Quick triage (by eye):** For each result, check name match,
age/birth year (within ±3), place (same county/state), and gender.
Discard obvious mismatches (wrong gender, wrong decade, wrong state).

**Sanity-check the collection.** Every result carries the collection
it came from (e.g., `collectionId` plus a human title like "United
States Census, 1850"). Verify the returned collection actually
answers the question you asked: a search for the 1870 census that
returns a 1850-collection result is **not a 1870 finding** — it's a
near-miss the search engine surfaced, and treating it as a positive
result for the original query would be a fabrication. When the
returned collection doesn't match the query's stated year /
jurisdiction / record type, either explain the mismatch and triage
the result honestly, or log the search as effectively negative for
the asked-for collection and propose a follow-up.

**Quantitative triage:** Call `same_person` for every result that
could potentially match the research subject — not just obvious
strong matches. Near-matches, variant spellings, and slightly wrong
ages all benefit from a numerical score; the tool distinguishes a
genuine candidate from a coincidental name match.

**How to call `same_person`:** Compare each search result against the
research subject from `tree.gedcomx.json` (NOT against another search
result). Pass:
- `gedcomx1`: the result's `gedcomx` field (from record_search output)
- `primaryId1`: the result's `primaryId` field (NOT `personId` or `arkUrl`)
- `gedcomx2`: the research subject's section from `tree.gedcomx.json`
- `primaryId2`: the research subject's `id` in `tree.gedcomx.json`
  (e.g., `"I1"` for Patrick Flynn)

Score thresholds:
- Score > 0.7: Strong match — prioritize for extraction
- Score 0.4–0.7: Possible match — examine details; flag as needs-review
- Score < 0.4: Weak match — skip unless nothing better exists

**Important:** A low `same_person` score is one data point — not
grounds to dismiss a result on its own. Always note the reason for
dismissal in the log (wrong age, wrong county, wrong given name, etc.)
alongside the score.

**Even a high `same_person` score requires a logical cross-check.** When the score is ≥0.7, verify the record details make sense before accepting the match:
- Check the person's role in the record (e.g., Head of Household). A 5-year-old cannot be Head of Household — flag as a transcription conflict.
- Check the age/birth year against the expected range.
- Flag any logical impossibility as `needs-review` regardless of the numeric score. Score is one input; reason is the final arbiter.

**Attachment check:** After narrowing to promising results, call
`source_attachments({ uris: [recordId1, recordId2, ...] })` to check
whether each record is already attached to a tree person.
- **Attached to the target person** → note in triage ("already
  attached to KWCJ-RN4") and deprioritize for extraction unless the
  user wants to re-examine it.
- **Attached to a different person** → flag as potentially relevant
  ("attached to LTMX-5TM — could be a family member or duplicate").
- **Unattached** → prioritize for extraction — this is new evidence.

**Deduplication:** Multiple index entries may point to the same
underlying record (e.g., same census page indexed in two
collections). Check record identifiers and source details before
treating similar results as independent records.

**Present triage to the user.** List top results with match quality
and attachment status. Let the user confirm which records to examine
before extraction.

### 5. Retain results and write the log entry

**Every search gets a log entry and retains its results — no
exceptions.** Call `research_log_append` once per search. The tool
assigns the `log_` id, stamps the timestamp, finalizes the staged
results into the `results/<log_id>.json` sidecar (counting them itself),
validates the project before persisting, and appends to the tail of
`log[]` atomically — so you never hand-assemble the entry, count
results, or worry about ordering. See `references/research-log-protocol.md`
for the analytical rules (when an outcome is negative, what belongs in
`query`/`notes`).

```
research_log_append({
  projectPath: "<absolute-path-to-project-directory>",
  tool: "record_search",
  planItemId: "pli_007",            // or null for an ad-hoc search
  query: {
    surname: "Flynn",
    givenName: "Thomas",
    deathYearFrom: 1881,
    deathYearTo: 1881,
    deathPlace: "Schuylkill County, Pennsylvania",
    collectionId: 2421317
  },
  outcome: "positive",
  resultsExamined: 3,
  resultsAvailable: 3,              // total hit count the tool reported
  notes: "3 Flynn probate hits; all 3 examined. One matches — Thomas Flynn, will dated 1881; the other two are different Thomas Flynns (wrong county, wrong dates).",
  stagedResultsRef: staged.resultsRef   // from the record_search response
})
```

- `query` — enough detail to reproduce the search.
- `resultsExamined` — how many results you actually triaged.
- `resultsAvailable` — the total hit count the tool reported (or null).
- `notes` — a one-line human summary of what the search returned.
- `stagedResultsRef` — the `staged.resultsRef` from Step 3's
  `record_search` response. **Omit it (or pass null) for a nil search**
  (the search returned zero results, so there is nothing to retain and
  `staged` was `null`).

The tool returns a compact summary — `{ ok: true, logId, resultsRef,
returnedCount, filesWritten, validation }`. Narrate from it ("logged as
log_006; retained 3 results"); do not echo the payload.

**Collection-mismatch.** When the index returns results but from the
wrong collection (e.g., you searched the 1870 census and got 1850
results), that is **not a nil result and not a positive finding for the
asked-for collection.** Call `research_log_append` with:
- `outcome: "partial"` (not `"negative"` — negative means zero results)
- a `notes` line explaining the mismatch (e.g., "Searched 1870 census;
  results returned 1850 collection — not a 1870 finding. Query should be
  retried with explicit 1870 collection filter.")
- still pass `stagedResultsRef` (the results were returned and are worth
  retaining for audit)
- **STOP after confirming the mismatch.** Variant spellings will NOT fix
  a collection mismatch. In your summary, do NOT suggest variant surname
  searches as a next step. Instead, suggest consulting a different source
  (e.g., Ancestry for US census years not well-covered on FamilySearch)
  or adjusting the collection filter.

**outcome values:**
- `positive`: Matching results found
- `negative`: No matching results (this IS a finding)
- `partial`: Results found but incomplete (e.g., image unavailable, or
  collection-mismatch)
- `error`: Search failed (authentication, server error)

**If the call returns `{ ok: false, errors }`:** the tool wrote
nothing. Surface the errors plainly rather than retrying blindly. A
common cause is a **stale `stagedResultsRef`** — staged result files are
pruned after ~24h, so if you searched in an earlier session and only now
log it, the handle may no longer resolve. The fix is cheap: re-run the
`record_search` (Step 3) to re-stage, then call `research_log_append`
with the fresh `staged.resultsRef`.

The log entry is append-only — the tool appends it once and offers no
update or delete. When record-extraction later creates sources and
assertions from this search, it stamps each of them with this entry's
`log_entry_id`. The search-to-output link lives there, not back on the
log entry.

### 6. Update plan item status

Route the plan item's `status` change through `research_append`
(`op: "update"`) — the tool locates the item by id within its parent
plan, validates, and persists atomically:

```
research_append({
  projectPath: "<absolute-path-to-project-directory>",
  section: "plan_items",
  op: "update",
  planId: "pl_002",          // the parent plan's id
  entryId: "pli_007",        // the plan item you executed
  fields: { status: "in_progress" }
})
```

Set the `status` field to:
- `in_progress`: Search executed — work continues downstream in
  record-extraction. Use this whenever you have found records to
  pass on, OR when the search was exhausted with nil results and
  re-planning may still be needed.
- `skipped`: The search was determined to be unnecessary (e.g.,
  the question was already answered by a prior search).

**Do not** set status to `completed` from this skill. `completed`
is set by record-extraction once the results have been fully
analyzed and assertions have been created. Setting it here would
signal to downstream skills that no further work is needed, which
is premature.

If the call returns `{ ok: false, errors }`, surface the errors (e.g.
a stale `entryId`/`planId`) rather than retrying blindly.

### 7. Pass records to extraction

For each promising record, Claude holds the record data in context
and invokes record-extraction to process it. The handoff is
context-based — there is no file queue.

**Hand off the `recordId` explicitly.** Each search result from
`record_search` carries a `recordId` field that record-extraction uses as
the assertion `record_id`. Pass that `recordId` value through in the
handoff (alongside the persona ids you already hold) so record-extraction
does **not** have to recover it by re-running `record_search`. Its exact
format is the validator's concern — it matches `record_id` to the record
by canonical ARK form — so just pass `recordId` straight through; that
lets record-extraction's first `research_append` validate without a
re-search.

**Critical: distinguish index entries from original records.**
Most search results are index entries — derivative sources created
by volunteers or automated systems. They are pointers to originals,
not the records themselves. Before extraction:

1. Determine whether the result is an index entry or a full record.
   Index entries typically contain only name, date, place, and a
   record identifier. Full records contain additional detail
   (household members, witnesses, document text, etc.).
2. If a record ID or ARK is available, call `record_read` to fetch
   the full simplified GEDCOMX before passing to record-extraction.
   This surfaces relationships, additional persons, and fact details
   that the index entry may not include. **Parameter name:** always
   use `recordId` — pass the result's `recordId` field if present,
   otherwise pass its `arkUrl` value (e.g.,
   `record_read({ recordId: result.arkUrl })`). Do NOT use parameter
   names like `arkId`, `ark`, `id`, or `url` — the tool only accepts
   `recordId`.
3. If the full record is unavailable but an image exists, record the
   image's URL or identifier in the log and pass the record to
   record-extraction, which fetches and transcribes the image.
4. If only the index entry is available (no image, no full record),
   flag it in the log notes as "derivative only — original not
   located" so the researcher knows the data has not been verified
   against the original source.

Never treat an index entry as equivalent to examining the original
record. Indexes may contain transcription errors, omit context, or
misattribute relationships.

**Passenger lists (arrival manifests):** When searching for immigration
records, remember that passenger lists record every person aboard —
including infants and young children (ages 0–5) traveling with parents.
When a result matches a parent, examine the full manifest for all
family members listed together. Children's names, ages, and birthplaces
confirm family composition and can resolve parentage questions.

### 8. Handle nil results

When a search returns no results:

1. **Log the nil result** via `research_log_append` with
   `outcome: "negative"` and the exact parameters used. A nil search
   retains nothing — omit `stagedResultsRef` (the `record_search`
   response returned `staged: null`).
2. **Iterate through search strategy levers** before declaring
   the search negative. Read `references/search-strategy-levers.md`
   for the full catalog. Try at least 3 lever variations for
   important plan items. **Log each retry as a separate entry.**
   **NEVER drop given name as a nil search lever.** A surname-only search (e.g., `{surname: "Flynn"}` with no given name) is not a valid escalation step — it broadens to all persons of that surname and makes triage impossible. Keep both surname and given name on every retry.
3. **Stop retrying when:** you have tried all levers in the
   zero-hit escalation priority list (see reference), OR the
   database clearly does not cover the target time/place, OR you
   have exhausted 5+ variations with no results.
4. **Assess whether absence is meaningful.** After exhausting name
   variants and search levers, explicitly evaluate three conditions:
   (a) the record type existed in this jurisdiction at this time,
   (b) the collection is reasonably complete for the period (e.g.,
   the 1850 US census is ~95% indexed — an Irish immigrant with 3
   phonetic surname variants exhausted is meaningful negative evidence),
   (c) the subject should have appeared based on known facts. State
   EACH condition clearly in your final summary. If all three hold,
   note this in the log and suggest record-extraction create a negative
   assertion. If the collection is incomplete or the subject may have
   been absent from the target place at that time, note this as a
   limitation rather than a conclusion.
5. **Distinguish "not found" from "does not exist."** A nil result
   in an online index may mean the record is undigitized, unindexed,
   or indexed under a variant. Note which applies.
   **Zero results is NOT "service unavailability."** If `record_search` returns `totalMatches: 0` with no error, the search completed and found nothing — do not attribute this to service issues. Only cite service problems if the tool returns an explicit error (not a zero-result response).
   **Prior log entries finding the record do NOT override current nil results.** If the research log shows a prior search found the person via different parameters, today's nil with these specific parameters is STILL meaningful — it documents that these particular name variants, spelling combinations, or place filters do not find the record in the current index. Log each nil honestly as evidence of which query shapes fail.
   ❌ WRONG nil reasoning: "Log_001 found Patrick Flynn (ARK MXHY-TP4), so the current nil with the Flinn variant is not meaningful."
   ✅ CORRECT nil reasoning: "Log_001 found Patrick under 'Flynn' spelling. The current nil under 'Flinn' documents that FamilySearch does not alias Flynn→Flinn for this record — both findings stand as independent evidence."
6. Check for fallback plan items (`fallback_for`). If none and the
   question remains open, suggest research-plan for re-planning.

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
    exhaustive?" (research-exhaustiveness)
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

- **Log every search.** Each retry gets its own `research_log_append`
  call. A search without a log entry is a search that didn't happen.
- **Append-only.** `research_log_append` appends to the tail of `log[]`
  and offers no update or delete — the audit trail's chronological order
  is guaranteed by the tool, not by hand.
- **Don't skip plan items silently.** Set status to `skipped` with
  an explanation if you decide not to execute.
- **Let the user confirm before extraction.** Show triage results
  first — don't silently extract every hit.
- **Never fabricate results.** If the MCP tool returns nothing,
  report nothing.
- **No post-write validation needed.** `research_log_append` and
  `research_append` validate-before-persist and write nothing on
  `{ ok: false }`. This skill writes only log entries and plan-item
  status — neither adds assertions, so `check-warnings` does not apply
  here (it runs in the skills that create assertions). See
  `references/validation-protocol.md`.

## Re-invocation behavior

**Writes:** via `research_log_append`, a new entry in the `log` section
of `research.json` (append-only) and its `results/log_NNN.json` sidecar
(the tool finalizes the staged `record_search` payload); via
`research_append`, an update to the `status` field on the corresponding
plan item.

**On repeat invocation:** always appends a new `log_` entry and a new
sidecar — re-running the search is itself a logged event. Updates the
plan item's `status` if applicable.

**Do not duplicate:** `research_log_append` only appends, never modifies
prior `log_` entries, and the tool assigns each `log_` id, so two
consecutive runs of the same query produce two distinct log entries and
two distinct sidecars; that's the append-only contract that makes the
search log auditable.
