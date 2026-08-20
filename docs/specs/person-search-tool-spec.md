# Person Search Tool — Implementation Spec

## Overview

An MCP tool that searches the **FamilySearch Family Tree** for people.
The caller passes clues — a name, a birth/death/marriage/residence year
or place, the name of a parent or spouse — and gets back a ranked list
of **tree persons** who might be that individual, each with their key
facts and a stable tree-person ID. The skill displays the list and asks
the user which person they want to research.

Requires authentication (OAuth tokens from the `login` tool). Uses the
documented FamilySearch platform endpoint
`GET /platform/tree/search` ("Search Tree Persons").

This is the **find-a-person-in-the-tree** primitive. It does **not**
return each match's relatives — the matched person's own data only.
Expanding a chosen match into their family is already handled by
`person_read`, so the tools chain:

```
place_search(query: "Kentucky")              // (optional) confirm an ambiguous place
  ↓
person_search({ givenName, surname, ... })   // find candidate tree persons
  ↓  user picks one → personId (e.g. "LZJW-C31")
person_read({ personId, relatives: true })   // expand to parents, spouse, children
```

Sibling to `record_search`: that tool searches indexed historical
**records** (documents); this tool searches the collaborative
**tree** (conclusion persons). They share the same `q.*` query-parameter
family, so this spec follows `record_search`'s input-naming convention.

### Surname-plus-one rule (design note)

A search must include:

- `surname` (always required), **and**
- at least one **other** search field — a `givenName`, any life-event
  year or place (birth / death / marriage / residence), or any relative
  name (`spouse*`, `father*`, `mother*`, `parent*`, including relative
  birth places).

`sex`, the `*Exact` toggles, and `count` / `offset` do **not** count as
the "other" field: `sex` barely narrows, the toggles only modify an
existing term, and pagination is not a search criterion. So `surname`
alone, `surname` + `sex`, and `surname` + `surnameExact` are all
rejected.

The tree-search service is heavily fuzzy: a surname alone returns the
whole surname pool (`surname=Lincoln` → 56,177) and even a gibberish
surname returned ~9,700. Requiring a second narrowing field keeps the
result set small enough to be a usable pick-list.

---

## Input

Inputs are grouped by purpose. The surname-plus-one rule above must be
satisfied — `surname` plus at least one other search field. Input field
names follow
the `record_search` convention; the wire mapping to the upstream `q.*`
parameters is in *FamilySearch API Reference → mapping table*.

### Person fields

| Field | Type | Description |
|-------|------|-------------|
| `givenName` | string | Given (first) name. Counts as the required "other" field alongside `surname`. |
| `surname` | string | Family name. **Required on every search**, plus at least one other search field (see the surname-plus-one rule). |
| `sex` | `"Male"` \| `"Female"` \| `"Unknown"` | Sex of the person. Case-insensitive — `"male"` normalizes to `"Male"`. |
| `givenNameExact` | boolean | Restricts the given name to its exact spelling — see the exact-match rule below. Excludes diminutives — the lead's 2026-08-17 sourcing, not a measurement, and not measured on this endpoint at all (see `record-search-tool-spec-v2.md` → `givenNameExact`). |
| `surnameExact` | boolean | Restricts the surname to its exact spelling — see the exact-match rule below. Fuzzy matching is what bridges a misspelling, so this can drop the target. |

#### The exact-match rule

One rule, belonging to the search engine rather than to this endpoint — with one
measured exception, on `surname`:

> **Without `exact=on` on a name field**, results include fuzzy matches, and
> persons where **that field is empty** — for `givenName` and for a father's,
> mother's, parent's or spouse's name (`other` not measured), but **not** for
> `surname`, where an unqualified value drops surname-empty persons. **With
> `exact=on`**, whatever its own field admits is
> excluded.

**The exception was measured on the record index, not here.** See
`record-search-tool-spec-v2.md` → *Person fields* → *The exact-match rule* for the
method and the figures, and `dev/explore-name-empty-field-leg-records.ts` for the
script. Nothing has tested it on `platform/tree/search`, so treat the asymmetry as the
engine's behaviour reported from one endpoint rather than as measured on this one.

**Provenance, and its limit.** The rule is the lead's, from FamilySearch
search-engine internals — it belongs to the search engine rather than to either
endpoint. **Every figure behind it was measured against the record index**
(`/service/search/hr/v2/personas`), not against `platform/tree/search`.

