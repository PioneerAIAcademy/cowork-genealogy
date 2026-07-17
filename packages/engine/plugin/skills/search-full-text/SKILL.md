---
name: search-full-text
model: claude-sonnet-4-6
description: Invoke for FamilySearch full-text search (FTS) — immediately
  when the user says "full-text search", "FTS", "search document
  transcripts", or "construct a full-text query". Use this skill to find a
  person as a witness, executor, executrix, administrator, appraiser, heir,
  neighbor, surety, or other non-principal in deeds, probate, wills, court
  minutes, or notarial protocolos; to run Lucene-style queries with
  +required terms, wildcards, or phrase matching; and to cover spelling and
  transcription variants across FamilySearch's AI-transcribed historical
  documents. FamilySearch document images only. Exclude external sites like
  Ancestry or Newspapers.com (use search-external-sites), structured
  indexed search by name/date/place (use search-records), and planning what
  to search (use research-plan).
allowed-tools:
  - fulltext_search
  - source_attachments
  - research_log_append
  - research_append
---

# Search Full-Text

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

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
| Source type | Structured index (derivative) | AI transcript of document images (also derivative) |

### Critical: FTS results are derivative sources

Chain: original → image → AI transcript → textDocument. Each step can
introduce errors (~10% observed). **Always verify against the
original image** (linked from each result).

## Steps

### 1. Identify the plan item to execute

Read `research.json` `plans[]` and find the next plan item with
`status: "planned"` that targets full-text search. If the user
specifies a particular search, match it to a plan item or create
an ad-hoc search (with `plan_item_id: null` in the log).

### 2. Evaluate the target database

Before constructing any query, verify FTS covers the target. Read
`references/online-search-literacy.md` for the evaluation checklist.

- **Coverage:** ~6,665 searchable collections as of mid-2026. Not
  all FamilySearch collections are FTS-searchable.
- **Collection scope:** Read the description — titles mislead about
  geographic/temporal coverage.
- **Error rate:** ~10% observed. Plan for transcription variants.

### 3. Choose a search philosophy

**Default to "less is more" for FTS.** No fuzzy matching means every
extra required term risks missing transcription variants.

- **Uncommon surname** → `+Surname` only, filter after
- **Common surname** → `+Surname +Associate` or `+Surname +Keyword`
- **Very common surname (Smith, Jones)** → multiple required terms
  or phrase search ("kitchen sink")

See `references/online-search-literacy.md` for the full framework.

### 4. Determine the search strategy

Read `references/search-strategies.md` for the full strategy
catalog. Key decision: what kind of FTS search is this?

| Research goal | Query approach |
|---|---|
| Find person as witness/appraiser/heir | `+Surname` in Name field, place filter after |
| Find person in narrative records (deeds, probate, court) | `+GivenName +Surname` in Keywords, place filter after |
| FAN cluster search | `+TargetSurname +AssociateSurname` in Keywords |
| Parents of someone with a compound surname (Iberian / Latin-American `Paterno Materno`) | Decompose the compound: `+PaternalSurname +MaternalSurname` co-occurrence in Keywords — **never** as one phrase (see critical rules) |
| Kinship determination | `+Surname +"daughter of"` or `+Surname +"my beloved wife"` |
| Migration tracing | `+Surname` with successive place filters |
| Enslaved persons | Enslaver surname + slavery keywords (see strategies reference) |

### 5. Construct the search query

Read `references/query-syntax.md` for operator rules.

**Critical rules:**
- **Always use `+` to require terms.** Default is OR, which returns
  millions of irrelevant results.
- **Search by name only first.** Do NOT include place in the initial
  query — place matches collection metadata and causes false
  positives. Apply place as a post-search filter.
- **Do NOT scope a full-text search to a record `collectionId`.** The
  FTS corpus is partitioned into its own auto-generated collections;
  a `collectionId` guessed from `record_search` (or from a collections
  survey) frequently does **not** contain the FTS volume that holds the
  answer, so scoping silently drops it. Search the whole corpus first;
  narrow with the `recordPlace*` / `recordType` / year filters (or a
  known `imageGroupNumber`) only after you have hits. (Real failure: a
  Cantabrian baptism was found by an unscoped `+Naveda +Somarriba` but
  returned **zero** when the same query was scoped to the Diocese-of-
  Santander indexed collection — the record lived in a different FTS
  collection.)
