# Standard-place standardization — implementation plan

**Status:** Draft v5 (2026-06-05) — added retry/backoff for standardization;
locked the `standardPlace`(code) / `standard_place`(data) naming split.
**Scope:** Make `standard_place` (a fully-qualified standardized place
NAME) the only place vocabulary above the MCP tool layer — in skills, in
SimplifiedGedcomX, and in persisted research artifacts. Keep `placeId` /
`placeRepId` as private, cached, in-server plumbing.
**Related:** `docs/plan/id-vocabulary-standardization-progress.md` (which
explicitly scoped the placeId chain OUT as "a separate task" — this is
that task), and the `place-search`/`place-search-all` specs, which already
promise "a later phase will route every tool that needs a place ID through
placeSearch so IDs stay inside the server."

> **v2 changes (review-incorporated):** decision #1 (pure converter) is now
> **contingent on a verification probe** + `Accept-Language: en` because
> `place.normalized` is unconfirmed at the read endpoints and is
> locale-sensitive; rollout re-sequenced to **tool+its-skills atomic units**;
> `place_search` gains an explicit `standard_place` field + selection rule;
> `metadata_search` gets a placeId tie-break; added missing update sites
> (eval app TS schema, 3 testing guides, place-collections & gps-mentor specs,
> `types/place.ts`); corrected two false claims (no fixtures carry `place_id`;
> no "wiki country specs" exist).
>
> **v3 change:** populate strategy is now **hybrid** — use `place.normalized`
> when present (locale fragility accepted by the user), and **standardize via
> `place_search` otherwise** (as a network enrichment step in the read tools).
> The §0 probe is downgraded from a go/no-go gate to an optional shape check,
> since the design no longer depends on normalized being present.
>
> **v4 change:** standardization moved **into the converter path** (not the
> read tools) as an async document-level pass (`toSimplifiedStandardized`)
> with **dedup + ≤8-way parallelism**, so the workhorse `record_search` gets
> standardized places too. `place_search` now **always and only returns
> standard places** (`standard_place` is its canonical field). Network in the
> converter path is accepted; the pass is best-effort (never throws) with
> negative-caching + a soft cap.
>
> **v5 change:** place standardization **retries transient failures (≤3,
> backoff + jitter)**; only definitive 0-candidate nulls are cached (transient
> blips are not). Naming locked: **camelCase `standardPlace`** in code surfaces
> (place_search struct, tool inputs, internal TS), **snake_case
> `standard_place`** in the data formats (`SimplifiedFact`, research.json) —
> see §2. The `place_search` result struct is
> `{ standardPlace, type, dateRange?, coords, links }`.

---

## 0. Shape probe (informational — no longer a gate)

The hybrid populate strategy (§1.1) does **not** depend on `normalized`
being present: when it's missing we standardize via `place_search`. So this
is a quick shape check, not a go/no-go gate.

- Write `mcp-server/dev/probe-place-normalized.ts`: call live `person_read`
  and `record_read` for a record with a standardized place and capture the
  **raw** fact `place` block. Confirm the field shape we'll read —
  `place.normalized` as `[{ value, lang? }]` (GedcomX `TextValue[]`) — and
  note how often it's present and in what locale.
- Regardless of the result, add `Accept-Language: en` to the
  person_read/record_read fetch headers as cheap insurance so the normalized
  values trend English (the user has accepted residual locale fragility).

Context: `person-read-tool-spec.md:291,310,509` models `fact.place` as only
`{ original }` and `gedcomx-convert-spec.md:84` as `{ original?, description? }`
— neither models `normalized`, so the type widening in §5.1 is required
regardless. The only repo mention of `.normalized`
(`person-search-tool-spec.md:370-376`, a different endpoint) flags locale
sensitivity, which the user has accepted.

---

## 1. Decisions locked (user, 2026-06-05)

1. **Populate source — in the converter path, dedup + parallelism.**
   `standard_place` = `place.normalized` when present (pure, in
   `toSimplified`; locale accepted, `Accept-Language: en` insurance), **else
   resolved via `place_search`** in an async document-level standardization
   pass (`toSimplifiedStandardized`) that **dedups** distinct place strings
   and resolves them **≤8 in parallel**, best-effort. This runs on *every*
   converter path — including the workhorse `record_search` — so the LLM
   always sees a `standard_place`. Network calls in the converter path are
   explicitly accepted (the converter module owns them; `simplifyFact` stays
   pure). Unresolvable → omit (never guess). See §5.
