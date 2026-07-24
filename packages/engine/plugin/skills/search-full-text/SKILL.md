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

- **What's searched:** Raw transcript text, not structured name/date/place fields.
- **No fuzzy matching.** Exact text only — no nicknames, phonetic variants, or Soundex.
- **No abbreviation expansion.** Must search Wm and William separately.
- **Default is OR** — at least one term must appear. Always use `+` to require terms.
- **Unique strength:** Finding non-principal mentions (witnesses, neighbors, heirs).

FTS results are derivative sources (original → image → AI transcript →
textDocument, ~10% error rate). **Always verify against the original image.**

## Steps

### 1. Identify the plan item to execute

Read `research.json` `plans[]` and find the next plan item with
`status: "planned"` that targets full-text search. If the user
specifies a particular search, match it to a plan item or create
an ad-hoc search (with `plan_item_id: null` in the log).

### 2. Evaluate coverage and choose search philosophy

Before constructing any query, verify FTS covers the target.
Read `references/online-search-literacy.md` for the evaluation
checklist (~6,665 searchable collections; ~10% transcription error
rate). **Default to "less is more"** — no fuzzy matching means every
extra required term risks missing transcription variants:

- **Uncommon surname** → `+Surname` only, filter after
- **Common surname** → `+Surname +Associate` or `+Surname +Keyword`
- **Very common surname** → multiple required terms or phrase search

### 3. Determine the search strategy

Read `references/search-strategies.md` for the full strategy catalog.

| Research goal | Query approach |
|---|---|
| Find person as witness/appraiser/heir | `+Surname` in Name field, place filter after |
| Find person in narrative records | `+GivenName +Surname` in Keywords, place filter after |
| FAN cluster search | `+TargetSurname +AssociateSurname` in Keywords |
| Compound surname parentage (Iberian `Paterno Materno`) | `+PaternalSurname +MaternalSurname` co-occurrence — **never** as one phrase (see step 4 rules) |
| Kinship determination | `+Surname +"daughter of"` or `+Surname +"my beloved wife"` |

### 4. Construct the search query

Read `references/query-syntax.md` for operator details and wildcards.

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
  narrow with `recordPlace*` / `recordType` / year filters (or a
  known `imageGroupNumber`) only after you have hits.
- **Decompose a compound surname into co-occurrence, not a phrase.**
  For an Iberian / Latin-American name (`Given Paterno Materno`, e.g.
  "Francisco **Naveda Somarriba**"), require the two surnames as
  separate terms — `+Naveda +Somarriba` — **never** `+"Naveda
  Somarriba"`. The parents' own records name the father with the
  paternal surname and the mother with the maternal, so the words are
  on **different people and not adjacent**. See `references/query-syntax.md`
  for escalation once the mother's fuller form is known.
- **Abbreviations must be searched explicitly.** FTS does not
  auto-expand (Wm/William, Thos/Thomas). Run separate queries.
- **Mine prior records for known surname variants before querying.**
  Scan existing `research.json` assertions and log entries for the
  target surname. If prior records show a transcription variant,
  include it in your initial query set.

**Example queries:**

```
# Require both terms; always pass projectPath for result staging
fulltext_search({ keywords: "+Patrick +Flynn", projectPath })

# Compound-surname parentage: co-occurrence, UNSCOPED (no collectionId)
fulltext_search({ keywords: "+Naveda +Somarriba", projectPath })

# Natural language search / tree person ID
fulltext_search({ nlQuery: "KD96-TV2" })

# Wildcard for HTR errors
fulltext_search({ keywords: "+Fl?nn +Patrick" })
```

### 5. Execute and iterate

Call `fulltext_search` with the constructed query. This skill **logs
every search**, so `projectPath` (the absolute path to the project
folder) is **mandatory on every call** — never omit it. When supplied,
the host stages the raw results and the response gains a
`staged.resultsRef` handle you hand to `research_log_append` in step 7
to retain them — you never serialize the payload yourself.

**Always log the search (step 7) — that is unconditional; never skip it.**
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
- **0 results** → See step 9 (handle nil results)
- **1-50 results** → Review all
- **50-500 results** → Add Year/RecordType filter
- **>500 results** → Add a second required term or place filter

Read `references/transcription-quirks.md` for HTR error patterns.

### 6. Triage results

For each result, evaluate match quality:
- Does the target name appear in the textDocument?
- Is the name in the right context (witness, will clause, deed party)
  or a false positive (cross-column alignment, place name matching)?