**No figure in `dev/measured-figures.json` was taken on this endpoint**, and that
is the line that matters. Four exploratory scripts under
`packages/engine/mcp-server/dev/` do reach it —
`explore-tree-require-switch.ts`, `explore-tree-204-vs-429.ts`,
`explore-tree-empty-field-leg.ts`, `explore-year-bands-tree.ts` — so a reader can
re-run the checks by hand. What none of them does is call `record()`, so nothing
they print is traceable, contradictable, or diffable against a re-run. An
`explore-*` script is not a probe section.

So the rule is stated **on the lead's authority, not on a measurement of this
endpoint**, and the tool description says as much. Treat a tree-side figure as
absent rather than unstated.

Those four scripts do not share one disposition, and each says which it has in its
own header:

- `explore-tree-empty-field-leg.ts` — **never citable.** The 2026-08-17 ruling says
  of `person_search` to "state the direction and the mechanism only, carry no figure
  from it, and do not add `person-search.ts` to `EVIDENCE_SURFACES`". Promoting this
  one would manufacture exactly the figures that forbids, because what it measures
  IS the name rule.
- `explore-tree-require-switch.ts`, `explore-tree-204-vs-429.ts` — **not
  measurements.** Each demonstrates an instrument defect on this endpoint, so
  citability does not apply; their promotion path is a test.
- `explore-year-bands-tree.ts` — **should become citable**, and that is not in
  tension with the ruling. The ruling constrains what the NAME rule may claim about
  this endpoint; it says nothing about whether YEAR behaviour may be measured here.
  Until a probe section records it, the year toggles say their behaviour here is
  unestablished.

No figure belongs in a tool description here, and
`person-search.ts` is deliberately **not** in `EVIDENCE_SURFACES` in
`tests/packaging/measured-figures.test.ts` — it carries no figures and must not
start. It *is* scanned for contradicted wording (`WORDING_ONLY_SURFACES`).

**Two mistakes this endpoint invites**, both silent and both inverting the result
— recorded because each produced a wrong finding before being caught:

- **`m.queryRequireDefault=on` is mandatory.** Without it, `q.*` terms only
  rerank; they do not filter. Omitting it makes every query return the
  surname-only total rather than the filtered one, which reads convincingly as
  "the given name does not filter". The figures behind that observation are
  deliberately not quoted: no tree-side figure is in the artifact, so citing one
  here is exactly what the provenance note above warns against. `buildSearchUrl` always sends it; anything probing the endpoint by hand must too.
- **A zero-result query returns HTTP 204 with an empty body**, not 200 with an
  empty `entries` array. `res.ok` is true for 204, so a reader that parses the body
  or retries on emptiness turns a meaningful zero into an error. `personSearchTool`
  handles this correctly (its 204 branch returns `emptyResponse`); copy it.

**Years and places are both outside the rule, and neither has been measured
here.** The year finding — that the population the old wording was phrased around
(objects with no indexed year) is empty, and the index carries estimated date
*ranges* matched by overlap — is the lead's account, and the session probe behind
it left no artifact, on either endpoint. The artifact still reads
`H.verdict:silence tolerated` = OPEN.
The place mechanism (upward expansion) is likewise a
record-index measurement, and its descent half is recorded by no verdict at all. Both are stated as unestablished on this endpoint, and
the toggles' descriptions say so. **Places are a different mechanism** (upward expansion) and are
outside the rule.

### Life-event fields

Each event group (birth, death, marriage, residence) has a year range
and a place, each with an `Exact` toggle.