- **Decompose a compound surname into co-occurrence, not a phrase.**
  For an Iberian / Latin-American name (`Given Paterno Materno`, e.g.
  "Francisco **Naveda Somarriba**"), a parent-finding search must
  require the two surnames as separate terms — `+Naveda +Somarriba` —
  **never** the adjacent phrase `+"Naveda Somarriba"`. In the parents'
  own records (the child's baptism, a parent's burial/marriage) the
  father carries the paternal surname and the mother the maternal
  surname, so the two words appear on **different people and are not
  adjacent** — the phrase form only matches where the child's own
  compound name is written out, missing exactly the parentage records
  you are after. Also try the mother's fuller form as a phrase paired
  with the father's surname (`+"Somarriba González" +Naveda`) to cut
  noise once you know it.
- **Abbreviations must be searched explicitly.** FTS does not
  auto-expand. If searching for William, also search Wm. If
  searching for Thomas, also search Thos.
- **Mine prior records for known surname variants before querying.**
  Scan existing `research.json` assertions and log entries for the
  target surname. If prior records show a transcription variant
  (e.g., a "Flinn" assertion or log entry when searching "Flynn"),
  include the variant in your initial query set. FTS does not
  auto-expand spelling variants — the work has already been done
  upstream, and ignoring it wastes queries on the wrong spelling.
- **Phrases tolerate one intervening word.** `"Ezekiel Pearce"`
  also matches "Ezekiel John Pearce."
- **Wildcards:** `?` (one char), `*` (zero or more). Cannot appear
  inside quotes or as first character. Minimum 3 literal characters.

**Example queries:**

```
# Basic person search (require both terms). Pass projectPath so the
# host stages results and returns a staged.resultsRef for step 8.
fulltext_search({ keywords: "+Patrick +Flynn", projectPath })

# Phrase search
fulltext_search({ keywords: '+"Patrick Flynn"' })

# Person + boilerplate phrase (will search)
fulltext_search({ keywords: '+"Thomas Flynn" +"Last Will and Testament"' })

# FAN cluster (target + associate)
fulltext_search({ keywords: "+Flynn +Brennan" })

# Compound-surname parentage: co-occurrence of the two surnames,
# UNSCOPED (no collectionId) — the two surnames sit on the mother and
# father separately, so they are not adjacent. Do NOT write it as the
# phrase +"Naveda Somarriba".
fulltext_search({ keywords: "+Naveda +Somarriba", projectPath })
fulltext_search({ keywords: '+"Somarriba González" +Naveda', projectPath })

# Wildcard for HTR errors
fulltext_search({ keywords: "+Fl?nn +Patrick" })

# Abbreviation variant (separate query)
fulltext_search({ keywords: "+Wm +Flynn" })

# Natural language search
fulltext_search({ nlQuery: "Search for John Doe born in Austria" })

# Search by tree person ID
fulltext_search({ nlQuery: "KD96-TV2" })

# Search within a specific volume
fulltext_search({ imageGroupNumber: "4057677" })
```

**When searching a specific volume:** Use the Image Group Number field to restrict to one digitized volume, then add keywords.

### 6. Execute and iterate

Call `fulltext_search` with the constructed query. This skill **logs
every search**, so `projectPath` (the absolute path to the project
folder) is **mandatory on every call** — never omit it. When supplied,
the host stages the raw results and the response gains a
`staged.resultsRef` handle you hand to `research_log_append` in step 8
to retain them — you never serialize the payload yourself.

