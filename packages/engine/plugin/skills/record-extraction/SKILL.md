---
name: record-extraction
model: claude-sonnet-4-6
description: >-
  Extracts GPS-conformant assertions from genealogical records and owns
  their evidence classifications. Acquires and triages the record (MCP
  search result, record ARK, captured PDF, or image), then delegates each
  record to the record-extractor agent, which extracts atomic assertions
  with first-and-final three-layer classifications. GPS Step 2 (citation)
  and Step 3 (analysis). Use when the user says "extract assertions",
  "analyze this record", "what does this record say", "process this
  record", after search-records or search-external-sites finds a record,
  when the user uploads a PDF or image of a record — and ALSO for
  classification refinement, e.g. "classify this evidence", "primary or
  secondary?", "reclassify these assertions", "evaluate the informant",
  or when the user questions an existing classification (classification
  is set at extraction and refined here; there is no separate
  classification skill). Do NOT use when the user wants to search for
  records (use search-records or search-external-sites) or wants to
  format citations (use citation).
allowed-tools:
  - record_read
  - volume_search
  - research_log_append
---

# Record Extraction (router)

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

This skill is a **thin router**. It acquires and triages record input,
writes the research-log entry, then delegates each record to the
`record-extractor` agent (`@plugin:record-extractor`), which owns
extraction, classification, and persistence in a fresh context. **Inline
extraction is forbidden** — you never write assertions, sources, or tree
entries yourself (the persistence tools are not in your allowed-tools),
and you never re-derive classifications the agent already wrote.

## Inputs — acquire and triage

Record data arrives in one of four ways:

1. **MCP search result in context** — search-records ran `record_search`
   and you hold the compact result stubs. The stubs are enough to
   *triage* which records to extract; the full gedcomx lives in that
   search's log-entry `results_ref` sidecar. Do NOT fetch anything —
   pass `recordId` + that `resultsRef` in the delegation and the agent
   reads the record out of the sidecar. If the full record content is
   already in context (e.g. pasted into the conversation), pass the
   content itself instead. **Never `Read` the sidecar file yourself** —
   you already hold each `recordId`, and loading the whole
   `results/<log_id>.json` reloads every staged result into context.

2. **Record ARK or entity ID** — e.g. `ark:/61903/1:1:QVS9-DHDB` or bare
   `QVS9-DHDB`. If the record came from a staged search, use its sidecar
   (path 1). Otherwise call `record_read({ recordId: "<ark or entity
   id>" })` once to fetch the simplified GEDCOMX — you need it to triage
   and to log — and pass the returned content in the delegation so the
   agent never re-fetches. Never `record_read` a record already read
   this session; reuse the content you have.

3. **PDF capture** — the user uploaded a PDF (Ancestry, MyHeritage,
   FindMyPast, FindAGrave). Read the PDF directly and pass its text in
   the delegation with a `capture:<descriptive>` record id.

4. **Image** — a FamilySearch image ARK (`3:1:.../$dist`) or Image Group
   Number (an imageId like `004022578_00190`). **Do not call `image_read`
   yourself** — delegate to the **`image-reader` subagent** by invoking
   `@plugin:image-reader`, once per image (it reads exactly one). It
   absorbs the base64 scan in an isolated context and returns a full
   text transcription plus an extracted-facts list; the raw image never
   enters your context (accumulated base64 overflows the transport's
   ~1 MiB buffer and crashes the run).

   **`looking_for` is a search key, not the answer.** Phrase it as *who
   or what* to locate — "the christening entry for a Christina born ~Jan
   1783", "any entry naming a Clark" — never the expected result. Do not
   write "confirm the father is Adam Schreck": the reader transcribes
   what the page says; *you* decide whether it contains what you sought.

   Treat the returned transcription as your own reading — present it for
   user review, then pass it (with the capture path / imageId) in the
   extraction delegation so it lands in the source's `transcription`
   field.

   **If the reader returns `NOT READ`** (unreachable ARK, image over the
   transport-safety floor), it includes the verbatim error and a pivot
   recommendation. Do not treat NOT READ as evidence and do not retry
   the image — pivot to **indexes** that carry the same facts: the
   record's own indexed persona fields (`record_read`), a broader
   `record_search` / `search-full-text`, a Find A Grave entry, or
   related persons' indexed records. Never fill the gap with an assumed
   reading, and never try a browser, "Claude in Chrome", or `web_fetch`
   — unavailable here; they only waste turns.

   To find images without a URL, use `volume_search` by `standardPlace`
   + year range to discover digitized volumes, then invoke
   `@plugin:image-reader` once per specific image you land on. Reserve
   image transcription for facts that exist *only* on the image; when
   even that is blocked, log the gap and continue via indexes.

   **A required identifying name you flag as suspect is not confirmed by
   the index alone.** When the element that *keys identity* — a
   patronymic, a surname, a father's name on a baptism — looks like a
   likely mistranscription (an out-of-place patronymic, a spelling no
   other record corroborates), treat the indexed value as a lead: route
   to the original register image (`volume_search` +
   `@plugin:image-reader`) to confirm the spelling before it is recorded
   as established. If the image is unreachable, tell the extractor to
   record the name **tentative** — `[?]` in `value`, the doubt in the
   bias notes, original-image confirmation named as the outstanding
   step. (This is how an index OCR slip — "Aadnesen" read as "Nadnesen"
   — becomes a wrong father in the tree.)