| Field | Type | Description |
|-------|------|-------------|
| `birthYearFrom` | number | Lower bound of the birth-year range. 4-digit year. Pair with `birthYearTo`. |
| `birthYearTo` | number | Upper bound of the birth-year range. Pair with `birthYearFrom`. |
| `birthYearExact` | boolean | Requires the birth year to match the range exactly. **Years are the exception to the exact-match rule** and their behaviour is provisional — use only with a firm date, and do not rely on a range to include or exclude undated persons. |
| `birthPlace` | string | Birth place name. |
| `birthPlaceExact` | boolean | Stops upward expansion to parent jurisdictions. A **different mechanism** from the exact-match rule — expansion, not fuzz. Measured against the record index, not here. |
| `deathYearFrom` / `deathYearTo` / `deathYearExact` | number / number / boolean | Death-year range and exactness. |
| `deathPlace` / `deathPlaceExact` | string / boolean | Death place and exactness. |
| `marriageYearFrom` / `marriageYearTo` / `marriageYearExact` | number / number / boolean | Marriage-year range and exactness. |
| `marriagePlace` / `marriagePlaceExact` | string / boolean | Marriage place and exactness. |
| `residenceYearFrom` / `residenceYearTo` / `residenceYearExact` | number / number / boolean | Residence-year range and exactness (census-style anchor). |
| `residencePlace` / `residencePlaceExact` | string / boolean | Residence place and exactness. |

Year inputs are 4-digit years; the search engine processes only the year
even though the upstream parameter is a full GedcomX date. A range
endpoint is inclusive. To match a single year, set `From` and `To` to
the same value.

### Family-member fields

| Field | Type | Description |
|-------|------|-------------|
| `spouseGivenName` / `spouseSurname` | string | Spouse's given / family name. |
| `spouseGivenNameExact` / `spouseSurnameExact` | boolean | Requires the spouse's given / family name to be present and match exactly — the exact-match rule, including its empty-field leg. |
| `fatherGivenName` / `fatherSurname` | string | Father's given / family name. |
| `fatherGivenNameExact` / `fatherSurnameExact` | boolean | Requires the father's given / family name to be present and match exactly. Unqualified, the field keeps persons with no father recorded; this drops them. |
| `fatherBirthPlace` / `fatherBirthPlaceExact` | string / boolean | Father's birth place and exactness. |
| `motherGivenName` / `motherSurname` | string | Mother's given / family name. |
| `motherGivenNameExact` / `motherSurnameExact` | boolean | As `fatherGivenNameExact`, for the mother. |
| `motherBirthPlace` / `motherBirthPlaceExact` | string / boolean | Mother's birth place and exactness. |
| `parentGivenName` / `parentSurname` | string | A parent's given / family name when the parent's sex is unknown. |
| `parentGivenNameExact` / `parentSurnameExact` | boolean | As `fatherGivenNameExact`, for a parent of unknown sex. |
| `parentBirthPlace` / `parentBirthPlaceExact` | string / boolean | A parent's birth place and exactness. |

### Pagination

| Field | Type | Description |
|-------|------|-------------|
| `count` | number | Results per call. Default 20, range 1–100. |
| `offset` | number | 0-based index of the first result. Default 0, range 0–4999 (FamilySearch's search-depth limit). |

This tool always searches the main shared FamilySearch Family Tree. The
endpoint's `f.treeId` filter is intentionally **not** exposed — omitting
it defaults to the shared tree, which is the only tree we search.

### Examples

Specific person:
```json
{ "givenName": "Abraham", "surname": "Lincoln",
  "birthYearFrom": 1809, "birthYearTo": 1809, "birthPlace": "Kentucky" }
```

Narrow by a parent:
```json
{ "givenName": "Abraham", "surname": "Lincoln",
  "birthYearFrom": 1809, "birthYearTo": 1809,
  "fatherGivenName": "Thomas", "fatherSurname": "Lincoln" }
```

Strict surname + birth-place match:
```json
{ "surname": "Smyth", "surnameExact": true,
  "birthPlace": "Hodgenville, Kentucky", "birthPlaceExact": true }
```

Kept deliberately, with what it costs stated — the two toggles here do different
things, and this is the one shape where both are the right call. `surnameExact`
holds the count to persons indexed exactly `Smyth`, and it will miss the target
outright if the tree spells it `Smith`. It is *not* claimed to drop
initials-only forms — that is not established. It **does** drop persons with no
surname recorded, per the rule above: measured on the record index, not on this
endpoint. Use it only with a spelling you have confirmed. `birthPlaceExact` is
not the same mechanism: it stops upward expansion to parent jurisdictions, which
is what makes the count mean something for an exhaustiveness claim. Reach for
this pair when you need a defensible total, not when you are still looking for
the person.

---

## Output

| Field | Type | Description |
|-------|------|-------------|
| `query` | object | Echo of the input fields the caller supplied. |
| `totalMatches` | number | Total tree persons matching the query. |
| `paginationCappedAt` | number | Hard limit on how deep pagination can reach (4999). When `totalMatches > paginationCappedAt`, the remainder is unreachable — narrow the query. |
| `returned` | number | Number of results in this response (≤ `count`). |
| `offset` | number | Echo of the input offset (0 if not supplied). |
| `hasMore` | boolean | `true` when more pages are available (response carries `links.next`). |
| `results` | PersonSearchResult[] | Ranked results, best-scoring first. |

Each `PersonSearchResult`:

| Field | Type | Description |
|-------|------|-------------|
| `personId` | string | Bare Family-Tree person ID (e.g. `"LZJW-C31"`), taken verbatim from `entry.id`. The handle the user's pick passes to `person_read`. Also present as `gedcomx.persons[0].id`. |
| `score` | number \| undefined | Search-relevance score for this query (higher = better). **Search metadata — not part of any GedcomX**, so it lives at the top level. Not comparable across queries. |
| `confidence` | number \| undefined | A 1–5 confidence band (5 highest). Search metadata, not GedcomX. Rank with `score`. |
| `gedcomx` | SimplifiedGedcomX | The matched person as simplified GedcomX: `id`, `ark`, `gender`, `names` (given/surname), and `facts` (Birth, Death, …) — produced by `toSimplified` (see `simplified-gedcomx-spec.md`). The skill renders its pick-list from this. Relatives are excluded by design (see *Picking a result*). Per-person **source references are also stripped** — they'd be dangling IDs here (the source descriptions aren't included), and the full sources come from `person_read` on the chosen person. |

