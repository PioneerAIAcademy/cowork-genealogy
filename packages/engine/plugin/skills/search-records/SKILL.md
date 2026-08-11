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
allowed-tools:
  - record_search
  - rank_search_matches
  - record_read
  - same_person
  - source_attachments
  - research_log_append
  - research_append
  - research_query
---

# Search Records

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

The bridge between planning (research-plan) and analysis (record-extraction).

## Route check — answer before ANY tool call or file read

| Condition | Action |
|-----------|--------|
| User names a non-FamilySearch site (Ancestry, MyHeritage, FindMyPast, FindAGrave, Newspapers.com, or any other commercial site) | `Skill("search-external-sites")` — stop |
| User asks what to search, which records to check, whether research is complete, how to find someone, or what to do next (any strategy question rather than executing an already-planned search) | `Skill("research-plan")` — stop |
| User wants to analyze, extract from, or interpret a record already in hand | `Skill("record-extraction")` — stop |

**The key test:** is the user asking you to EXECUTE a search or to DECIDE what to search?
- "Search for X" / "Find X in Y records" / "Execute pli_001" → execute (proceed below)
- "What should I search for?" / "What next?" / "How do I find X?" / "Is the research done?" → `Skill("research-plan")` immediately

**CRITICAL — do NOT call `Skill("project-status")` before routing.** research-plan handles its own project reading; call it with no prior tool calls.

❌ WRONG: `Skill("project-status")` → read project → answer with research recommendations  
✅ CORRECT: `Skill("research-plan")` with no prior tool calls → stop

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
| `newspaper`, or any witness/FAN mention search | — | **Not this skill's job — report and stop.** Say full-text is needed and why, then hand back. Applies when: searching obituaries/marriage announcements, searching for a person as witness/neighbor/heir/surety/appraiser, pre-1850 US research with thin indexed coverage, Latin American notarial records, or narrative paragraph records |
| Parish registers where the target is **unindexed** — an emigrant's origin, a compound-surname parentage, any baptism/marriage/burial reachable only by transcript text | — | **Not this skill's job — report and stop.** When indexed `record_search` on the surname has returned only noise (the person is not name-indexed), the answer is usually in the AI-transcribed page text — reachable by a full-text co-occurrence search on the surnames, not by more indexed queries |
| `probate`, `court`, `land` (and other county-court series) in a **browse-only / barely-indexed** collection (low `recordSearchablePercent`) | `record_search` **then** — | Try `record_search` first. **If it returns nil/near-nil AND the locality survey said this collection covers the place+period, do NOT log negative as absence — the record is un-indexed, not absent.** Handle it per Step 8 item 5, then hand back. This is also the pre-1911-death path: no death certificate exists, so a county estate administration brackets the death |
| `cemetery` | `record_search` | FamilySearch indexes some cemetery records; also consider search-external-sites for FindAGrave |

Additional tools: `rank_search_matches` (the primary triage tool — host-side match-ranking of a staged result set against the subject; folds in match scoring **and** the attachment check); `same_person` / `source_attachments` (fallback for a thin/unresolvable subject, or per-record checks).

**This skill does not run `fulltext_search`, and does not delegate to
`search-full-text`.** It executes indexed FamilySearch record searches. When the
evidence says the answer is in un-indexed page text, that is a finding to report —
log it honestly, leave the plan item `in_progress`, name full-text as the next
step, and stop. The caller decides what runs next.

## Steps

### 1. Identify the plan item

Find the next plan item with `status: "planned"` in the active plan for the
current question. If you already hold the active plan and its item statuses in
context from this run (e.g. research-plan just wrote it), work from that — don't
re-read `research.json` "to be safe"; the writer tools validate the whole project
on every write, so the in-context view can't be silently stale.

**If you need project state you do not already have, fetch it with
`research_query` — never a whole-file `Read`, never a `grep`.** `research.json`
grows all run, so a whole-file read costs more context every time.

**At most one such call per invocation, and only when you are actually missing
something.** Ask for `plans` — the plan item you are executing and its status —
and nothing else; not `questions`, since the question is already in the plan item.
Do not re-query between searches; the plan does not change while you are searching
it. If the plan item arrived in your prompt, in a hand-off, or from
`research-plan` earlier in this same run, issue no query at all.

**Planned or ad-hoc — decide before you search.** The line is *who chose the
search*, not whether a plan exists.

| What you have | Do |
|---|---|
| A plan item | Execute. Full GPS, including the Step 8 escalation |
| No plan item, but the **user named this search** | Execute as ad-hoc: log `plan_item_id: null`, note it was user-requested, and stop when done — no escalation, no plan edits |
| No plan item, and **you** thought of the search | `Skill("research-plan")` and stop. If the user then says yes, it comes back as a plan item — not as ad-hoc |

Refusing a researcher's own request is obstruction, not rigour; inventing a search
nobody asked for is how a session drifts off its question. An autonomous
`/research` run has no ad-hoc searches — the orchestrator only dispatches you when
a plan item is waiting.

### 2. Construct the search query

**Choose a search strategy:**

