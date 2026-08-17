# Volume Search Tool — Implementation Spec

## Overview

An MCP tool that searches FamilySearch's Records Management Service
(RMS) for **image groups** — digitized volumes of historical documents
(microfilm rolls, book scans) — by **place and year range**. For each
matching image group it returns coverage metadata plus two
searchability signals the LLM needs to plan its research:

- **`recordSearchablePercent`** — what fraction of the volume's images
  have been indexed into structured records (findable by name via
  `record_search`).
- **`fulltextSearchable`** — whether the volume's images have been
  full-text (OCR) processed, so `fulltext_search` will return hits for
  it.

This is the renamed and enriched successor to the old `image_search`
tool (which performed this group search). The name `image_search` now
belongs to a separate tool that lists the individual images *within* a
group — see `docs/specs/image-search-tool-spec.md`.

### Why this matters

Not all FamilySearch images are indexed or transcribed. Many volumes
exist only as scanned images. `volume_search` lets the LLM discover
which digitized volumes cover a place and time period, then judge — per
volume — whether to (a) search it by name (`record_search`, once it
accepts an image group filter), (b) search its text (`fulltext_search`),
or (c) browse it image by image (`image_search` → `image_read`).

### Relationship to other tools

```
collections_search  →  discovers COLLECTIONS for a place
volume_search       →  discovers IMAGE GROUPS (volumes) covering a place + year range   ← this tool
image_search        →  lists the IMAGE IDs within one image group
image_read         →  reads a SINGLE IMAGE
fulltext_search    →  searches OCR text; accepts imageGroupNumber to scope to one volume
record_search      →  searches indexed records by person (will gain an image_group_number
                       filter in a later PR; accepts either imageGroupNumber or imageGroupPrefix)
```

### Image group numbers and Natural Groups

An image group number identifies a grouping of images — typically one
microfilm roll or digitized book. (FamilySearch historically used
several names — DGS, filmNumber, digitalFilmNumber — but the canonical
term is **image group number**.) Sometimes an image group is split into
**Natural Groups** — logical sub-volumes (e.g., one parish register
within a multi-volume film). This tool **only ever queries `NATURAL`
groups**:

- If an image group has been split, each Natural Group is returned
  individually, with a `groupName` of the form
  `{prefix}_{part}_{naturalId}` (e.g., `007621224_005_M99P-2TQ`).
- If an image group has **not** been split, it is returned as a single
  group whose `groupName` is the bare image group number (e.g.,
  `004452257`), and whose `types` is `["DGS", "NATURAL"]`. It still
  matches the `NATURAL` filter.

---

## Endpoints

| Purpose | Method + URL |
|---------|--------------|
| **Group search** | `PUT https://sg30p0.familysearch.org/service/records/rms/group-service/group/search` (with `returnChildCounts: true`, child counts come back inline) |
| **Full-text searchability** | `GET https://sg30p0.familysearch.org/service/search/fulltext/search/groupNumber?ids={comma-separated}` |
| **standardPlace → placeId → placeRepIds (input conversion)** | Anonymous FamilySearch place lookups (place search + `GET https://api.familysearch.org/platform/places/{placeId}`), via the resolver in `src/utils/place-resolver.ts` |

Note: the group search is a **PUT** request (not GET or POST).

### Headers

All `sg30p0.familysearch.org` calls (group search, full-text searchability):

| Header | Value | Notes |
|--------|-------|-------|
| `Authorization` | `Bearer <token>` | From `getValidToken()` |
| `Content-Type` | `application/json` | On the PUT (group search) |
| `Accept` | `application/json` | |
| `User-Agent` | `BROWSER_USER_AGENT` | From `src/constants.ts` — FS sits behind Imperva, which 403s non-browser UAs |
| `FS-User-Agent-Chain` | `chesworth` | Hard-coded identifier so the FamilySearch team knows who to contact |

The place-resolution calls (the place search and `api.familysearch.org`
lookups behind `standardPlaceToPlaceId` → `placeIdToRepIds`) are
**anonymous** — they send no `Authorization` header. They run inside the
resolver in `src/utils/place-resolver.ts`, whose underlying FamilySearch
place fetchers all hit anonymous endpoints.