`personId`, `score`, and `confidence` are the only non-GedcomX fields,
because they are search metadata the endpoint returns at the entry level
(`entry.id` / `entry.score` / `entry.confidence`) and cannot live inside
a person's GedcomX. Everything else about the person — name, sex, dates,
places, ark — is **inside** `gedcomx`, never duplicated outside it. This
matches what the endpoint returns; the tool invents no flat summary
fields of its own.

**ID note (don't "fix" this):** `toSimplified` preserves the source
person's ID (`gedcomx-convert.ts` `simplifyPerson`), so
`gedcomx.persons[0].id` is the FamilySearch tree ID (e.g. `"LZJW-C31"`),
identical to `personId`. It is **not** renumbered to the abstract
`I1`/`N1`/`F1` IDs that `simplified-gedcomx-spec.md` §3 prescribes —
those are assigned only when curating the `tree.gedcomx.json`
deliverable. Emitting FS IDs here is correct and matches how
`person_read` and `record_search` return GedcomX from live API data.

Example:

```json
{
  "query": { "givenName": "Abraham", "surname": "Lincoln", "birthYearFrom": 1809, "birthYearTo": 1809, "birthPlace": "Kentucky" },
  "totalMatches": 7,
  "paginationCappedAt": 4999,
  "returned": 1,
  "offset": 0,
  "hasMore": false,
  "results": [
    {
      "personId": "LZJW-C31",
      "score": 5.1136,
      "confidence": 3,
      "gedcomx": {
        "persons": [
          {
            "id": "LZJW-C31",
            "ark": "https://familysearch.org/ark:/61903/4:1:LZJW-C31",
            "gender": "Male",
            "names": [{ "preferred": true, "type": "BirthName", "given": "Abraham", "surname": "Lincoln" }],
            "facts": [
              { "type": "Birth", "date": "12 February 1809", "place": "Hardin, Kentucky, United States" },
              { "type": "Death", "date": "15 April 1865", "place": "Washington, District of Columbia, United States" }
            ]
          }
        ]
      }
    }
  ]
}
```

### Picking a result (why this output is terminal)

When the user chooses a match, the LLM passes only the `personId` string
to `person_read({ personId, relatives: true })`. `person_read` re-fetches
the authoritative person from FamilySearch by ID and runs its own
GedcomX→simplified conversion. This tool's `gedcomx` is therefore never
read back as input, and the simplified→raw reverse converter
(`toGedcomX`) is **not** used in this chain. That is why the output can
be lossy-simplified and scoped to the matched person without losing
anything — the full, current record is always one `person_read` call
away.

---

## Tool Schema

The advertised schema for `person_search` is **not duplicated here.** Read it at
[`packages/engine/mcp-server/src/tools/person-search.ts`](../../packages/engine/mcp-server/src/tools/person-search.ts) —
it is the only copy the model ever sees, and a paste of it in this file has no
reader that the source does not serve.

A verbatim copy used to live here and drifted: it was not updated alongside the
tool, no check compared the two, and prose written against the stale block
contradicted the shipped descriptions. Do not reintroduce one. If a rendered
schema is ever wanted in the docs, generate it from `allToolSchemas` at build
time the way `packages/schema/src/enums.generated.ts` is generated — never by
hand.

The surname-plus-one rule is enforced in `validateInput`, not via JSON
Schema's `required`. Although `surname` is always required (which JSON
Schema *could* express), the "+1 other field" half cannot be, and
keeping both halves in `validateInput` yields a single descriptive error
message rather than a generic schema-validation error for a missing
surname.

