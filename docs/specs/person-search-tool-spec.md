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
| `givenNameExact` | boolean | When `true`, disables fuzzy matching on the given name (no nicknames/spelling variants). |
| `surnameExact` | boolean | When `true`, disables fuzzy matching on the surname. |

### Life-event fields

Each event group (birth, death, marriage, residence) has a year range
and a place, each with an `Exact` toggle.

| Field | Type | Description |
|-------|------|-------------|
| `birthYearFrom` | number | Lower bound of the birth-year range. 4-digit year. Pair with `birthYearTo`. |
| `birthYearTo` | number | Upper bound of the birth-year range. Pair with `birthYearFrom`. |
| `birthYearExact` | boolean | When `true`, the year range is matched exactly (no fuzz). |
| `birthPlace` | string | Birth place name. |
| `birthPlaceExact` | boolean | When `true`, the place is matched exactly (no expansion to parent jurisdictions). |
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
| `spouseGivenNameExact` / `spouseSurnameExact` | boolean | Strict match on the spouse's given / family name. |
| `fatherGivenName` / `fatherSurname` | string | Father's given / family name. |
| `fatherGivenNameExact` / `fatherSurnameExact` | boolean | Strict match on the father's given / family name. |
| `fatherBirthPlace` / `fatherBirthPlaceExact` | string / boolean | Father's birth place and exactness. |
| `motherGivenName` / `motherSurname` | string | Mother's given / family name. |
| `motherGivenNameExact` / `motherSurnameExact` | boolean | Strict match on the mother's given / family name. |
| `motherBirthPlace` / `motherBirthPlaceExact` | string / boolean | Mother's birth place and exactness. |
| `parentGivenName` / `parentSurname` | string | A parent's given / family name when the parent's sex is unknown. |
| `parentGivenNameExact` / `parentSurnameExact` | boolean | Strict match on the parent's given / family name. |
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