## Log entry — router-side, before delegating

**Only when no search skill already logged this search.** If
search-records or search-external-sites produced the record, reference
their existing `logId` — never create a second entry.

For a user-provided record (pasted text, PDF, image), call
`research_log_append` with `tool: "user_provided"`. For a record you
fetched via a `record_search` run with `projectPath`, pass that
response's `staged.resultsRef` as `stagedResultsRef` so the host
finalizes the `results/<log_id>.json` sidecar (staged handles expire
~24h — on a stale-handle `{ ok: false }`, re-run the search and pass the
fresh one). A **`record_read`**-fetched record has no staged sidecar:
log it (tool `record_read`) with no `stagedResultsRef`, and do **not**
hand-write a `results/<log_id>.json` for it — a manual sidecar is
flagged as an orphan and blocks every subsequent write. The log is
append-only.

Use the resulting `logId` in the delegation below.

## Per-record delegation

For **each** record, invoke `@plugin:record-extractor` **once** — the
same subagent-delegation mechanism `/research` uses for its mentor — with
a delegation message carrying:

- `projectPath` — absolute path to the project directory
- `recordId` — the record's ARK / `ancestry:...` / `capture:...` id
- the record content you hold (search-result gedcomx, `record_read`
  response, PDF text, or image transcription + capture path) **or** the
  sidecar `resultsRef` for a staged search result
- `logId` — the log entry from the step above (or the search skill's)
- open research question ids this record bears on
- flags when applicable: "user asked to check FamilySearch matches",
  "the <element> is a suspect transcription — record it tentative
  pending image confirmation"

One record per invocation; several records = several invocations, each
carrying its own content. The agent extracts every assertion, writes the
source + assertions in one composite `research_append`, creates sibling
person stubs when the subject is a child on a household record, and
returns a ≤10-line summary.

**Classification refinement requests route the same way.** "Reclassify
these evidence types", "is this informant primary or secondary?" — find
which record(s) the named assertions came from (`record_id` /
`source_id` in `research.json`) and delegate per record with the
refinement request; the agent updates classifications in place. Do not
re-classify inline in this context.

## Present and continue

Relay the agent's compact summary to the user — source id, assertion
counts, tree changes, key findings (including any "original not
examined" or tentative-name flag), next step. Do not re-print
per-assertion detail; it is already persisted.

Then **keep going in the same turn**: if more records are queued,
delegate the next one now; if this was the last record, hand off to the
next skill in the workflow (check-warnings for new tree persons, then
person-evidence) or return to the orchestrator that invoked you.
Presenting a summary and yielding with records still unextracted is a
failure — the summary is a progress marker, not a stopping point.

## Tool availability

**If `record_read`, `volume_search`, or `research_log_append` are not
immediately available** (e.g., shown as deferred), call ToolSearch first
with the fully-qualified names, e.g.
`query: "select:mcp__genealogy__record_read,mcp__genealogy__volume_search,mcp__genealogy__research_log_append"`
(adjust the server prefix if yours differs), then proceed. **Never fall
back to writing `research.json` or `tree.gedcomx.json` directly** —
direct writes bypass schema validation, id allocation, and the `.bak`
safety net; persistence belongs to the record-extractor agent's tools.

## What this skill does not do

- **No inline extraction or classification** — every assertion, source,
  and classification is written by the `record-extractor` agent.
- **No image reading in this context** — `@plugin:image-reader` only.
- **No searching** — search-records / search-external-sites find
  records; this skill processes ones already found or provided.
- **No citation polishing** — the agent writes working citations; the
  citation skill refines them.

## Re-invocation behavior

Safe to re-run on a record already extracted: the agent detects the
existing source (by `gedcomx_source_description_id` or working citation)
and refines it in place instead of duplicating. Always append a new log
entry for a genuinely new search/provision; never modify existing log
entries (see `docs/specs/research-schema-spec.md` §4).
