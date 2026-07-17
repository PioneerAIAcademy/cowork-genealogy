# Search-tool shaping + sidecar-staging integrity — implementation plan

> Covers GitHub #696 (oversize search-tool results) and #699 (upstream
> sidecar-staging gap). Two independent PRs, split by issue. Neither depends
> on the other landing first.

## Problem, verified against the code

### #696 — oversize search-tool results
`fulltext_search` and `external_links_search` return 79–136 KB payloads that
overflow the tool-result token cap, spill to files, and cost a reader-subagent
detour (closing report §3.5, 4 runs).

- **`fulltext_search`** already *stages* when `projectPath` is passed
  (`fulltext-search.ts:223-234`) but — unlike `record_search` — never strips
  the inline copy. Every result still carries its full AI-transcribed
  `textDocument` (`mapEntry`, line 120). `record_search` solved the identical
  problem by deleting the heavy inline field once staged
  (`record-search.ts:546-551`, `delete r.gedcomx`). `fulltext` simply never
  got the parallel treatment.
- **`external_links_search`** does not stage at all and deliberately returns
  the *entire* filtered set in one response (`external-links-search.ts:129-176`,
  "no pagination"). Its overflow is result **count** (each item is a small
  `{ url, linkText }`), not per-item size. It also retains nothing to disk —
  the `search-external-sites` skill consumes the links inline and only logs the
  generated external-site URL (SKILL.md:281-282, "External-site searches retain
  no result sidecar").

### #699 — sidecar-staging gap
D2 auto-fill (`research-append.ts:1019-1115`) resolves `record_persona_id` by
matching each assertion against its log entry's **sidecar**. With no sidecar
(`results_ref` null) it cannot fill anything: a supplied persona id is
*rejected* (line 1028-1036), an omitted one is *silently left null*
(the fall-through past line 1037). One e2e run (spriggs) staged no sidecar, so
all 18 persona ids came back null and identity was unrecoverable.

Both search skills already *instruct* passing `projectPath`, but nothing
hard-stops the model from proceeding when the response comes back `staged: null`
(either `projectPath` omitted, or `stagingError` set). And the null-persona
outcome at the append boundary is silent.

**Nuance that constrains the fix:** a null `results_ref` is *legitimate* for
`record_read` / PDF / image / pasted-record log entries — those carry no
personas by design (comment at `research-append.ts:1026`). So the loud warning
must fire only on the *anomalous* case (a search that should have staged but
didn't), never on every sidecar-less assertion.

---

## PR 1 — #696: shape oversize search results + persist external links

Cohesive unit: bound both tools' inline payloads, and give `external_links`
the same disk-persistence the other search tools have so its results ride along
in a "submit feedback" zip (which bundles `results/log_*.json`,
feedback-case-spec.md:367,434).

### 1a. `fulltext_search` — strip inline when staged (tool)
`fulltext-search.ts`: after staging succeeds (`out.staged` truthy), delete the
heavy fields from each inline result. Mirror the `record_search` comment +
guard exactly:

```ts
if (out.staged) {
  for (const r of out.results) {
    delete r.textDocument;   // the 79–136 KB driver; full copy lives in the sidecar
  }
}
```

- Strip **only** `textDocument`. Leave `names`/`places`/`dates`/`highlightTerms`
  /`title`/`recordType` — those are the triage stubs, small, and what the skill
  reads inline.
- Strip **only when staged**, never on an un-staged exploratory search (nothing
  was retained to re-read) — identical to `record_search`.
- `record_read` already reads a fulltext record's full text from the sidecar via
  the staged ref, so no consumer loses access to `textDocument`.

### 1b. `external_links_search` — add staging + host-side filter (tool)
**Resolved after review: host-side filter, not a blind cap.** The sole
consumer (`search-external-sites`) filters the flat `results[]` by host *inline*
(`SKILL.md:157-160`, `result.url.includes("ancestry.com")`) and never reads the
sidecar during the skill, so a blind first-N cap can drop the target site's link
on exactly the large places that overflow — regressing the feature. Types to
edit live in `external-links-search.ts` (interface `ExternalLinksSearchInput:10`,
schema `:178`) and `types/external-links-search.ts` (`ExternalLinksSearchResult`
`:30-42`), not `tool-schemas.ts` (which only re-exports).

- Add optional **`projectPath`** (camelCase) — when present, stage the full,
  pre-filter set via `stageSearchResults({ tool: "external_links_search", response })`
  and return `staged: { resultsRef, returnedCount }`. Additive, best-effort,
  never fails the search (same try/catch as fulltext/record). **Stage the full
  set BEFORE any inline filtering/slicing** — staging serializes `response`
  and derives `returned_count` at call time (`results-staging.ts:71-81`), same
  order as `record-search.ts` (stage `out`, then trim `out.results`).
- Add optional **`host`** — when present, filter `results[]` to links whose URL
  contains that host (server-side), returning the small exact set the skill
  needs. When omitted, behavior is unchanged (return all) but still capped by a
  generous backstop `INLINE_CAP` for the general/exploratory case. The full,
  unfiltered set is always what gets staged to disk (for feedback).
- Add `staged?` and a `returned` count to `ExternalLinksSearchResult`
  (`types/external-links-search.ts` — currently only `query`/`totalForPlace`/
  `results`).

### 1c. `search-external-sites` skill — pass `projectPath`, keep the handle (skill)
`search-external-sites/SKILL.md`:

- Step 2: call `external_links_search({ standardPlace, startYear, endYear,
  projectPath })`.
- Wire the returned `staged.resultsRef` into the step-4 `research_log_append`
  as `stagedResultsRef`, so the curated links finalize into
  `results/log_NNN.json` and land in feedback zips. Update the "External-site
  searches retain no result sidecar" note (SKILL.md:281-282) accordingly.

**Resolved after review: option B is the only correct choice.**
`finalizeStagedResults` hard-checks the staged envelope's `tool` against the log
entry's `tool` (`results-staging.ts:127`; `research-log-append.ts:241` passes
`expectedTool: input.tool`). Attaching an `external_links` staged ref to the
existing `tool: "external_site"` entry (option A) would throw a tool-mismatch
and write nothing. So the `external_links` fetch gets its **own** log entry
(`tool: "external_links_search"`, its own `results_ref` sidecar), consistent with how
`record_search`/`fulltext_search` log. This validates cleanly with no schema
change: log `tool` is a free string in both the hand validator (`validator.ts:646-682`,
no enum on `tool`) and `research.schema.json:307`; `external_site` is
required-but-nullable; `results_ref` is an allowed nullable key.

### 1d. Tests / wiring (PR 1)
- Unit tests: fulltext strips `textDocument` when staged, keeps it when not;
  external_links stages when `projectPath` given, caps inline, best-effort on
  staging failure.
- Update `dev/try-fulltext-search.ts` / `dev/try-external-links-search.ts` if
  they assert on the stripped/added fields.
- Add `projectPath` + `host` to the `external_links_search` schema and the
  `ExternalLinksSearchInput` interface — both in **`external-links-search.ts`**
  (`tool-schemas.ts` only re-exports). **No `manifest.json` change** (params
  only). **No `packages/schema` mirror / schema blast-radius** — `projectPath`/
  `host` are MCP tool *input* schema, and the D2 change rides the existing
  `errors`/`warnings` channels: neither touches `research.schema.json`.
- Update `docs/specs/search-result-staging-spec.md` to add `external_links` to
  the list of staging producers, and note the fulltext inline-strip.

---

## PR 2 — #699: staging-integrity gate + loud null at the boundary

### 2a. Hard-gate the two search skills on `staged` (skill)
`search-records/SKILL.md` and `search-full-text/SKILL.md`: turn the existing
soft guidance into a hard stop. A results-returning search that comes back with
`staged: null` (because `projectPath` was omitted, or `stagingError` is set)
**must not proceed** to ranking / extraction / logging-as-if-staged. Required
recovery: re-run the identical query **with** `projectPath`; if `stagingError`
persists, surface it to the user rather than proceeding with unrecoverable
persona identity. `search-full-text` already has a soft version of this
(SKILL.md:212-215) — make it a hard gate and mirror the wording in
`search-records`.

### 2b. Loud failure at the D2 boundary (tool)
`research-append.ts`, D2 block, the `if (!ref)` branch (`:1025`). Today: a
supplied `record_persona_id` with no sidecar is *rejected* (`:1028-1036`); an
omitted one silently falls through and the assertion persists with
`record_persona_id: null` — the exact silent loss #699 is about.

**Resolved after review: reject (error), not warn.** A bare warning still lets
the null land on disk, which is precisely #699's complaint, and the D2 block
already *rejects* the adjacent case one branch over — a warning would be the odd
exception in a validate-before-persist gate. Push the error via the existing
`errors` array (same `errors.push(fmt(i, …))` used throughout D2); no new
response field.

**Condition (finalized):** the log entry's `tool` ∈ {`record_search`,
`fulltext_search`} **and** `results_ref` is null **and** the search actually
found something (`outcome` ∈ {`positive`,`partial`} or `results_examined > 0`).