- **"Less is more" (broad start):** minimal criteria — surname plus broad location, or surname plus wide date range. Best when the name is uncommon, when you are unsure of details, or when indexing errors are likely.
- **"Kitchen sink" (narrow start):** as many known details as possible, to filter a common name. Best when the surname is very common (Smith, Jones, Johnson).

The default is **broad-to-narrow**. Use narrow-to-broad only when you have high-confidence facts and expect to retrieve a specific known record.

**Anchor rule:** Every `record_search` query must include either `surname` or `recordCountry`. The tool rejects anchor-less queries. If neither is known, fall back to a broader plan item or skip.

**Search parameter guidance (`record_search`):**

| Parameter | Source | Notes |
|-----------|--------|-------|
| `surname` | tree.gedcomx.json person name | Try the spelling the tree holds first, then variant spellings as separate searches. Anchor — required if `recordCountry` is absent. |
| `givenName` | tree.gedcomx.json person name | **Use the full given-name string when a source names one** — "Anna Maria Eva", not just "Anna": a common first name alone returns a large, undifferentiated set, while the full name tends to surface the target as a clear top-scoring outlier. Truncate to first-name-only as a **lever** if it nils (`references/search-strategy-levers.md`), not as the default. |
| `birthYearFrom` / `birthYearTo` | Assertions or facts | Year range, both required when filtering by birth year (±5 years typical) |
| `birthPlace` | Assertions or facts | Use the broadest useful level (state, not city) |
| `residenceYearFrom` / `residenceYearTo` | Plan item year | Census-style anchor. Set both to the same year for a single-census search |
| `residencePlace` | Plan item jurisdiction | The primary geographic filter |
| `recordCountry` | Plan item jurisdiction | Anchor — required if `surname` is absent |
| `collectionId` | From `collections_search` output or plan rationale | Narrow to a specific collection when possible |
| `spouseGivenName` / `fatherSurname` / etc. | Known spouse/parent names | Narrows the result set — see "Relative-name anchors" below before reading a nil as meaningful |
| `surnameExact`, `givenNameExact`, `birthPlaceExact`, `marriagePlaceExact`, `birthYearExact`, `marriageYearExact`, `fatherGivenNameExact`, `spouseSurnameExact` (and the same `Exact` suffix on every other name, place, and year field) | — | Boolean. **Leave unset unless a rule below says otherwise.** See "Exact-match qualifiers" |

**Exact-match qualifiers (`*Exact`) — when to reach for one, and when not.**

`record_search` exposes an `Exact` boolean beside most name, place, and year
parameters. The rules below cover the surname, given name, place, year, parent and
spouse families; other fields follow the same pattern.

- **Never set one to find a record you could not otherwise find.** An exact
  search can only take records away, never surface one that was buried — though
  it does re-shuffle the ones it keeps. (Measured on `surnameExact` in marriage
  records: every record the exact search returned was already in the fuzzy one's
  results. The other `*Exact` fields are assumed to behave the same way, not
  measured.) If a search is not surfacing the target,
  the levers are a different name spelling, a broader place level, or dropping a
  filter — not exactness. (`references/search-strategy-levers.md`.)
- **`surnameExact` is usually the wrong reach.** Fuzzy matching is what bridges
  an index misspelling, the commonest reason a record cannot be found: on a
  record indexed `Neill`, `Neal` with `surnameExact` returned nothing while plain
  fuzzy returned it. Set it only when you have *confirmed* how the index spells
  the name.
- **The default reaches period diminutives; `givenNameExact` is expected to cut
  them off.** Fuzzy `Elizabeth` returns `Betty` records, likewise
  `Margaret`/`Peggy` and `Mary`/`Polly` — that reach is measured. That the exact
  form excludes them follows from what exactness does elsewhere; it was not
  measured directly. They rank deep and are easy to miss: to chase a nickname, pass
  it as its own `givenName` value rather than making the formal name exact, or
  narrow the query until the pool is small enough to read in full.
- **Searching a person indexed under initials (common in US census and
  directory records): pass `givenName: "J W"` and do NOT set `givenNameExact`.**
  Three things follow from that, in order of when they will bite you:
  - **Expect both orders back from a fuzzy search.** `J W` also returns records
    indexed `W J`. A reversed-initials hit is very often the same person, not a
    different one — do not discard it on the order alone. `givenNameExact` does
    remove them: on a census pool read in full both ways, the `W J` record is in
    the fuzzy results and absent from the exact ones while other records survive,
    so exactness is how you pin the order — at the cost below.
  - **`givenNameExact` is worth setting where the index really does use
    initials** — census and directory records. It keeps only records indexed in
    that literal form: on a US-wide `J W` search it cut the pool roughly
    120-fold, and the sampled page held no transpositions at all.
  - **But it returns NOTHING where the index spells names out.** On twenty
    narrow English marriage pools read in full, it came back empty every time,
    because no record there is indexed under initials. So a nil under
    `givenNameExact` is a fact about the index, not about the person: drop the
    qualifier and search fuzzy before concluding the record does not exist.
  - **To confirm which order the index actually uses**, narrow onto the surname
    until the pool is small enough to read in full, and look. That is also how
    you reach a transposed record deliberately.
