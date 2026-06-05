# Tool Naming & Interface Cleanup — Implementation Spec

## Overview

A cross-cutting cleanup that makes the place-keyed tools **name and behave
consistently**, collapses one tool family, renames three more, and fixes the
skill/fixture fallout. It is a pure refactor of the *surface* — no new
capability, no new external API. It lands **after #274** ("Standardize on
standardPlace above the tool layer") and builds directly on the resolver that
PR established at `mcp-server/src/utils/place-resolver.ts`.

Everything above the tool layer already speaks `standardPlace` (a
fully-qualified, comma-delimited place name, most-specific-first, e.g.
`"Schuylkill, Pennsylvania, United States"`). That single fact is what makes
this cleanup cheap:

- **A parent jurisdiction is a string operation** — drop the text before the
  first comma. No API call, no hierarchy walk.
- **A standardPlace is unambiguous by construction** — every jurisdictional
  level is already in the name, so the place-keyed tools need no `contextName`
  (that lever stays where it belongs: `place_search`, turning a partial
  `"Paris"` into a full standardPlace).

### Scope at a glance

| Area | Change |
|------|--------|
| Renames | `metadata_search`→`volume_search`, `place_external_links`→`external_links_search`, `place_collections`→`collections_search`, `match_two_examples`→`same_person` |
| Collapse | four `wiki_country_*` tools → one `wiki_place_page({ standardPlace, section })` |
| Split | `place_collections`'s detail mode (`id`) → its own `collection_read` tool |
| Unify | the three place-resource `_search` tools share an **input** (`standardPlace` + optional `startYear`/`endYear`) and an **output shape** (`{ query, results, … }`) — but **not** a cursor: only `volume_search` paginates (it has a real server cursor); `external_links_search` and `collections_search` filter small sets client-side and return them whole |
| Consistency | `place_population` `year_start`/`year_end` → `startYear`/`endYear` |
| Walk | the comma-strip jurisdiction walk lives in `places-guidance.md`, **not** in any tool — tools stay single-level |
| Keep as-is | the four `*_*_matches` tools; `place_search` / `place_search_all` (with rationale below) |
| Skills | fix the `research-plan` `image_search`→`volume_search` bug; propagate renames through the 9 `places-guidance.md` copies + direct call sites |
| Fixtures | migrate the place-based `image_search` fixture to `volume_search`; keep the group-number one |

### Sequencing

One PR, after #274 is merged (done). The packaging drift test
(`tests/packaging/manifest.test.ts`) and the guidance drift lint
(`tests/packaging/skill-guidance.test.ts`) will both fail until every
touchpoint is updated — they are the backstop that this refactor is complete.

---

## Decisions (and why)

| Decision | Rationale |
|----------|-----------|
| **Tools stay single-level; the walk lives in guidance** | With a parent reachable by comma-strip, an agent climbs as reliably as code. Keeping the tools single-level makes all three `_search` tools *identical* in contract, lets the agent fetch only the levels its research goal needs (controls token cost), and keeps behavior audience-independent. |
| **Date param is `startYear`/`endYear` (integers) family-wide** | Two of the three tools and every research-plan item already think in years; genealogists reason in years. `volume_search` converts year→`YYYY-01-01`/`YYYY-12-31` internally for its API (it already builds `fromDateString`/`toDateString`). **`volume_search` is by years only** — sub-year (ISO day) precision is intentionally dropped; film/volume coverage is a year-range concern. |
| **Keep the four `*_*_matches` tools** | They form a coupled, directional 2×2 (`source`×`target`). Merging would force two coupled enums + correct id placement — a silent-failure mode. Encoding the operation in the name keeps selection unambiguous. Documented here so nobody "consolidates" it later. |
| **Keep `place_search` and `place_search_all` separate** | Their difference is **temporal, not breadth**: `place_search` returns the best current match; `place_search_all` returns *every* standard place a location has belonged to over time (boundary changes). Different output shape and workflow — merging into one `all` flag would muddy a meaningful distinction, same reasoning as the matches tools. Considered, rejected. |
| **Collapse the four `wiki_country_*`** | They differ by a single independent enum (which page), with ~80% duplicated schema text. One clean enum is something an LLM selects reliably; this is the case where merging wins. Also fixes the "country" misnomer (US states/Canadian provinces were always accepted). |

---

## 1. Tool renames

