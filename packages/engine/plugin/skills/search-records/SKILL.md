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

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Executes searches against FamilySearch per the research plan — the bridge between planning (research-plan) and analysis (record-extraction).

## Route check — answer before ANY tool call or file read

| Condition | Action |
|-----------|--------|
| User names a non-FamilySearch site (Ancestry, MyHeritage, FindMyPast, FindAGrave, Newspapers.com, or any other commercial site) | `Skill("search-external-sites")` — stop |
| User asks what to search, which records to check, whether research is complete, how to find someone, or what to do next (any strategy question rather than executing an already-planned search) | `Skill("research-plan")` — stop |
| User wants to analyze, extract from, or interpret a record already in hand | `Skill("record-extraction")` — stop |

**The key test:** is the user asking you to EXECUTE a search or to DECIDE what to search?
- "Search for X" / "Find X in Y records" / "Execute pli_001" → execute (proceed below)
- "What should I search for?" / "What next?" / "How do I find X?" / "Is the research done?" → `Skill("research-plan")` immediately

**CRITICAL — do NOT call `Skill("project-status")` before routing.** research-plan handles its own project reading. Call it with no prior tool calls.

❌ WRONG: Call `Skill("project-status")` → read project → answer with research recommendations  
✅ CORRECT: Call `Skill("research-plan")` with no prior tool calls → stop

After invoking any routed Skill, stop. Do not read files, call MCP tools, or provide supplementary information.

## GPS Grounding

GPS Element 1 (Reasonably Exhaustive Research) — execution layer:

- **Collect impartially.** Record contradicting evidence with the same care as supporting evidence.
- **Index entries are pointers, not records.** Always attempt to locate the underlying original.
- **Negative results are findings.** Log them with the same detail as positive results.
- **Evaluate the database before interpreting results.** Read the collection description before searching.

On demand, load:
- `references/data-collection-standards.md` — source classification, information quality, evidence types
- `references/research-log-standards.md` — nine essential log elements, completeness criteria
- `references/validation-protocol.md` — genealogical plausibility checks (`check-warnings`) after a write

## MCP tools and routing

| Plan item record_type | MCP tool | When to use |
|----------------------|----------|-------------|
| `census`, `vital_record`, `probate`, `land`, `church`, `military`, `immigration`, `court`, `tax` | `record_search` | Structured searches by person attributes |
| `newspaper`, or any witness/FAN mention search | — | **Delegate to search-full-text skill.** Use when: searching obituaries/marriage announcements, searching for a person as witness/neighbor/heir/surety/appraiser, pre-1850 US research with thin indexed coverage, Latin American notarial records, or narrative paragraph records |
| `cemetery` | `record_search` | FamilySearch indexes some cemetery records. Also consider suggesting search-external-sites for FindAGrave |

Additional tools: `same_person` (results triage — match scoring); `source_attachments` (attachment check — which results are already attached to tree persons).

## Steps

### 1. Identify the plan item

Read `research.json` `plans[]` and find the next plan item with `status: "planned"` in the active plan. If the user specifies a particular search, match it to a plan item or create an ad-hoc search (with `plan_item_id: null` in the log).

### 2. Construct the search query

**Choose a search strategy:**

- **"Less is more" (broad start):** Begin with minimal criteria — surname plus broad location, or surname plus wide date range. Best when the name is uncommon, when you are unsure of details, or when indexing errors are likely.
- **"Kitchen sink" (narrow start):** Enter as many known details as possible to filter a common name. Best when the surname is very common (Smith, Jones, Johnson).

The default is **broad-to-narrow**. Use narrow-to-broad only when you have high-confidence facts and expect to retrieve a specific known record.

**Anchor rule:** Every `record_search` query must include either `surname` or `recordCountry`. The tool rejects anchor-less queries. If neither is known, fall back to a broader plan item or skip.

**Search parameter guidance (`record_search`):**