- **`<event>PlaceExact` is for making a count mean something, not for finding.**
  An unqualified place scope expands upward so far that a county barely
  discriminates — a *wrong* county can return nearly the same total as the right
  one. Set it when you are about to record `results_available` or argue a search
  was reasonably exhaustive; leave it unset while still looking.
- **`<event>YearExact` narrows hard.** It is meant to remove the fuzz around the
  range bounds, but that fuzz is only weakly evidenced. What it does to records
  carrying **no indexed year** is **not established**, and neither is whether an
  unqualified range keeps them — so do not use a year range, set or unset, to
  include or exclude undated records. Whether it drops in-range approximate dates
  is also not established. Use it only with a firm date from a vital record.
- **Wildcards survive exactness; variant spellings do not.** `Sm?th` plus
  `surnameExact` still returns both `Smith` and `Smyth`, while the same query
  without the wildcard drops `Smyth`. A wildcard plus exactness controls the
  *shape* of the expansion rather than switching it off.

**There is no "required" toggle, and this changes how you read a nil.** Every
term you supply is already required in one sense: a record must not *contradict*
it. A record simply **silent** about a *name* field is kept — measured for the
searched person's own name and for father and spouse names. (How a *year range*
treats a record with no indexed year is **not established** in either direction,
so do not assume a range either keeps or excludes undated records.) For the
searched person's own name — which the index virtually always holds — that
collapses to "must match". So **a nil result means one of the terms on the person
you searched did not match.** Drop or loosen one of *those* to recover; adding
more criteria cannot help. A nil is *not* evidence that some relative was absent
from the records.

**Relative-name anchors (`fatherGivenName`, `spouseGivenName`, …) narrow — they
do not widen.** Holding a query otherwise constant, adding a parent's name
reduces the result count. If a count goes **up**, something else changed in the
same call — check for a dropped date range or place filter before concluding the
anchor broadened the search. How much it narrows depends on **which** relative,
and on how often that relative is indexed in the records you are searching:

- **An unmatchable relative name keeps exactly the records silent about that
  relative, and drops every record naming a different one.** Enumerated for
  `father*` and `spouse*` only, in marriage records; `mother*`, `parent*` and
  `other*` are assumed to follow, not measured — so a mother-anchored nil is
  weaker evidence than a father-anchored one.
- **So the narrowing you get is the share of records that name that relative at
  all.** Where parents are rarely indexed, a parent name barely narrows and a
  parent-anchored nil is weak evidence. Where spouses are almost always indexed
  — typical of marriage records — a spouse name cuts most of the pool and its nil
  means more. Where a population indexes both sparsely, both behave the same;
  there is nothing special about the parameter.
- **A parent-anchored *hit* may still contain no parent at all**, because silent
  records are kept. Never report one as confirming a parent without opening the
  record.
- **Setting the matching `*Exact` requires the relative to be indexed**, dropping
  those silent records along with variant forms the fuzzy search did reach.
  Whether it also drops indexed abbreviations (`Wm` for `William`) is not
  established.

For wildcard rules and fuzzy matching behavior, read `references/name-search-mechanics.md`. For place hierarchy expansion and date range behavior, read `references/place-date-mechanics.md`.

**Before finalizing queries for a named collection (a specific `collectionId`, or a collection you can name — e.g. "Norway, Marriages, 1660-1926"), check `references/collection-quirks.md` for an entry on it and apply its guidance exactly.** Required, not optional — it documents transcription and indexing behaviors (abbreviations, vowel substitutions, wildcard restrictions) the general name-variant strategy will not surface. If an entry says two fields must be varied together (e.g. a given name and a surname abbreviation), vary them together in the same call before concluding a plan item is exhausted.

**Name variant strategy:** If the name as spelled in the tree returns few results, try:
- Phonetic variants (Flynn → Flyn, Flinn)
- Spelling variants (Patrick → Patric, Paddy, Pat)
- Abbreviations (William → Wm, Thomas → Thos)
- Initials (J. Smith)
- Maiden names for married women

**Secondary names need variants too — the given name, not just the surname.** The
variant strategy applies to `spouseGivenName`, `fatherSurname`, `motherGivenName`
and other secondary-party parameters: a bride indexed "Urna" when the tree has
"Unna" is as easy a false negative as one on the principal, and varying only the
secondary surname (Halsteinsdatter → Halstensdatter) misses that class. Before
calling a secondary-name search a genuine negative, work this order:

1. Vary the secondary **given** name itself (Unna → Urna, Anna, Una), then the
   secondary surname, then both together in the same call.
2. **A query-shape change is not a name variant.** Switching which party holds
   `spouseGivenName`, dropping the surname filter, dropping the place filter —
   while re-typing the same spelling — will not surface a transcription-variant
   record. Confirm you can point to at least one search where a **letter in the
   secondary given name itself** changed.