---

## Authentication

Requires a valid FamilySearch access token. Calls `getValidToken()` from
`src/auth/refresh.ts` — the single entry point for authenticated tools.
Do not re-implement token plumbing. If the user is not authenticated,
`getValidToken()` throws an LLM-instruction error directing them to the
`login` tool; the handler lets it propagate (same pattern as the other
tools in `index.ts`).

**No browser User-Agent is required.** *(Empirical, probe 2026-05-28:
the platform host `api.familysearch.org` is not behind the Imperva WAF —
requests succeed with no UA. This differs from `record_search`, whose
`www.familysearch.org/service/...` host 403s without the browser UA.)*

---

## FamilySearch API Reference

**Endpoint (auth required):**

```
GET https://api.familysearch.org/platform/tree/search
Authorization: Bearer <access_token>
Accept: application/x-gedcomx-atom+json
Accept-Language: en
```

**Required headers:**

- `Authorization: Bearer <token>` — without it, 401.
- `Accept: application/x-gedcomx-atom+json` — the GedcomX-Atom search
  feed. *(`application/json` returns the same envelope; the atom media
  type is the documented default for this endpoint.)*
- `Accept-Language: en` — sent defensively; **not load-bearing for this
  tool's output.** *(Empirical, probe 2026-05-28: the session locale only
  affects the `.normalized` place values and the `display` block — a
  Mongolian-locale account returned `"Hardin, Кентаки, ..."` in those.
  This tool reads `fact.place.original` / `fact.date.original` through
  `toSimplified` — the contributor's as-entered text, which is
  locale-independent — and never surfaces `display` / `.normalized`. So
  the header doesn't change our output; we send it as
  belt-and-suspenders.)*

**Default flags sent on every request:**

| Flag | Value | Purpose |
|------|-------|---------|
| `m.queryRequireDefault` | `on` | **Required.** Treats every `q.*` term as a hard filter. *(Empirical, probe 2026-05-28: without this flag, additional `q.*` terms do not narrow at all — `surname=Lincoln` and `surname=Lincoln&givenName=Abraham` both returned 56,177. With the flag the same query returned 2,916, and the full clue set narrowed to 7.)* |

The platform feed does not return facet aggregations, so no
facet-suppression flag is needed (unlike `record_search`'s service
endpoint).

**Tool input → API parameter mapping:**

