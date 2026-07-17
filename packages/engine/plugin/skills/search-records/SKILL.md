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
  - rank_search_matches
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
| Parish registers where the target is **unindexed** — an emigrant's origin, a compound-surname parentage, any baptism/marriage/burial reachable only by transcript text | — | **Delegate to search-full-text skill.** When indexed `record_search` on the surname has returned only noise (the person is not name-indexed), the answer is usually in the AI-transcribed page text — reachable by a full-text co-occurrence search on the surnames, not by more indexed queries. |
| `cemetery` | `record_search` | FamilySearch indexes some cemetery records. Also consider suggesting search-external-sites for FindAGrave |

Additional tools: `rank_search_matches` (the primary triage tool — host-side match-ranking of a staged result set against the subject; folds in match scoring **and** the attachment check); `same_person` / `source_attachments` (fallback for a thin/unresolvable subject, or per-record checks).

**If you run `fulltext_search` yourself instead of delegating** (a quick
check from the main loop), two rules decide success or failure — the
`search-full-text` skill carries the full version, but at minimum:

- **Compound (Iberian / Latin-American) surnames → co-occurrence, not a
  phrase.** For a subject named `Given Paterno Materno` (e.g. "Francisco
  **Naveda Somarriba**"), require the two surnames as separate terms:
  `+Naveda +Somarriba`. **Never** the adjacent phrase `+"Naveda
  Somarriba"` — in the parents' own records the father carries the
  paternal surname and the mother the maternal one, so the two words sit
  on different people and are never adjacent; the phrase only matches the
  child's own written-out name and misses every parentage record.
- **Do not scope a full-text search to a record `collectionId`.** The FTS
  corpus is partitioned into its own auto-generated collections; a
  `collectionId` borrowed from `record_search` or a collections survey
  routinely excludes the FTS volume that holds the answer and the search
  returns zero. Search the whole corpus first; narrow with
  `recordPlace*` / `recordType` / year filters (or a known
  `imageGroupNumber`) only after you have hits.

## Steps

### 1. Identify the plan item

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

**Secondary names need variants too — including the given name, not just the surname.** The same variant strategy applies to `spouseGivenName`, `fatherSurname`, `motherGivenName`, and other secondary-party parameters, not just the principal's own name — an exact-match assumption on a spouse or parent's name can produce a false negative just as easily as one on the principal (e.g. a bride indexed as "Urna" when the tree has "Unna"). A run that only varies the secondary surname (e.g. Halsteinsdatter → Halstensdatter) while leaving the secondary given name fixed still misses this class of error — the given name needs its own spelling/phonetic variants tried (Unna → Urna, Anna, Una), not just the patronymic. If several searches with a secondary name come back empty, before concluding a genuine negative: (1) try spelling variants on the secondary given name itself, (2) try spelling variants on the secondary surname, and (3) try both varied together — don't stop after varying only one half of the secondary name.

**Query-structure changes are not a substitute for name-spelling changes.** Twice on the same real record (see `references/collection-quirks.md`, Norway section), the agent tried several searches that changed *which field* held which value — switching which party was `spouseGivenName` vs. the principal, dropping the surname filter, dropping the place filter — while re-typing the exact same spelling of the secondary given name every time. That is not a name variant; it is the same name run through a different query shape, and it does not surface a transcription-variant record. Before moving to another repository, confirm you can point to at least one search where a **letter in the secondary given name itself** was changed (not just which parameter it was assigned to).

**When secondary-party name variants are exhausted and still weak, drop the secondary filter instead of switching repositories.** Across repeated live runs against the same Norwegian marriage record (see `references/collection-quirks.md`, Norway section), the searches that actually recovered the target record dropped the secondary-party name filter entirely — searching the principal alone, scoped only by collection/date/place — rather than continuing to guess spelling combinations on the secondary party or pivoting to a different collection/record type. This is a required fallback, not an optional one: before concluding a plan item is exhausted or moving to another repository, run at least one principal-only search (no `spouseGivenName`/`fatherSurname`/etc.) with `count: 50`, then `rank_search_matches` with `checkAttachments: true` over the full candidate pool. A candidate with `attachedToSubject: true` is a strong confirming signal here — FamilySearch's own matcher already linked it to this person — even when its raw `matchScore` looks unremarkable (a real recovered case scored only 0.632 at rank 2 of 58). This is the inverse of the "attached → deprioritize" guidance in Step 4: that guidance is for *discovering new* evidence, where an attached record is old news; when the plan item's goal is *confirming* a fact already suspected (a marriage date, a birth record), an attached record is exactly the target and should be read via `record_read`, not skipped.

**Do NOT use wildcard characters (`*`, `?`, `%`) in `record_search` parameters.** Use explicit spelling variants instead.

**Always keep givenName in variant searches.** Do not drop to a surname-only query — it broadens results to all persons of that surname and makes triage impossible. Keep both surname and givenName on every retry; change the spelling of one or both.

**Patronymic cultures are the exception to leaning on the surname.** In Scandinavian and other patronymic systems the surname is a patronymic that changes every generation (-sen/-datter, -son/-dotter) or a farm/emigrant name adopted later — it is the *least* stable identifier, not the anchor. There, anchor on the **given name + exact date + the parents' given names**, expect the surname to differ from record to record, and do not require a surname match (the given name still stays — it's the surname you loosen). A shifting patronymic across a family is normal; a *conflicting* patronymic for the same person is a different-person signal, not a variant (see person-evidence / conflict-resolution).