3. **Then drop the secondary filter rather than switching repositories.** Run at
   least one principal-only search (no `spouseGivenName`/`fatherSurname`/etc.)
   with `count: 50`, then `rank_search_matches` with `checkAttachments: true`
   over the full pool. `attachedToSubject: true` is a strong confirming signal
   here — FamilySearch's own matcher already linked it to this person — even at
   an unremarkable `matchScore`. This is the inverse of Step 4's "attached →
   deprioritize", which is for *discovering new* evidence; when the goal is
   *confirming* a fact already suspected (a marriage date, a birth record), an
   attached record is exactly the target — read it via `record_read`.

**Wildcards are supported — `*` and `?` both bind.** `?` is a single-character
wildcard, and a wildcard still expands with `.exact` set. `%` is not a
FamilySearch wildcard — use `*` or `?`. Prefer explicit spelling variants first,
because a wildcard widens in ways you cannot see; reach for one when the variants
are exhausted (`references/search-strategy-levers.md`, steps 8 and 9).

**Always keep givenName in variant searches.** A surname-only query broadens results to every person of that surname and makes triage impossible. Keep both surname and givenName on every retry; change the spelling of one or both.

**Patronymic cultures are the exception to leaning on the surname.** In Scandinavian and other patronymic systems the surname changes every generation (-sen/-datter, -son/-dotter) or is a farm/emigrant name adopted later — the *least* stable identifier, not the anchor. There, anchor on the **given name + exact date + the parents' given names**, expect the surname to differ from record to record, and do not require a surname match (the given name still stays — it's the surname you loosen). A shifting patronymic across a family is normal; a *conflicting* patronymic for the same person is a different-person signal, not a variant (see person-evidence / conflict-resolution).

### 3. Execute the search