| Tool input | API parameter |
|------------|---------------|
| `givenName` | `q.givenName` |
| `surname` | `q.surname` |
| `givenNameExact=true` | `q.givenName.exact=on` |
| `surnameExact=true` | `q.surname.exact=on` |
| `sex` | `q.sex` |
| `birthYearFrom` / `birthYearTo` | `q.birthLikeDate.from` / `q.birthLikeDate.to` |
| `birthYearExact=true` | `q.birthLikeDate.exact=on` |
| `birthPlace` / `birthPlaceExact=true` | `q.birthLikePlace` / `q.birthLikePlace.exact=on` |
| `deathYearFrom` / `deathYearTo` / `deathYearExact` | `q.deathLikeDate.from` / `.to` / `.exact=on` |
| `deathPlace` / `deathPlaceExact` | `q.deathLikePlace` / `q.deathLikePlace.exact=on` |
| `marriageYearFrom` / `marriageYearTo` / `marriageYearExact` | `q.marriageLikeDate.from` / `.to` / `.exact=on` |
| `marriagePlace` / `marriagePlaceExact` | `q.marriageLikePlace` / `q.marriageLikePlace.exact=on` |
| `residenceYearFrom` / `residenceYearTo` / `residenceYearExact` | `q.residenceDate.from` / `.to` / `.exact=on` |
| `residencePlace` / `residencePlaceExact` | `q.residencePlace` / `q.residencePlace.exact=on` |
| `spouseGivenName` / `spouseSurname` (+`Exact`) | `q.spouseGivenName` / `q.spouseSurname` (+`.exact=on`) |
| `fatherGivenName` / `fatherSurname` (+`Exact`) | `q.fatherGivenName` / `q.fatherSurname` (+`.exact=on`) |
| `fatherBirthPlace` (+`Exact`) | `q.fatherBirthLikePlace` (+`.exact=on`) |
| `motherGivenName` / `motherSurname` (+`Exact`) | `q.motherGivenName` / `q.motherSurname` (+`.exact=on`) |
| `motherBirthPlace` (+`Exact`) | `q.motherBirthLikePlace` (+`.exact=on`) |
| `parentGivenName` / `parentSurname` (+`Exact`) | `q.parentGivenName` / `q.parentSurname` (+`.exact=on`) |
| `parentBirthPlace` (+`Exact`) | `q.parentBirthLikePlace` (+`.exact=on`) |
| `count` | `count` |
| `offset` | `offset` |

`sex` normalizes to `"Male"` / `"Female"` / `"Unknown"` before sending.
URL-encode every value with `encodeURIComponent`.

**Response shape** *(confirmed by probe 2026-05-28):*

```
response.results                          -> total match count (number)
response.index                            -> current offset (0-based)
response.links.next?.href                 -> next-page URL (omitted on last page)
response.entries[]
  .id                                     -> bare tree-person ID (e.g. "LZJW-C31")
  .title                                  -> "Person <ID> (<name>)"
  .score                                  -> relevance score (number)
  .confidence                             -> 1-5 (number)
  .content.gedcomx.persons[]              -> a CLUSTER: the matched person PLUS relatives
    .id                                   -> tree-person ID; the matched person's equals entry.id
    .display                              -> normalized summary block (locale-sensitive; NOT read by this tool)
      .name / .gender / .birthDate / .birthPlace / .deathDate / .deathPlace
    .gender.type                          -> URL form (e.g. "http://gedcomx.org/Male")
    .names[].nameForms[].fullText         -> fallback name
    .facts[]                              -> { type (URL), date.original, place.original, value }
    .identifiers["http://gedcomx.org/Persistent"][0] -> ark URL of the tree person
  .content.gedcomx.relationships[]        -> cluster relationships (NOT surfaced by this tool)
```

Each entry returns a family cluster (3–15 persons), but this tool
surfaces only the matched person.

---

## Mapping Logic

For each `entry` in `response.entries`:

1. **Resolve the matched person.** Find the person in
   `entry.content.gedcomx.persons[]` whose `id` equals `entry.id`.
   Fallbacks, in order: the person whose
   `identifiers["http://gedcomx.org/Persistent"][0]` ends with
   `entry.id`; then `persons[0]`. If `persons` is empty, skip the entry.
2. `personId` ← `entry.id`.
3. `score` ← `entry.score`. `confidence` ← `entry.confidence`.
4. `gedcomx` ← `toSimplified({ persons: [matchedPerson] })` — the matched
   person only, no relatives. Name (given/surname), `gender`, `ark`, and
   the Birth/Death facts all come through inside this from the person's
   `names`, `gender`, `identifiers`, and `facts`. The tool does **not**
   read the FS `display` block. After conversion, **per-person `sources`
   are stripped** from the result (they'd be dangling references with no
   included source descriptions); `toSimplified` itself is unchanged, so
   other callers keep their sources.

**Top-level fields:**

