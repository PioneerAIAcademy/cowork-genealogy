# Specification: `record_read` tool

> **Status:** live. Implementation: `packages/engine/mcp-server/src/tools/record-read.ts`
> (the handler, `recordReadTool`, and the tool call, `recordReadMcpTool`) and
> `compactRecordReadAnswer` in
> `packages/engine/mcp-server/src/utils/staged-compaction.ts` (the answer's
> shape at the MCP boundary).

`record_read` reads one FamilySearch historical record and returns it as
simplified GedcomX (`simplified-gedcomx-spec.md`). One read returns every
persona on the record, so reading a second persona of the same record adds
nothing.

## 1. Input

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `recordId` | string | yes | A record-persona ARK (`ark:/61903/1:1:QVS9-DHDB`, `record_search`'s `recordId`) or its bare id (`QVS9-DHDB`). |
| `resultsRef` | string | no | A `record_search` or `record_read` sidecar ref (`results/.staging/<uuid>.json` or `results/<log_id>.json`). Reads the record from that file, with no FamilySearch call. Requires `projectPath`. |
| `projectPath` | string | no | The project directory. Required with `resultsRef`. On a live read it stages the record. |

## 2. The two read modes

- **Live read** (no `resultsRef`). Fetches the persona from FamilySearch's
  record API, converts it with `recordReadDocument` (standard places named in
  English for each fact's date), and adds `imageArk`, `viewerUrl` and
  `birthRanges` (§4).
- **Sidecar read** (`resultsRef`). Finds the element whose `recordId` reduces,
  by bare id, to the caller's, and returns its `gedcomx` as staged, with
  `imageArk` and `viewerUrl` derived from it again. Stages nothing.

## 3. Errors

The handler throws; the server returns `{ error }` with `isError: true`.

- An empty `recordId`.
- A `1:2:` record ARK (record_search's `recordArk`, or a tree source's `url`)
  or a `3:1:`/`3:2:` document-image ARK: refused by `extractEntityId`, on both
  modes, never resolved to some persona.
- FamilySearch 401 (the rejected-token message), 403 (restricted), 404 (not
  found), 429 (rate limit not cleared within the retry budget), any other
  non-2xx.
- Sidecar mode with no `projectPath`, or no element matching the id.

## 4. Fields the handler adds

- **`imageArk`** — the page image's document-image ARK. The requested persona's
  own source refs are tried first, then document order; a source is skipped
  only when it names a `resource_type` that is not `DigitalArtifact*`. Keeps the
  source url's `i=`/`cc=`/`groupId=` params. Absent when the record has no
  page-image source. The persona is found by `findRequestedPersona`
  (`src/utils/requested-persona.ts`): `persons[].id`, or `persons[].ark`
  reduced to its bare id, equal to the bare id of `recordId`.
- **`viewerUrl`** — the FamilySearch viewer URL built from `imageArk`; present
  only with it.
- **`birthRanges`** — persona id → the birth years its stated age implies, from
  `birthRangesFor` (`record-extract.ts`). Absent when no persona has one. Top
  level only, never staged.
- **`staged`** / **`stagingError`** — §5.

## 5. Staging

A live read given `projectPath` writes the record to `results/.staging/` as a
one-element `record_read` envelope, `{ query: { recordId }, results: [{
recordId, gedcomx, indexFields? }] }` (`StagedRecordReadElement`), and returns
`staged: { resultsRef, returnedCount }`. `research_log_append` finalizes it
(`stagedResultsRef`) and `extraction_append` reads it. Staging is best-effort:
on failure the read still returns, with `staged: null` and `stagingError`.

**The staged document is full.** It is written inside the handler, before the
answer is compacted, and keeps every source, id and place.

## 6. The answer

What the caller receives is the handler's document after
`compactRecordReadAnswer(result, recordId)`, applied by `recordReadMcpTool`,
which `server.ts`'s `record_read` arm calls. The type is `CompactRecordReadAnswer`
(`src/types/record-read.ts`).

### 6.1 Cuts

- **Sources.** `sources[]` is replaced by:
  - `citation`: the citation of the requested persona's own source (a
    `resource_type: "Person"` source, or one with no `resource_type`, whose
    `url` reduces to the persona's bare id or ark), else the `Record` source's,
    else the first source's that has one;
  - `recordUrl`: the `Record` source's `url`;
  - `collectionTitle`: the `Collection` source's `title`, only when `citation`
    does not contain it. With no citation on any source, the first source title
    (persona source, Record source, then document order).

  Every `{ref}` list goes with it: on persons, names, facts, relationships and
  relationship facts.
- **Ids.** Name, fact and relationship ids go. `persons[].id` and
  `persons[].ark` stay: relationships and `birthRanges` name personas by id, and
  `merge_warnings`' `merges` pairs do too.
- **`places`** (the top-level place descriptions) goes.
- A relationship `type`'s `http://familysearch.org/types/relationships/` prefix
  goes (`Sibling`, `Grandparent`, `ParentChildInLaw`, `Relative`).
- A name `type` of `BirthName` goes.
- A fact's `place` goes when it equals its `standard_place`.

Kept: `principal`, `gender`, names, facts, relationships, `imageArk`,
`viewerUrl`, `birthRanges`, `staged`, `stagingError`.

### 6.2 The persona cap

Constants in `staged-compaction.ts`: `RECORD_READ_FULL_PERSONAS` = 40 and
`RECORD_READ_STUB_PERSONAS` = 60, the stub count set so a 150-persona household
compacts to at most 39,000 characters (`tests/utils/staged-compaction.test.ts`).

When a record has more than `RECORD_READ_FULL_PERSONAS` personas:

1. Slots are ordered: the requested persona; its one-hop relatives (the other
   end of any relationship naming it), in document order; the principal; then
   every other persona in document order.
2. The first `RECORD_READ_FULL_PERSONAS` in that order stay whole.
3. The next `RECORD_READ_STUB_PERSONAS` become stubs, `{ id, ark?, gender?,
   names }`, with no facts.
4. The rest are left out of `persons`, and `personsOmitted` counts them. Every
   relationship naming an omitted persona, and its `birthRanges` key, go too (an
   emptied `birthRanges` goes).

`persons` keeps document order. With no persona matching `recordId`, step 1
has no requested-persona slot.

### 6.3 Idempotence

Compacting a compacted answer changes nothing: it has no sources, ids or
places left, and the cap picks the same personas again, since the whole ones
precede the stubs in each slot class. The eval harness depends on this
(§8).

### 6.4 Who gets the full document

Only the MCP answer is compacted. These keep the full document:

- the staged sidecar (§5);
- `extraction_append`, which calls `recordReadTool` in-process
  (`DEFAULT_DEPS.readRecord`);
- `same_person`, which calls it in-process for a fetched record.

`tests/tools/record-read.test.ts` pins that only `record-read.ts` imports
`compactRecordReadAnswer` and only `server.ts` imports `recordReadMcpTool`. No read returns the full document to the caller;
`sidecar_read` refuses `record_read` refs.

## 7. `merge_warnings`

The answer is passed to `merge_warnings` as `candidateGedcomx` as it is.
`sanitizeCandidate` (`merge-shared.ts`; `merge-gedcomx-spec.md` §5b.2) makes it
a valid tree candidate, full or compacted: it mints the missing name, fact and
relationship ids, sets a missing `gender` to `Unknown` and a missing
`given`/`surname` to `""`, drops titleless sources and relationships that are
not ParentChild or Couple, and, when the candidate has no `sources`, builds
one source `S1` from `citation`, `collectionTitle` and `recordUrl`. Its title
is `collectionTitle`, else the first double-quoted run of `citation` with
trailing punctuation removed (FamilySearch often quotes the title with its
comma, `"United States Census, 1860,"`), else the citation.

That rebuilt source is what keeps `hasSameCensus` working: a persona with no
source refs reads every candidate source title. **Known limit:** a tree census
source titled per person (`Henry Gaetjen, "United States Census, 1940"`) does
not equal the rebuilt collection title, so the check does not fire against it.
`extraction_append` titles new tree sources with the collection name.

## 8. The eval harness

`eval/harness/harness/mock_mcp.py` serves `record_read` from fixtures and runs
the compiled `compactRecordReadAnswer` on every served answer, after
`birthRanges`, staging and the `indexFields` strip, with the agent's call
`recordId` (never the fixture's `~`-prefixed predicate). The fixtures stay in
the full shape; the staged sidecar and the `extraction_append` records map stay
full, as production's do.