**Always log the search (step 8) — that is unconditional; never skip it.**
`projectPath` on the call is what earns the log entry its results sidecar: the
response comes back with a `staged.resultsRef` you hand to `research_log_append`.
If you omitted `projectPath` (no `staged.resultsRef`) or hit a `stagingError`,
re-run the identical query **with** `projectPath` and log **that** staged re-run,
so the entry gets its sidecar. Why the sidecar matters: a sidecar-less search
entry can't feed extraction — `record_persona_id` is auto-filled from the
sidecar, and `research_append` rejects an assertions append against a
sidecar-less search — so **re-stage before any handoff to extraction**. A
missing handle is a reason to re-run and re-log, never a reason to skip logging.
If a `stagingError` persists across one retry, surface it to the user. (A nil
search correctly has no `staged.resultsRef` — nothing was found to retain; that
is expected.)

**Decision rules by hit count:**
- **0 results** → See step 10 (handle nil results)
- **1–50 results** → Review all
- **50–500 results** → Add Year/RecordType filter
- **>500 results** → Add a second required term (`+associate`,
  `+occupation`, `+landmark`) or add place filter

**If searching a collection-specific quirk:** Read
`references/transcription-quirks.md` for HTR error patterns,
era-specific handwriting issues, and coverage gaps.

### 7. Triage results

For each result, evaluate match quality:

**Quick triage:**
- Does the target name appear in the textDocument?
- Is the name in the right context (witness signature, will clause,
  deed party) or a false positive (cross-column alignment, place
  name matching)?
- Is the place and approximate date consistent?

**Attachment check:** After narrowing to promising results, call
`source_attachments({ uris: [ark1, ark2, ...] })` to check whether
each record is already attached to a tree person.
- **Attached to the target person** → deprioritize for extraction
  unless the user wants to re-examine it.
- **Attached to a different person** → flag as potentially relevant
  (could be a family member or duplicate).
- **Unattached** → prioritize for extraction — this is new evidence.

**Present triage to the user:** List the top results with match
quality, context (what role the person plays in the document), and
attachment status. Let the user confirm which records to examine in
detail.

### 8. Retain results and write the log entry

**Every search gets a log entry and retains its results — no
exceptions.** Call `research_log_append` once per search. The tool
assigns the log id and `performed` timestamp, finalizes the staged
results into the `results/<log_id>.json` sidecar (recomputing the
count), and validates-before-persist — you supply only the judgment
(outcome, counts, notes) and the staged handle:

```
research_log_append({
  projectPath,
  planItemId: "pli_010",          // null for an ad-hoc search
  tool: "fulltext_search",
  query: {
    keywords: "+Flynn +\"Last Will and Testament\"",
    recordPlace1: "Pennsylvania",
    recordPlace2: "Schuylkill",
    yearFrom: 1870,
    yearTo: 1890
  },
  outcome: "positive",            // your judgment: positive/negative/partial/error
  resultsExamined: 5,
  resultsAvailable: 47,           // upstream totalResults, or null
  notes: "47 Schuylkill will hits 1870–1890; 5 examined. Thomas Flynn's will (1881) names wife Mary and children Patrick, John, Margaret; Flynn also appears as a witness on two unrelated wills.",
  stagedResultsRef: staged.resultsRef   // omit for a nil search
})
```

`notes` is a one-line human summary of what the search returned. For a
**nil** search, omit `stagedResultsRef` entirely (no sidecar is
written) and set `resultsExamined: 0`.