- `query` ← echo of supplied input.
- `totalMatches` ← `response.results`.
- `paginationCappedAt` ← `4999` (constant).
- `returned` ← mapped `results.length`.
- `offset` ← `response.index ?? 0`.
- `hasMore` ← `response.links?.next?.href != null`.
- `results` ← the mapped `PersonSearchResult[]`.

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| `surname` missing, or `surname` present with no other qualifying field | Throw: `"person_search requires a surname plus at least one other search field (a given name, a life-event date or place, or a relative's name). sex and exact-match toggles don't count."` |
| `count` outside `[1, 100]` | Throw: `"count must be between 1 and 100."` |
| `offset` outside `[0, 4999]` | Throw: `"offset must be between 0 and 4999 (FamilySearch search-depth limit). Narrow the query instead of paging deeper."` |
| Year input not a 4-digit year | Throw: `"<field> must be a 4-digit year (e.g., 1809)."` |
| `<event>YearFrom` without `<event>YearTo` (or vice versa) | Throw: `"<event>YearFrom and <event>YearTo must be provided together."` |
| `<event>YearFrom > <event>YearTo` | Throw: `"<event>YearFrom must be <= <event>YearTo."` |
| `sex` not in `{Male, Female, Unknown}` (case-insensitive) | Throw: `"sex must be 'Male', 'Female', or 'Unknown' (case-insensitive)."` |
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error. |
| API returns 401 | Throw: `"FamilySearch session not accepted; call the login tool to re-authenticate."` |
| API returns 400 | Read body as JSON, extract error detail, throw: `"FamilySearch tree search rejected the query: ${detail}."` Fall back to a generic message if the body isn't parseable. |
| API returns 429 | Throw: `"FamilySearch rate limit reached. Wait a moment and try again."` |
| API returns 204 (no matches) | Return `{ ..., totalMatches: 0, returned: 0, results: [], hasMore: false }`. |
| API returns other non-OK status | Throw: `"FamilySearch tree search API error: ${status} ${statusText}."` |
| API returns 200 with empty `entries` | Return `{ ..., totalMatches: <upstream>, returned: 0, results: [], hasMore: false }`. |

---

## Caching

None. Search queries are high-cardinality and the tree changes as users
edit it; caching wouldn't pay off and would risk staleness.

---

## Files

### `packages/engine/mcp-server/src/types/person-search.ts`
FS response types (`FSTreeSearchResponse`, `FSTreeSearchEntry`,
`FSTreeSearchPerson`, `FSDisplay`, `FSFact`) and tool I/O types
(`PersonSearchInput`, `PersonSearchResult`, `PersonSearchToolResponse`).
Reuse shared GedcomX types from `src/types/gedcomx.ts` where possible.

### `packages/engine/mcp-server/src/tools/person-search.ts`
- `personSearchToolSchema` — the MCP schema above.
- `personSearchTool(input)` — entry point: validate, authenticate, fetch, map.
- `validateInput(input)` — surname-plus-one rule + per-field validation.
- `buildSearchUrl(input)` — `q.*` parameter builder; applies
  `.exact`/`.from`/`.to` modifiers, the `m.queryRequireDefault=on` flag,
  and `encodeURIComponent`.
- `mapEntry(entry)` — `FSTreeSearchEntry → PersonSearchResult` (the
  8-step procedure above).
- `findMatchedPerson(entry)` — the person-by-id resolution in step 1.

### `packages/engine/mcp-server/src/tool-schemas.ts`
Add `personSearchToolSchema` to `allToolSchemas`.

### `packages/engine/mcp-server/src/index.ts`
Add the `person_search` dispatch branch (import tool + input type,
call within the existing try/catch pattern).

### `packages/engine/mcp-server/manifest.json`
Add `{ "name": "person_search" }` to `tools`.

### `packages/engine/mcp-server/dev/try-person-search.ts`
Live smoke-test CLI, e.g.
`npx tsx dev/try-person-search.ts Lincoln Abraham --birth-year 1809`.

---

## Testing

### `tests/tools/person-search.test.ts`