Pure name changes — input/output behavior unchanged except where called out in
§3–§5. For **each** renamed tool, update all of: the `name:` in the schema, the
exported symbol names, `src/tool-schemas.ts`, the `src/index.ts` dispatch case,
the `manifest.json` `tools` array, `README.md`, `CLAUDE.md`, the per-tool spec
**file name + body**, `dev/try-*.ts`, and `tests/tools/*.test.ts`. See §9 for
the full touchpoint checklist.

| Old name | New name | Notes |
|----------|----------|-------|
| `metadata_search` | `volume_search` | "metadata" is contentless; the tool finds **digitized volumes** covering a place. Pairs with `image_search` (volumes → images). Avoids leaking the FS-internal "image group" term while still naming the concept. |
| `place_external_links` | `external_links_search` | Joins the `_search` family; leads with the resource returned. |
| `place_collections` | `collections_search` | Joins the `_search` family. Detail mode split out (§4). |
| `match_two_examples` | `same_person` | Names the question the tool answers ("are these two records the same person?"), not a vague operation. Rename only — inputs (`gedcomx1`/`primaryId1`/`gedcomx2`/`primaryId2`) and output unchanged. |

> **File renames:** `docs/specs/metadata-search-tool-spec.md` →
> `volume-search-tool-spec.md`, `place-external-links-tool-spec.md` →
> `external-links-search-tool-spec.md`, `place-collections-tool-spec.md` →
> `collections-search-tool-spec.md`, `match-two-examples-tool-spec.md` →
> `same-person-tool-spec.md`. Update the tool name and any `image_search`/old-name
> references inside each. The per-tool specs remain the behavioral source of
> truth; this document is the migration instruction.

---

## 2. Collapse the four `wiki_country_*` tools → `wiki_place_page`

Today: `wiki_country_home`, `wiki_country_getting_started`,
`wiki_country_online_records`, `wiki_country_research_tips` — four schemas that
differ only by which page slug they read, all sharing `readCountryPage` in
`src/tools/wiki-country-page.ts`. Already `standardPlace`-based (resolves via
`standardPlaceToPlaceId` → `getPlaceCandidateNames`).

**After:** one tool.

```typescript
{
  name: "wiki_place_page",
  description:
    "Return a FamilySearch Research Wiki page for a place (country, US state, " +
    "or Canadian province). Provide a standardPlace from place_search and the " +
    "section you want. Reads the pre-crawled wiki markdown for that jurisdiction " +
    "and returns it. The wiki corpus covers the country level everywhere, plus " +
    "the state/province level for the US and Canada; for a more specific place " +
    "(county, town) no page exists — broaden the standardPlace one jurisdiction " +
    "(see places guidance) and call again.",
  inputSchema: {
    type: "object",
    properties: {
      standardPlace: {
        type: "string",
        description:
          "Standard place name (the `standardPlace` field from place_search).",
      },
      section: {
        type: "string",
        enum: ["home", "getting_started", "online_records", "research_tips"],
        description:
          "Which wiki page to return: 'home' (genealogy overview), " +
          "'getting_started', 'online_records' (online genealogy records), or " +
          "'research_tips' (research strategies).",
      },
    },
    required: ["standardPlace", "section"],
  },
}
```

Internally, keep `readCountryPage` and select the candidate-slug builder by
`section` (the four existing slug-pattern closures become a `switch` on
`section`). Behavior per section is unchanged.

**Single-level, no walk in the tool.** If no page exists for the given
`standardPlace`'s jurisdiction, throw the existing clear not-found
(`"No wiki page found for place ..."`). The agent broadens via the comma-strip
pattern in guidance (§6) and retries. This keeps `wiki_place_page` uniform with
every other place tool.

---

## 3. The shared `_search` shape (consistency without forced pagination)

`external_links_search`, `volume_search`, and `collections_search` share an
**input convention** and an **output shape** — not a cursor. Pagination is a
property of the data *source*, and only one of the three has a real one:

- `volume_search` queries a massive corpus; the API filters by date server-side
  and returns a **real cursor**. It paginates.
- `external_links_search` and `collections_search` each fetch a **small, curated
  set** for the place and filter **client-side**. There is no server cursor, so
  they return the full filtered set in one response and have **no** `pageToken`.

Putting a `pageToken` on the cursorless two would advertise a capability they
don't have (an agent would try to page and get nothing). This asymmetry is
**deliberate** — do not "unify" it away. The item shape also differs per tool
(a link, a volume, a collection).