Call `record_search` with the constructed params plus **`projectPath`** (the
absolute path of the project directory) and **`subjectId`** (the research
subject's `persons[].id` in `tree.gedcomx.json`, e.g. `"I1"`).

Those two arguments do all of Step 4 for you:

- `projectPath` stages the raw results host-side and returns a
  `staged.resultsRef` handle (pass it to `research_log_append` in Step 5), with
  the inline results as **compact stubs** — the bulk per-result GedcomX lives in
  the staged file.
- `subjectId` makes the tool **rank the candidates for you** against that subject
  and return them under `ranked` (see Step 4). You do not call
  `rank_search_matches` yourself in the normal flow.

Leave `count` alone. It defaults to 50 when you pass `subjectId` — a deep pool is
worth fetching precisely because the ranker cuts it back host-side — and to 20
when you don't. Setting `count: 50` without a `subjectId` just hands you 50 raw
stubs to read.

Omit `subjectId` only when the search is genuinely not about a specific tree
person (a broad survey, or a person not yet in the tree). Then triage falls back
to the manual path in Step 4.

**Always log the search (Step 5) — never skip it.** `projectPath` on the call is
what earns the log entry its results sidecar (the `staged.resultsRef` handle). If
you omitted `projectPath` (no `staged.resultsRef`) or hit a `stagingError`,
re-run the identical query **with** `projectPath` and use **that** staged re-run
for Steps 4 and 5. Why the sidecar matters: a sidecar-less search entry can't
feed extraction — `record_persona_id` is auto-filled from the sidecar and
`research_append` **rejects** an assertions append against a sidecar-less search
— so **re-stage before any handoff to extraction**. A missing handle is a reason
to re-run, never a reason to skip ranking or logging. If a `stagingError`
persists across one retry, surface it to the user. (A nil search correctly has no
handle — nothing was found to retain.)

**If the search fails due to authentication:** tell the user: "The search requires FamilySearch authentication. Please ask me to log you in, or type `login`."

**A zero-result search is NOT an authentication failure.** Auth problems throw an
error ("User is not logged in to FamilySearch…" / "FamilySearch session not
accepted…"); `results: []` means the query ran, authenticated, and matched
nothing. That is the nil finding this skill exists to record. An implausible nil
is not licence to suspect your session — say so in the `notes` and carry on.
(Rows from the wrong collection are a mismatch, not a nil.)

❌ WRONG: "Zero results US-wide is implausible for the 1850 census, so the session
must be dead — please log in and I'll re-run."
✅ CORRECT: "Zero results US-wide despite good coverage. The search ran fine, so
this is a real nil — most likely a transcription error the index cannot match."

### 4. Triage results — rank by match, then confirm

**If you passed `subjectId` in Step 3, the ranking is already in the response —
read `ranked`, don't re-rank.** The tool scored every staged candidate against
the subject and checked attachments as part of the search. If you find yourself
about to hand-score a stub list, check whether you passed `subjectId`.

**Two cases still need the standalone `rank_search_matches` tool:**

1. **Re-ranking a logged search later** — pass the finalized
   `results/<log_id>.json` as `stagedResultsRef`, e.g. to score an old pool
   against a subject you have since enriched.
2. **Ranking against a different subject** than the one you searched for —
   testing whether a candidate pool matches a *sibling* or a hypothesised parent.

```
rank_search_matches({
  projectPath,
  stagedResultsRef,        // staged.resultsRef, or results/<log_id>.json
  subjectId,               // any persons[].id in tree.gedcomx.json
  checkAttachments: true
})
```

**If `rankingError` came back on the search**, ranking failed but the search did
not: `results` is intact and unranked. Re-run the standalone tool with the
`staged.resultsRef` you already hold; if it fails again, surface it and triage
by hand for that one search.

Whichever path produced it, the ranking scores **every** staged candidate against
the subject with FamilySearch's own matcher (the engine `same_person` uses),
re-orders by real match quality — **not** FamilySearch's search rank, which is
unreliable — and returns the **top 10** in `matches[]`. Each carries `matchRank`,
`searchRank` (its original position — shows how far the ranker missed),
`matchScore` (0–1), `matchConfidence`, the key facts, and `attachedToSubject` /
`attachedToOther`. The bulk GedcomX stays host-side, and a per-result
`same_person` loop plus a separate `source_attachments` call are both unnecessary.

**The ranked list is a review surface, not an auto-accept.** Match score orders the
candidates; you still confirm the top ones:

- **Logical cross-check every strong match.** Role in the record (a 5-year-old
  cannot be Head of Household), age/birth year vs. the expected range, place
  consistency. Flag any impossibility as `needs-review` regardless of score —
  score is one input, reason is the arbiter. A birth year that conflicts with
  the known subject by more than a year or two is itself a different-person
  signal, not a rounding error to explain away: a high name-and-place score with
  the dates several years apart is the classic signature of a *namesake* in a
  crowded parish. Don't reach for an excuse (imprecise census ages, indexing
  slips) and adopt the record on the strength of the score; require independent
  confirmation that it is the *same* person — anchors matching the known subject
  (spouse, children, later residences, FAN network). Absent that, flag it
  `needs-review`, keep the plan item `in_progress`, and do not hand the record or
  its parents to extraction as the subject's.
  **Exception for civil death registrations:** ages on death certificates are
  frequently estimates provided by whoever reported the death — non-family
  informants (a neighbour, a burial agent, a hospital official) are commonly
  off by 3–7 years. On a death registration, a birth year discrepancy of ≤5
  years does not by itself disqualify a match, particularly when the full
  given name — including middle names — is an exact match. Read the image
  before dismissing.
  **The excuse can point either direction — both are still excuses.** A
  same-name match carrying an exact, precise date (a parish baptism, a marriage
  register entry) that conflicts with the tree's own approximate estimate is
  *not* resolved by noting that the tree's number is the fuzzy one. The record's
  greater precision makes the conflict a stronger caution flag, not a reason to
  relax scrutiny. Present it as `needs-review — possible namesake`, never as a
  "Top Match" and never with warm framing — not "almost certainly the right
  person", "highly promising", "very likely ours", nor the date reduced to a
  footnote. A disqualifying conflict makes the record *probably someone else*,
  and your summary has to say so.
  **Do not offer extraction as a next step — not even as a question.** "Shall I
  proceed with extraction?" hands the judgment back to a user who is trusting
  you to have made it, and a user who says yes has just adopted a namesake's
  parents. State the conclusion instead: this is very likely a different
  same-named person; name the anchor that would settle it (a baptism in the
  expected year window, a matching spouse or child, a later residence); propose
  **that narrower search** as the next step. Extraction is available again only
  once an independent anchor confirms identity.
  **Dismissing one result does not close the search.** After ruling out a
  candidate, evaluate the next result in the same ranked list — #2, then #3 — in
  score order, and move on only when the whole list is triaged. The error is:
  top result dismissed → jump to the next plan item.
  **And do not report the disqualified record's family as findings.** Naming its
  parents (or spouse, or children) in your results table or narrative adopts the
  identity in the only way that matters to a reader, whatever the needs-review
  flag says — they will remember the names, not the caveat. Report the record,
  the conflict, and what would settle it.
- **Pre-1880 US censuses have no relationship column.** 1850/1860/1870 list name,
  age, sex, birthplace, occupation in household order — "relationship to head" is
  **1880-onward**. So any "head"/"wife"/"son" read off a pre-1880 household is an
  inference from surname, age and listing order, and the record's own
  `ParentChild`/`Couple` edges are the indexer's inference from those same
  signals. Write the listing and mark the family structure inferred — not "head
  Daniel + wife Margaret + daughter Hannah" but "Daniel, Margaret, Hannah in one
  dwelling; family structure inferred from surname, ages and order, not stated."
  Same caution for any field that year didn't collect:
  `references/census-field-availability.md`.
- **Cite `matchScore`, never `results[].score` — they are different numbers.** A
  raw search stub's `score` (and `confidence`) is FamilySearch's own *search
  relevance*, the unreliable ordering the match-ranker exists to replace;
  `matchScore` on a `ranked.matches[]` entry is the content match against your
  subject. Quoting a stub's `score` as a match score is a reasoning error, not a
  wording slip: the triage would rest on the ordering you were supposed to
  discard. Before citing a number, check which array you read it from.
- **Needs-review band.** A genuinely *different* same-name/same-place person can
  land inside the match band, and sparse/dateless records score unstably. When the
  top scores don't clearly separate, or a candidate is a thin/dateless stub, treat
  it as `needs-review` and confirm by other means.
- **Attachment status** is already on each match: attached-to-subject → note and
  deprioritize *when the goal is discovering new evidence*; attached-to-other →
  potentially relevant; unattached → prioritize (new evidence). **When the goal is
  instead confirming a specific fact already suspected** (e.g. "did this marriage
  happen, and when"), an attached-to-subject candidate is exactly the target, not
  noise — read it via `record_read` even at a moderate `matchScore`.
- **Collection sanity-check.** Verify the matched record's collection actually
  answers the question asked — a 1870-census query returning an 1850 result is a
  near-miss, not a finding; log it `partial` (collection-mismatch) per Step 5.

**When nothing in the top 10 is a confident match** — or `rank_search_matches`
returns `subjectResolvable: false` — do **not** conclude the record is absent:

- The pool caps at 50, and re-ranking only re-orders what was fetched — it can't
  rescue a target FamilySearch buries past rank 50. So **page deeper**
  (`record_search` with `offset: 50`, then rank again) or **narrow** the query
  (collection, place, parent/spouse) so the target ranks into the fetched 50. For
  a very broad search (thousands of hits), narrow *first*.
- **`subjectResolvable: false` means one of two things — read the `diagnostic`
  field, which says which.**
  - *The subject is too thin to score.* `matches` comes back **empty on
    purpose**: the ranking would have been FamilySearch's unreliable search order
    wearing match scores. **Fix the subject, don't hand-triage 50 stubs.** The
    tool folds in every assertion linked to the person through `person_evidence`,
    so give it something to fold: extract and link one dated or placed assertion,
    or record the fact on the tree person, then rank again. If the subject cannot
    be thickened yet, **narrow the query** instead — a smaller, better-targeted
    pool is worth more than a big unranked one.
  - *The subject is fine; the pool holds no match.* That is a **real negative**
    for this query. Log it as such and page deeper or narrow — do not re-triage
    the same 50 stubs by hand.

  Do **not** fall back to hand-scoring with `same_person` against the same tree
  subject: that is the identical starved document the ranker just failed on.
  `same_person` is a fallback only when you have a *richer* subject document than
  the tree person — e.g. a confirmed record for this person, compared
  record-to-record.

**Deduplicate.** Multiple index entries may point to one underlying record; check
identifiers before treating similar matches as independent.

**Present triage to the user.** Show the top matches with match score, attachment
status, and any `needs-review` flags. Let the user confirm which records to examine
before extraction.

### 5. Log the search

Call `research_log_append` once per search — it assigns the next `log_` id, stamps the timestamp, writes the `results/<log_id>.json` sidecar, validates, and **appends** atomically. Field-level guidance: `references/research-log-protocol.md`.

Pass: `projectPath`, `tool`, `planItemId`, `query` (enough detail to reproduce the search), `outcome`, `resultsExamined`, `resultsAvailable`, `notes` (a one-line summary), and `stagedResultsRef` from Step 3 (the `staged.resultsRef` handle, when present).

**Required log-entry fields.** Every `log[]` entry must carry: `id` (the next `log_NNN`), `plan_item_id` (null for an ad-hoc search), `performed` (ISO-8601 timestamp), `tool`, `query`, `outcome`, `results_examined`, and `external_site` — set `external_site` to **null** for FamilySearch `record_search` searches. Add `results_ref` for any results-returning search.

**Append-only — never modify, overwrite, or re-order an existing `log[]` entry.** Each search, including each nil retry, becomes exactly one NEW entry with the next `log_` id; re-running a search is a fresh logged event, not an edit of a prior one. Even if you notice an error in an earlier entry, do NOT edit it — leave every existing entry byte-for-byte intact and append a new entry that notes the correction.

**Sidecar correctness — what counts as nil is the result COUNT, not `staged`.** Any search returning one or more results — `outcome: "positive"` **or** a `partial` collection-mismatch — gets a `results/<log_id>.json` sidecar with that entry's `results_ref` set to `"results/<log_id>.json"` (never null). Only a **zero**-result search omits `stagedResultsRef` and leaves `results_ref` null. `research_log_append` writes the sidecar from the `stagedResultsRef` handle — which is why the Step 3 staging gate is mandatory before you get here; if results came back but `staged` is null you cannot patch it here (there is no way to set `results_ref` by hand), so re-run the identical query **with** `projectPath`. The sidecar is a JSON object — `{ "returned_count": <n>, "payload": { "results": [ <the records returned> ] } }`, never a bare array — where `returned_count` equals the number of records in `payload.results`, and `results_available` matches that count.

**Collection-mismatch:** When results come from the wrong collection (e.g., searched 1870 census, got 1850 results):
- Log with `outcome: "partial"` (not `"negative"` — negative means zero results)
- Explain the mismatch in `notes`
- Still pass `stagedResultsRef`
- **Stop after confirming the mismatch.** Variant spellings will NOT fix a collection mismatch — do not execute them, and do not recommend them as next steps. Suggest a different source or collection filter instead.
- **A collection mismatch is not a nil, and repeating it is not "still exhausting levers."** If a follow-up attempt at fixing the *collection* targeting (an explicit `collectionId` pin, a broadened year window) still returns the same wrong-collection record, that repetition is the confirmation — not license to reach for Step 8's nil-lever escalation. The record that keeps surfacing is real; it simply isn't from the collection being asked about.
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

**Do this now, in the same turn as Step 5 — before Step 7 or presenting anything.** A logged search with no matching plan-item status update is an incomplete step, not a deferred one: if you executed a search against a plan item, this call happens before you do anything else with the results.

Call `research_append` with `section: "plan_items"`, `op: "update"`, `planId`, `entryId`, and `fields: { status: "..." }`:
- `in_progress`: Search executed — work continues downstream in record-extraction. Use whenever records were found to pass on, OR the search was exhausted with nil results and re-planning may be needed.
- `skipped`: The search was determined to be unnecessary.

**Do not** set status to `completed` from this skill — that is set by record-extraction once assertions have been created.

### 7. Pass records to extraction

**Distinguish index entries from original records.** Most search results are index entries — derivative sources that are pointers to originals, not the records themselves.

**Hand off the `recordId` explicitly.** Each ranked match (like each `record_search` result) carries a `recordId` field that record-extraction uses as the assertion `record_id`. Pass it through in the handoff (alongside the persona ids you already hold) so record-extraction does **not** have to recover it by re-running `record_search` — that lets its first `research_append` validate without a re-search. The format is the validator's concern (it matches `record_id` by canonical ARK form), so pass `recordId` straight through.

1. If a record ID or ARK is available, call `record_read` to fetch the full simplified GEDCOMX before passing to record-extraction. **Read it from the sidecar, not live:** pass the Step 3 handle — `record_read({ recordId, resultsRef: staged.resultsRef, projectPath })` — to get the searched person's full gedcomx (facts, source citation, standardized places) **without a network round-trip**. **Do NOT `Read` the sidecar file yourself:** `record_read` pulls just the one record out, whereas reading the whole `results/<log_id>.json` reloads every staged result and defeats the compaction. Omit `resultsRef` for a live read only when you need a **co-resident's** full facts (the sidecar stubs co-residents to a name plus a fact or two), or the record wasn't part of this staged search. **Parameter name:** always `recordId` — the result's `recordId` field, which every result carries (the ARK, when you need it, is `recordArk`). Do NOT use `arkId`, `ark`, `id`, or `url`.
2. If the full record is unavailable but an image exists, record the image URL in the log and pass to record-extraction, which fetches and transcribes.
3. If only the index entry is available, flag it in log notes as "derivative only — original not located." Never treat an index entry as equivalent to examining the original.

**Passenger lists:** Passenger lists record every person aboard including infants. When a result matches a parent, examine the full manifest for all family members — children's ages and birthplaces can resolve parentage questions.

### 8. Handle nil results

**This section's levers (including name-spelling/phonetic variants) apply to genuine nil results only.** A collection mismatch is a different failure mode with a narrower remedy — see Step 5's Collection-mismatch note. Do not apply this section's spelling-variant escalation to a mismatch.

1. **Log the nil result** via `research_log_append` with `outcome: "negative"` and the exact parameters used. Omit `stagedResultsRef`.
2. **Iterate through search strategy levers** before declaring negative. Read `references/search-strategy-levers.md`. Try at least 3 lever variations for important plan items. **Log each retry as a separate `research_log_append` call immediately after it completes — do not batch log calls at the end.**
   **NEVER drop given name as a nil search lever.** A surname-only search is not a valid escalation step. Keep both surname and given name on every retry.
   **If a boundary may have changed and a search nils, use the successor jurisdiction the plan gives you.** A record can be filed under the jurisdiction in force at the event *or* the place's present-day one. A plan item may carry a fallback jurisdiction in its `rationale` — use it. If the plan offers none and the nil persists, **bounce back to `research-plan`**: deciding what jurisdiction to search (and consulting `locality-guide`) is its job, not this skill's. Do not look up place history or hardcode per-country rules here. See `references/search-strategy-levers.md`.
3. **Stop retrying when:** you have tried all levers in the zero-hit escalation priority list, OR the database clearly does not cover the target time/place, OR you have exhausted 5+ variations.
4. **Assess whether absence is meaningful.** After exhausting variants and levers, explicitly evaluate three conditions:
   (a) the record type existed in this jurisdiction at this time,
   (b) the collection is reasonably complete for the period,
   (c) the subject should have appeared based on known facts.
   State each condition clearly. If all three hold, note in the log and suggest record-extraction create a negative assertion. If the collection is incomplete or the subject may have been absent, note this as a limitation rather than a conclusion.
5. **Distinguish "not found" from "does not exist."** A nil result may mean the record is undigitized, unindexed, or indexed under a variant. Note which applies.
   **Low index coverage → pivot to full-text, do not conclude absent.** When the nil is on a collection the locality survey flagged as covering this place+period but whose index coverage is very low (browse-only image volumes — probate, court order books, land/deeds, many pre-1900 registers; `recordSearchablePercent` near 0), the record is almost certainly present as an **un-indexed page image**, not absent. `outcome` is still **`negative`** — that field records what the search returned, not what it means. The *interpretation* goes in `notes` and in the plan-item status: say the collection is browse-only / near-zero indexed and the record is very likely present as un-indexed page text, and keep the plan item **`in_progress`**. **Never let the narrative claim absence** — "no estate record exists" is the error, not the `negative` enum. Then report that a full-text search of that collection's volumes (a co-occurrence search — surname plus a distinguishing term like an heir/administrator's name or `deceased`/`estate`), and possibly image browsing, is the next step. **Do not run or delegate that search yourself** — the caller owns that decision. Absence may only be called after full-text/browse has also come up empty. (Example: a pre-1911 Kentucky death has no statewide certificate; it is established from the county estate administration — bond and settlement — which `record_search` on a ~1%-indexed probate collection will never surface.)
   **Zero results is NOT "service unavailability."** If `record_search` returns `totalMatches: 0` with no error, the search completed — do not attribute this to service issues.
   **Prior log entries finding the record do NOT override current nil results.** A nil with different parameters documents that those query shapes fail — log each nil honestly as that evidence.
   ❌ WRONG: "Log_001 found Patrick Flynn, so the current nil with the Flinn variant is not meaningful."
   ✅ CORRECT: "Log_001 found Patrick under 'Flynn'. The nil under 'Flinn' documents that FamilySearch does not alias Flynn→Flinn for this record — both findings stand as independent evidence."
6. Check for fallback plan items (`fallback_for`). If none and the question remains open, suggest research-plan for re-planning.
7. **Escalate to external sites — the final step after FamilySearch exhaustion.** FamilySearch's index-based search has no phonetic or partial-match fallback: once the indexer mis-transcribes a name (e.g. "Quass" indexed as "Ovass"), no FamilySearch variant will ever surface that record, while other sites *do* fuzzy-match (Ancestry's partial/phonetic `name_x=ps_ps`). When an **important** plan item has returned nil across 3+ FamilySearch variants and the question is still open, invoke `Skill("search-external-sites")` with the same person attributes to generate Ancestry (and, where the researcher subscribes, MyHeritage/FindMyPast) search URLs. **Do this immediately — do not ask the user first and do not wait until step 9.** This is a tool call you make in this turn, not an option you narrate for approval.

   **No plan item → no escalation**, however many variants came back nil; an ad-hoc search ends when you log it (Step 1).

   ❌ WRONG: Ending your response with "FamilySearch is exhausted — would you like me to check Ancestry?" without having called the skill. Offering the escalation in prose is not escalating.
   ✅ CORRECT: Call `Skill("search-external-sites")` in this same turn, before writing your summary, and present the URLs it returns as part of your results.

   In the nil log entry's `notes`, record that FamilySearch variants were exhausted and external sites should be checked. Do not treat the plan item as resolved on the FamilySearch nil alone — leave its status `in_progress` until the external search has been checked. Skip this only for low-value items, or when a fallback plan item already targets an external site.

