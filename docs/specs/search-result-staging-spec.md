# Search-result staging — producer side of Option B — Spec

> **Status:** New (2026-06-19). Implements the producer half of
> `research-log-editor-spec.md` §5 Option B: search tools persist their own raw
> payload host-side and return a **handle**, so `research_log_append` can retain it
> without the LLM ever re-serializing the payload. Pairs 1:1 with that spec — read
> it first.

When a search tool is given the project directory, it writes its verbatim response
to a staging file in the project's `results/.staging/` area and returns a small
`staged` handle alongside the normal model-facing results. `research_log_append`
later finalizes that staged file into `results/<log_id>.json`. The big payload
travels host-side (search tool → disk → log-append); the model carries only the
handle.

---

## 1. Why this exists

The sidecar payload is the verbatim response of `record_search` / `fulltext_search`
— produced on the host, where the search ran. Today the LLM has to re-emit that
whole payload to persist it (`research-log-protocol.md` tells it to "write in
~40-result chunks" because a single `Write` stalls past ~50 results). That
re-serialization is the exact failure the read/write-tool direction exists to kill,
and it's the only thing standing between `research_log_append` and a clean
no-big-write design. Letting the producer stage its own payload removes it: the
payload originates on the host and never needs to round-trip through the model just
to be retained.

This is the symmetric analog of the merge tools reading the tree off disk rather
than taking it as an argument.

---

## 2. Scope

The sidecar-producing search tools: **`record_search`**, **`fulltext_search`**,
and **`external_links_search`** (`tool: "external_links"`) — the tools whose
payloads become `results/` sidecars per `research-log-protocol.md`. The staging
logic is a shared util so adding a producer is a one-line opt-in
(`external_links_search` was added as the third, 2026-07 — GitHub #696).

The change is **purely additive and back-compatible**: no `projectPath` → the tools
behave exactly as today.

**Inline-payload strip (overflow protection).** Once a producer has staged its
full payload, it drops the heavy per-result field from the *inline* copy so a
broad search can't overflow the model's token cap — the bulk lives in the
sidecar, which `record_read` and `rank_search_matches` read host-side. Each
producer strips its own heavy field: `record_search` drops `gedcomx`,
`fulltext_search` drops `textDocument` (the AI-transcribed page), and
`external_links_search` bounds the inline `results[]` (optional `host` filter +
a backstop cap) while staging the full year-filtered set. The strip is
unconditional once staged (so the protection can't be forgotten) and never runs
on an un-staged search (nothing was retained to re-read).

Out of scope: `research_log_append` itself (its spec), the other search tools
(image/volume/collections/person — they don't write `results/` sidecars today), and
any validator rule change.

---

## 3. Evidence base (seen directly)

| Fact | Source |
|------|--------|
| `record_search` returns `{ query, totalMatches, returned, offset, hasMore, results[] }`; each result has `recordId`, `primaryId`, `gedcomx` | `src/tools/record-search.ts:511`, `:413` |
| `fulltext_search` returns `{ query, totalResults, returned, offset, hasMore, results[] }` | `src/tools/fulltext-search.ts:206` |
| For both, `returned === results.length` — i.e. the sidecar `returned_count` invariant | record-search.ts:515, fulltext-search.ts:209 |
| No search tool takes a `projectPath` or writes to the project folder today | `grep writeFile\|mkdir src/tools` → none |
| `validateSidecars` orphan check reads `results/` **non-recursively** and flags only top-level `*.json` not referenced by a log entry | `src/validation/validator.ts:1034–1043` |
| Existing path-traversal guard pattern for project-relative refs | `src/validation/validator.ts:988` |

The orphan-check fact is load-bearing: staging files placed in the
`results/.staging/` **subdirectory** are invisible to that check (it neither
recurses nor matches a directory name against `.json`), so they never read as
orphan sidecars.

---

## 4. The change

Add one optional input to each producer; everything else is unchanged.

```typescript
record_search({ /* …all existing params… */, projectPath?: string })
fulltext_search({ /* …all existing params… */, projectPath?: string })
```

Behavior:

- **No `projectPath`** → identical to today. No staging, no `staged` field.
- **`projectPath` present and `results.length > 0`** → after building the normal
  response, stage it (§5) and add a `staged` handle to the returned object:

  ```typescript
  // returned object = the existing response PLUS:
  staged: { resultsRef: string, returnedCount: number } | null
  //   resultsRef e.g. "results/.staging/<token>.json"
  ```

  The model still receives the full `results[]` for triage — staging changes only
  the *persistence* path, not the *read* path. The model passes `staged.resultsRef`
  to `research_log_append` as `stagedResultsRef`.
- **`projectPath` present but `results.length === 0`** (nil search) → no staging,
  `staged: null`. Nil searches retain nothing (`research-schema-spec.md` §5.4.1).

A shared util — e.g. `src/utils/results-staging.ts` `stageSearchResults({
projectPath, tool, response })` — owns the write, the token, and pruning (§7), so
both producers call one code path.

> Adding `projectPath` to a search tool is the same project-folder access pattern
> `validate_research_schema` already uses (read) and the merge / log tools will use
> (read+write) — not a new architectural seam.

---

## 5. The staging file

- **Location:** `results/.staging/<token>.json` under `projectPath`. The
  `.staging/` subdirectory is mandatory — it is what keeps the orphan check (§3)
  from flagging un-finalized files. `<token>` is a `crypto.randomUUID()`.
- **Shape:** the sidecar envelope minus the not-yet-known `log_id`:

  ```typescript
  { tool: string, retrieved: string /* ISO 8601 + tz, search time */,
    returned_count: number, payload: object /* the verbatim response */ }
  ```

  `payload` is the producer's response object (the one with `results[]`); the
  producer knows `tool`, the `retrieved` timestamp (more accurate than log time),
  and `returned_count` (it counted). snake_case keys — this file *is* persisted
  project state.

The handle returned to the model is just `{ resultsRef, returnedCount }` (enough
for narration like "retained 12 results"); the payload itself is not echoed back as
part of `staged`.

---

## 6. Finalize handshake with `research_log_append`

When the log editor is called with `stagedResultsRef`, it (host-side):

1. Resolves `stagedResultsRef` and **rejects anything not inside
   `projectPath/results/.staging/`** (path-traversal guard, mirroring
   validator.ts:988).
2. Reads the staged file. Verifies its `tool` matches the log entry's `tool`.
3. **Recomputes `returned_count` from `payload.results.length`** — authoritative,
   per `research-log-editor-spec.md` §4 ("never trusted from the caller"); the
   staged file's count is advisory.
4. Wraps it as the full sidecar `{ log_id, tool, retrieved, returned_count,
   payload }` and writes `results/<log_id>.json`.
5. Unlinks the staged file.

This is a host-side byte move — **the model never serializes the payload.** (This
refines the log-editor spec §6's "rename the staged file" wording: it is a wrap +
write + unlink, because `log_id` and the authoritative `returned_count` are injected
at finalize, not a pure rename.)

If `stagedResultsRef` is absent (Option A fallback, or a nil/external-site search),
the log editor behaves exactly as its own spec describes.

---

## 7. Lifecycle & cleanup

- **Cross-turn survival.** The staged file is on disk, so a search in one turn and
  the `research_log_append` in a later turn work without any in-memory cache — the
  reason Option B beats a token cache (§5 of the log-editor spec, Option C).
- **Finalize consumes it.** A successful `research_log_append` unlinks the staged
  file (§6 step 5).
- **Un-finalized staging files** (the LLM searched but never logged, or the turn
  died) are pruned opportunistically: on each `stageSearchResults` write, delete
  `results/.staging/*.json` older than a TTL (24h, by `mtime`). Safe unconditionally
  — nothing in the project ever references a staging file, and the orphan check
  ignores the subdir. No reaper or background job needed.
- **TTL vs. long sessions.** The 24h prune can delete a staged file before a slow
  multi-turn session logs it (search early, `research_log_append` >24h later). That
  is not corruption: the stale `stagedResultsRef` simply fails the finalize guard
  (§6 steps 1–2), and `research_log_append` writes nothing and returns a clear error.
  The **skill** recovers by re-running the search (cheap — it re-stages); the
  consuming skills should document that fallback. Raising the TTL trades disk for
  fewer misses; 24h fits genealogy research cadence and is the v1 default.
- **Read-only consumers.** Besides `research_log_append` (which finalizes), two
  tools read the sidecar without consuming it: `rank_search_matches` (scores every
  staged result against the tree subject) and `record_read` in **sidecar mode**
  (`record_read({ recordId, resultsRef, projectPath })` returns one record's
  gedcomx from the staged/finalized sidecar — no live FS fetch — re-applying place
  standardization so it matches a live read; used by record-extraction /
  search-records to avoid re-fetching a record they already searched). Both share
  the dual-location read helper `readStagedResults` (staged handle OR finalized
  `results/<log_id>.json`) and never unlink, so a staged handle can still be
  finalized afterward.

---

## 8. Back-compat & errors

| Condition | Behavior |
|-----------|----------|
| `projectPath` omitted | identical to today; no `staged` field; existing callers/tests unaffected |
| Staging write fails (dir unwritable, disk error) | **the search still succeeds** — return the normal results with `staged: null` and a `stagingError` note. Retention falls back to the protocol's "results could not be retained" path; never fail a successful search over a retention problem |
| Nil results with `projectPath` | `staged: null`, no file written |
| `projectPath` does not exist / is not a directory | treat as a staging failure (above): results returned, `staged: null`, note |
| Stale/garbage staged file at finalize | handled by `research_log_append` (§6 steps 1–2): traversal-guarded, `tool`-checked; a missing/invalid staged file is a clear log-append error that writes nothing |

The model-facing response gaining an optional additive field is a safe, non-breaking
output change.

---

## 9. Test plan (vitest)

- **No projectPath → no change** — response is byte-identical to the pre-change
  output; no `results/.staging/` created.
- **Stage on hit** — with `projectPath`, a staged file appears at
  `results/.staging/<uuid>.json` with `{ tool, retrieved, returned_count, payload }`;
  `returned_count === payload.results.length`; response carries
  `staged.resultsRef`.
- **Nil → no stage** — zero results yields `staged: null` and no file.
- **Orphan-check immunity** — a project with an un-finalized staged file still
  passes `validate_research_schema` (no orphan-sidecar error), proving the subdir is
  invisible to the top-level scan.
- **Finalize round-trip** — `record_search(projectPath) → research_log_append(
  stagedResultsRef)` produces a valid `results/<log_id>.json` whose `log_id` matches
  the entry and filename, `returned_count` matches, and the `.staging/` file is gone.
- **Traversal guard** — a `stagedResultsRef` pointing outside `results/.staging/` is
  rejected by `research_log_append`; nothing written.
- **TTL prune** — a staging file older than the TTL is removed on the next
  `stageSearchResults`; a fresh one is kept.
- **Staging failure is non-fatal** — an unwritable `results/` yields results +
  `staged: null` + note, not a tool error.

---

## 10. Non-goals

- Not `research_log_append` (own spec) — this spec only defines the staging file it
  consumes and the finalize handshake.
- Not the other search tools — extensible via the shared util but not wired here.
- No validator change — the `.staging/` subdir is already invisible to the orphan
  check; a regression test pins that.
- Does not alter the model-facing `results[]` shape or ranking.

---

## 11. Consumers / cross-refs

- `research-log-editor-spec.md` §5 (Option B), §6 (finalize) — the consumer.
- `search-records` / `search-full-text` skills — pass `projectPath` on the search
  call, then hand `staged.resultsRef` to `research_log_append`; their
  `research-log-protocol.md` references lose the sidecar-writing + chunking
  guidance entirely.
- `validate-project-refactor-spec.md` — unaffected; the staged file is not a sidecar
  until finalized, and the orphan check already ignores the subdir.