2. **Rollout — one coordinated effort.** Shared name↔ID resolver + tool
   input migration + converter change + skill rewrites + schema change land
   together, fixing the pre-existing `place_search` drift in the same pass.
   **Unit of change = each place tool *plus* the skills that call it,
   migrated atomically** (see §12) — so no intermediate commit strands a
   skill against a changed tool contract.
3. **research.json — replace `place_id` with `standard_place`.** Drop
   `timelines[].events[].place_id`; store `standard_place`. `place_distance`
   accepts `standard_place` names and resolves to lat/long internally.
   Matches the prior `jurisdiction_place_id → jurisdiction` decision
   (`research-schema-spec.md:1438`); the schema is unversioned, so the
   break is acceptable.

---

## 2. The place model (ground truth)

| Term | Meaning | FS identity | Resolves via |
|------|---------|-------------|--------------|
| **`standard_place`** | Fully-qualified standardized place NAME, e.g. `"Branch Township, Schuylkill, Pennsylvania, United States"` | == `SimplifiedPlaceResult.fullName` | 1:1 with a **placeRepId** |
| **`placeRepId`** | One time-qualified representation | FS "rep" id | `getPlaceById(repId)` → `/platform/places/description/{repId}` → fullName + coords |
| **`placeId`** | A spot on earth (FS "Primary" id) | `extractPrimaryId(...)` | `getPlaceByPrimaryId(placeId)` → `/platform/places/{placeId}` → coords; `getPlaceRepIds(placeId)` → all repIds |

Two endpoints, two id-types — do **not** conflate: `getPlaceById` takes a
**repId** (`/description/{id}`), `getPlaceByPrimaryId` takes a **placeId**
(`/{id}`). Both return coords. `searchPlace(name)` also returns coords per
entry, so a name→coords path needs no second fetch.

Key consequence: **`standard_place` is the 1:1 partner of `placeRepId`, not
`placeId`.** `placeId` only matters when a tool must enumerate *all* of a
spot's representations over time.

Uniqueness caveat: `fullName` is **not guaranteed globally unique** — two
reps at different dates can share a `fullName` (differ only by `dateRange`),
and in principle two distinct `placeId`s could too. See §11 (resolution
policy + null-on-ambiguity).

**Naming convention (`standardPlace` vs `standard_place`).** The string
value is identical; only the key casing differs by surface:
- **camelCase `standardPlace`** in all *code* surfaces — the `place_search`
  output struct (cf. `fullName`/`dateRange`), every tool **input** param
  (cf. `placeName`/`placeId`/`birthPlace`), and internal TS (resolver fns,
  helpers).
- **snake_case `standard_place`** only in the two snake_case *data formats* —
  the `SimplifiedFact` field (cf. its sibling `standard_date`) and
  research.json (cf. `place_id`/`distance_from_previous_km`).
(The per-skill table in §7 uses the concept loosely; map each mention to
the surface above.)

---

## 3. Answer: "do we still need placeIds at all?"

**Above the tool layer (skills, SimplifiedGedcomX, research.json): No.**
Everything becomes `standard_place` names.

**Inside the server: yes, but only as private plumbing behind the shared
resolver.** Two irreducible survivors for `placeId` itself:

- **`place_search_all`** — `placeId` groups the many `placeRepId`s one spot
  has had over time; no FS endpoint maps a name/repId → all sibling reps
  directly (`place-search.ts:507-512`, `getPlaceRepIds`).
- **`place_population`** — the **external** Pop Stats sidecar is
  `place_id`-keyed and re-emits `place_id` in its response
  (`types/place-population.ts:36,43`; the outbound param is built at
  `place-population.ts:19`).

`placeRepId` also survives internally as the key for `metadata_search`'s
RMS coverage query (`placeIdToRepIds` → `coverage.placeRepIds`),
`getPlaceWikipediaUrl`'s ws-ui attributes endpoint
(`place-search.ts:256`), and `getPlaceById`.

`place_distance` and `wiki_country_*` currently take an ID but do **not**
need one — distance needs only lat/long (already in `place_search` output),
and the wiki tools use the ID only to derive a NAME, which `standard_place`
already is.

---

## 4. Architecture — the shared place resolver (bidirectional cache)

Create `mcp-server/src/utils/place-resolver.ts`, the single home for
name↔ID conversion, **consolidating** today's scattered + duplicated
helpers (all currently in `place-search.ts`):