```typescript
{
  name: "person_search",
  description:
    "Search the FamilySearch Family Tree for a person. Requires a surname " +
    "plus at least one other search field (a given name, a life-event year " +
    "or place, or a relative's name; sex and exact-match toggles don't " +
    "count). Additional fields narrow the ranking. Returns a ranked list " +
    "of candidate tree persons with their key facts and a tree-person ID, so " +
    "the user can pick which one to research. To expand a chosen match into " +
    "parents, spouses, and children, call person_read with relatives: true. " +
    "Requires authentication — call the login tool first if not logged in. " +
    "For ambiguous place names, call the place_search tool first.",
  inputSchema: {
    type: "object",
    properties: {
      // Person
      givenName:            { type: "string", description: "Given (first) name. Counts as a qualifying 'other' field alongside the required surname." },
      surname:              { type: "string", description: "Family name. Required on every search, and must be accompanied by at least one other search field (a given name, a life-event year/place, or a relative's name). `sex` and `*Exact` toggles do not count." },
      sex:                  { type: "string", enum: ["Male", "Female", "Unknown"], description: "Sex of the person. Case-insensitive on input." },
      givenNameExact:       { type: "boolean", description: "When `true`, requires an exact given-name match (no fuzzy nicknames or spelling variants)." },
      surnameExact:         { type: "boolean", description: "When `true`, requires an exact surname match (no fuzzy nicknames or spelling variants)." },

      // Birth
      birthYearFrom:        { type: "number", description: "Lower bound of the birth-year range. 4-digit year. Must be paired with `birthYearTo`." },
      birthYearTo:          { type: "number", description: "Upper bound of the birth-year range. 4-digit year. Must be paired with `birthYearFrom`." },
      birthYearExact:       { type: "boolean", description: "When `true`, the birth-year range is matched exactly." },
      birthPlace:           { type: "string", description: "Birth place name. For ambiguous places, call `place_search` first." },
      birthPlaceExact:      { type: "boolean", description: "When `true`, requires an exact place match (no expansion to parent jurisdictions)." },

      // Death
      deathYearFrom:        { type: "number", description: "Lower bound of the death-year range. 4-digit year. Must be paired with `deathYearTo`." },
      deathYearTo:          { type: "number", description: "Upper bound of the death-year range. 4-digit year. Must be paired with `deathYearFrom`." },
      deathYearExact:       { type: "boolean", description: "When `true`, the death-year range is matched exactly." },
      deathPlace:           { type: "string", description: "Death place name." },
      deathPlaceExact:      { type: "boolean", description: "When `true`, requires an exact place match." },

      // Marriage
      marriageYearFrom:     { type: "number", description: "Lower bound of the marriage-year range. 4-digit year. Must be paired with `marriageYearTo`." },
      marriageYearTo:       { type: "number", description: "Upper bound of the marriage-year range. 4-digit year. Must be paired with `marriageYearFrom`." },
      marriageYearExact:    { type: "boolean", description: "When `true`, the marriage-year range is matched exactly." },
      marriagePlace:        { type: "string", description: "Marriage place name." },
      marriagePlaceExact:   { type: "boolean", description: "When `true`, requires an exact place match." },

      // Residence
      residenceYearFrom:    { type: "number", description: "Lower bound of the residence-year range. 4-digit year. Must be paired with `residenceYearTo`." },
      residenceYearTo:      { type: "number", description: "Upper bound of the residence-year range. 4-digit year. Must be paired with `residenceYearFrom`." },
      residenceYearExact:   { type: "boolean", description: "When `true`, the residence-year range is matched exactly." },
      residencePlace:       { type: "string", description: "Residence place name." },
      residencePlaceExact:  { type: "boolean", description: "When `true`, requires an exact place match." },

      // Spouse
      spouseGivenName:      { type: "string", description: "Spouse's given name." },
      spouseSurname:        { type: "string", description: "Spouse's family name." },
      spouseGivenNameExact: { type: "boolean", description: "When `true`, requires an exact match on the spouse's given name." },
      spouseSurnameExact:   { type: "boolean", description: "When `true`, requires an exact match on the spouse's family name." },

      // Father
      fatherGivenName:      { type: "string", description: "Father's given name." },
      fatherSurname:        { type: "string", description: "Father's family name." },
      fatherGivenNameExact: { type: "boolean", description: "When `true`, requires an exact match on the father's given name." },
      fatherSurnameExact:   { type: "boolean", description: "When `true`, requires an exact match on the father's family name." },
      fatherBirthPlace:     { type: "string", description: "Father's birth place name." },
      fatherBirthPlaceExact:{ type: "boolean", description: "When `true`, requires an exact match on the father's birth place." },

      // Mother
      motherGivenName:      { type: "string", description: "Mother's given name." },
      motherSurname:        { type: "string", description: "Mother's family name." },
      motherGivenNameExact: { type: "boolean", description: "When `true`, requires an exact match on the mother's given name." },
      motherSurnameExact:   { type: "boolean", description: "When `true`, requires an exact match on the mother's family name." },
      motherBirthPlace:     { type: "string", description: "Mother's birth place name." },
      motherBirthPlaceExact:{ type: "boolean", description: "When `true`, requires an exact match on the mother's birth place." },

      // Parent (sex unknown)
      parentGivenName:      { type: "string", description: "A parent's given name when the parent's sex is unknown." },
      parentSurname:        { type: "string", description: "A parent's family name when the parent's sex is unknown." },
      parentGivenNameExact: { type: "boolean", description: "When `true`, requires an exact match on the parent's given name." },
      parentSurnameExact:   { type: "boolean", description: "When `true`, requires an exact match on the parent's family name." },
      parentBirthPlace:     { type: "string", description: "A parent's birth place name." },
      parentBirthPlaceExact:{ type: "boolean", description: "When `true`, requires an exact match on the parent's birth place." },

      // Pagination
      count:                { type: "number", description: "Results per call. Default 20, range 1–100." },
      offset:               { type: "number", description: "0-based index of the first result. Default 0, range 0–4999." }
    }
  }
}
```

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
Full layered playbook in
`docs/testing-guides/person-search-tool-testing-guide.md` (OAuth setup
per `docs/testing-guides/oauth-tool-testing-guide.md`).

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