| Parameter | Source | Notes |
|-----------|--------|-------|
| `surname` | tree.gedcomx.json person name | Try exact first, then fuzzy variants. Anchor — required if `recordCountry` is absent. |
| `givenName` | tree.gedcomx.json person name | Use first name only — middle names often absent in records |
| `birthYearFrom` / `birthYearTo` | Assertions or facts | Year range, both required when filtering by birth year (±5 years typical) |
| `birthPlace` | Assertions or facts | Use the broadest useful level (state, not city) |
| `residenceYearFrom` / `residenceYearTo` | Plan item year | Census-style anchor. Set both to the same year for a single-census search |
| `residencePlace` | Plan item jurisdiction | The primary geographic filter |
| `recordCountry` | Plan item jurisdiction | Anchor — required if `surname` is absent |
| `collectionId` | From `collections_search` output or plan rationale | Narrow to a specific collection when possible |
| `spouseGivenName` / `fatherSurname` / etc. | Known spouse/parent names | Add when available to improve result quality |

For wildcard rules and fuzzy matching behavior, read `references/name-search-mechanics.md`. For place hierarchy expansion and date range behavior, read `references/place-date-mechanics.md`. For collection-specific strategies, read `references/collection-quirks.md`.

**Name variant strategy:** If the exact name returns few results, try:
- Phonetic variants (Flynn → Flyn, Flinn)
- Spelling variants (Patrick → Patric, Paddy, Pat)
- Abbreviations (William → Wm, Thomas → Thos)
- Initials (J. Smith)
- Maiden names for married women

**Do NOT use wildcard characters (`*`, `?`, `%`) in `record_search` parameters.** Use explicit spelling variants instead.

**Always keep givenName in variant searches.** Do not drop to a surname-only query — it broadens results to all persons of that surname and makes triage impossible. Keep both surname and givenName on every retry; change the spelling of one or both.

### 3. Execute the search

Call `record_search` with the constructed params plus `projectPath` (the absolute path of the project directory). Passing `projectPath` causes the tool to stage raw results host-side and return a `staged.resultsRef` handle — pass this to `research_log_append` in Step 5.

**If the search fails due to authentication:** Instruct the user to log in: "The search requires FamilySearch authentication. Please ask me to log you in, or type `login`."

### 4. Triage results

**Decision rules by hit count:**
- **>5,000 hits** → narrow by collection, then place, then spouse/parent. See `references/search-strategy-levers.md`.
- **100–5,000 hits** → add collection filter and sex; add parent name
- **10–100 hits** → evaluate top results directly
- **0 hits** → see Step 8 (handle nil results)

**Quick triage (by eye):** For each result, check name match, age/birth year (within ±3), place (same county/state), and gender. Discard obvious mismatches.

**Sanity-check the collection.** Verify the returned collection actually answers the question you asked. A search for the 1870 census that returns a 1850-collection result is not a 1870 finding — it's a near-miss the search engine surfaced. When the returned collection doesn't match the query's stated year/jurisdiction/record type, log as effectively negative for the asked-for collection and propose a follow-up (see collection-mismatch in Step 5).

**Quantitative triage:** Call `same_person` for every result that could potentially match the research subject — not just obvious strong matches.

**How to call `same_person`:** Compare each search result against the research subject from `tree.gedcomx.json` (NOT against another search result). Pass:
- `gedcomx1`: the result's `gedcomx` field (from record_search output)
- `primaryId1`: the result's `primaryId` field (NOT `personId` or `arkUrl`)
- `gedcomx2`: the research subject's section from `tree.gedcomx.json`
- `primaryId2`: the research subject's `id` in `tree.gedcomx.json` (e.g., `"I1"`)

Score thresholds:
- Score > 0.7: Strong match — prioritize for extraction
- Score 0.4–0.7: Possible match — examine details; flag as needs-review
- Score < 0.4: Weak match — skip unless nothing better exists

**A low score is one data point** — not grounds to dismiss a result on its own. Always note the reason for dismissal alongside the score.

**Even a high score requires a logical cross-check.** When the score is ≥0.7:
- Check the person's role in the record (e.g., Head of Household). A 5-year-old cannot be Head of Household — flag as a transcription conflict.
- Check the age/birth year against the expected range.
- Flag any logical impossibility as `needs-review` regardless of score. Score is one input; reason is the final arbiter.