**Recovery.** If the search response is stale or the
`staged.resultsRef` handle has expired (the host's staging TTL lapsed),
re-run the `fulltext_search` (with `projectPath`) to re-stage — it is
cheap. If `research_log_append` returns `{ ok: false, errors }`, surface
the errors to the user rather than retrying blindly.

### 9. Update plan item status

Route the plan-item `status` mutation through `research_append`
(it validates-before-persist and writes nothing on `{ ok: false }`):

```
research_append({
  projectPath,
  section: "plan_items",
  op: "update",
  planId: "pl_003",        // the parent plan's pl_ id
  entryId: "pli_010",      // the plan item's pli_ id
  fields: { status: "completed" }
})
```

Set `status` to:
- `completed`: Search executed regardless of outcome
- `skipped`: The search was determined to be unnecessary (e.g., the
  question was already answered by a prior search)

### 10. Handle nil results

When a search returns no results:

1. Log the nil result via `research_log_append` with `outcome:
   "negative"`, `resultsExamined: 0`, and **no** `stagedResultsRef`
   (a nil search retains no sidecar). **The `notes` field on a negative log entry must explicitly state the collection class searched, the place filters and date range applied, the spelling/variant forms queried, and the count of variants tried before declaring negative** (for example: "Searched FamilySearch FTS, FamilySearch Probate collections, Schuylkill County, Pennsylvania, 1870–1890; 5 variants tried (+'Patrick Flynn', +Patrick +Flynn, +Patrick +Flinn, +Patrick +Flunn, +Flynn surname-only); 0 results — FTS coverage gap probable; recommend indexed search-records or volume browse"). A bare "no results" note is insufficient for the GPS exhaustive-search audit trail; the future reader must be able to see the search scope without re-deriving it from the query payload.
2. **Iterate through variants before declaring negative — but cap
   total queries (initial + retries) at 5 per plan item.** Pick the
   most promising 4 variants from `references/search-strategies.md`
   (decision tree) and `references/online-search-literacy.md`
   (nil-result checklist) for the specific record class and locality;
   do not exhaustively walk the full variant catalogue. Log each
   retry separately. Once you have logged 5 nil queries for the same
   subject, stop and declare a coverage gap — additional retries
   produce diminishing returns and inflate the tool-call budget
   without changing the answer.
3. **Verify coverage exists.** A nil result may mean the record was
   never transcribed — not that it doesn't exist.
4. **Assess whether absence is meaningful** (negative evidence) —
   only when coverage is known to be good for that locality/period.
5. Check for fallback plan items or suggest search-records/re-plan.
6. **Do NOT execute unrelated diagnostic queries to "test" the FTS
   index.** When a long string of variant queries returns zeros, the
   right next step is to declare a coverage gap and log the negative
   finding — not to query a common surname (`+Smith`, `+Jones`) to
   see whether the tool is "broken." The tool's response is
   authoritative. Diagnostic probes both inflate Tool Arguments cost
   on unrelated subjects and rationalize away genuine negative
   findings as "must be a test environment issue."

### 11. Queue cross-reference searches

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

### 12. Pass records to extraction

For each promising record, invoke record-extraction to process it.
FTS results include transcript text — pass this context along.

### 13. Present results

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

## Important rules

- **Always use `+` to require terms.** Default is OR (millions of
  irrelevant results).
- **Search name first, filter place after.** Place in the query
  causes metadata false positives.
- **FTS results are derivative sources.** Always verify against the
  original image.
- **A nil result does not prove absence.** Try variants before
  declaring negative; log exact parameters for reproducibility.
- **Log every search.** Including nil results. The log is the GPS
  audit trail.
- **Let the user confirm before extraction.** Never fabricate
  results.
- **Do NOT write to `sources` or `assertions`.** This skill only
  writes to `log` and `plans` (status updates). Creating source
  entries and extracting assertions is record-extraction's job —
  pass promising records there instead.
- **Do NOT add extra fields to plan items.** Plan items have a
  fixed schema (`id`, `sequence`, `record_type`, `jurisdiction`,
  `date_range`, `repository`, `rationale`, `fallback_for`,
  `status`). Do not add `completion_note`, `notes`, or any other
  fields — the schema enforces `additionalProperties: false`.
- **Always use `keywords` for queries.** Do not fall back to
  `nlQuery` when `keywords` queries return few or no results.
  Use `nlQuery` only when the user explicitly asks for a natural
  language search or provides a tree person ID.

## Re-invocation behavior

**Writes:** via `research_log_append`, a new entry in the `log` section
of `research.json` (append-only) plus its `results/log_NNN.json`
sidecar (the tool finalizes the staged payload); and, via
`research_append`, the `status` field on the corresponding plan item.

**On repeat invocation:** always appends a new `log_` entry — re-running
the search is itself a logged event. Updates the plan item's `status`
if applicable.

**Do not duplicate:** the log is append-only and `research_log_append`
only appends (no update or delete), so prior `log_` entries and their
sidecars are never touched. Two consecutive runs of the same query
produce two log entries and two sidecars; that's correct.