- `placeIdToRepIds(placeId, token)` → `number[]` (auth) — `:33-68`
- `getPlaceRepIds(pid)` → `string[]` (no-auth) — `:391-414`
- `getPlaceById(repId)` (repId; `/description/{id}`) — `:198-233`
- `getPlaceByPrimaryId(placeId)` (placeId; `/{id}`) — `:156-192`
- `extractPrimaryId(identifiers)` — `:96-104`
- `searchPlace(name)` (returns placeId + repId + fullName + coords) — `:111-149`

The two `…ToRepIds` functions hit the **identical** endpoint and differ
only in auth + return type. **Cache-safety / auth note (verified):** every
`/platform/places` endpoint is anonymous (`place-search.ts:389`), so the
merged resolver can drop the token; this does **not** weaken
`metadata_search`'s own `getValidToken()` gate, which stays at the tool
boundary (`metadata-search.ts:167`). Because all cached results come from
anonymous endpoints, process-wide `Map`s carry **no** user-scoped data and
are safe to share across users (same as today's `placeSearchCache`).

Public API (memoized in-process `Map`s, no TTL — mirrors `placeSearchCache`):

```
standardPlaceToRepId(name, {date?, contextName?}): Promise<string | null>   // 1:1
repIdToStandardPlace(repId): Promise<string | null>                         // 1:1, cheap
standardPlaceToPlaceId(name, {date?, contextName?}): Promise<string | null> // null if candidates disagree on placeId (§11)
placeIdToRepIds(placeId): Promise<string[]>                                 // 1:N, anonymous
standardPlaceToCoords(name, {...}): Promise<{lat,long} | null>              // straight from the search entry — no 2nd fetch
resolveStandardPlace(originalText, {contextName?}): Promise<string | null>  // free text → standardPlace; transient failures retried ≤3× (backoff+jitter); only definitive 0-candidate nulls cached
```

(The document-level dedup + ≤8-way parallel standardization pass that calls
`resolveStandardPlace` lives in the **converter module**, §5 — not here. A
small `mapWithConcurrency(items, 8, fn)` helper in `utils/` bounds it.)

Cache shape — four `Map`s, filled opportunistically:
- `originalText → standardPlace | null` (standardization cache; caches **definitive 0-candidate negatives** only — transient retry-exhausted failures are NOT cached, so they retry on a later call)
- `name → repId` (1:1, with the §11 tie-break)
- `repId → {standardPlace, placeId, lat, long}` (from `getPlaceById`)
- `placeId → repId[]` (1:N, from `getPlaceRepIds`)

The **persisted `standard_place` strings** in `research.json` /
`tree.gedcomx.json` are the real cross-session "cache": skills never
re-resolve because the name is already stored.

`place-search.ts` keeps the tool entry points (`placeSearchTool`,
`placeSearchAllTool`) but delegates the raw fetchers to `place-resolver.ts`
(CLAUDE.md: extend, don't parallel-copy). Update CLAUDE.md's place-helper
note accordingly (it currently locates these in `place-search.ts`).

---

## 5. Populating `standard_place` — in the converter path, dedup + ≤8 parallel

Standardization happens **in the converter path** so *every* tool that runs
GedcomX through it returns standardized places automatically — the workhorse
`record_search`/`person_search` plus `person_read`/`record_read`/
`person_ancestors`. The LLM can then always reason about a `standard_place`,
exactly as it does about `standard_date`. Network calls in the converter
path are accepted (the user's call).

**Why a document-level pass, not inside `simplifyFact`:** dedup must see all
facts at once ("Ky" ×10 → one resolution), which a per-fact function can't.

1. **Type** — extend the raw model (`types/gedcomx.ts:45`) with
   `normalized?: { value: string; lang? }[]`; add `standard_place?: string`
   to `SimplifiedFact` (`types/gedcomx.ts:120-129`). (Raw type lacks
   `normalized` today — compile-time only; it survives at runtime because
   `person-read.ts:215-219` / `record-read.ts:94` pass un-whitelisted bodies.)
2. **Cheap path — pure `toSimplified` (purity unchanged).** In `simplifyFact`
   (`gedcomx-convert.ts:264-266`), after `out.place = fact.place.original`,
   set `out.standard_place` from `place.normalized` when present (prefer
   `lang === "en"`, else first). No network. `Accept-Language: en` on reads
   as insurance. **Existing pure-converter tests stay green.**
3. **`toSimplifiedStandardized(gedcomx)` (async, same module).** Calls
   `toSimplified`, then runs **one document-level standardization pass**, and
   returns the result. Tools call this instead of bare `toSimplified`; the
   pure version remains for callers that want no I/O (`merge_gedcomx`,
   validation).
4. **The pass — `standardizePlaces(facts[])`:**
   - Collect every fact with `place` but no `standard_place` — for the search
     tools, pass the **flattened** fact set across the whole response so
     dedup spans records.
   - **Dedup** by normalized key (`original.trim().toLowerCase()`,
     whitespace-collapsed); map one resolution back to all facts sharing it.
   - Resolve distinct keys **≤8 at a time** (`mapWithConcurrency`, §4) via
     `resolveStandardPlace`.
   - Write `standard_place` back; on null/ambiguous/error **leave it empty**.
5. **Date isn't needed here.** We populate the *name* (stable), not a repId,
   so dedup-by-name is safe even across facts with different dates.
   Date-aware repId resolution stays in the consuming tools (§11). (v1
   simplification: bulk standardization is date-agnostic.)
6. **Robustness — network is now in the search hot path:** the pass is
   strictly **best-effort and never throws**. Each `resolveStandardPlace`
   call **retries transient failures (network / 429 / 5xx) with exponential
   backoff + jitter, up to 3 attempts** (a shared `fetchWithRetry`); a
   0-candidate result is definitive (no retry). On retry-exhaustion /
   ambiguous / error the fact keeps an empty `standard_place` (snake — it is
   the `SimplifiedFact` field) and the other places proceed. **Negative-cache only definitive 0-candidate results —
   never transient failures** (so a network blip doesn't poison the cache).
   **Soft cap** distinct places per call (~50) and `log()` overflow — no
   silent truncation. The process cache + persisted names keep steady-state
   well under the cap. Idempotent: only fills empty values.
7. **`expandFact`** (`gedcomx-convert.ts:506`): `standard_place` is a
   simplified-only sidecar — **dropped on `toGedcomX`**, like `standard_date`
   (`gedcomx-convert.ts:505`).
8. **Locally-authored facts** (init-project, record-extraction, tree-edit,
   timeline) bypass the converter — skills fill `standard_place` via the
   `place_search` tool at author time (§7). Cross-session: once written into
   `tree.gedcomx.json` / results sidecars, names are never re-resolved.

Spec updates: `simplified-gedcomx-spec.md` (facts table + sidecar rule),
`gedcomx-convert-spec.md` (Rule 7 + `SimplifiedFact` type + the new async
`toSimplifiedStandardized` contract + test 13).

---

## 6. Tool input migrations (LLM boundary → `standard_place` names)

Every tool below changes its **LLM-facing** input from an ID to a
`standard_place` name, resolving internally via §4. Internal/upstream IDs
are unchanged.

| Tool | Today (LLM input) | After | Internal resolution | placeId still needed? |
|------|-------------------|-------|---------------------|-----------------------|
| `metadata_search` | `placeId` (required) | `standardPlace` | `standardPlaceToPlaceId` (null-on-disagreement, §11) → `placeIdToRepIds` → `coverage.placeRepIds` | placeId internal only |
| `place_population` | `placeId` | `standardPlace` | `standardPlaceToPlaceId` → Pop Stats `place_id` | **yes** (external sidecar) |
| `place_external_links` | `placeId` | `standardPlace` | `standardPlaceToPlaceId` → `q.placeId` | yes (FS external endpoint) |
| `place_distance` | `placeId1`,`placeId2` | `standardPlace1`,`standardPlace2` | `standardPlaceToCoords` (coords straight from search entry) → haversine | no |
| `wiki_country_*` (×4) | `placeId` | `standardPlace` (or simple place name) | name → candidate wiki slugs (keep multi-variant slug search) | no |
| `place_collections` | `query` (name) ✓ + `placeIds` | `query` unchanged; **deprecate `placeIds`** | n/a (already name-based) | n/a — different id space |

Plus an **output** change: `place_search` / `place_search_all` **always and
only return standard places**. Each result is the struct
`{ standardPlace, type, dateRange?, latitude?, longitude?, familysearchUrl, wikipediaUrl? }`
— `standardPlace` (camel) is the canonical handle (== today's `fullName`);
the rest is metadata. `place_search` is the **single standardizer** that both
the converter pass (§5) and the skills call.

Notes:
- **`metadata_search`** keeps today's "coverage across all temporal reps"
  behavior: skills pass **one** `standardPlace`; the tool recovers the
  parent `placeId` and fans out to **all** repIds. The risk (review): if a
  fullName re-resolves to a *different* placeId than the user meant, fan-out
  shifts silently. Mitigation: `standardPlaceToPlaceId` returns **null when
  surviving candidates disagree on `placeId`** (§11), and the tool surfaces
  an LLM-actionable error rather than guessing. Query echo changes
  `{ placeId }` → `{ standardPlace }` (`metadata-search.ts:200-202`,
  `types/metadata-search.ts:87-97`).
- **`place_distance`**: coords come straight from the resolved search entry
  (`searchPlace` returns `latitude`/`longitude` per entry,
  `place-search.ts:142-143`) — no second description fetch. Failure mode the
  schema requires: if **either** `standardPlace` is unresolvable or lacks
  coords, return `null` (`distance_from_previous_km` null,
  `research-schema-spec.md:464`).
- **`place_collections.placeIds`** is a **third** id space (Alabama=33, not
  the Places API placeId — `place-collections.ts:305`). No skill passes it
  (verified: grep of `plugin/` for `placeIds` is empty), so removing it from
  the LLM schema is safe; also drop the opaque `Collection.placeIds` from
  output. Primary path already takes `query` = a name.
- Tools that re-emit an ID in output (`place_population`'s `place.place_id`,
  `distance`'s `placeId1/2` echo) drop or translate it to the
  `standard_place` name.
- **`types/place.ts:74-75`** comments ("pass to downstream tools") go stale —
  update them.

---

## 7. Skill rewrites (fix drift + adopt standard_place)

The skills are **already broken** and must be repaired in this pass:
- Every skill calls `place_search({ query })` — the real param is
  `{ placeName, contextName }`. Fix all call sites.
- 6 skills tell Claude to pull a `placeId` out of `place_search` and pass it
  downstream — impossible since the tool returns ID-free output.
- No skill knows `place_search_all` exists.

**The handle + selection rule (review blocker fix).** `place_search`
returns an **array**, and two results can share a name. So skills get an
explicit rule, stated once in the canonical reference block and the
place_search spec: *"`place_search` returns a `standardPlace` field on each
result. Pick the best/first matching result and pass its `standardPlace`
verbatim to every downstream tool."* This requires the §6 output change (add
`standardPlace` to `SimplifiedPlaceResult`).

Per-skill work:

| Skill | Changes |
|-------|---------|
| `locality-guide` | `query`→`placeName`; placeId→`standard_place` for place_population / wiki_country_* / place_external_links; add `place_search_all` |
| `research-plan` | `query`→`placeName`; placeId→`standard_place`; **fix stale `image_search({ placeId })`** (now takes `imageGroupNumber`); add `place_search_all` |
| `search-external-sites` | rewrite "placeId … get it from place_search" → "pass the `standard_place` from place_search" |
| `historical-context` | add `place_search`/`place_search_all` to allowed-tools; placeId→`standard_place` for place_population |
| `timeline` | `place_search`→`standard_place` on events (replaces `place_id`); `place_distance` with two `standard_place` names |
| `conflict-resolution` | resolve location → `standard_place` (not placeId) → `place_distance` |
| `record-extraction` | optionally write `standard_place` companion alongside free-text `place` |
| `tree-edit` | when correcting `facts[].place`, optionally fill `standard_place` |
| `init-project` | seeds `facts[].place` — leave free-text; standard_place optional |
| `gps-mentor` (agent) | geographic-plausibility path: `place_search`→`standard_place`→`place_distance` |

**Out of scope (don't let the §12 sweep rewrite these):**
`search-records/references/place-date-mechanics.md:40` documents the raw FS
`f.*Place` filter format `{parent_place_id},{place_name}` — a separate,
currently-unexposed API id-space, **not** a `standard_place` handle. Leave
as-is.

**Reference-doc rule:** per CLAUDE.md, shared guidance is **duplicated**,
not linked. Author one canonical "places & standard_place" guidance block
(the handle + selection rule + place_search vs place_search_all) and copy it
into each skill's `references/`. Add a drift lint (like the manifest test).
Model the write-companion pattern on `convert-dates`.

---

## 8. Persisted schema (research.json) — narrow blast radius

The only persisted `place_id` is the schema definition itself + its mirrors.
**No scenario or tree fixture currently contains `place_id` or
`standard_place`** (verified: grep of `eval/fixtures/` and all
`tree.gedcomx.json` is empty) — so there is **no fixture data migration**;
new `standard_place` fixtures are authored only for new tests.

Update sites:
- `docs/specs/schemas/research.schema.json` — `timeline_event`: remove
  `place_id` (line 586), add `standard_place` (string|null) next to `place`
  (585).
- `docs/specs/research-schema-spec.md` — replace the `place_id` row (461)
  with `standard_place`; update `distance_from_previous_km` derivation (464)
  to key off `standard_place` equality + name resolution.
- `mcp-server/src/validation/validator.ts` — `NULLABLE_FIELDS` (225-226):
  add `standard_place`, drop `place_id`.
- **`eval/app/components/scenario/lib/schema.ts:242`** — `TimelineEvent.place_id`
  → `standard_place` (the eval CRUD app's independent TS schema mirror; the
  renderer `TimelinesSection.tsx:115` only reads `event.place`, so it's
  safe, but the interface must change). *(This is the 4th mirror the memory
  note `research-schema-required-field-update-sites` warns about.)*
- eval-side Python stubs that declare the timeline-event shape — migrate
  `place_id` → `standard_place`.

Note: existing eval run-log snapshots will be invalidated by the
converter/tool changes (expected; `eval/CLAUDE.md` snapshot model tracks
`mcp-server/src/**`). Re-record as part of §10.

---

## 9. Specs & docs to update (source of truth for spec-review)

- `place-search-tool-spec.md`, `place-search-all-tool-spec.md` — fulfill the
  "later phase" promise; document the `standardPlace` output struct (==
  `fullName`) + selection rule.
- `simplified-gedcomx-spec.md`, `gedcomx-convert-spec.md` — `standard_place`
  field + sidecar rule + test 13.
- `metadata-search-tool-spec.md`, `place-population-tool-spec.md`,
  `place-external-links-tool-spec.md`, `place-collections-tool-spec.md`
  (documents `placeIds` across ~15 sites), `2026-05-07-timeline-distances-design.md`
  (distance) — input-contract changes.
- `gps-mentor-agent-spec.md` (lists `place_search`/`place_distance` in
  allowed-tools + usage, `:108-109,222,616`) — tool-usage guidance.
- **Testing guides** (CLAUDE.md verify-before-ship playbooks):
  `docs/testing-guides/place-population-tool-testing-guide.md`,
  `place-external-links-tool-testing-guide.md`,
  `place-collections-tool-testing-guide.md` all teach passing a `placeId` —
  rewrite to `standard_place`.
- `research-schema-spec.md` (+ schema + validator + eval TS schema) — §8.
- `types/place.ts` (stale `:74-75` comments), `CLAUDE.md` (place-helper
  location).
- **There is no `wiki_country` tool spec** (only the source
  `wiki-country-page.ts` + its test) — do not list one.

---

## 10. Tests

- `gedcomx-convert.test.ts` — `normalized` present → `standard_place` (prefer
  en, else first); absent → left empty by pure `toSimplified`; dropped on
  `toGedcomX`.
- New `place-resolver.test.ts` — `resolveStandardPlace` (free text →
  standard_place), result + **negative caching**, bidirectional cache hits,
  §11 tie-break, ambiguous/0/many, **null-on-placeId-disagreement**, 404 → null.
- Converter standardization pass (`toSimplifiedStandardized`) — **dedups**
  duplicate place strings to one resolution, resolves **≤8 in parallel** (mock
  resolver), fills empties, leaves unresolved empty, **never throws** on
  resolver error, honors the soft cap + logs overflow. Assert a multi-record
  `record_search` response standardizes each distinct place exactly once.
- Per-tool tests (`metadata-search`, `place-population`,
  `place-external-links`, `distance`, `wiki-country-page`,
  `place-collections`) — name input → internal resolution; update fixtures.
  Add a `metadata_search` test for a name that resolves to **multiple
  placeIds** to prove coverage equals the old placeId path (or errors).
- `manifest.test.ts` / tool-schemas drift.
- **Fixture cleanup:** remove/replace
  `eval/fixtures/mcp/image-search-edensor-place.json` (its `placeId` arg
  predicate no longer matches the rewritten `image_search`) and re-record
  invalidated run-log snapshots.

---

## 11. Resolution policy (the genuine design risk)

`standardPlaceToRepId` / `standardPlaceToPlaceId` are inherently
**ambiguous** searches. v1 policy:

1. Exact case-insensitive `fullName` match among `searchPlace` candidates;
   if multiple, take the highest `score`.
2. **Date hint** (facts/events carry dates): when provided, prefer the rep
   whose `temporalDescription.formal` covers the date — the
   genealogically-correct tie-break (boundaries change). Thread the date
   through from the start.
3. **Null on disagreement:** for `standardPlaceToPlaceId`, if surviving
   candidates disagree on `placeId`, return `null` (don't silently pick one)
   — this guards `metadata_search` / `place_population` fan-out. 0 candidates
   → `null`. The tool surfaces an LLM-actionable "couldn't resolve
   <standard_place>; try place_search" error.
4. **Locale:** the resolver searches by English fullName, so a non-en
   `standard_place` (from a non-en `normalized` value the user opted to
   accept) may resolve to `null` when a tool later needs its repId. Mitigated
   by `Accept-Language: en` on reads (§5.2) so normalized trends English; not
   treated as a hard error.

Deferred (note, don't build): encoding date/dateRange into the
`standard_place` token to make name↔repId provably 1:1. v1 keeps the name as
the key + date as a resolution hint.

---

## 12. Sequenced work (one coordinated effort, atomic units)

0. **Shape probe (§0, informational).** Confirm `place.normalized` shape +
   add `Accept-Language: en`. Does **not** block §5 (the hybrid standardizes
   via `place_search` when normalized is absent).
1. **Resolver foundation** — ✅ **DONE** (`mcp-server/src/utils/place-resolver.ts`
   + `tests/utils/place-resolver.test.ts`, 18 tests; full suite 789 green,
   tsc clean). Public fns (`resolveStandardPlace`, `standardPlaceToRepId`,
   `repIdToStandardPlace`, `standardPlaceToPlaceId`, `standardPlaceToCoords`,
   `placeIdToRepIds`) + `withRetry` (≤3, backoff+jitter) + `mapWithConcurrency`
   + caches (4 + an internal search memo) + §11 tie-break + null-on-disagreement
   + negative-cache (definitive-0 only). *Deviation:* kept it a pure addition —
   it **imports** the existing `searchPlace`/`getPlaceById`/`getPlaceRepIds`
   from `place-search.ts` rather than moving them; the fetcher consolidation
   (move down + place-search delegation, incl. `getPlaceByPrimaryId`) is a
   later step (TODO noted in the module header). No contract changes.
2. **`place_search` output** — ✅ **DONE**. `SimplifiedPlaceResult.fullName`
   renamed → `standardPlace` (`types/place.ts`, `simplifyPlaceResult`,
   schema descriptions, tests). `place_search`/`place_search_all` now return
   `{ standardPlace, type, dateRange?, lat?, long?, links }`.
3. **Converter + standardization pass** — ✅ **DONE**.
   `types/gedcomx.ts`: `GedcomXFact.place.normalized` + `SimplifiedFact.standard_place`.
   `gedcomx-convert.ts`: `simplifyFact` reads `normalized` (pure, prefer en);
   `standardizePlaces` (dedup + ≤8 parallel + soft-cap-50 + best-effort) +
   `collectFacts` + async `toSimplifiedStandardized`. Wired: `person_read`,
   `record_read`, `person_ancestors` → `toSimplifiedStandardized`;
   `record_search`/`person_search` → one `standardizePlaces` over all entries
   (cross-record dedup). `Accept-Language: en` on `person_read`/`record_read`.
   Tests: `gedcomx-standardize.test.ts` (10) + resolver stub in the 5 tool
   tests. Full suite 799 green. *Follow-ups:* `Accept-Language: en` on
   `person_ancestors`/search fetches (optional; locale fragility accepted);
   spec sync (below).
4. **Per place tool, ATOMIC with its skills:** for each of `metadata_search`,
   `place_population`, `place_external_links`, `place_distance`,
   `wiki_country_*`, `place_collections` — migrate the tool schema **and**
   rewrite every skill/agent that calls it **in the same commit**, plus that
   tool's spec + testing guide + tests. This is the unit that keeps the
   system runnable at every commit. (Fixing the `place_search({ query })`
   drift happens here too, per tool's callers.)
   - ✅ **`place_distance`** DONE — input `placeId1/2` → `standardPlace1/2`
     (resolves via `standardPlaceToCoords`); output echoes the names; tool +
     test + dispatch unaffected. Skills/agent updated: `timeline` (resolves to
     `standardPlace` transiently, no `place_id` persistence — that field moves
     in Step 5; also fixed `query`→`placeName`), `conflict-resolution`,
     `gps-mentor`. Spec note added to the timeline-distances design doc.
   - ✅ **`wiki_country_*`** (×4) DONE — input `placeId` → `standardPlace`;
     resolves the standard place's leaf name + `standardPlaceToPlaceId` →
     `getPlaceCandidateNames` for slug variants. Output echoes `standardPlace`.
     Types + test (11) updated. Skills `locality-guide` + `research-plan`
     wiki_country calls → `standardPlace` (+ their `place_search` `query`→
     `placeName` drift fixed). No dedicated wiki_country spec/testing guide.
   - ✅ **`place_population`** DONE — `standardPlace` → `standardPlaceToPlaceId`
     → Pop Stats `place_id`; new test; skills (locality-guide, historical-context).
   - ✅ **`place_external_links`** DONE — `standardPlace` → `standardPlaceToPlaceId`
     → `q.placeId` (resolve after the cheap guards); output echoes `standardPlace`;
     skills (locality-guide, research-plan, search-external-sites + its `query`→`placeName` drift).
   - ✅ **`place_collections`** DONE — deprecated/removed the `placeIds` input +
     curated `Collection.placeIds`/`CollectionsResult.placeIds` output + dead
     helpers (`getPlaceIds`/`filterByPlaceIds`); kept the upstream
     `FSSearchMetadata.placeIds` detail pass-through.
   - ✅ **`metadata_search`** DONE — `standardPlace` → `standardPlaceToPlaceId`
     (null-on-disagreement) → `placeIdToRepIds` (anonymous, `string[]`) →
     `coverage.placeRepIds` (type widened to `string[]`); query echo →
     `standardPlace`; getValidToken stays for the RMS/fulltext calls; test
     re-indexed to the 2-call (search, fulltext) sequence + resolver mocks.
   - **Step 4 tool migration complete.** Remaining doc cleanup (batched):
     full testing-guide sweeps + residual spec prose/examples for the four
     tools; the old `placeIdToRepIds` in `place-search.ts` is now dead code
     (resolver's version is used) — leave or remove with a CLAUDE.md note.
5. **Schema** — research.json `place_id` → `standard_place` (§8): schema +
   spec + validator + eval TS mirror + Python stubs.
6. **Sweep** — repo-wide grep for residual `placeId`/`placeRepId`/`place_id`
   in skills, specs, fixtures; run `spec-review` on every touched tool;
   manifest drift test. Leave the documented out-of-scope id-spaces alone
   (`place-date-mechanics.md` `{parent_place_id}`, `place_collections`
   internal placeIds).

---

## Appendix — primary evidence (file:line)

- Converter drops `description`, keeps only `original`: `gedcomx-convert.ts:264-266,506`
- `standard_date` sidecar precedent: `gedcomx-convert.ts:505`, `simplified-gedcomx-spec.md:183`
- Read-endpoint place modeled as `{original}` only (premise risk): `person-read-tool-spec.md:291,310,509`, `gedcomx-convert-spec.md:84`
- `.normalized` is locale-sensitive, wrong-endpoint cite corrected: `person-search-tool-spec.md:370-376` (person *search*, not read)
- Raw bodies un-whitelisted into converter (field survives at runtime if sent): `person-read.ts:215-219`, `record-read.ts:94`
- `metadata_search` requires `placeId`, no reverse repId→placeId: `metadata-search.ts:169,235-259`, `metadata-search-tool-spec.md:134-137`
- ID-free LLM output already shipped: `types/place.ts:90-106`, `place-search.ts:371-381`
- `place_search_all` needs placeId to group reps: `place-search.ts:507-512`
- Pop Stats is `place_id`-keyed (external) + re-emits it: outbound `place-population.ts:19`; response `types/place-population.ts:36,43`
- distance uses `getPlaceByPrimaryId` (placeId), not `getPlaceById` (repId): `distance.ts:1,49-50`; endpoints `place-search.ts:157` vs `:199`
- `searchPlace` returns coords per entry: `place-search.ts:142-143`
- `/platform/places` is anonymous (auth-drop safe): `place-search.ts:389`
- Persisted `place_id` (sole stored ID) + eval mirror: `research.schema.json:585-586`, `research-schema-spec.md:461,464`, `validator.ts:225`, `eval/app/components/scenario/lib/schema.ts:242`
- No fixtures carry `place_id` (migration is a no-op): grep `eval/fixtures/` empty
- Skills broken (`query` param + expect stripped placeId): `locality-guide:84`, `research-plan:124,127`, `timeline:129`, `search-external-sites:125`, `historical-context:90`
- `place_collections.placeIds` separate id-space, unused by skills: `place-collections.ts:305`, grep `plugin/` empty
- Prior "drop place IDs for human-readable" decision: `research-schema-spec.md:1438`
- This task scoped out of id-vocabulary effort: `id-vocabulary-standardization-progress.md:6`