- Drop `external_links` from the producer set — those entries never carry
  personas, so no assertion resolves against one; it would only add
  false-positive surface.
- The outcome/`results_examined` gate is required: a **nil/negative**
  `record_search` legitimately has `results_ref: null` (`stageSearchResults`
  returns `null` for zero results, `results-staging.ts:48`), and a
  negative-evidence assertion citing it must NOT trip the error. Both fields are
  always present on the entry (`research-log-append.ts:210-211`).
- `record_read` / PDF / image / pasted entries never match (`tool` not a
  producer), so they never error. `tool` is reachable — `logById.get(logId)`
  at `:1022`, and `tool` is a required log-entry field (`validator.ts:647`).
- Message: names the log id, states persona identity is unrecoverable, and
  instructs re-running the search **with `projectPath`** to re-stage. This is
  the tool-side backstop for the skill gate in 2a; when 2a works the model never
  reaches this error.

### 2c. Tests (PR 2)
- Unit test: assertions-append against a positive/partial `record_search` log
  entry with null `results_ref` is **rejected** with the re-stage message; the
  same against (i) a `record_read` entry and (ii) a nil/negative `record_search`
  entry is **accepted** (no false positive).
- Skill-gate behavior is prose; covered by the eval harness, not a unit test.

---

## Sequencing & mechanics
- Two independent PRs off `origin/main` (verified independent — 2a/2b reference
  only pre-existing `staged`/`stagingError`/`results_ref` fields).
- PR 1 on branch `search-shaping-staging` (current worktree). PR 2 on a fresh
  branch off `origin/main` after PR 1 is committed.
- Per repo memory: user reviews/merges PRs; I create + push only.

## Out of scope / TODOs to file
- Optional `site`/`host` filter param on `external_links_search` (1b option B)
  if the count cap proves insufficient on real runs.
- Any judge/eval change to detect null-persona regressions (closing report §4
  notes the judge is blind to provenance nulling) — separate board item.