### Shared input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `standardPlace` | string | **Yes** | The `standardPlace` from `place_search`. Resolved internally (see per-tool resolver use). |
| `startYear` | integer | No | Earliest year of interest (inclusive). Omit for all periods. |
| `endYear` | integer | No | Latest year of interest (inclusive). Must be ≥ `startYear`. Omit for all periods. |
| `pageToken` | string | No | **`volume_search` only.** Opaque cursor from a prior `nextPageToken`; pass with the same `standardPlace`/`startYear`/`endYear`. |

### Shared output

| Field | Type | Description |
|-------|------|-------------|
| `query` | object | Echo of `standardPlace` + `startYear?` + `endYear?` |
| `results` | Item[] | The matched items (tool-specific shape). For the cursorless tools this is the **full** filtered set; for `volume_search` it is one page. |
| `nextPageToken` | string? | **`volume_search` only** — present when more pages remain |

Count fields differ by tool because their semantics differ — see each below.
**Single-level, always:** `results` describes the exact `standardPlace` passed
in; to broaden, the caller re-issues with the parent standardPlace (§6). No tool
auto-aggregates ancestors.

### 3a. `external_links_search` (was `place_external_links`)

- Resolver: `standardPlaceToPlaceId(standardPlace)` (unchanged from current
  `place_external_links`). Throw the existing
  `"Could not resolve \"<name>\" to a FamilySearch place"` on null.
- **`startYear`/`endYear` become optional** (currently required). When both are
  omitted, return all dated resources **plus** undated wiki/website resources.
  Preserve the existing rule: an undated resource is **always** included
  regardless of the year filter.
- **No pagination.** The curated set per place is small; return the full
  (optionally year-filtered) set in one response. The old silent internal
  50×100 page cap goes away — it was an internal fetch detail, never a caller
  cursor.