| # | Test case | Verifies |
|---|-----------|----------|
| 1 | Returns ranked results for `surname` + `givenName` | Happy path |
| 2 | Surname-plus-one rule: accepts `surname`+`givenName` and `surname`+`birthPlace`; rejects `surname` alone, no-surname (`givenName`+`birthPlace`), `surname`+`sex` only, and `surname`+`surnameExact` only | Input validation |
| 3 | Throws when `count` < 1 or > 100 | Bound check |
| 4 | Throws when `offset` < 0 or > 4999 | Pagination cap |
| 5 | Throws when `<event>YearFrom` is supplied without `<event>YearTo` | Range-pair validation |
| 6 | Throws when `<event>YearFrom > <event>YearTo` | Range-order validation |
| 7 | Throws on `sex` outside Male/Female/Unknown (case-insensitive accepted) | sex enum validation |
| 8 | Builds URL with all `q.*` params mapped correctly | Param mapping |
| 9 | `surnameExact=true` emits `q.surname.exact=on` | Modifier mapping |
| 10 | `birthYearFrom/To` emit `q.birthLikeDate.from`/`.to`; `birthYearExact` emits `.exact=on` | Year-range mapping |
| 11 | `fatherBirthPlace` maps to `q.fatherBirthLikePlace` | Relative-place mapping |
| 12 | `m.queryRequireDefault=on` is sent on every request | Default-flag enforcement |
| 13 | `Accept-Language: en` header is sent | Defensive header (output reads `.original`, locale-independent) |
| 14 | No `User-Agent` header is required (request succeeds without it) | Host contract |
| 15 | `gedcomx` carries the matched person's name (given/surname), gender, ark, and Birth/Death facts (via `toSimplified`, not `display`) | Field mapping |
| 16 | Resolves the matched person by `entry.id` within a multi-person cluster | Cluster resolution |
| 17 | `gedcomx` contains only the matched person (no relatives) | Lean-output contract |
| 18 | `hasMore: true` when `links.next` exists | Pagination flag |
| 19 | Echoes `totalMatches` and `paginationCappedAt` | Total-count surfacing |
| 20 | Returns empty results on 200 with empty `entries` and on 204 | Zero-match handling |
| 21 | Throws auth error when not authenticated | Auth propagation |
| 22 | Throws on 401 with re-login guidance; on 400 with extracted detail | API errors |

### Smoke test

```bash
cd packages/engine/mcp-server
npx tsx dev/try-person-search.ts Lincoln Abraham
npx tsx dev/try-person-search.ts Lincoln Abraham --birth-year 1809 --birth-place Kentucky
npx tsx dev/try-person-search.ts --given Mary --surname Todd --spouse-surname Lincoln
```

---

## Verification

### Automated
```bash
cd packages/engine/mcp-server && npm run build && npm test
```

### Manual Layer 1 (MCP Inspector)
```bash
npx @modelcontextprotocol/inspector node build/index.js
```
- `person_search({ givenName: "Abraham", surname: "Lincoln", birthYearFrom: 1809, birthYearTo: 1809, birthPlace: "Kentucky" })` — top result has `personId: "LZJW-C31"`, and its `gedcomx.persons[0]` carries the Lincoln name (given/surname) plus Birth (1809, Kentucky) and Death (1865) facts.
- `person_search({ surname: "Lincoln" })` — fails: surname alone needs one more field.
- `person_search({ birthPlace: "Kentucky" })` — fails: surname is required.
- `person_search({ surname: "Lincoln", count: 200 })` — fails with the count-bound error.
- `person_search` without logging in — returns the auth error.

### Manual Layer 2 (Claude Code)
- *"Find Abraham Lincoln born 1809 in Kentucky in the family tree."* — Claude calls `person_search`, surfaces the ranked matches.
- *"Now show me his parents and children."* — Claude chains to `person_read({ personId: "LZJW-C31", relatives: true })`.

### Manual Layers 0–3 (smoke → Inspector → Claude Code → Cowork)
Run `dev/try-person-search.ts` for the smoke layer; OAuth setup per
`docs/testing-guides/oauth-tool-testing-guide.md`.

---

## References

- Search Tree Persons (endpoint reference): https://developers.familysearch.org/main/reference/searchtreepersons *(verified live 2026-05-28)*
- Family Tree Search (parameter guide): https://developers.familysearch.org/main/docs/family-tree-search *(verified live 2026-05-28)*
- `docs/specs/simplified-gedcomx-spec.md` — output format for the `gedcomx` field.
- `docs/specs/record-search-tool-spec-v2.md` — sibling tool; input-naming convention and shared `q.*` family.
- `docs/specs/person-read-tool-spec.md` — the chained tool for expanding a chosen match.

Evidence trail: `packages/engine/mcp-server/dev/probe-tree-search.ts`,
`probe-tree-search-narrowing.ts`, `probe-svc-tree-search.ts`,
`probe-tree-search-platform-lang.ts` (run 2026-05-28).
```