- Is the place and approximate date consistent?

**Attachment check:** After narrowing to promising results, call
`source_attachments({ uris: [ark1, ark2, ...] })` to check whether
each record is already attached to a tree person.
- **Attached to the target person** → deprioritize for extraction.
- **Attached to a different person** → flag as potentially relevant.
- **Unattached** → prioritize for extraction — this is new evidence.

Present triage to the user with match quality, document role, and
attachment status. Let the user confirm which records to examine.

### 7. Retain results and write the log entry

**Every search gets a log entry — no exceptions.** Call
`research_log_append` once per search:

```
research_log_append({
  projectPath,
  planItemId: "pli_010",          // null for ad-hoc
  tool: "fulltext_search",
  query: { keywords: "+Flynn +\"Last Will and Testament\"",
           recordPlace1: "Pennsylvania", yearFrom: 1870, yearTo: 1890 },
  outcome: "positive",
  resultsExamined: 5,
  resultsAvailable: 47,
  notes: "47 Schuylkill will hits 1870-1890; 5 examined.",
  stagedResultsRef: staged.resultsRef   // omit for a nil search
})
```

For a **nil** search, omit `stagedResultsRef` and set
`resultsExamined: 0`. If `staged.resultsRef` has expired, re-run the
`fulltext_search` with `projectPath` to re-stage.

### 8. Update plan item status

Route the plan-item `status` mutation through `research_append`:

```
research_append({
  projectPath,
  section: "plan_items",
  op: "update",
  planId: "pl_003",
  entryId: "pli_010",
  fields: { status: "completed" }
})
```

Set `completed` (search executed) or `skipped` (unnecessary).

### 9. Handle nil results

When a search returns no results:

1. Log the nil result via `research_log_append` with `outcome:
   "negative"`, `resultsExamined: 0`, and **no** `stagedResultsRef`.
   **The `notes` field must explicitly state the collection class
   searched, place filters and date range applied, spelling/variant
   forms queried, and count of variants tried before declaring
   negative.** A bare "no results" note is insufficient for the GPS
   exhaustive-search audit trail.
2. **Iterate through variants before declaring negative — but cap
   total queries (initial + retries) at 5 per plan item.** Pick the
   most promising 4 variants from `references/search-strategies.md`
   and `references/online-search-literacy.md`; log each retry
   separately. After 5 nil queries, declare a coverage gap.
3. **Verify coverage exists.** A nil result may mean the record was
   never transcribed — not that it doesn't exist.
4. Assess whether absence is meaningful (negative evidence) — only
   when coverage is known to be good for that locality/period.
5. Check for fallback plan items or suggest search-records/re-plan.
6. **Do NOT execute diagnostic queries** (`+Smith`, `+Jones`) to
   "test" the FTS index. The tool's response is authoritative.

### 10. Queue cross-reference searches

Suggest sub-searches for named non-target persons (witnesses,
executors, appraisers), distinctive landmarks, and slaveholder-enslaved
name pairs. See `references/search-strategies.md` for triggers.

### 11. Pass records to extraction

For each promising record, invoke record-extraction to process it.
FTS results include transcript text — pass this context along.

### 12. Present results

Summarize what was searched and found, highlighting non-principal
mentions (FTS's unique value). Show log entries, plan progress, and
suggest next steps (more plan items, cross-references, or re-plan).

## Important rules

- **Do NOT write to `sources` or `assertions`.** This skill only
  writes to `log` and `plans` (status updates). Creating source
  entries and extracting assertions is record-extraction's job.
- **Do NOT add extra fields to plan items.** Plan items have a
  fixed schema (`id`, `sequence`, `record_type`, `jurisdiction`,
  `date_range`, `repository`, `rationale`, `fallback_for`,
  `status`). The schema enforces `additionalProperties: false`.
- **Always use `keywords` for queries.** Do not fall back to
  `nlQuery` when `keywords` queries return few or no results.
  Use `nlQuery` only when the user explicitly asks for a natural
  language search or provides a tree person ID.
- **Log every search** including nil results — the log is the GPS
  audit trail.

## Re-invocation behavior

**Writes:** `research_log_append` appends to `log[]` plus its
`results/log_NNN.json` sidecar; `research_append` updates the plan
item `status`. On repeat invocation, always appends a new `log_`
entry. Prior entries and sidecars are never touched.