### 9. Present results

**Accuracy rule — do not overclaim persistence.** This skill writes only `log[]` entries and plan-item `status` — nothing else. Never describe results as "logged with sources," "recorded," "saved to the research project," or any phrasing implying a `sources` or `assertions` entry exists, unless `record-extraction` actually ran in this turn and returned assigned `src_`/`a_` ids. A search result that hasn't been through extraction is a candidate record sitting in a search log — say exactly that, even when the user's own phrasing ("go ahead," "find and list them") sounds like a go-ahead to do the full job.

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

Plan items targeting Ancestry, MyHeritage, FindMyPast, FindAGrave, or Newspapers.com go to search-external-sites. If the user says "search all repositories," execute the FamilySearch items then suggest: "The FamilySearch searches are complete. The plan also includes searches on [Ancestry/etc.] — would you like me to generate search URLs for those?" (triggering search-external-sites).

## Important rules

- **Log every search.** Each retry gets its own `research_log_append` call. A search without a log entry is a search that didn't happen.
- **Prior log entries are immutable.** Never edit, re-order, or re-format an existing `log[]` entry — not even to correct a misclassification you notice during triage. Append a new entry instead (see Step 5).
- **Don't skip plan items silently.** Set status to `skipped` with an explanation.
- **Let the user confirm before extraction.** Show triage results first — don't silently extract every hit.
- **Never fabricate results.** If the MCP tool returns nothing, report nothing.
- **The write tools validate-before-persist.** `check-warnings` does not apply here — this skill writes only log entries and plan-item status, not assertions.

## Re-invocation behavior

**Writes:** a new `log[]` entry in `research.json` (via `research_log_append`) plus its `results/<log_id>.json` sidecar for any results-returning search; and a `status` update on the executed plan item in `plan_items` (via `research_append`, `op: "update"`).

**On repeat invocation:** always append a new `log_` entry (and sidecar) — re-running a search is itself a logged event, never an edit of a prior one; update the plan item's `status` in place. Two runs of the same query produce two distinct log entries and sidecars — that is the audit trail, not a duplication bug.