**Attachment check:** After narrowing to promising results, call `source_attachments({ uris: [recordId1, recordId2, ...] })`:
- **Attached to the target person** → note and deprioritize for extraction.
- **Attached to a different person** → flag as potentially relevant.
- **Unattached** → prioritize for extraction — this is new evidence.

**Deduplication:** Multiple index entries may point to the same underlying record. Check identifiers and source details before treating similar results as independent.

**Present triage to the user.** Show top results with match quality and attachment status. Let the user confirm which records to examine before extraction.

### 5. Log the search

Call `research_log_append` once per search — it assigns the next `log_` id, stamps the timestamp, writes the `results/<log_id>.json` sidecar, validates, and **appends** atomically. See `references/research-log-protocol.md` for field-level guidance.

Pass: `projectPath`, `tool`, `planItemId`, `query` (enough detail to reproduce the search), `outcome`, `resultsExamined`, `resultsAvailable`, `notes` (a one-line summary), and `stagedResultsRef` from Step 3. **Omit `stagedResultsRef` (or pass null) for a nil search** — `record_search` returned `staged: null`.

**Append-only — never modify, overwrite, or re-order an existing `log[]` entry.** Each search, including each nil retry, becomes exactly one NEW entry with the next `log_` id; re-running a search is a fresh logged event, not an edit of a prior one. Even if you notice an error in an earlier entry (e.g. a prior misclassification), do NOT edit it — leave every existing entry byte-for-byte intact and append a new entry that notes the correction.

**Sidecar correctness.** Any search that returns one or more results — `outcome: "positive"` **or** a `partial` collection-mismatch — writes a `results/<log_id>.json` sidecar. The sidecar is a JSON object — `{ "returned_count": <n>, "payload": { "results": [ <the records returned> ] } }`, never a bare array — where `returned_count` equals the number of records in `payload.results`. The log entry's `results_ref` points to it and `results_available` matches that count. Only a nil search (zero results) writes no sidecar and leaves `results_ref` null.

**Collection-mismatch:** When results come from the wrong collection (e.g., searched 1870 census, got 1850 results):
- Log with `outcome: "partial"` (not `"negative"` — negative means zero results)
- Explain the mismatch in `notes`
- Still pass `stagedResultsRef`
- **Stop after confirming the mismatch.** Variant spellings will NOT fix a collection mismatch — do not execute them, and do not recommend them as next steps. Suggest a different source or collection filter instead.

**outcome values:**
- `positive`: Matching results found
- `negative`: No matching results (this IS a finding)
- `partial`: Results found but incomplete (e.g., image unavailable, or collection-mismatch)
- `error`: Search failed (authentication, server error)

If the call returns `{ ok: false, errors }`, surface the errors rather than retrying blindly. A common cause is a **stale `stagedResultsRef`** (staged files are pruned after ~24h) — re-run `record_search` to re-stage, then call `research_log_append` with the fresh ref.

Narrate from the tool's summary ("logged as log_006; retained 3 results"); do not echo the payload.

### 6. Update plan item status

Call `research_append` with `section: "plan_items"`, `op: "update"`, `planId`, `entryId`, and `fields: { status: "..." }`:
- `in_progress`: Search executed — work continues downstream in record-extraction. Use whenever records were found to pass on, OR the search was exhausted with nil results and re-planning may be needed.
- `skipped`: The search was determined to be unnecessary.

**Do not** set status to `completed` from this skill — that is set by record-extraction once assertions have been created.

### 7. Pass records to extraction

**Distinguish index entries from original records.** Most search results are index entries — derivative sources that are pointers to originals, not the records themselves.

1. If a record ID or ARK is available, call `record_read` to fetch the full simplified GEDCOMX before passing to record-extraction. **Parameter name:** always use `recordId` — pass the result's `recordId` field if present, otherwise pass its `arkUrl` value (e.g., `record_read({ recordId: result.arkUrl })`). Do NOT use `arkId`, `ark`, `id`, or `url`.
2. If the full record is unavailable but an image exists, record the image URL in the log and pass to record-extraction, which fetches and transcribes.
3. If only the index entry is available, flag it in log notes as "derivative only — original not located."