### 3. Execute the search

Call `record_search` with the constructed params plus `projectPath` (the absolute path of the project directory) and **`count: 50`**. Passing `projectPath` stages the raw results host-side, returns a `staged.resultsRef` handle (pass it to `rank_search_matches` in Step 4 **and** `research_log_append` in Step 5), and returns the inline results as **compact stubs** — the bulk per-result GedcomX lives in the staged file (so a large result set can't overflow; no flag needed). `count: 50` fetches a deep-enough pool for the match re-ranker.

**If the search fails due to authentication:** Instruct the user to log in: "The search requires FamilySearch authentication. Please ask me to log you in, or type `login`."

### 4. Triage results — rank by match, then confirm

Step 3 returned compact stubs plus a `staged.resultsRef`. **Always call
`rank_search_matches` after any search that returns one or more results — even
1–2.** Don't hand-score, eyeball, or skip it for a small result set: one cheap
host-side call gives a real match score + attachment flag for every candidate
(which also feeds the match-score log for later threshold calibration) and keeps
triage uniform.

**Rank the staged results:**

```
rank_search_matches({
  projectPath,
  stagedResultsRef,        // the staged.resultsRef from Step 3
  subjectId,               // the research subject's id in tree.gedcomx.json (e.g. "I1")
  checkAttachments: true
})
```

It scores **every** staged candidate against the subject with FamilySearch's own
matcher (the engine `same_person` uses), re-orders by real match quality — **not**
FamilySearch's search rank, which is unreliable — and returns the **top 10** in
`matches[]`. Each carries `matchRank`, `searchRank` (its original position — shows
how far the ranker missed), `matchScore` (0–1), `matchConfidence`, the key facts,
and `attachedToSubject` / `attachedToOther`. The bulk GedcomX stays host-side; the
old per-result `same_person` loop and the separate `source_attachments` call both
**collapse into this one call**.

**The ranked list is a review surface, not an auto-accept.** Match score orders the
candidates; you still confirm the top ones:

- **Logical cross-check every strong match.** Role in the record (a 5-year-old
  cannot be Head of Household), age/birth year vs. the expected range, place
  consistency. Flag any impossibility as `needs-review` regardless of score —
  score is one input, reason is the arbiter. A birth year that conflicts with
  the known subject by more than a year or two is itself a different-person
  signal, not a rounding error to explain away: a high name-and-place score with
  the dates several years apart is the classic signature of a *namesake* in a
  crowded parish — exactly the case where the score misleads. Don't reach for an
  excuse (imprecise census ages, indexing slips) and adopt the record on the
  strength of the score; require independent confirmation that it is the *same*
  person — anchors that match the known subject (spouse, children, later
  residences, FAN network) — before treating it as the subject's. Absent that
  confirmation, flag it `needs-review`, keep the plan item `in_progress`, and do
  not hand the record or its parents to extraction as the subject's.
  **The excuse can point either direction — both are still excuses.** The
  imprecision doesn't have to sit on the *matched record's* side to be a
  rationalization: a same-name match carrying an exact, precise date (a parish
  baptism, a marriage register entry) that conflicts with the tree's own
  approximate estimate (itself often a census-derived age) is not resolved by
  noting that the *tree's* number is the fuzzy one. A precise record's exact
  date disagreeing with an approximate estimate by several years is the same
  disqualifying signal as the reverse case — the record's greater precision
  makes the conflict a stronger caution flag, not a reason to relax scrutiny
  because "the other number was only an estimate anyway." Present this pattern
  to the user as `needs-review — possible namesake`, not as a "Top Match," and
  do not phrase the conclusion as "almost certainly the right person" with the
  date reduced to a footnote.
- **Needs-review band.** A genuinely *different* same-name/same-place person can
  land inside the match band, and sparse/dateless records score unstably. When the
  top scores don't clearly separate, or a candidate is a thin/dateless stub, treat
  it as `needs-review` and confirm by other means, not on score alone.
- **Attachment status** is already on each match: attached-to-subject → note and
  deprioritize *when the goal is discovering new evidence*; attached-to-other →
  potentially relevant; unattached → prioritize (new evidence). **When the plan
  item's goal is instead confirming a specific fact already suspected** (e.g. "did
  this marriage happen, and when") rather than discovering something new, an
  attached-to-subject candidate is exactly the target, not noise — FamilySearch's
  own matcher already vetted the link. Read it via `record_read` even at a
  moderate `matchScore`, rather than passing over it in search of unattached
  "new" evidence.
- **Collection sanity-check.** Verify the matched record's collection actually
  answers the question asked — a 1870-census query returning an 1850 result is a
  near-miss, not a finding; log it `partial` (collection-mismatch) per Step 5.

**When nothing in the top 10 is a confident match** — or `rank_search_matches`
returns `subjectResolvable: false` (a thin/unresolvable subject, so its scores
carry no signal) — do **not** conclude the record is absent:

- The pool caps at 50 by FamilySearch's ranker, and re-ranking only re-orders what
  was fetched — it can't rescue a target FamilySearch buries past rank 50. So
  **page deeper** (`record_search` with `offset: 50`, then rank again) or **narrow**
  the query (collection, place, parent/spouse) so the target ranks into the fetched
  50. For a very broad search (thousands of hits), narrow *first*.
- On `subjectResolvable: false`, fall back to hand-scoring the promising stubs with
  `same_person` (`gedcomx1` = the record via `record_read`; `gedcomx2` = the subject
  from `tree.gedcomx.json`; `primaryId2` = the subject's id) plus the cross-checks
  above.

**Deduplicate.** Multiple index entries may point to one underlying record; check
identifiers before treating similar matches as independent.

**Present triage to the user.** Show the top matches with match score, attachment
status, and any `needs-review` flags. Let the user confirm which records to examine
before extraction.

### 5. Log the search

Call `research_log_append` once per search — it assigns the next `log_` id, stamps the timestamp, writes the `results/<log_id>.json` sidecar, validates, and **appends** atomically. See `references/research-log-protocol.md` for field-level guidance.

Pass: `projectPath`, `tool`, `planItemId`, `query` (enough detail to reproduce the search), `outcome`, `resultsExamined`, `resultsAvailable`, `notes` (a one-line summary), and `stagedResultsRef` from Step 3 (the `staged.resultsRef` handle, when present).

**What counts as nil is the result COUNT, not `staged`.** A nil search is one that returned **zero** results — only then omit `stagedResultsRef` and leave `results_ref` null. If the search returned one or more results but `staged` is null (no handle was returned), it is **not** a nil search: write the `results/<log_id>.json` sidecar yourself from the returned `results[]` and set `results_ref` to it (see Sidecar correctness below).

**Required log-entry fields.** Every `log[]` entry must carry: `id` (the next `log_NNN`), `plan_item_id` (null for an ad-hoc search), `performed` (ISO-8601 timestamp), `tool`, `query`, `outcome`, `results_examined`, and `external_site` — set `external_site` to **null** for FamilySearch `record_search` searches. Add `results_ref` for any results-returning search (per Sidecar correctness).

**Append-only — never modify, overwrite, or re-order an existing `log[]` entry.** Each search, including each nil retry, becomes exactly one NEW entry with the next `log_` id; re-running a search is a fresh logged event, not an edit of a prior one. Even if you notice an error in an earlier entry (e.g. a prior misclassification), do NOT edit it — leave every existing entry byte-for-byte intact and append a new entry that notes the correction.

**Sidecar correctness.** Any search that returns one or more results — `outcome: "positive"` **or** a `partial` collection-mismatch — writes a `results/<log_id>.json` sidecar AND sets that log entry's `results_ref` to `"results/<log_id>.json"` (never null). The sidecar is a JSON object — `{ "returned_count": <n>, "payload": { "results": [ <the records returned> ] } }`, never a bare array — where `returned_count` equals the number of records in `payload.results`, and `results_available` matches that count. Only a nil search (zero results) writes no sidecar and leaves `results_ref` null.

**Collection-mismatch:** When results come from the wrong collection (e.g., searched 1870 census, got 1850 results):
- Log with `outcome: "partial"` (not `"negative"` — negative means zero results)
- Explain the mismatch in `notes`
- Still pass `stagedResultsRef`
- **Stop after confirming the mismatch.** Variant spellings will NOT fix a collection mismatch — do not execute them, and do not recommend them as next steps. Suggest a different source or collection filter instead.
- **A collection mismatch is not a nil, and repeating it is not "still exhausting levers."** If a follow-up attempt at fixing the *collection* targeting (an explicit `collectionId` pin, a broadened year window) still returns the same wrong-collection record, that repetition is itself the confirmation — it does not mean the mismatch is still unconfirmed, and it is not license to reach for Step 8's nil-lever escalation (spelling/phonetic variants) next. The record that keeps surfacing is real; it simply isn't from the collection being asked about.
  ❌ WRONG: three straight 1870-census queries all return the 1850 record → try a "Flinn" spelling variant next.
  ✅ CORRECT: three straight 1870-census queries all return the 1850 record → stop, log the pattern, and suggest a different collection/repository (a different state's archive, Ancestry's independently-indexed 1870 census) — never a spelling change.

**outcome values:**
- `positive`: Matching results found
- `negative`: No matching results (this IS a finding)
- `partial`: Results found but incomplete (e.g., image unavailable, or collection-mismatch)
- `error`: Search failed (authentication, server error)

If the call returns `{ ok: false, errors }`, surface the errors rather than retrying blindly. A common cause is a **stale `stagedResultsRef`** (staged files are pruned after ~24h) — re-run `record_search` to re-stage, then call `research_log_append` with the fresh ref.

Narrate from the tool's summary ("logged as log_006; retained 3 results"); do not echo the payload.

### 6. Update plan item status

**Do this now, in the same turn as Step 5 — before Step 7 or presenting anything.** A logged search with no matching plan-item status update is an incomplete step, not a deferred one: it's easy to log the search and move straight to triage/handoff and simply forget this call. If you executed a search against a plan item, this call happens before you do anything else with the results.

Call `research_append` with `section: "plan_items"`, `op: "update"`, `planId`, `entryId`, and `fields: { status: "..." }`:
- `in_progress`: Search executed — work continues downstream in record-extraction. Use whenever records were found to pass on, OR the search was exhausted with nil results and re-planning may be needed.
- `skipped`: The search was determined to be unnecessary.

**Do not** set status to `completed` from this skill — that is set by record-extraction once assertions have been created.

### 7. Pass records to extraction

**Distinguish index entries from original records.** Most search results are index entries — derivative sources that are pointers to originals, not the records themselves.

**Hand off the `recordId` explicitly.** Each ranked match from `rank_search_matches` (like each `record_search` result) carries a `recordId` field that record-extraction uses as the assertion `record_id`. Pass it through in the handoff (alongside the persona ids you already hold) so record-extraction does **not** have to recover it by re-running `record_search` — that lets its first `research_append` validate without a re-search. The exact format is the validator's concern (it matches `record_id` by canonical ARK form), so pass `recordId` straight through.

1. If a record ID or ARK is available, call `record_read` to fetch the full simplified GEDCOMX before passing to record-extraction. **Read it from the sidecar, not live:** you already staged this search in Step 3, so pass that handle — `record_read({ recordId, resultsRef: staged.resultsRef, projectPath })` — to get the record's full gedcomx **without a network round-trip** (for the person you searched: the same facts, the source citation, and correct standardized places). **Do NOT `Read` the sidecar file yourself** — you already hold each `recordId` from the ranked results; `record_read` pulls just the one record out of the sidecar, whereas reading the whole `results/<log_id>.json` reloads every staged result and defeats the compaction. Omit `resultsRef` for a live read only when you need a **co-resident's** full facts (a household member you didn't search for — the sidecar stubs co-residents to a name plus a fact or two), or the record wasn't part of this staged search. **Parameter name:** always use `recordId` — pass the result's `recordId` field if present, otherwise its `arkUrl` value. Do NOT use `arkId`, `ark`, `id`, or `url`.
2. If the full record is unavailable but an image exists, record the image URL in the log and pass to record-extraction, which fetches and transcribes.
3. If only the index entry is available, flag it in log notes as "derivative only — original not located."

Never treat an index entry as equivalent to examining the original record.

**Passenger lists:** Passenger lists record every person aboard including infants. When a result matches a parent, examine the full manifest for all family members — children's ages and birthplaces can resolve parentage questions.

### 8. Handle nil results

**This section's levers (including name-spelling/phonetic variants) apply to genuine nil results only.** A collection mismatch (Step 5) is a different failure mode with a narrower, separate remedy — see Step 5's Collection-mismatch note. Do not apply this section's spelling-variant escalation to a mismatch.

1. **Log the nil result** via `research_log_append` with `outcome: "negative"` and the exact parameters used. Omit `stagedResultsRef`.
2. **Iterate through search strategy levers** before declaring negative. Read `references/search-strategy-levers.md`. Try at least 3 lever variations for important plan items. **Log each retry as a separate `research_log_append` call immediately after it completes — do not batch log calls at the end.**
   **NEVER drop given name as a nil search lever.** A surname-only search is not a valid escalation step. Keep both surname and given name on every retry.
   **If the place's boundaries changed since the event, search the historical jurisdiction first, then the present-day one.** The general rule for any boundary change (city, county, state, country, or parish renamed, split, or reassigned) is to search the jurisdiction that existed at the event date — the record was created under the boundary then in force. The exception is FamilySearch's own indexing, which sometimes files a collection under the place's **modern** country instead: a birth in 1893 Šútovo (then Turócz County, Kingdom of Hungary; today Slovakia) is indexed under **Slovakia**, so a `recordCountry: "Hungary"` search returns nil however many name variants you try. So when the historical jurisdiction returns nil, switch `recordCountry` to the present-day country (use `place_search_all` to see the succession), and don't assume the historical empire's religion. See the boundary-change lever in `references/search-strategy-levers.md`.
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
7. **Escalate to external sites — the final step after FamilySearch exhaustion.** FamilySearch's index-based search has no phonetic or partial-match fallback: once the indexer mis-transcribes a name (e.g. "Quass" indexed as "Ovass" on a Q→O error), no FamilySearch variant will ever surface that record. Other sites *do* fuzzy-match (Ancestry's partial/phonetic `name_x=ps_ps`), so they can recover records FamilySearch cannot — which is exactly why the escalation is triggered by the nil signal here, not planned upfront (planning external items preemptively clutters the plan when FamilySearch works). When an **important** plan item has returned nil across 3+ FamilySearch variants and the question is still open, invoke `Skill("search-external-sites")` with the same person attributes to generate Ancestry (and, where the researcher subscribes, MyHeritage/FindMyPast) search URLs. **Do this immediately — do not ask the user first and do not wait until step 9.** This is a tool call you make in this turn, not an option you narrate for the user to approve.

   ❌ WRONG: Ending your response with "FamilySearch is exhausted — would you like me to check Ancestry?" without having called the skill. Offering the escalation in prose is not escalating.
   ✅ CORRECT: Call `Skill("search-external-sites")` in this same turn, before writing your summary, and present the URLs it returns as part of your results.

   In the nil log entry's `notes`, record that FamilySearch variants were exhausted and external sites should be checked. Do not treat the plan item as resolved on the FamilySearch nil alone — leave its status `in_progress` until the external search has been checked. Skip this only for low-value items, or when a fallback plan item already targets an external site.

### 9. Present results

**Accuracy rule — do not overclaim persistence.** This skill's writes are limited to `log[]` entries and plan-item `status` (see Important rules) — nothing else. Never describe results as "logged with sources," "recorded," "saved to the research project," or any phrasing implying a `sources` or `assertions` entry exists, unless `record-extraction` has actually run in this turn and returned assigned `src_`/`a_` ids. A search result that hasn't been through extraction is a candidate record sitting in a search log — say exactly that, not more. This applies even when the user's own phrasing ("go ahead," "find and list them") sounds like a go-ahead to do the full job — logging a search is not the same action as persisting a source or assertion, and the summary must not blur the two.

- Summarize what was searched and what was found
- Show the log entries created
- List records passed to extraction (or explain why none) — and if none, say plainly that no `sources` or `assertions` exist yet for these findings
- Show plan progress: "3 of 5 plan items completed"
- Suggest next steps:
  - Promising results found, not yet extracted → "I found N promising record(s) for <person> — want me to run record-extraction now to turn them into sourced, GPS-classified assertions?" Do not present these results as already persisted beyond the search log.
  - More plan items → "Shall I continue with the next search?"
  - All done → "All planned searches are complete. Would you like me to evaluate whether the research is exhaustive?" (research-exhaustiveness)
  - No results → "FamilySearch is exhausted for this search — shall I generate Ancestry/MyHeritage URLs for it (search-external-sites), or re-plan with different parameters or adjacent jurisdictions (research-plan)?"

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

## Re-invocation behavior

**Writes:** a new `log[]` entry in `research.json` (via `research_log_append`) plus its `results/<log_id>.json` sidecar for any results-returning search; and a `status` update on the executed plan item in `plan_items` (via `research_append`, `op: "update"`).

**On repeat invocation:** always append a new `log_` entry (and sidecar) — re-running a search is itself a logged event, never an edit of a prior one. Update the plan item's `status` in place.

**Do not duplicate:** the `log[]` is append-only; never modify or re-number an existing entry, even to correct one. Two runs of the same query produce two distinct log entries and sidecars — that is the audit trail, not a duplication bug.