> **Verify during implementation:** that the full-text searchability
> endpoint accepts the same headers. It requires authentication; the
> browser UA + agent chain are sent for consistency with the other
> RMS calls but may not be strictly required.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `standardPlace` | string | **Yes** | Standard place name (the `standardPlace` field from `place_search`). The tool resolves it to a `placeId` and then to one or more `placeRepId`s internally (via `standardPlaceToPlaceId` → `placeIdToRepIds`). |
| `startYear` | integer | No | Earliest year of interest, inclusive (e.g., `1730`). Omit for all periods. |
| `endYear` | integer | No | Latest year of interest, inclusive (e.g., `1810`). Must be ≥ `startYear`. Omit for all periods. |
| `recordTypeGroups` | string[] | No | One or more record-type group names from the closed vocabulary in [Record-type filtering](#record-type-filtering). Results are restricted to volumes carrying at least one matching coverage. Multiple groups are **OR**-ed. Omit to search all record types. |
| `pageToken` | string | No | Opaque pagination cursor. Pass back the `nextPageToken` from a previous response to fetch the next page. **Must be sent together with the same `standardPlace`/`startYear`/`endYear`/`recordTypeGroups`** that produced it (see [Pagination](#pagination)). |

### Fixed fields (always sent in the group-search request body)

| Field | Value | Rationale |
|-------|-------|-----------|
| `types` | `["NATURAL"]` | Only query Natural Groups, for correct granularity |
| `active` | `true` | Only return available groups |
| `pageSize` | `100` | One page per call (see Pagination) |
| `returnChildCounts` | `true` | Populates `childCount` / `indexedChildCount` / `noIndexableDataChildCount` **inline** on each group in the search response |

`returnChildCounts: true` is sent, and the group-search response returns the
child counts **inline** on each group — no per-group sub-fetch is needed.
(Confirmed against the live API: the search response carries `childCount`,
`indexedChildCount`, and `noIndexableDataChildCount` directly.)

### Internal conversion: standardPlace → placeId → placeRepIds

When the LLM provides a `standardPlace` name, the tool resolves it in two
steps (both **anonymous** — no auth token is sent on these calls):

1. `standardPlaceToPlaceId(standardPlace)` resolves the name to a single
   `placeId` via FamilySearch place search. It returns `null` when the
   name is unresolvable or maps to multiple distinct spots (guarding the
   fan-out).
2. `placeIdToRepIds(placeId)` calls
   `GET https://api.familysearch.org/platform/places/{placeId}` and
   extracts all `placeRepId`s (one placeId can map to multiple
   placeRepIds).
3. The tool passes them in a single search call via
   `coverage.placeRepIds` — the API accepts the array natively (no
   fan-out or dedup needed).

This is invisible to the LLM, which only ever provides a
`standardPlace`. Both helpers live in the shared resolver
`src/utils/place-resolver.ts` (see [Files](#files)).

> There is **no reverse `placeRepId` → `placeId` conversion** in this
> tool. The old tool did this to populate a `placeId` in coverage
> output; that field has been dropped, so the reverse conversion
> (`repIdToPlaceId`) is removed entirely.

### Request body example

The RMS wire fields `fromDateString`/`toDateString` are **derived** from the
integer `startYear`/`endYear` inputs (they are not passed by the caller):
`fromDateString = "${startYear}-01-01"` and
`toDateString = "${endYear}-12-31"`. This is years-only — there is **no**
sub-year/ISO-day precision. So `startYear: 1730, endYear: 1810` yields:

```json
{
  "coverage": {
    "placeRepIds": [2968392, 10609408],
    "fromDateString": "1730-01-01",
    "toDateString": "1810-12-31",
    "recordTypeConceptIds": [122797]
  },
  "types": ["NATURAL"],
  "active": true,
  "pageSize": 100
}
```

On a paged call, `nextPageToken` is added and the rest of the body is
**byte-for-byte identical** to the call that produced the token (the API
requires this).

---

## Record-type filtering

Everything in this section was determined empirically against the live API —
FamilySearch publishes no documentation for it. Each claim names the probe
section that reproduces it:
`npx tsx dev/probe-record-type-groups.ts <section>`.

### The request field

The RMS group-search endpoint accepts a record-type filter **inside `coverage`**,
beside `placeRepIds`:

```ts
coverage: {
  placeRepIds: number[];
  fromDateString?: string;
  toDateString?: string;
  recordTypeConceptIds?: number[];   // ← the filter
}
```

> **Probing this endpoint requires controls.** It returns `200` and ignores
> unknown request fields silently, so a successful response is not evidence that
> a parameter exists. Only a response whose `totalCount` **moves** is.
> Section `filter`, Harjager 1650–1720 — baseline `110`; a bogus field at top
> level and inside `coverage` both return `110`; `recordTypeConceptIds` at top
> level returns `110`; **inside `coverage` it returns `4`**. The singular
> `recordTypeConceptId` and a name-based `recordTypes` are not parameters.

### Semantics

| Behaviour | Detail | Section |
|---|---|---|
| **Hierarchy containment** | An ancestor id matches its entire subtree. Harjager 1650–1720: `122797` (Legal, root) and `127010` (Court, its child) both return **25**, while `124277` (Probate, below Court) returns **3**; `123402` (Religious) returns **81** against `127575` (Religious Birth) at **2**. | `containment` |
| **OR across the array** | `[124410]`→4, `[123402]`→81, `[124410,123402]`→**85**. Intersection would return 0. | `or` |
| **Unknown id contributes nothing** | Alone it returns `totalCount: 0` with status `200` — indistinguishable from "no such records here". Alongside a valid id it is silently dropped (`[124410,999999]`→4). | `or` |
| **Filters groups, not coverages** | A matching group is returned with **all** its coverage rows, including types that did not match. Harjager filtered on `124410` returns 4 groups carrying 48 matching rows **and 48 non-matching** ones (`123363` Census — a different root). Consumers must not assume every returned `recordType` satisfies the filter. | `containment` |
| **The date window filters groups too** | The same is true of `startYear`/`endYear`: a matched group carries coverage rows entirely outside the requested range. A Harjager query for 1650–1720 returns groups whose rows include 1846–1858. Do not treat a returned `dateRange` as being within the requested window. | `containment` |

Because containment is applied server-side, a group needs only its **anchor**
concept id — not an enumeration of the types beneath it.

#### Two quirks that affect how the request is built

- **Key matching is case-lenient, not exact.** `recordTypeConceptIDs` (capital
  `D`) is honoured and filters identically. So "the endpoint ignores anything it
  does not recognise" is too strong a model: it ignores unknown *fields*, but
  tolerates case variants of known ones. Send the documented spelling; do not
  infer from a working response that a guessed field name is correct.
- **An empty array is a no-op.** `recordTypeConceptIds: []` returns the
  unfiltered baseline. The tool must therefore decide explicitly what
  `recordTypeGroups: []` means rather than passing it through: **treat an empty
  array as "no filter"**, matching the API, and never as an error.
- String ids are coerced (`["124410"]` filters correctly), so a wire-format slip
  will not surface as an error. Send numbers.

### The group vocabulary

`recordTypeGroups` is a **closed** vocabulary declared as an `enum` on the tool's
input schema, following the `enum: [...CONST_LIST]` precedent in
`extraction-append.ts` and `research-log-append.ts`. The names live in the schema
rather than in any `SKILL.md`, so they cost no tokens per skill invocation.

**The enum literals are exactly the values in the *Group* column below**, verbatim
and case-sensitive — `"ID documents"`, `"Poor Law"`, `"Government Pensions"`.
They are exported as `RECORD_TYPE_GROUP_NAMES` from
`src/utils/record-type-groups.ts` and spread into the schema, so the list exists
once. Sentence case with proper nouns capitalised; no kebab- or snake-casing.

> **The vocabulary cannot be finalised until the [open questions](#open-questions-for-review)
> are answered.** Questions 2 and 3 change its membership (whether Casualties
> ships at all, whether Emigration is kept) and question 6 changes the Newspapers
> anchor — which the [reach](#what-the-filter-excludes-and-what-it-does-not)
> measurement shows is worth 3.5% of one jurisdiction. Implement the mechanism
> against the table as it stands; expect the literals to move once.

Each group maps to `{ anchors, strays }`:

- **`anchors`** — concept ids whose subtree covers the group. Usually one.
- **`strays`** — ids belonging to the group editorially but sitting **outside**
  every anchor's subtree, so containment cannot reach them. They are added to the
  same `recordTypeConceptIds` array; there is no post-filter. Verified list in
  [Strays](#strays).

#### The group table

**Every group is a single row with exactly one parent**, so containment is
unambiguous. `—` in *Parent* means a root. Selecting a group returns its own
volumes **plus every group nested beneath it**. Reproduce with section `tree`.

| Group | Anchor | Parent | Also returns |
|---|---|---|---|
| Genealogies | `123682` | — | Biography |
| Biography | `122921` | Genealogies | |
| Vital | `124443` | — | Birth, Death, Cemetery, Marriage, Divorce |
| Birth | `103979` | Vital | |
| Death | `104898` | Vital | Cemetery |
| Cemetery | `104497` | Death | |
| Marriage | `104727` | Vital | |
| Divorce | `104832` | Vital | |
| Religious | `123402` | — | Baptism, Religious Death, Religious Marriage, Confirmation |
| Baptism | `103612` | Religious | |
| Religious Death | `127576` | Religious | |
| Religious Marriage | `127577` | Religious | |
| Confirmation | `101655` | Religious | |
| Military | `124133` | — | Military Pensions, Draft |
| Military Pensions | `127621` | Military | |
| Draft | `104808` | Military | |
| Migration | `127023` | — | Emigration, Naturalization |
| Emigration | `123632` | Migration | |
| Naturalization | `124162` | Migration | |
| Census | `123363` | — | |
| Legal | `122797` | — | Court, Probate, Guardianship, Wills, Land, Enslavement, Notarial |
| Court | `127010` | Legal | Probate, Guardianship |
| Probate | `124277` | Court | Guardianship |
| Guardianship | `123769` | Probate | |
| Wills | `124457` | Legal | |
| Land | `127026` | Legal | Enslavement |
| Enslavement | `126864` | Land | |
| Notarial | `100599` | Legal | |
| Government | `126517` | — | ID documents, Passports, Foreigner, Tax, Wartime, Poor Law, Prison, Government Pensions, Indigenous |
| ID documents | `126546` | Government | Passports |
| Passports | `124216` | ID documents | |
| Foreigner | `131588` | Government | |
| Tax | `124410` | Government | |
| Wartime | `130090` | Government | |
| Poor Law | `126768` | Government | |
| Prison | `123478` | Government | |
| Government Pensions | `124227` | Government | |
| Indigenous | `130717` | Government | |
| Voting | `127015` | — | |
| School | `124365` | — | |
| Business | `126340` | — | |
| Reference | `126808` | — | |
| Medical | `127076` | — | |
| Photographs | `122956` | — | |
| Miscellaneous | `124078` | — | |
| Administrative | `135784` | — | |
| Newspapers | `119166` | *(under `124231`, which is not itself a group)* | |

**Consumers must be told the nesting**, because it is not visible from a group
name: asking for *Government* also returns tax, prison, poor-law, passport,
foreigner, wartime, pension and indigenous volumes. Express the hierarchy as this
table rather than an indented diagram: a nested `⊃` notation is ambiguous about
whether a name following it is a sibling or a child; one parent per row is not.

#### Strays

Ids that belong to a group editorially but sit outside its anchor's subtree.
Verified individually with section `anchors`; each row's *Actually under* is the
id's real ancestor chain.

| Group | Stray | Actually under |
|---|---|---|
| Baptism | `127575` religious birth records | Religious `123402` — a **sibling** of the Baptism anchor `103612`, not a descendant. 208,413 volumes globally |
| Prison | `131448` police records | Government `126517` — a **sibling** of the Prison anchor `123478`. 50,432 volumes globally |
| Death | `122911` obituaries | Newspapers `124231›119166` |
| Religious Death | `127739` religious burial | Religious `123402` |
| Passports | `124432`, `124442`, `131572` travel permits, visas, residence permits | Migration `127023` |
| ID documents | `129962`, `129964` driver records and licences | Government `126517` |
| Census | `104611` military census | Military `124133` |
| Court | `127571` court martial | Military `124133` |
| Wills | `127073` testamentary letters | Probate `122797›127010›124277` |
| Wills | `129547` religious testaments | Religious `123402` |
| Tax | `129065` tax census | Census `123363` |
| Prison | `130086` criminal records | Legal `122797` |
| Prison | `126416` criminal case files | Criminal court `122797›127010›126417` |
| Government Pensions | `126869`, `124383` social-security death | Vital › Death `124443›104898` |
| Government Pensions | `127027` widow records | Government `126517` |

Two of these resolve a duplicate assignment in the source list: `127571` and
`129065` were each claimed by two groups, and the taxonomy settles which owns
them. (`131421` is also double-claimed but resolves *inside* Government Pensions
`124227`, so containment already reaches it and it needs no stray row.)

**Enumerate this table; do not describe it.** The source list gives Baptism and
Prison a *second* anchor each, and both sit outside the first anchor's subtree.
Carrying only the first anchor drops 208,413 and 50,432 volumes from those groups
respectively, with no error and no empty result to notice.

### Relationship to the other record-type filters — read before naming anything

**Three sibling tools already accept a `recordType`, and none of their
vocabularies is this one.** The differences are deliberate, but they are a trap
for an agent transferring a value between tools, so they are spelled out here
rather than discovered.

| Where | Field | Type | Vocabulary |
|---|---|---|---|
| `record_search` | `recordType` | string | **closed, 8**, lowercase: `birth`, `marriage`, `death`, `census`, `immigration`, `military`, `probate`, `other` — mapped to the upstream integer encoding (`RECORD_TYPE_TO_INT`, `src/tools/record-search.ts`) |
| `fulltext_search` | `recordType` | string | **open**, free text, forwarded as `f.recordType0` |
| `research.json` | `record_type` | string | **open enum, snake_case** — `record_type_recommended` in `enums.schema.json`, e.g. `census`, `vital_record`, `probate`, `church` |
| **`volume_search`** | **`recordTypeGroups`** | **string[]** | **closed, 47**, Title Case — this document |

**They filter different objects, which is why one vocabulary cannot serve all
four.** `record_search`'s `recordType` narrows indexed *records* by the event the
record attests. `volume_search`'s `recordTypeGroups` narrows *volumes* by the kind
of book. A single volume of `Religious` records contains birth, marriage and death
records at once, so "this volume is a church register" and "this record is a
birth" are orthogonal statements — not coarse and fine versions of one statement.
`research.json`'s `record_type` is a third thing again: what a human wrote down
about a source in the research log.

Approximate correspondences, for an agent moving from a record search to a volume
search. **Approximate is the operative word** — each row is a widening, not an
equivalence, because a volume carrying one event type generally carries others:

| `record_search.recordType` | Closest `recordTypeGroups` |
|---|---|
| `birth` | `Birth`, or `Baptism` for a parish register |
| `marriage` | `Marriage`, or `Religious Marriage` |
| `death` | `Death`, or `Religious Death`; `Cemetery` for burials |
| `census` | `Census` |
| `immigration` | `Migration` |
| `military` | `Military` |
| `probate` | `Probate` |
| `other` | no correspondence — do not map it |

> **The name mismatch fails silently, and that is the reason to document it.** No
> tool in this server sets `additionalProperties: false`, and `volume_search`'s
> `validate()` inspects only known fields. So `recordType: "probate"` sent to
> `volume_search` is **ignored, and the search runs unfiltered** — a full result
> set with no error and no signal that the filter was dropped. See
> [open question 7](#open-questions-for-review).

### Names are not stable; concept ids are

`recordTypeOrig` is **locale- and collection-specific display text**, not a
canonical label — `101655` surfaces as "Konfirmationslängd" in Sweden, `124372`
as "Militärische Kriegsgefangenenakten", `126869` as "Begraven". Some values are
literal placeholders (`concept-id:124231`, `concept-id:123632`), and of the 13
roots observed by section `roots`, **six carry no label at all**: `122797`,
`124078`, `126340`, `126517`, `126808`, `127015`.

> **Which roots are unnamed is sample-dependent, and that is itself the point.**
> A shallower sweep of the same 10 places left `124443` unnamed and never
> surfaced `126340` as a root; deeper pagination named `124443` ("Vital records")
> and revealed `126340`. A name map harvested from observed leaves is therefore a
> floor, never a census — which is why the vocabulary's English names are
> supplied by this spec rather than derived from the API at runtime.

The concept id is the only stable key.

`recordTypeConceptId` is surfaced on each coverage in the [Output](#output) so a
consumer can reason about the tree without depending on display text.

### What the filter excludes, and what it does not

**A missing display name is not a missing type.** The filter matches on
`recordTypeConceptId`; `recordTypeOrig` is only a label. Confusing the two
inverts every conclusion in this section, so both are measured separately.
Section `roots`, 10 places, window 1500–1950, first 2 pages (≤200 groups) per
place, 2704 coverages:

| | Coverages |
|---|---|
| lacking a **display name** (`recordTypeOrig`) | **475 / 2704 — 18%** |
| lacking a **concept id** (what the filter matches) | **1 / 2704 — 0%** |

The two diverge completely by jurisdiction. New South Wales has **202 of 202**
coverages with no display name and **0 of 202** with no concept id; Ontario is
144/200 and 0/200. A filter reaches both places in full.

**Filter reach is high but not total.** Section `reach` OR-s **every id the
vocabulary would send** — all 47 anchors plus all strays, 66 ids — against each
place's unfiltered baseline:

| Place | Reachable |
|---|---|
| Harjager · Edensor · Wayne · Jalisco · Tolna | **100%** |
| Kent, England | 10593 / 10595 |
| Ontario, Canada | 32609 / 32628 — 99.9% |
| Bayern, Germany | 163884 / 164292 — 99.8% |
| Oslo, Norway | 6192 / 6227 — 99.4% |
| **New South Wales, Australia** | **3641 / 3775 — 96.5%** |

**So the constraint is the completeness of our vocabulary, not the API's data** —
every one of those shortfalls is a volume whose type sits outside the subtrees we
name, not a volume without a type.

**Most of the gap traces to one open question.** Newspapers is anchored on
`119166`, the *child*; its root `124231` is not in the vocabulary. Adding
`124231` alone takes New South Wales from 3641 to **3775 (100%)** and Oslo from
6192 to **6227 (100%)**. So the choice in [open question 6](#open-questions-for-review)
is not cosmetic — anchoring on the child costs 3.5% of New South Wales.

> **This measurement must be derived from the vocabulary, never hand-listed.** The
> probe's `reach` section reads the same `VOCABULARY` constant its `tree` section
> does, so a change to the group table moves the number. A hardcoded id list
> reports a reach figure for a vocabulary that does not ship.

Consequences for the tool:

1. **No untyped-coverage advisory, and do not add one.** Measured against
   `recordTypeConceptId` — the field the filter matches — the excluded count is
   `0` almost everywhere, so reporting it carries no information and a
   majority-untyped warning could never fire. The temptation comes from measuring
   `recordTypeOrig` instead, which is absent 18% of the time and irrelevant to
   what the filter reaches.
2. **An unknown group name is a hard error** naming the valid set — never an
   empty result, which is indistinguishable from a genuine absence of records
   (the API returns `totalCount: 0` with status `200` for an unrecognised id).
3. **Re-measure `reach` whenever the vocabulary changes.** It is the check that
   the group list still covers the corpus, and it is cheap — one query per place.

## API response shape

Probed against the live endpoint (see `metadata-search-documentation.txt`).

**Top-level:**

```json
{
  "groups": [ ... ],
  "numberReturned": 6,
  "totalCount": 6,
  "nextPageToken": "002400...1a0004"
}
```

- `nextPageToken` is present only when more pages remain.
- **Empty result:** when no groups match, the response is
  `{"totalCount": 0}` — no `groups` key and no `numberReturned`. The
  tool must default `results` to `[]` and `totalResults` to `0`.

**Each group (fields this tool consumes):**

| API field | Type | Used for |
|-----------|------|----------|
| `groupName` | string | `imageGroupNumber` and (derived) `imageGroupPrefix` |
| `childCount` | number? | `imageCount` and the `recordSearchablePercent` numerator base |
| `indexedChildCount` | number? | `recordSearchablePercent` numerator |
| `noIndexableDataChildCount` | number? | excluded from the `recordSearchablePercent` denominator |
| `id` | string | Group identifier (not output) |
| `coverages` | Coverage[] | `coverages` output array |
| `languages` | string[] | `languages` output |
| `title` | string? | `title` output (when present) |
| `volumes` | string[]? | `volumes` output (when present) |

Group fields intentionally **ignored**: `creators`, `custodians`,
`active`, `types`, `externalId`, `externalIds`, `parentIds`,
`phoenixAcquisitionIds`, `archivalReferenceNumbers`, `hasAuditIssues`,
`createdDateTime`, `modifiedDateTime`, `modified`,
`publicationDateOverride*`.

**Each coverage entry (fields this tool consumes):**

| API field | Type | Used for |
|-----------|------|----------|
| `place` | string | `place` (resolved, human-readable) |
| `datesOrig` | string? | `dateRange` (when present, e.g. `"1726–1812"`; a `title:` prefix is stripped) |
| `recordTypeOrig` | string? | `recordType` (when present and not an opaque `concept-id:` value; a `title:` prefix is stripped) |
| `recordTypeConceptId` | number? | `recordTypeConceptId` — the stable key, and what [record-type filtering](#record-type-filtering) matches on |
| `fromdateString` | string? | `startYear`, and `dateRange` when `datesOrig` is absent |
| `todateString` | string? | `endYear`, and `dateRange` when `datesOrig` is absent |

Coverage fields **consumed**: `place`, `datesOrig`, `recordTypeOrig`,
`recordTypeConceptId`, and `fromdateString`/`todateString` (parsed to
`startYear`/`endYear`, and used to derive `dateRange` when `datesOrig` is
absent).

Coverage fields intentionally **ignored**: `placeRepId`,
`placeRepIdHierarchy`, `placeCoordinates`, `placeOrig`,
`placeRelevance`, `recordTypeConceptIdHierarchy`, `lifeEventIds`,
`fromDate`/`toDate` (superseded by the string forms — see
[Output](#output)), `citationString`, `source`.

---

## Child counts (inline)

The group-search request sends `returnChildCounts: true`, and the search
response returns the child counts **inline on each group** — there is **no
per-group sub-fetch**. Each group carries:

| API field | Meaning |
|-----------|---------|
| `childCount` | Total images in the group |
| `indexedChildCount` | Images indexed into structured records |
| `noIndexableDataChildCount` | Images with no indexable data (blanks, covers, etc.) |

The tool derives:

- **`imageCount`** ← `childCount`
- **`recordSearchablePercent`** ← `round( indexedChildCount / (childCount − noIndexableDataChildCount) × 100 )`

The denominator excludes non-indexable images so the percent reflects
the fraction of *indexable* images that have actually been indexed.

**Edge cases:**
- If the denominator (`childCount − noIndexableDataChildCount`) is `≤ 0`,
  set `recordSearchablePercent` to `null`.
- If a group omits the count fields entirely, set both `imageCount` and
  `recordSearchablePercent` to `null` for that group.

---

## Full-text searchability sub-fetch

To set `fulltextSearchable`, the tool batches the page's `groupName`
values (≤ 100 per call) into:

```
GET https://sg30p0.familysearch.org/service/search/fulltext/search/groupNumber?ids=8583524,007621224_005_M99P-2TQ,...
```

The response is the **sublist of ids that are full-text searchable**:

```json
{ "ids": ["8583524", "005876561"] }
```

Mapping:

- Build a `Set` from the returned `ids`.
- For each group, `fulltextSearchable = set.has(group.groupName)`
  (`true` if echoed back, `false` if not).
- The call is **retried up to 3 times** on failure. If it still fails,
  set `fulltextSearchable` to `null` (unknown) for every group in the
  batch — **not** `false` (absence-from-results means "not searchable";
  a failed call means "we could not determine it").

The endpoint accepts full `groupName`s, including split-group forms
(e.g., `7710186_001_M995-YTF` appears in the example `ids`), so matching
on the full `groupName` is exact — no prefix fallback is needed.

---

## Output

**Top-level:**

| Field | Type | Description |
|-------|------|-------------|
| `query` | object | Echo of input (`standardPlace`, `startYear?`, `endYear?`, `recordTypeGroups?`) |
| `totalResults` | number | `totalCount` from the API (across all pages) |
| `nextPageToken` | string? | Present only when more pages remain; pass back as `pageToken` |
| `results` | VolumeGroup[] | The matched image groups (this page) |

**Each `VolumeGroup`:**

| Field | Type | Description |
|-------|------|-------------|
| `imageGroupNumber` | string | The group's `groupName` (e.g., `"004452257"` or `"007621224_005_M99P-2TQ"`). Pass to `image_search` to list its images, or to `fulltext_search` (as its `imageGroupNumber`) to search this volume's text. |
| `imageGroupPrefix` | string | The bare image group number: the substring before the first `_` if any underscore is present, else the whole `groupName`. (`"007621224_005_M99P-2TQ"` → `"007621224"`; `"004452257"` → `"004452257"`.) Either this or the full `imageGroupNumber` can be passed to `record_search`'s image-group filter (coming in a later PR; see [Relationship to other tools](#relationship-to-other-tools)). |
| `imageCount` | number \| null | Total images in the group (`childCount`); `null` if counts couldn't be fetched. |
| `recordSearchablePercent` | number \| null | Percent of indexable images that are indexed into searchable records; `null` if not computable or counts couldn't be fetched. |
| `fulltextSearchable` | boolean \| null | `true`/`false` from the full-text endpoint; `null` if the check failed. |
| `title` | string? | Human-readable title, when present. |
| `volumes` | string[]? | Volume identifiers (e.g., `["Libro 9"]`), when present. |
| `languages` | string[] | Language codes (e.g., `["en", "la"]`); `[]` when absent. |
| `coverages` | SimplifiedCoverage[] | What this volume covers. |

**Each `SimplifiedCoverage`:**

| Field | Type | Description |
|-------|------|-------------|
| `place` | string | Human-readable place (e.g., `"Edensor, Derbyshire, England, United Kingdom"`). |
| `dateRange` | string? | Human-readable date range (from `datesOrig`, e.g., `"1726–1812"`), when present. A `^title:` prefix is stripped and the value kept, as on `recordType`. Omitted if nothing remains after stripping. |
| `recordType` | string? | Record type (from `recordTypeOrig`, e.g., `"Burial Records"`), when present. Omitted when the API returns an opaque internal id (a value matching `^concept-id:`). A `^title:` prefix is **stripped and the value kept** — that prefix marks provenance (the type came from the volume's title rather than the concept taxonomy), not a placeholder, so `"title:Taxation"` surfaces as `"Taxation"`. Omitted if nothing remains after stripping. |
| `recordTypeConceptId` | number? | The concept id behind `recordType` (from `recordTypeConceptId`), when present. **The stable key** — `recordType` is locale- and collection-specific display text and is sometimes an unusable placeholder, whereas the id is constant across locales and is what [record-type filtering](#record-type-filtering) matches on. Surfaced so a consumer can identify a type it cannot read the name of. |
| `startYear` | number? | First year covered, parsed from `fromdateString`. |
| `endYear` | number? | Last year covered, parsed from `todateString`. |

**Why the date pair is surfaced, and why `dateRange` falls back to it.**
`datesOrig` is display text and is **absent more often than the structured pair**:
over 4 pages per place, window 1500–1950, Wayne, Ohio has `datesOrig` on 335 of
463 coverages while `fromdateString`/`todateString` are present on **462**. Emitting
only `datesOrig` therefore drops a date the API supplied on ~27% of Wayne's rows.
`datesOrig` is also inconsistent (`"1882–1896"` with an en-dash beside
`"1870-1880"` with a hyphen, in one place) and carries the `title:` prefix, which
the pair never does — 0 occurrences in 2161 coverages.

So: `dateRange` keeps the archival display string when there is one, and is
**derived from the pair when `datesOrig` is absent**; `startYear`/`endYear` are
always emitted when the pair is present, because a consumer cannot compare or
filter on `"1882–1896"`.

Note the raw `fromDate`/`toDate` are epoch **milliseconds, negative before 1970**
(`-8899027200000`), so the ISO-shaped `fromdateString`/`todateString` are the
fields to parse.

**Reuse: match `collections_search`, do not invent a second format.**
`src/tools/collections-search.ts` already derives a display range from a
`startYear`/`endYear` pair — `` `${startYear}-${endYear}` `` when both are
present, the bare start year when only one is. `dateRange`'s fallback must produce
the same shape, so the two tools do not describe the same span differently. Those
fields are also already typed `startYear?: number` / `endYear?: number` on
`FSSearchMetadata` (`src/types/collection.ts`), which is the naming and type this
spec follows.

**Year extraction: take the leading four digits; do not route through the
genealogical date helpers.** `earliestYear` / `latestYear`
(`src/utils/date-helpers.ts`) parse the repo's *standardized* date strings —
`"11 Sep 1718"`, `"Bet 1870 and 1880"` — and return `null` for every ISO form.
Verified live:

```
"1683-01-01T00:00:00"     -> null
"1700-12-31T23:59:59.999" -> null
"1683-01-01"              -> null
"1683"                    -> 1683
"11 Sep 1718"             -> 1718
```

So they cannot be reused here, and **widening them to accept ISO is deliberately
out of scope**: they are shared by the timeline, conflict and warning paths, and a
change to their parsing surface risks those for no benefit to this tool. Extract
the year locally instead, and treat a value that does not begin with four digits
as absent rather than guessing.

### Output example

```json
{
  "query": {
    "standardPlace": "Edensor, Derbyshire, England, United Kingdom",
    "startYear": 1730,
    "endYear": 1810
  },
  "totalResults": 6,
  "results": [
    {
      "imageGroupNumber": "004452257",
      "imageGroupPrefix": "004452257",
      "imageCount": 412,
      "recordSearchablePercent": 89,
      "fulltextSearchable": false,
      "languages": ["en", "la"],
      "coverages": [
        {
          "place": "Edensor, Derbyshire, England, United Kingdom",
          "dateRange": "1726–1812",
          "recordType": "Burial Records"
        }
      ]
    }
  ]
}
```

---

## Tool schema

```typescript
{
  name: "volume_search",
  description:
    "Search FamilySearch's Records Management Service for image groups — " +
    "digitized volumes of historical documents (microfilm rolls, book scans) — " +
    "covering a place and year range. Provide a standardPlace from place_search and an " +
    "optional year range. For each volume it returns coverage (places, dates, " +
    "record types), how much of the volume is indexed for record_search " +
    "(recordSearchablePercent), and whether it is full-text searchable " +
    "(fulltextSearchable). Use the returned imageGroupNumber with image_search to " +
    "list the volume's images, or with fulltext_search to search its text. " +
    "Results are paginated — pass back nextPageToken (with the same standardPlace and " +
    "years) as pageToken to get the next page. " +
    "Optionally narrow to record-type groups with recordTypeGroups. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      standardPlace: {
        type: "string",
        description:
          "Standard place name (the `standardPlace` field from place_search). " +
          "Required. The tool resolves it to a placeId and its place " +
          "representation IDs for the query.",
      },
      startYear: {
        type: "integer",
        description:
          "Earliest year of interest, inclusive (e.g., 1730). Omit for all periods.",
      },
      endYear: {
        type: "integer",
        description:
          "Latest year of interest, inclusive (e.g., 1810). Must be ≥ startYear. " +
          "Omit for all periods.",
      },
      recordTypeGroups: {
        type: "array",
        items: { type: "string", enum: [...RECORD_TYPE_GROUP_NAMES] },
        description:
          "Restrict to volumes of these record-type groups. Multiple groups are " +
          "OR-ed. Selecting a group also returns the groups nested beneath it — " +
          "'Government' also returns Tax, Prison, Poor Law, Passports and more. " +
          "Omit to search all record types.",
      },
      pageToken: {
        type: "string",
        description:
          "Pagination cursor. Pass the nextPageToken from a previous " +
          "response, together with the same standardPlace/startYear/endYear/" +
          "recordTypeGroups, to fetch the next page.",
      },
    },
    required: ["standardPlace"],
  },
}
```

---

## Authentication

Uses `getValidToken()` from `src/auth/refresh.ts`. Same OAuth flow as
all other authenticated tools. Do not re-implement token plumbing.

---

## Error handling

| Condition | Behavior |
|-----------|----------|
| `standardPlace` not provided | Throw: `"volume_search requires a standardPlace."` |
| `standardPlace` unresolvable / ambiguous | Throw: `"Could not resolve \"<name>\" to a single place; use place_search ..."` |
| `startYear` not an integer year | Throw: `"startYear must be an integer year (e.g., 1730)."` |
| `endYear` not an integer year | Throw: `"endYear must be an integer year (e.g., 1810)."` |
| `endYear` < `startYear` | Throw: `"endYear must be greater than or equal to startYear."` |
| Resolved place has no placeRepIds | Throw: `"No place representations found for \"{standardPlace}\"."` |
| `recordTypeGroups` contains an unrecognised name | Throw: `"Unknown record-type group \"<name>\". Valid groups: <list>."` — never fall through to an unfiltered or empty search, since the API answers an unrecognised concept id with `totalCount: 0` and status `200`, which is indistinguishable from a genuine absence of records |
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error |
| Group-search API returns 401 | Throw: `"FamilySearch session not accepted; call the login tool to re-authenticate."` |
| Group-search API returns 403 | Throw: `"FamilySearch volume search API error: 403 Forbidden."` |
| Group-search API other non-OK | Throw: `"FamilySearch volume search API error: {status} {statusText}."` |
| Group-search network error | Throw: `"Could not reach FamilySearch volume search API: {message}."` |
| Group missing inline count fields | Set `imageCount` and `recordSearchablePercent` to `null` for that group; continue |
| **Full-text** check fails (after 3 retries) | Set `fulltextSearchable` to `null` for the batch; continue |

The full-text sub-fetch failure is **non-fatal** — a partial result with
`null` signals is more useful than a hard error.

---

## Mapping logic

### Pre-request

1. Validate `standardPlace` (required) and the integer years
   (`startYear`/`endYear`, with `endYear` ≥ `startYear`).
2. Resolve `standardPlace` → `placeId` via `standardPlaceToPlaceId`,
   then `placeId` → `placeRepIds` via `placeIdToRepIds` (both anonymous).
3. If `recordTypeGroups` is present and non-empty, map each name through the
   group table to its **anchor plus any strays**, union the ids, and set
   `coverage.recordTypeConceptIds`. An unrecognised name throws (see
   [Error handling](#error-handling)); an empty array is treated as no filter,
   matching the API.
4. Derive the RMS wire dates from the integer years
   (`fromDateString = "${startYear}-01-01"`,
   `toDateString = "${endYear}-12-31"`) and build the group-search body
   (fixed fields + coverage + optional `nextPageToken`).

### Group search → full-text

1. PUT the group search (`returnChildCounts: true`); read `groups`,
   `totalCount`, `numberReturned`, `nextPageToken`. Child counts arrive
   **inline** on each group — no per-group fetch.
2. In one or more batches of ≤ 100 `groupName`s (3 retries): fetch the
   full-text-searchable set.

### Per-group mapping

For each group in `response.groups`:

1. `imageGroupNumber` ← `group.groupName`
2. `imageGroupPrefix` ← `group.groupName` before first `_`, else whole
3. `imageCount` ← `childCount` (or `null`)
4. `recordSearchablePercent` ← computed (or `null`)
5. `fulltextSearchable` ← membership in the full-text set (or `null`)
6. `title` ← `group.title` (when present)
7. `volumes` ← `group.volumes` (when present)
8. `languages` ← `group.languages ?? []`
9. For each `group.coverages` entry:
   - `place` ← `coverage.place`
   - `dateRange` ← `coverage.datesOrig` (when present), with a leading
     `^title:\s*` stripped and the result trimmed; omitted when the
     result is empty
   - `recordType` ← `coverage.recordTypeOrig`, when present and not matching
     `^concept-id:`, with a leading `^title:\s*` stripped and the result
     trimmed; omitted when the result is empty
   - `recordTypeConceptId` ← `coverage.recordTypeConceptId` (when present)
   - `startYear` / `endYear` ← the leading year of
     `coverage.fromdateString` / `coverage.todateString` (when present)
   - when `coverage.datesOrig` is absent but the pair is present, `dateRange`
     is derived from `startYear`/`endYear` (`"1683-1700"`, or just the year
     when they are equal)

---

## Pagination

The API paginates with an opaque cursor. Constraints (from the API
docs):

- `nextPageToken` is **only valid with the exact same searchSpec** — the
  tool must rebuild a byte-for-byte identical body and append the token.
  Therefore the caller passes `pageToken` **together with the same
  `standardPlace`/`startYear`/`endYear`/`recordTypeGroups`** — the filter is
  part of the body, so omitting it on the follow-up call would silently widen
  the search mid-pagination. The year → ISO date derivation
  (`"${startYear}-01-01"` / `"${endYear}-12-31"`) is deterministic, so the
  same years always produce the same `fromDateString`/`toDateString` and
  hence the same body.
- The token is a client-side cursor with a **~9-day TTL** (the database
  is repaired every 9 days); stale tokens may skip or duplicate rows.

> **`standardPlace` re-resolution caveat (since the input is now a name, not a
> placeId).** Each page re-resolves `standardPlace` → `placeId` → `placeRepIds`
> to rebuild the coverage body. Within one server process this is deterministic
> (the resolver's in-process caches memoize the lookups), so pagination is
> byte-stable for the lifetime of a session. The only way the rebuilt body can
> differ from the token-minting body is if the **process restarts** between
> pages *and* the underlying FamilySearch place data shifts within the same
> 9-day window — a rare edge. Because `standardPlace` is a canonical
> fully-qualified name, resolution is exact-match and stable in practice; if a
> stale cursor is ever rejected, the caller simply re-issues page 1.

The tool returns **one page (≤ 100 groups) per call** plus
`nextPageToken` when more remain. It does **not** auto-aggregate all
pages — that would walk every page (and full-text batch) for what is
usually just a scoping question. `totalResults` tells the caller how many
groups exist in total.

---

## Caching

No caching. Results depend on search parameters and change as new
images are digitized, indexed, or full-text processed.

---

## Files

> **The rows below marked *Create* describe the tool's original build. The tool
> ships today**, so for the record-type-group and structured-date work in this
> spec they are **edits**, listed separately beneath.

| File | Action |
|------|--------|
| `src/types/volume-search.ts` | Create — input, output, and API response types |
| `src/tools/volume-search.ts` | Create — tool function, validation, request building, full-text sub-fetch, mapping, schema export |
| `src/utils/place-resolver.ts` | Use — `standardPlaceToPlaceId` and `placeIdToRepIds` (the place-name → placeId → placeRepIds resolution) live here, anonymous. The old `place-search.ts` copy of `placeIdToRepIds` was deleted; the resolver is the single home |
| `src/tool-schemas.ts` | Add `volumeSearchSchema` to `allToolSchemas` |
| `src/index.ts` | Wire `volume_search` handler in `CallToolRequestSchema` |
| `manifest.json` | Add `{ "name": "volume_search" }` to the `tools` array |
| `dev/try-volume-search.ts` | Create — one-shot smoke test |
| `tests/tools/volume-search.test.ts` | Create — unit tests |
| `README.md` | Add `volume_search` to the tool catalog |
| `CLAUDE.md` | Add `volume_search` to the authenticated-tools list; ensure the code-reuse note points at `src/utils/place-resolver.ts` as the home of `standardPlaceToPlaceId`/`placeIdToRepIds` (not the old `image-search.ts`) |

### Edits for record-type groups and structured dates

| File | Edit |
|---|---|
| `src/utils/record-type-groups.ts` | **New.** The group table as data: `RECORD_TYPE_GROUP_NAMES` (the enum literals, exported for the schema) and a `name → { anchor, strays }` lookup |
| `src/types/volume-search.ts` | Add `recordTypeGroups?: string[]` to `VolumeSearchInput`; `recordTypeConceptIds?: number[]` to `MetadataRmsCoverageRequest`; `recordTypeConceptId?`, `recordTypeConceptIdHierarchy?`, `fromdateString?`, `todateString?` to `MetadataRmsCoverageEntry`; `recordTypeConceptId?`, `startYear?`, `endYear?` to `SimplifiedCoverage` |
| `src/tools/volume-search.ts` | Validate and expand `recordTypeGroups`; send `coverage.recordTypeConceptIds`; map the new coverage fields; add the input to `volumeSearchSchema` |
| `tests/tools/volume-search.test.ts` | Cases 15a–15f |
| `dev/probe-record-type-groups.ts` | **New.** The evidence behind this section; `VOCABULARY` there and the group table here must agree |

---

## Testing

### `tests/tools/volume-search.test.ts`

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns groups for standardPlace + year range | Happy path |
| 2 | Throws when standardPlace is missing | Required-input validation |
| 3 | Throws when startYear/endYear is not an integer, or endYear < startYear | Year validation |
| 4 | Resolves standardPlace → placeId → placeRepIds and passes them in `coverage.placeRepIds` | Input conversion |
| 5 | Sends fixed fields `types:["NATURAL"]`, `active:true`, `pageSize:100`, `returnChildCounts:true` | Request construction |
| 6 | Derives `imageGroupPrefix` for both bare and 3-segment `groupName`s | Prefix rule |
| 7 | Computes `recordSearchablePercent` = round(indexed / (total − nonIndexable) × 100) | Counts math |
| 8 | Sets `recordSearchablePercent: null` when denominator ≤ 0 | Zero-denominator edge |
| 9 | Sets `imageCount`/`recordSearchablePercent: null` when a group omits inline count fields | Missing-counts path |
| 10 | Sets `fulltextSearchable: true/false` from the groupNumber endpoint | Full-text mapping |
| 11 | Sets `fulltextSearchable: null` after the full-text call fails 3× | Full-text failure path |
| 12 | Batches `groupName`s in chunks of ≤ 100 | Batch sizing |
| 13 | Maps coverages to `{ place, dateRange?, recordType?, recordTypeConceptId?, startYear?, endYear? }`; drops `placeId`/`placeRelevance` | Coverage mapping |
| 14 | Omits `recordType` for `concept-id:…`; strips a `title:` prefix and keeps the type | Record-type normalization |
| 15 | Handles empty `{"totalCount":0}` response | Zero-result path |
| 15a | Strips a `title:` prefix from `dateRange`; derives `dateRange` from the date pair when `datesOrig` is absent | Date normalization |
| 15b | Parses `startYear`/`endYear` from `fromdateString`/`todateString`; omits both when the pair is absent | Structured dates |
| 15c | `recordTypeGroups` maps each group name to its anchor **and stray** ids and sends them in `coverage.recordTypeConceptIds` | Group expansion |
| 15d | A parent group's request ids retrieve its nested groups' volumes (containment), and two groups OR rather than intersect | Group semantics |
| 15e | An unrecognised group name throws and names the valid set — it does **not** fall through to an unfiltered or empty search | Unknown-group guard |
| 15f | `recordTypeGroups` is resent on the paginated follow-up call, unchanged | Pagination + filter |
| 16 | Returns `nextPageToken` when present; rebuilds identical body + token on paged call | Pagination |
| 17 | Throws on 401 with re-login guidance | Token-expired path |
| 18 | Throws on network error | Connectivity failure |
| 19 | Sends correct headers (Authorization, Content-Type, User-Agent, FS-User-Agent-Chain) | Header contract |

### Smoke test

```bash
cd packages/engine/mcp-server
npx tsx dev/try-volume-search.ts --standardPlace "Edensor, Derbyshire, England, United Kingdom" --startYear 1730 --endYear 1810
```

> The `standardPlace "Edensor, Derbyshire, England, United Kingdom"` /
> `1730`..`1810` query is a reasonable starting fixture (it
> appears in `metadata-search-documentation.txt`). The live request/response
> behavior has been confirmed: the group search with `returnChildCounts:
> true` returns child counts inline, and the full-text `groupNumber`
> endpoint behaves as specced.

---

## Open questions for review

These are the decisions this spec deliberately does **not** make. Each needs a
judgement the API cannot supply; the measurement behind each is already done.

**1. The strays — absorb or realign?**
Fifteen rows in [Strays](#strays), carrying 19 ids, are assigned to a group
editorially while the taxonomy files them elsewhere. Two options: keep them as `strays` on the group
(the spec's current shape), or realign those groups to follow the taxonomy and
drop the concept. The first honours the editorial intent; the second keeps
`group → anchor` a clean one-to-one. Affects the vocabulary only, not the
mechanics.

**2. Group 14 (Casualties, War, POW) has no anchor.**
Its members split across two roots with no common ancestor — `123352` casualty
records and `124372` POW files under Military `124133`; `124129` military death
and `124445` war graves under Vital › Death `124443›104898`. It cannot be one
anchor. Either it ships as a multi-id group, or it is dropped and its members
reached through Military and Death.

**3. Group 16 (Emigration) sits inside group 15 (Migration).**
`123632` resolves under `127023`, so selecting Migration already returns it. Keep
it as a narrowing convenience, or drop it as redundant? Note `131602`
(departure records), the group's other proposed id, has **zero records** across
the whole corpus and cannot be verified.

**4. Enslavement and Indigenous placement.**
The taxonomy puts Enslavement (`126864`) under **Land & Property** (`127026`),
under Legal — reflecting how enslaved people were recorded in law, as property.
Indigenous (`130717`) sits under **Government** (`126517`). Both are factually
what FamilySearch encodes. Whether this tool surfaces them that way, flattens
them to top level, or annotates them is a judgement for the genealogy reviewers,
not an implementation detail to settle silently. A researcher looking for
enslavement records will not think to open "Land & Property", and a reader
browsing Land will meet them unannounced.

**5. Four groups proposed as anchorless actually have clean root anchors** —
Voting `127015`, Medical `127076`, Photographs `122956`, Administrative
`135784`. The source list marks all four "no large anchor (aggregate)". They
need none of that treatment; confirm the correction.

**6. Newspapers' true root is `124231`, not `119166`.** `119166` resolves under
`124231`, and `124231` is itself only ever labelled with the placeholder
`concept-id:124231`. Should the group anchor on the root (wider, unlabelled) or
the child (narrower, named)?

**7. Should `volume_search` reject unknown input properties?**
Today no tool in this server sets `additionalProperties: false`, so
`recordType: "probate"` — the field name three sibling tools use — is silently
ignored here and the search runs unfiltered. That is a wrong answer with no
signal, the same failure class as the two defects this filter work grew out of.
Setting `additionalProperties: false` on `volume_search` alone would turn it into
a clear error; applying it server-wide would be a **breaking contract change**
across every tool and is not proposed here. Scoping it to one tool is also an
inconsistency of its own. Needs a decision, not a default.

## Design notes

### Two searchability signals, two mechanisms

`recordSearchablePercent` and `fulltextSearchable` describe **different
search systems** and are sourced differently:

- `recordSearchablePercent` comes from the **inline child counts**
  (`indexedChildCount` vs. indexable images) returned on each group. It
  tells the LLM how much of the volume is reachable through the indexed
  `record_search`.
- `fulltextSearchable` comes from the dedicated **full-text groupNumber
  endpoint**. It tells the LLM whether `fulltext_search` (which accepts
  an `imageGroupNumber`) will find anything in this volume.

A volume can be one, both, or neither. Both being low/false is the
signal that the only way into the volume is to browse it image by image
(`image_search` → `image_read`).

### Child counts come back inline

`returnChildCounts: true` on the group search **does** populate
`childCount` / `indexedChildCount` / `noIndexableDataChildCount` inline on
each returned group — confirmed against the live API. There is no
per-group sub-fetch; the tool reads the counts straight off the search
response. (An earlier draft of this spec assumed `returnChildCounts` was
ineffective and required a single-group `?include-child-count=true` fetch
per group; that turned out to be wrong and the inline approach is what
ships.)

### Terminology

The tool uses `imageGroupNumber` / `imageGroupPrefix` consistently on
all LLM-facing surfaces. The underlying API's legacy field name is
`groupName`; it is mapped on output.