Never treat an index entry as equivalent to examining the original record.

**Passenger lists:** Passenger lists record every person aboard including infants. When a result matches a parent, examine the full manifest for all family members — children's ages and birthplaces can resolve parentage questions.

### 8. Handle nil results

1. **Log the nil result** via `research_log_append` with `outcome: "negative"` and the exact parameters used. Omit `stagedResultsRef`.
2. **Iterate through search strategy levers** before declaring negative. Read `references/search-strategy-levers.md`. Try at least 3 lever variations for important plan items. **Log each retry as a separate `research_log_append` call immediately after it completes — do not batch log calls at the end.**
   **NEVER drop given name as a nil search lever.** A surname-only search is not a valid escalation step. Keep both surname and given name on every retry.
3. **Stop retrying when:** you have tried all levers in the zero-hit escalation priority list, OR the database clearly does not cover the target time/place, OR you have exhausted 5+ variations.
4. **Assess whether absence is meaningful.** After exhausting variants and levers, explicitly evaluate three conditions:
   (a) the record type existed in this jurisdiction at this time,
   (b) the collection is reasonably complete for the period,
   (c) the subject should have appeared based on known facts.
   State each condition clearly. If all three hold, note in the log and suggest record-extraction create a negative assertion. If the collection is incomplete or the subject may have been absent, note this as a limitation rather than a conclusion.
5. **Distinguish "not found" from "does not exist."** A nil result may mean the record is undigitized, unindexed, or indexed under a variant. Note which applies.
   **Zero results is NOT "service unavailability."** If `record_search` returns `totalMatches: 0` with no error, the search completed — do not attribute this to service issues.
   **Prior log entries finding the record do NOT override current nil results.** A nil with different parameters documents that those query shapes fail. Log each nil honestly as evidence of which query shapes fail.
   ❌ WRONG: "Log_001 found Patrick Flynn, so the current nil with the Flinn variant is not meaningful."
   ✅ CORRECT: "Log_001 found Patrick under 'Flynn'. The nil under 'Flinn' documents that FamilySearch does not alias Flynn→Flinn for this record — both findings stand as independent evidence."
6. Check for fallback plan items (`fallback_for`). If none and the question remains open, suggest research-plan for re-planning.

### 9. Present results

- Summarize what was searched and what was found
- Show the log entries created
- List records passed to extraction (or explain why none)
- Show plan progress: "3 of 5 plan items completed"
- Suggest next steps:
  - More plan items → "Shall I continue with the next search?"
  - All done → "All planned searches are complete. Would you like me to evaluate whether the research is exhaustive?" (research-exhaustiveness)
  - No results → "Would you like me to re-plan with different parameters or adjacent jurisdictions?" (research-plan)

## Searching multiple repositories

This skill handles FamilySearch searches. Plan items targeting Ancestry, MyHeritage, FindMyPast, FindAGrave, or Newspapers.com should be directed to search-external-sites.

If the user says "search all repositories," execute the FamilySearch items then suggest: "The FamilySearch searches are complete. The plan also includes searches on [Ancestry/etc.] — would you like me to generate search URLs for those?" (triggering search-external-sites).

## Important rules

- **Log every search.** Each retry gets its own `research_log_append` call. A search without a log entry is a search that didn't happen.
- **Prior log entries are immutable.** Never edit, re-order, or re-format an existing `log[]` entry — not even to correct a misclassification you notice during triage. Append a new entry; every entry that existed before yours must stay byte-for-byte unchanged.
- **Don't skip plan items silently.** Set status to `skipped` with an explanation.
- **Let the user confirm before extraction.** Show triage results first — don't silently extract every hit.
- **Never fabricate results.** If the MCP tool returns nothing, report nothing.
- **The write tools validate-before-persist.** `check-warnings` does not apply here — this skill writes only log entries and plan-item status, not assertions.