- **Output: `{ query, totalForPlace, results }`.**
  - `results` — the `{ url, linkText }` items, year-filtered when years are
    given. **Its length is the matched count** — no separate field.
  - `totalForPlace` — total curated resources for the place **before** the date
    filter. This is the only non-derivable count, and it makes the
    `results: [], totalForPlace: 12` case ("resources exist here, just not in
    your years") self-evident with no special field.
  - **Drop `matchedCount`** — it was literally `results.length`. There is no
    `totalResults`/`unfilteredTotal`. `totalForPlace` is the single, clearly
    named *pre-filter* count, intentionally distinct from `volume_search`'s
    *post-filter* `totalResults` — same name would mean different things, so the
    names differ on purpose.
- **Skill follow-up:** `search-external-sites` and `locality-guide` branch on
  the old `totalResults`/`matchedCount`; update them to read `totalForPlace`
  and `results.length` (covered in §7).

### 3b. `volume_search` (was `metadata_search`)

- Resolver: `standardPlaceToPlaceId` → `placeIdToRepIds` (unchanged).
- **Date param change:** `fromDate`/`toDate` (ISO) → `startYear`/`endYear`
  (integers). Convert internally to `fromDateString: "${startYear}-01-01"` /
  `toDateString: "${endYear}-12-31"` when building the group-search body. All
  other request construction, child-count math, full-text sub-fetch, and item
  mapping are unchanged (see `volume-search-tool-spec.md`).
- Pagination already exists (`pageToken`/`nextPageToken`) — keep it; the
  byte-identical-body rule still holds (year→ISO derivation is deterministic).
- Rename output count fields to the envelope: `totalGroups`→`totalResults`,
  `groups`→`results`, `returned` may stay or be dropped (it equals
  `results.length`). Keep the per-item `MetadataGroup` shape.

> **Verify during implementation:** the existing tests and
> `try-metadata-search.ts` use `--from`/`--to` ISO args. Update them to
> `--startYear`/`--endYear`.

### 3c. `collections_search` (was `place_collections`)

- Input is already `standardPlace` (#274). Keep
  `standardPlaceToCollectionsQuery(standardPlace)` deriving the state/country
  scope, then `filterByQuery` against collection titles.
- **No pagination.** Like `external_links_search`, it filters a fetched set
  client-side; return the full matched set in one response. Replace the current
  `matchingCollections` field with the shared `results` array (its length is the
  count). Add a `totalForPlace`-style pre-filter count only if a date filter is
  added (below).
- **Optional** `startYear`/`endYear`: filter the returned collections by their
  `dateRange` overlap, for input symmetry with the family.
- Item shape unchanged: `{ id, title, dateRange, placeIds, recordCount,
  personCount, imageCount, url }`.

> **Note:** how `collections_search` queries FamilySearch (the
> `standardPlaceToCollectionsQuery` scope derivation + title match) was settled
> by #274 and is **not** changed here. This spec only adds the **name, output
> shape, and detail-mode split** on top of it.

---

## 4. Split `collection_read` out of `collections_search`

`place_collections` currently overloads two operations: list-by-place
(`standardPlace`) and fetch-one-by-id (`id`, returning the full FS response with
HTML→markdown citation/wiki). The repo already pairs search/read elsewhere
(`record_search`/`record_read`, `person_search`/`person_read`). Make
collections match:

- **`collections_search`** — list mode only. Required `standardPlace`. Remove
  the `id` branch.
- **`collection_read`** — new tool. Required `id` (a collection ID like
  `"1743384"`). Returns the FS API response with HTML strings converted to
  markdown (move `getCollectionDetail` / `fetchCollectionDetail` /
  `convertHtmlToMarkdown` behind it; they already live in
  `place-collections.ts` — relocate to `src/tools/collection-read.ts`).

New spec file: `docs/specs/collection-read-tool-spec.md`. New tool wired into
`tool-schemas.ts`, `index.ts`, `manifest.json`, `README.md`, `CLAUDE.md`,
`dev/try-collection-read.ts`, `tests/tools/collection-read.test.ts`.

---

## 5. `place_population` consistency fix

Confirmed still snake_case after #274 (`src/tools/place-population.ts` and
`src/types/place-population.ts`):

- `year_start` → `startYear`, `year_end` → `endYear` (camelCase, matching the
  `_search` family). Keep `year` (single-year query) as-is.
- Update the query-param mapping to the Pop Stats API: the **upstream** API
  still expects `year_start`/`year_end` as wire params, so map
  `startYear → year_start`, `endYear → year_end` when building the URL (mirrors
  how `placeId → place_id` is already mapped). Only the **MCP tool input**
  changes to camelCase.
- Update schema, type, `dev/try-population.ts`, tests, and the per-tool spec.

`place_population` stays single-level (superseding); its walk is in guidance
(§6).

---

## 6. The comma-strip walk → `places-guidance.md`

The jurisdiction walk is a **documented agent pattern**, not tool behavior. Add
it to the canonical `plugin/references/places-guidance.md`, then re-copy into
every skill listed in `tests/packaging/skill-guidance.test.ts` (the drift lint
enforces byte-for-byte copies).

Two patterns, because superseding and additive resources climb differently:

```markdown
## Broadening to a parent jurisdiction

Every place tool returns results for the **exact** standardPlace you pass.
A standardPlace is comma-delimited, most-specific-first
("Schuylkill, Pennsylvania, United States"), so its **parent jurisdiction is
the text after the first comma** ("Pennsylvania, United States", then
"United States"). To broaden, drop the leading component and call again.

- **Superseding resources** — `wiki_place_page`, `place_population`. One right
  answer per place: the most-specific available. If a place has no page / no
  data, climb to the parent and retry; **stop at the first hit.** A national
  figure for a village is usually too generic to use — climb only as far as you
  must.
- **Additive resources** — `external_links_search`, `collections_search`,
  `volume_search`. Each level holds *different* records (the county courthouse,
  the state archive, the national index), so fetch the levels your research
  actually needs and combine them. Bias to the specific end; the national level
  is mostly generic collections the researcher already knows — pull it only on
  first contact with a country or when the local levels are sparse.
```

Also in the same file, update the tool list (lines ~40–45) to the new names:
`external_links_search`, `collections_search`, `volume_search`,
`wiki_place_page({ standardPlace, section })`. Remove the four `wiki_country_*`
entries.

> **Drift-lint procedure:** edit the canonical file, then copy the block into
> each of the 9 skill `references/places-guidance.md` copies, then run
> `skill-guidance.test.ts` to confirm zero drift.

---

## 7. Skill fixes

| Skill / agent | Change |
|---------------|--------|
| `plugin/skills/research-plan/SKILL.md` | **Bug:** `image_search({ placeId, fromDate, toDate })` → `volume_search({ standardPlace, startYear, endYear })`. Also fix the prose ("image_search reveals volumes" → volume_search). `image_search` never took a place — this called the wrong tool. |
| `plugin/skills/record-extraction/SKILL.md` | **Bug (confirmed):** lines ~86–93 use `image_search` to "discover available image groups **by place and date range**" — a place→volumes query, same misuse as research-plan. Replace with `volume_search({ standardPlace, startYear, endYear })` (prose + the description at lines 88–90). It has no genuine group-number→images call, so **remove `image_search` from `allowed-tools` and add `volume_search`**. |
| `locality-guide`, `research-plan`, `search-records`, `search-external-sites` | Update every renamed-tool call site: `place_collections`→`collections_search`, `place_external_links`→`external_links_search`, `metadata_search`→`volume_search`, `wiki_country_*`→`wiki_place_page({ section })`. |
| `locality-guide/SKILL.md` | Drop the "query the enclosing state, never the county" workaround for collections — `collections_search` derives the scope itself, and broadening is now the documented comma-strip pattern. |
| `plugin/agents/gps-mentor.md` | Update any renamed-tool references. |
| `allowed-tools:` frontmatter | In every skill above, rename tools in the `allowed-tools` list (e.g. `wiki_country_home`… → `wiki_place_page`; `metadata_search` → `volume_search`). |

> Grep the whole `plugin/` tree for each old name before declaring done; the
> renames must leave zero references to `place_collections`,
> `place_external_links`, `metadata_search`, `wiki_country_*`, or
> `match_two_examples`.

---

## 8. Fixture fixes

| Fixture | Action |
|---------|--------|
| `eval/fixtures/mcp/image-search-edensor-place.json` | **Migrate to `volume_search`.** Its input is `{ placeId, fromDate, toDate }` — a place→volumes query mislabeled as `image_search`. Set `tool: "volume_search"`, input `{ standardPlace: "Edensor, Derbyshire, England, United Kingdom", startYear: 1730, endYear: 1810 }`, and **regenerate** the output against the real `volume_search` (the recorded group shape predates `recordSearchablePercent`/`fulltextSearchable`). Rename the file to `volume-search-edensor.json`. |
| `eval/fixtures/mcp/image-search-by-group-number.json` | **Keep on `image_search`.** Its input is `{ imageGroupNumber }` — a legitimate `image_search` call. `image_search` is not renamed. Do **not** migrate (it would lose `image_search` coverage and is semantically wrong for `volume_search`). Refresh the output shape only if it has drifted. |
| `eval/runlogs/unit/**` referencing the old names | Regenerate affected runlogs after the rename, or note them for the next eval refresh. |
| `mcp-server/tests/tools/image-search.test.ts` | Unaffected by the rename, but confirm it exercises `imageGroupNumber` input (not a place). |

---

## 9. Mechanical wiring checklist (per renamed/new/collapsed tool)

For every name change, all of these must move in lockstep or a drift test fails:

- [ ] `src/tools/<file>.ts` — `name:` in the schema export + exported symbol(s)
- [ ] `src/types/<file>.ts` — input/output type names (where they encode the old name)
- [ ] `src/tool-schemas.ts` — the import + the `allToolSchemas` entry
- [ ] `src/index.ts` — the `CallToolRequestSchema` dispatch case
- [ ] `manifest.json` — the `tools` array entry (enforced by `tests/packaging/manifest.test.ts`)
- [ ] `README.md` — tool catalog
- [ ] `CLAUDE.md` — authenticated-tools list and any tool name references
- [ ] `docs/specs/<tool>-tool-spec.md` — rename file + update body
- [ ] `dev/try-<tool>.ts` — rename + update args
- [ ] `tests/tools/<tool>.test.ts` — rename + update assertions
- [ ] `plugin/**` — call sites + `allowed-tools` + `places-guidance.md` copies

**File-rename map (source files):**

| From | To |
|------|----|
| `src/tools/metadata-search.ts` | `src/tools/volume-search.ts` |
| `src/tools/place-external-links.ts` | `src/tools/external-links-search.ts` |
| `src/tools/place-collections.ts` | `src/tools/collections-search.ts` (+ extract `src/tools/collection-read.ts`) |
| `src/tools/match-two-examples.ts` | `src/tools/same-person.ts` |
| `src/tools/wiki-country-page.ts` | `src/tools/wiki-place-page.ts` |
| `src/types/metadata-search.ts` | `src/types/volume-search.ts` (and analogues) |

(Keep `image-search.ts`, `place-population.ts`, `place-search.ts`,
`distance.ts`, and the four `match-by-id` tools' filenames as-is.)

---

## 10. Files

| File | Action |
|------|--------|
| `src/tools/volume-search.ts` | Rename from `metadata-search.ts`; date param year-based |
| `src/tools/external-links-search.ts` | Rename from `place-external-links.ts`; optional dates + pagination |
| `src/tools/collections-search.ts` | Rename from `place-collections.ts`; envelope + pagination; remove `id` branch |
| `src/tools/collection-read.ts` | Create; move detail-mode logic here |
| `src/tools/same-person.ts` | Rename from `match-two-examples.ts` |
| `src/tools/wiki-place-page.ts` | Rename from `wiki-country-page.ts`; one schema, `section` enum |
| `src/tools/place-population.ts` | Edit; `startYear`/`endYear` input, map to upstream snake_case |
| `src/types/*` | Rename/edit the corresponding type modules |
| `src/tool-schemas.ts` | Swap imports + `allToolSchemas` entries (4 wiki → 1; +`collection_read`) |
| `src/index.ts` | Update dispatch cases to match |
| `manifest.json` | Update `tools` array (net −4 wiki +1 wiki, +1 collection_read, 4 renames) |
| `README.md`, `CLAUDE.md` | Update tool catalogs / lists |
| `docs/specs/*` | Rename the 5 per-tool spec files + add `collection-read-tool-spec.md` |
| `dev/try-*.ts`, `tests/tools/*.test.ts` | Rename + update |
| `plugin/references/places-guidance.md` + 9 skill copies | Add the walk patterns; update tool names |
| `plugin/skills/*/SKILL.md`, `plugin/agents/gps-mentor.md` | Call sites + `allowed-tools` |
| `eval/fixtures/mcp/*` | Migrate edensor fixture; keep group-number fixture |

---

## 11. Testing

- **Drift gates (must pass):** `tests/packaging/manifest.test.ts` (manifest ↔
  `allToolSchemas`) and `tests/packaging/skill-guidance.test.ts` (guidance
  copies). These two passing is the definition of "the rename is complete."
- **Per renamed tool:** existing test suites pass after rename; assertions
  updated for new names/fields. No behavior regressions.
- **`volume_search`:** add cases for `startYear`/`endYear` → `fromDateString`/
  `toDateString` derivation; the rest of `metadata-search.test.ts` carries over.
- **`external_links_search`:** new cases for omitted dates (all periods +
  undated always included) and pagination (`nextPageToken` round-trip,
  `totalResults`).
- **`collections_search` / `collection_read`:** list mode returns the envelope
  with pagination; `id` now routes to `collection_read`; the old
  "`place_collections({ id })`" path is gone.
- **`wiki_place_page`:** one test per `section` value; not-found throws for a
  sub-state place (e.g. a county standardPlace).
- **`same_person`:** identical to `match_two_examples` tests, renamed.
- **`place_population`:** `startYear`/`endYear` map to upstream `year_start`/
  `year_end`.
- **Smoke tests:** update each `dev/try-*.ts` invocation; e.g.
  `npx tsx dev/try-volume-search.ts --standardPlace "Edensor, Derbyshire, England, United Kingdom" --startYear 1730 --endYear 1810`.

---

## 12. Resolved design questions

No open design questions remain — all were settled during spec review:

- **`external_links_search` counts** — output is `{ query, totalForPlace,
  results }`; `matchedCount` is dropped (it was `results.length`); no
  pagination. `totalForPlace` is the single pre-filter count, distinct from
  `volume_search`'s post-filter `totalResults` (§3a).
- **Pagination** — only `volume_search` has a cursor; `external_links_search`
  and `collections_search` return their full client-filtered set (§3).
- **`volume_search`** — years-only; no ISO exception.
- **`record-extraction`** — confirmed `image_search` misuse for place discovery;
  **fixed** in §7, not merely audited.
- **`collections_search`** — FamilySearch querying was settled by #274.
- **`place_search` / `place_search_all`** — stay separate (temporal
  distinction; see Decisions).

---

## Out of scope

- Any cross-jurisdiction **rollup inside a tool** (`includeAncestors`,
  `levels[]`) — the walk is an agent pattern in guidance.
- Changing how `collections_search` queries FamilySearch (settled by #274).
- New capabilities, new external APIs, new auth.
- The four `*_*_matches` tools and the `place_search`/`place_search_all` pair —
  deliberately unchanged.
