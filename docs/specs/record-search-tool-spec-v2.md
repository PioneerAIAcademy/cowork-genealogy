# Record Search Tool — Implementation Spec

## Overview

An MCP tool that searches FamilySearch's historical record index for
a person. The caller passes clues — a name, a year, a place, the
name of a parent or spouse — and gets back a ranked list of records
that might describe that person, with the key facts on each record
(name, dates, places, family) and links the user can open.

Requires authentication (OAuth tokens obtained via the `login`
tool). Uses the lower-level FamilySearch search service at
`/service/search/hr/v2/personas`.

The tool is the **find** primitive of the genealogy toolkit. It
chains naturally with the other tools:

```
places(query: "Alabama")        // confirm which place is meant
  ↓
collections(query: "Alabama")   // find which collections cover it
  ↓
search({ surname, collectionId, ... })  // find a person inside
```

### Anchor rule (design note)

A search must include at least one of these anchor fields:

- `surname`
- `recordCountry`

A search with only `givenName`, only `collectionId`, only a place,
or only a kin name is rejected. The search service throttles
unanchored queries because they're expensive — anchoring on
something that meaningfully narrows the candidate pool keeps the
tool fast and useful.

---

## Input

Inputs are grouped by purpose. Every field is optional individually,
but the anchor rule above must be satisfied.

### Person fields

| Field | Type | Description |
|-------|------|-------------|
| `surname` | string | Family name. The strongest anchor for genealogy queries. |
| `givenName` | string | Given (first) name. |
| `surnameAlt` | string | Alternate family name (e.g., maiden name when also searching by married name). |
| `givenNameAlt` | string | Alternate given name. |
| `sex` | `"Male"` \| `"Female"` \| `"Unknown"` | Sex of the person. Case-insensitive — `"male"` is normalized to `"Male"`. |
| `surnameExact` | boolean | When `true`, only records with the exact surname spelling match. By default the search uses fuzzy matching (nicknames, spelling variants). When `surnameAlt` is also set, the strict-match toggle applies to both the primary and the alternate. |
| `givenNameExact` | boolean | Same idea for given name. Applies to `givenNameAlt` too when both are set. |

Setting `surnameAlt` or `givenNameAlt` performs a UNION — the result
set includes records that match the primary name AND records that
match the alternate name. Useful for women whose maiden and married
names are both worth searching. If just `surnameAlt` is populated
but not `givenNameAlt`, the MCP server code sets `givenNameAlt =
givenName` before sending. Similarly, if `givenNameAlt` is populated
but not `surnameAlt`, the code sets `surnameAlt = surname`.

### Life event fields

Each event group (birth, death, marriage, residence, any) has a
year range and a place, with corresponding `Exact` toggles.

| Field | Type | Description |
|-------|------|-------------|
| `birthYearFrom` | number | Lower bound of birth-year range. Pair with `birthYearTo`. |
| `birthYearTo` | number | Upper bound of birth-year range. Pair with `birthYearFrom`. |
| `birthYearExact` | boolean | When `true`, the year range is matched exactly (no fuzz). |
| `birthPlace` | string | Birth place name. |
| `birthPlaceExact` | boolean | When `true`, the place is matched exactly (no expansion to parent jurisdictions). |
| `deathYearFrom` | number | Lower bound of death-year range. |
| `deathYearTo` | number | Upper bound of death-year range. |
| `deathYearExact` | boolean | Strict match on the death-year range. |
| `deathPlace` | string | Death place name. |
| `deathPlaceExact` | boolean | Strict match on the death place. |
| `marriageYearFrom` | number | Lower bound of marriage-year range. |
| `marriageYearTo` | number | Upper bound of marriage-year range. |
| `marriageYearExact` | boolean | Strict match on the marriage-year range. |
| `marriagePlace` | string | Marriage place name. |
| `marriagePlaceExact` | boolean | Strict match on the marriage place. |
| `residenceYearFrom` | number | Lower bound of residence-year range (census-style anchor). |
| `residenceYearTo` | number | Upper bound of residence-year range. |
| `residenceYearExact` | boolean | Strict match on the residence-year range. |
| `residencePlace` | string | Residence place name. |
| `residencePlaceExact` | boolean | Strict match on the residence place. |
| `anyYearFrom` | number | Lower bound of an event-year range that matches any event type (use when the event type is unknown or doesn't matter). |
| `anyYearTo` | number | Upper bound of any-event-year range. |
| `anyYearExact` | boolean | Strict match on the any-event-year range. |
| `anyPlace` | string | Place name for an event of any type. |
| `anyPlaceExact` | boolean | Strict match on the any-event place. |

Year inputs are 4-digit years. The search engine ignores month and
day even if supplied.

### Family member fields

| Field | Type | Description |
|-------|------|-------------|
| `spouseGivenName` | string | Spouse's given name. |
| `spouseSurname` | string | Spouse's family name. |
| `spouseGivenNameExact` | boolean | Strict match on the spouse's given name. |
| `spouseSurnameExact` | boolean | Strict match on the spouse's family name. |
| `fatherGivenName` | string | Father's given name. |
| `fatherSurname` | string | Father's family name. |
| `fatherGivenNameExact` | boolean | Strict match on the father's given name. |
| `fatherSurnameExact` | boolean | Strict match on the father's family name. |
| `motherGivenName` | string | Mother's given name. |
| `motherSurname` | string | Mother's family name. |
| `motherGivenNameExact` | boolean | Strict match on the mother's given name. |
| `motherSurnameExact` | boolean | Strict match on the mother's family name. |
| `parentGivenName` | string | Parent's given name when sex unknown. |
| `parentSurname` | string | Parent's family name when sex unknown. |
| `parentGivenNameExact` | boolean | Strict match on the parent's given name. |
| `parentSurnameExact` | boolean | Strict match on the parent's family name. |
| `otherGivenName` | string | A given name appearing alongside the searched person, of unknown relationship. |
| `otherSurname` | string | A family name appearing alongside the searched person, of unknown relationship. |
| `otherGivenNameExact` | boolean | Strict match on the other given name. |
| `otherSurnameExact` | boolean | Strict match on the other family name. |

`other*` is for cases where the caller knows two names appear
together in a record but doesn't know the formal relationship.

### Record-source fields

| Field | Type | Description |
|-------|------|-------------|
| `collectionId` | number | A FamilySearch collection ID (from the `place_collections` tool). |
| `recordCountry` | string | Country where the record was created (e.g., `"United States"`, `"England"`). |
| `recordSubdivision` | string | State or province within the country (e.g., `"Alabama"`). Requires `recordCountry`. |
| `recordType` | `"birth"` \| `"marriage"` \| `"death"` \| `"census"` \| `"immigration"` \| `"military"` \| `"probate"` \| `"other"` | Type of record. |
| `maritalStatus` | `"Married"` \| `"Single"` \| `"Divorced"` \| `"Widowed"` | Marital status. Case-sensitive. Many records leave this field blank, so filtering on it excludes records where the field is unfilled. |
| `isPrincipal` | boolean | Filters by the searched person's role inside each record. `true` returns only records where the matched person is the **principal subject** of the record (e.g., the bride or groom on a marriage certificate, the deceased on a death certificate, the child on a birth certificate). `false` returns only records where the matched person is named but is **not** the principal (e.g., listed as a parent on a child's birth certificate, as a spouse on a death certificate, as a witness on a marriage). When the parameter is **omitted**, both principal and non-principal mentions are returned (the broadest set). |

**What `isPrincipal` actually does (background for the LLM caller):**
Every FamilySearch persona record (one indexed row from one historical
document) has exactly one *principal* person — the main subject the
record is about — and zero or more *non-principal* people mentioned
alongside (parents on a birth record, witnesses on a marriage, surviving
relatives on a death record). The search engine matches the name query
against *any* person in *any* record — both principals and
non-principals. `isPrincipal` then filters that match set:

- `isPrincipal=true` → only records where the matched person is the
  main subject. Use when building a profile of the person directly:
  *"find John Smith's own birth, marriage, death records."*
- `isPrincipal=false` → only records where the matched person is
  mentioned but isn't the main subject. Use to discover collateral
  relatives: *"find records that name John Smith as a parent, spouse,
  or witness"* — the principals of the returned records will be his
  children, his spouse, etc.
- Omitted → both. The broadest set, ranked by match quality.

For most natural-language searches, omit the parameter — only set it
when the caller's intent specifically requires one role or the other.

### Pagination

| Field | Type | Description |
|-------|------|-------------|
| `count` | number | Results per call. Default 20, max 100. |
| `offset` | number | Pagination offset. Default 0. The combined value `offset + count` must be at most 4999. |

### Examples

Specific person:
```json
{
  "surname": "Lincoln",
  "givenName": "Abraham",
  "birthYearFrom": 1809,
  "birthYearTo": 1809,
  "birthPlace": "Kentucky"
}
```

Marriage records in a specific collection:
```json
{
  "surname": "Smith",
  "givenName": "John",
  "collectionId": 1743384,
  "marriageYearFrom": 1850,
  "marriageYearTo": 1859,
  "isPrincipal": true
}
```

Maiden + married name (UNION):
```json
{
  "givenName": "Mary",
  "surname": "Lincoln",
  "surnameAlt": "Todd"
}
```

The tool auto-pairs alt names — supplying just `surnameAlt: "Todd"` is
enough; the tool fills `givenNameAlt = "Mary"` (copied from
`givenName`) before sending so the API receives a complete alternate-name
pair. Same in reverse if `givenNameAlt` is set without `surnameAlt`.
See *Alt-name handling* under *FamilySearch API Reference* for the
wire-level mechanics.

Country-scoped death-year range:
```json
{
  "surname": "Smith",
  "recordCountry": "United States",
  "recordType": "death",
  "deathYearFrom": 1900,
  "deathYearTo": 1920
}
```

Strict surname + birth-place match:
```json
{
  "surname": "Smyth",
  "surnameExact": true,
  "birthPlace": "Hodgenville, Kentucky",
  "birthPlaceExact": true
}
```

---

## Output

| Field | Type | Description |
|-------|------|-------------|
| `query` | object | Echo of the input fields the caller supplied. |
| `totalMatches` | number | Total records matching the query in the corpus. |
| `paginationCappedAt` | number | The hard limit on how many results are reachable through pagination (4999). When `totalMatches > paginationCappedAt`, the rest are unreachable — narrow the query. |
| `returned` | number | Number of results in this response (≤ `count`). |
| `offset` | number | Echo of the input offset (0 if not supplied). |
| `hasMore` | boolean | `true` when more pages are available (the response includes a `links.next`). |
| `results` | SearchResult[] | The ranked results, best-scoring first. |

Each `SearchResult`:

| Field | Type | Description |
|-------|------|-------------|
| `personId` | string | The persona ID (e.g., `"6K9K-3HN9"`). Same as the suffix of the ark URL. |
| `personName` | string \| undefined | The person's name as written on the source record. Undefined when the upstream record carries no display name and no fallback name form. |
| `score` | number \| undefined | Relevance score within this query. Higher means better-ranked. Use for sorting within a result set. Not comparable across different queries. |
| `confidence` | number \| undefined | A 1–5 confidence band on this result, where 5 is highest. Surface for transparency; rank with `score`. |
| `sex` | string \| undefined | `"Male"`, `"Female"`, or undefined. |
| `birthDate` | string \| undefined | Birth date as written on the record (e.g., `"12 February 1809"` or `"1809"`). |
| `birthPlace` | string \| undefined | Birth place as written. |
| `deathDate` | string \| undefined | Death date as written. |
| `deathPlace` | string \| undefined | Death place as written. |
| `events` | Event[] | All other extracted facts that aren't already surfaced as birth/death (residence, immigration, marriage, etc.). |
| `arkUrl` | string \| undefined | Persistent link to the persona on FamilySearch. Undefined when the upstream record has no `Persistent` identifier on the represented person. |
| `collectionId` | string \| undefined | The ID of the collection this record belongs to. Undefined when the upstream record carries no Collection-typed `sourceDescriptions[]` entry. |
| `collectionTitle` | string \| undefined | Human-readable collection name. Undefined under the same conditions as `collectionId`. |
| `collectionUrl` | string \| undefined | Link to the collection page on FamilySearch. Undefined under the same conditions as `collectionId`. |
| `recordTitle` | string \| undefined | Human-readable description of the source record. |
| `recordUrl` | string \| undefined | Persistent link to the source record (different from `arkUrl`, which links to the persona). |
| `treeMatches` | TreeMatch[] | Suggested matches between this record persona and existing FamilySearch Family Tree people. Sorted by `stars` descending. Empty array when the upstream entry has no `hints`. |

Output fields keep the `Date` naming because they hold the date as
written on the record — which can include month and day even though
inputs are year-only.

Each `Event`:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | The fact type as a short label (e.g., `"Birth"`, `"Residence"`, `"Marriage"`, `"Immigration"`). |
| `date` | string \| undefined | Date as written on the record. |
| `place` | string \| undefined | Place as written. |
| `value` | string \| undefined | Free-text value for non-event facts (e.g., `"US Citizen"` for a Nationality fact). |

Each `TreeMatch`:

| Field | Type | Description |
|-------|------|-------------|
| `treePersonId` | string | Bare Family Tree person ID this record may correspond to (e.g., `"GQWZ-GPX"`). The full tree-person ARK is `ark:/61903/4:1:<treePersonId>` if the caller needs to reconstruct it. |
| `stars` | number | Match confidence on a 0–5 scale, where 5 is highest. |

Example:

```json
{
  "query": {
    "surname": "Lincoln",
    "givenName": "Abraham",
    "birthYearFrom": 1809,
    "birthYearTo": 1809,
    "birthPlace": "Kentucky"
  },
  "totalMatches": 432,
  "paginationCappedAt": 4999,
  "returned": 1,
  "offset": 0,
  "hasMore": true,
  "results": [
    {
      "personId": "QPRC-WPBZ",
      "personName": "Abraham Lincoln",
      "score": 5.4236,
      "confidence": 4,
      "sex": "Male",
      "birthDate": "12 February 1809",
      "birthPlace": "Hardin, Kentucky, United States",
      "deathDate": "14 April 1865",
      "deathPlace": "Washington, Washington County, District of Columbia, United States",
      "events": [
        { "type": "Residence", "date": "1860", "place": "Springfield, Illinois" }
      ],
      "arkUrl": "https://familysearch.org/ark:/61903/1:1:QPRC-WPBZ",
      "collectionId": "5000016",
      "collectionTitle": "United States, Social Security Numerical Identification Files (NUMIDENT), 1936-2007",
      "collectionUrl": "https://familysearch.org/collections/5000016",
      "recordTitle": "Entry for Abraham Lincoln, \"United States, Social Security...\"",
      "recordUrl": "https://familysearch.org/ark:/61903/1:2:HSJG-CLNF",
      "treeMatches": [
        { "treePersonId": "GQWZ-GPX", "stars": 5 }
      ]
    }
  ]
}
```

---

## Tool Schema

```typescript
{
  name: "record_search",
  description:
    "Search FamilySearch's historical record index for a specific person. " +
    "Requires at least one anchor: surname or recordCountry. Other fields " +
    "narrow ranking. Returns ranked person matches with key facts, " +
    "persistent URLs, source-record details, and Family-Tree-person match " +
    "suggestions. Requires authentication — call the login tool first if " +
    "not logged in. For ambiguous place names, call the places tool first. " +
    "To scope to a specific record collection, call the collections tool " +
    "first to find the right collectionId.",
  inputSchema: {
    type: "object",
    properties: {
      // Person fields
      surname:               { type: "string", description: "Family name of the searched person. Strongest anchor for genealogy queries. At least one of `surname` or `recordCountry` must be supplied." },
      givenName:             { type: "string", description: "Given (first) name of the searched person." },
      surnameAlt:            { type: "string", description: "Alternate family name (e.g., a woman's maiden name when also searching by married surname). Triggers a UNION search — results match either `surname` OR `surnameAlt`. The tool auto-fills `givenNameAlt = givenName` if only this side is supplied." },
      givenNameAlt:          { type: "string", description: "Alternate given name. UNION with `givenName`. The tool auto-fills `surnameAlt = surname` if only this side is supplied." },
      sex:                   { type: "string", enum: ["Male", "Female", "Unknown"], description: "Sex of the searched person. Case-insensitive on input — `'male'` is normalized to `'Male'`." },
      surnameExact:          { type: "boolean", description: "When `true`, requires an exact surname match (no fuzzy nicknames or spelling variants). Applies to `surnameAlt` too when both are set." },
      givenNameExact:        { type: "boolean", description: "When `true`, requires an exact given-name match (no fuzzy nicknames or spelling variants). Applies to `givenNameAlt` too when both are set." },

      // Birth event
      birthYearFrom:         { type: "number", description: "Lower bound of the birth-year range. 4-digit year (e.g., 1850). Must be paired with `birthYearTo`." },
      birthYearTo:           { type: "number", description: "Upper bound of the birth-year range. 4-digit year (e.g., 1859). Must be paired with `birthYearFrom`." },
      birthYearExact:        { type: "boolean", description: "When `true`, the birth-year range is matched exactly (no fuzz around the bounds)." },
      birthPlace:            { type: "string", description: "Birth place name (e.g., `'Kentucky'`, `'Hardin, Kentucky, United States'`). For ambiguous place names, call the `place_search` tool first to disambiguate." },
      birthPlaceExact:       { type: "boolean", description: "When `true`, requires an exact place match (no expansion to parent jurisdictions)." },

      // Death event
      deathYearFrom:         { type: "number", description: "Lower bound of the death-year range. 4-digit year (e.g., 1900). Must be paired with `deathYearTo`." },
      deathYearTo:           { type: "number", description: "Upper bound of the death-year range. 4-digit year (e.g., 1920). Must be paired with `deathYearFrom`." },
      deathYearExact:        { type: "boolean", description: "When `true`, the death-year range is matched exactly." },
      deathPlace:            { type: "string", description: "Death place name. For ambiguous place names, call the `place_search` tool first to disambiguate." },
      deathPlaceExact:       { type: "boolean", description: "When `true`, requires an exact place match (no expansion to parent jurisdictions)." },

      // Marriage event
      marriageYearFrom:      { type: "number", description: "Lower bound of the marriage-year range. 4-digit year (e.g., 1830). Must be paired with `marriageYearTo`." },
      marriageYearTo:        { type: "number", description: "Upper bound of the marriage-year range. 4-digit year (e.g., 1840). Must be paired with `marriageYearFrom`." },
      marriageYearExact:     { type: "boolean", description: "When `true`, the marriage-year range is matched exactly." },
      marriagePlace:         { type: "string", description: "Marriage place name. For ambiguous place names, call the `place_search` tool first to disambiguate." },
      marriagePlaceExact:    { type: "boolean", description: "When `true`, requires an exact place match (no expansion to parent jurisdictions)." },

      // Residence event
      residenceYearFrom:     { type: "number", description: "Lower bound of the residence-year range (typically census-style anchor). 4-digit year (e.g., 1860). Must be paired with `residenceYearTo`." },
      residenceYearTo:       { type: "number", description: "Upper bound of the residence-year range. 4-digit year (e.g., 1870). Must be paired with `residenceYearFrom`." },
      residenceYearExact:    { type: "boolean", description: "When `true`, the residence-year range is matched exactly." },
      residencePlace:        { type: "string", description: "Residence place name. For ambiguous place names, call the `place_search` tool first to disambiguate." },
      residencePlaceExact:   { type: "boolean", description: "When `true`, requires an exact place match (no expansion to parent jurisdictions)." },

      // Any-event
      anyYearFrom:           { type: "number", description: "Lower bound of an any-event year range. 4-digit year (e.g., 1850). Use when the event type is unknown or doesn't matter. Must be paired with `anyYearTo`." },
      anyYearTo:             { type: "number", description: "Upper bound of an any-event year range. 4-digit year (e.g., 1880). Must be paired with `anyYearFrom`." },
      anyYearExact:          { type: "boolean", description: "When `true`, the any-event year range is matched exactly." },
      anyPlace:              { type: "string", description: "Place name for an event of any type. For ambiguous place names, call the `place_search` tool first to disambiguate." },
      anyPlaceExact:         { type: "boolean", description: "When `true`, requires an exact place match (no expansion to parent jurisdictions)." },

      // Family members
      spouseGivenName:       { type: "string", description: "Spouse's given name (a person mentioned alongside the searched person as their spouse on the record)." },
      spouseSurname:         { type: "string", description: "Spouse's family name." },
      spouseGivenNameExact:  { type: "boolean", description: "When `true`, requires an exact match on the spouse's given name." },
      spouseSurnameExact:    { type: "boolean", description: "When `true`, requires an exact match on the spouse's family name." },
      fatherGivenName:       { type: "string", description: "Father's given name (a person mentioned on the record as the searched person's father)." },
      fatherSurname:         { type: "string", description: "Father's family name." },
      fatherGivenNameExact:  { type: "boolean", description: "When `true`, requires an exact match on the father's given name." },
      fatherSurnameExact:    { type: "boolean", description: "When `true`, requires an exact match on the father's family name." },
      motherGivenName:       { type: "string", description: "Mother's given name (a person mentioned on the record as the searched person's mother)." },
      motherSurname:         { type: "string", description: "Mother's family name." },
      motherGivenNameExact:  { type: "boolean", description: "When `true`, requires an exact match on the mother's given name." },
      motherSurnameExact:    { type: "boolean", description: "When `true`, requires an exact match on the mother's family name." },
      parentGivenName:       { type: "string", description: "A parent's given name when the parent's sex is unknown. Use instead of `fatherGivenName` / `motherGivenName` when you don't know which parent." },
      parentSurname:         { type: "string", description: "A parent's family name when the parent's sex is unknown." },
      parentGivenNameExact:  { type: "boolean", description: "When `true`, requires an exact match on the parent's given name." },
      parentSurnameExact:    { type: "boolean", description: "When `true`, requires an exact match on the parent's family name." },
      otherGivenName:        { type: "string", description: "Given name of a person who appears on the record alongside the searched person, of unknown relationship (use when you know two names co-occur but not how they relate)." },
      otherSurname:          { type: "string", description: "Family name of a person who appears on the record alongside the searched person, of unknown relationship." },
      otherGivenNameExact:   { type: "boolean", description: "When `true`, requires an exact match on the other given name." },
      otherSurnameExact:     { type: "boolean", description: "When `true`, requires an exact match on the other family name." },

      // Record-source
      collectionId:          { type: "number", description: "A single FamilySearch collection ID. Call the `place_collections` tool first to find the right ID for a place or topic. Note: this is a different ID system from the `place_search` tool's IDs — pass a place *name* to `place_collections`, not a place ID." },
      recordCountry:         { type: "string", description: "Country where the record was created (e.g., `'United States'`, `'England'`). Acts as an anchor — at least one of `surname` or `recordCountry` must be supplied." },
      recordSubdivision:     { type: "string", description: "State, province, or first-level subdivision within the country (e.g., `'Alabama'`). Requires `recordCountry` to be supplied alongside it." },
      recordType:            { type: "string", enum: ["birth", "marriage", "death", "census", "immigration", "military", "probate", "other"], description: "Type of record. Mapped to the upstream's integer recordType encoding by the tool." },
      maritalStatus:         { type: "string", enum: ["Married", "Single", "Divorced", "Widowed"], description: "Marital status of the searched person. Case-sensitive — must be supplied with the exact capitalization shown. Many records leave this field unfilled, so filtering on it excludes records where the field is blank." },
      isPrincipal:           { type: "boolean", description: "Filter by the searched person's role in the record. `true` returns only records where the matched person is the principal subject (e.g., the deceased on a death certificate, the bride/groom on a marriage). `false` returns only records where the matched person is mentioned but is not the principal (e.g., as a parent, witness, sibling). Omit the parameter to return both — the broadest set, recommended for most natural-language searches." },

      // Pagination
      count:                 { type: "number", description: "Number of results per page. Default 20, max 100." },
      offset:                { type: "number", description: "Pagination offset. Default 0. The combined value `offset + count` must be at most 4999 (FamilySearch's hard search-depth limit)." }
    }
  }
}
```

The anchor rule is enforced inside `validateInput`, not via JSON
Schema's `required` (which can only require single fields, not
"one of these N").

---

## Authentication

This tool requires a valid FamilySearch access token. It must call
`getValidToken()` from `src/auth/refresh.ts` — the single entry
point for all authenticated tools. Do not re-implement token
plumbing.

If the user is not authenticated, `getValidToken()` throws an
LLM-instruction error directing the user to call the `login`
tool. The tool handler should let this error propagate (same
try/catch pattern as other tools in `index.ts`).

---

## FamilySearch API Reference

**Endpoint (auth required):**

```
GET https://www.familysearch.org/service/search/hr/v2/personas
Authorization: Bearer <access_token>
Accept: application/json
Accept-Language: en
User-Agent: <browser-like user agent string>
```

**Required headers:**

- `Authorization: Bearer <token>` — without it, the API returns
  401.
- `User-Agent: <browser-like string>` — without it, the WAF
  (FamilySearch's web firewall) returns 403. Use the same
  browser-style constant the `place_collections` tool uses.
- `Accept-Language: en` — without it, place names in some response
  fields can come back in the user's session locale.

**Default flags sent on every request:**

| Flag | Value | Purpose |
|-----|------|---------|
| `m.queryRequireDefault` | `on` | Treats every `q.*` term as a required filter. Without this, most `q.*` terms only rerank the result list without narrowing it. |
| `m.defaultFacets` | `off` | Tells the server not to compute facet aggregations. The tool doesn't consume facet data; turning them off speeds up broad queries by up to 9×. |

**Tool input → API parameter mapping:**

| Tool input | API parameter |
|------------|---------------|
| `surname` | `q.surname` |
| `givenName` | `q.givenName` |
| `surnameAlt` | `q.surname.1` (with auto-pair: see Alt-name handling below) |
| `givenNameAlt` | `q.givenName.1` (with auto-pair) |
| `sex` | `q.sex` |
| `surnameExact=true` | `q.surname.exact=on` (and `q.surname.exact.1=on` if `surnameAlt` is set) |
| `givenNameExact=true` | `q.givenName.exact=on` (and `q.givenName.exact.1=on` if `givenNameAlt` is set) |
| `birthYearFrom` | `q.birthLikeDate.from` |
| `birthYearTo` | `q.birthLikeDate.to` |
| `birthYearExact=true` | `q.birthLikeDate.exact=on` |
| `birthPlace` | `q.birthLikePlace` |
| `birthPlaceExact=true` | `q.birthLikePlace.exact=on` |
| `deathYearFrom` | `q.deathLikeDate.from` |
| `deathYearTo` | `q.deathLikeDate.to` |
| `deathYearExact=true` | `q.deathLikeDate.exact=on` |
| `deathPlace` | `q.deathLikePlace` |
| `deathPlaceExact=true` | `q.deathLikePlace.exact=on` |
| `marriageYearFrom` | `q.marriageLikeDate.from` |
| `marriageYearTo` | `q.marriageLikeDate.to` |
| `marriageYearExact=true` | `q.marriageLikeDate.exact=on` |
| `marriagePlace` | `q.marriageLikePlace` |
| `marriagePlaceExact=true` | `q.marriageLikePlace.exact=on` |
| `residenceYearFrom` | `q.residenceDate.from` |
| `residenceYearTo` | `q.residenceDate.to` |
| `residenceYearExact=true` | `q.residenceDate.exact=on` |
| `residencePlace` | `q.residencePlace` |
| `residencePlaceExact=true` | `q.residencePlace.exact=on` |
| `anyYearFrom` | `q.anyDate.from` |
| `anyYearTo` | `q.anyDate.to` |
| `anyYearExact=true` | `q.anyDate.exact=on` |
| `anyPlace` | `q.anyPlace` |
| `anyPlaceExact=true` | `q.anyPlace.exact=on` |
| `spouseGivenName` | `q.spouseGivenName` |
| `spouseSurname` | `q.spouseSurname` |
| `spouseGivenNameExact=true` | `q.spouseGivenName.exact=on` |
| `spouseSurnameExact=true` | `q.spouseSurname.exact=on` |
| `fatherGivenName` | `q.fatherGivenName` |
| `fatherSurname` | `q.fatherSurname` |
| `fatherGivenNameExact=true` | `q.fatherGivenName.exact=on` |
| `fatherSurnameExact=true` | `q.fatherSurname.exact=on` |
| `motherGivenName` | `q.motherGivenName` |
| `motherSurname` | `q.motherSurname` |
| `motherGivenNameExact=true` | `q.motherGivenName.exact=on` |
| `motherSurnameExact=true` | `q.motherSurname.exact=on` |
| `parentGivenName` | `q.parentGivenName` |
| `parentSurname` | `q.parentSurname` |
| `parentGivenNameExact=true` | `q.parentGivenName.exact=on` |
| `parentSurnameExact=true` | `q.parentSurname.exact=on` |
| `otherGivenName` | `q.otherGivenName` |
| `otherSurname` | `q.otherSurname` |
| `otherGivenNameExact=true` | `q.otherGivenName.exact=on` |
| `otherSurnameExact=true` | `q.otherSurname.exact=on` |
| `collectionId` | `f.collectionId` |
| `recordCountry` | `q.recordCountry` |
| `recordSubdivision` | `q.recordSubcountry=<recordCountry>,<recordSubdivision>` (joined with a comma, no space) |
| `recordType` | `f.recordType=N` (`"birth"`=0, `"marriage"`=1, `"death"`=2, `"census"`=3, `"immigration"`=4, `"military"`=5, `"probate"`=6, `"other"`=7) |
| `maritalStatus` | `f.maritalStatus` |
| `isPrincipal` | `q.isPrincipal=true` or `=false` |
| `count` | `count` |
| `offset` | `offset` |

URL-encode each value with `encodeURIComponent`.

**Alt-name handling:**

The API requires `q.surname.1` and `q.givenName.1` to be paired
together (cardinality `.1` works as a pair under
`m.queryRequireDefault=on`). The tool fills the missing half
automatically before sending:

- If `surnameAlt` is set but `givenNameAlt` is not, the tool sets
  `givenNameAlt = givenName` before building the URL.
- If `givenNameAlt` is set but `surnameAlt` is not, the tool sets
  `surnameAlt = surname` before building the URL.

This is a server-side helper, not a caller obligation — the caller
can supply just one alt and the tool ensures the API receives a
correctly paired set.

**Modifier syntax:**

The API supports modifiers on `q.*` terms using a dot-separator
pattern: `q.<term>.<modifier>` and `q.<term>.<modifier>.<cardinality>`.

- `.exact=on` — strict matching instead of fuzzy. Used by the
  `*Exact` boolean inputs.
- `.from=YYYY` / `.to=YYYY` — date-range bounds on date terms. Used
  by the `*YearFrom` / `*YearTo` inputs.
- `.1` — alternate value for the term (cardinality). Used by
  `surnameAlt` / `givenNameAlt`.

Modifiers stack with cardinality. Example: `q.surname.exact.1=on`
applies exact matching to the alternate surname.

**Response shape:**

```
response.results                                              -> total match count
response.index                                                -> current offset (0-based)
response.links.next?.href                                     -> next-page URL (omitted on last page)
response.entries[]
  .id                                                         -> persona ID (e.g. "6K9K-3HN9")
  .score                                                      -> relevance score (number)
  .confidence                                                 -> 1-5 (number)
  .hints[]                                                    -> tree-person match suggestions
    .id                                                       -> ark of a tree person (e.g. "ark:/61903/4:1:GQWZ-GPX")
    .stars                                                    -> 0-5 match confidence
  .content.gedcomx.persons[]                                  -> can have multiple entries on household records
    .principal                                                -> boolean (multiple principals possible per record)
    .id                                                       -> internal ID (e.g. "p_298200778681")
    .display                                                  -> pre-normalized fields
      .name                                                   -> string
      .gender                                                 -> "Male" | "Female"
      .birthDate                                              -> string (e.g. "12 February 1809")
      .birthPlace                                             -> string
      .deathDate                                              -> string (when known)
      .deathPlace                                             -> string (when known)
      .role                                                   -> "Principal" | other
    .names[0].nameForms[0].fullText                           -> fallback name
    .gender.type                                              -> URL form (often missing)
    .facts[]
      .type                                                   -> URL, e.g. "http://gedcomx.org/Birth"
      .date.original                                          -> string
      .place.original                                         -> string
      .value                                                  -> string (for non-event facts)
    .identifiers["http://gedcomx.org/Persistent"][0]          -> ark URL of the persona
  .content.gedcomx.sourceDescriptions[]
    [0]                                                       -> the COLLECTION
      .resourceType                                           -> "http://gedcomx.org/Collection"
      .about                                                  -> "https://familysearch.org/collections/{id}"
      .titles[0].value                                        -> collection name
    [1]                                                       -> the RECORD
      .titles[0].value                                        -> record description
      .identifiers["http://gedcomx.org/Persistent"][0]        -> record ark URL
```

Some entries have multiple persons (e.g., census records list a
whole household). The mapping logic below picks the right person
for the entry.

---

## Mapping Logic

For each `entry` in `response.entries`:

1. **Find the persona this entry represents.** Take the entry's
   `id` (e.g., `"6K9K-3HN9"`) and find the person in
   `entry.content.gedcomx.persons[]` whose
   `identifiers["http://gedcomx.org/Persistent"][0]` ends in that
   ID. If no match, fall back to the first `principal: true`
   person. If still no match, skip the entry.

2. `personId` ← `entry.id`.

3. `personName` ← `person.display?.name`, falling back to
   `person.names[0].nameForms[0].fullText`.

4. `score` ← `entry.score`. `confidence` ← `entry.confidence`.

5. `sex` ← `person.display?.gender` if present (already `"Male"`
   or `"Female"`); otherwise the last path segment of
   `person.gender?.type`; otherwise undefined.

6. `birthDate` ← `person.display?.birthDate`, falling back to the
   `original` field of the `person.facts[]` entry whose `type`
   ends in `"/Birth"`. Same pattern for `birthPlace`, `deathDate`,
   `deathPlace`.

7. `events[]` ← every `person.facts[]` whose type isn't Birth or
   Death:
   - `type` ← last path segment of `fact.type`
   - `date` ← `fact.date?.original`
   - `place` ← `fact.place?.original`
   - `value` ← `fact.value`
   - Skip facts with none of date / place / value.

8. `arkUrl` ← first entry of
   `person.identifiers["http://gedcomx.org/Persistent"]`.

9. **Collection fields** ← from the `sourceDescriptions[]` entry
   whose `resourceType` is `"http://gedcomx.org/Collection"`:
   - `collectionUrl` ← `sd.about`
   - `collectionId` ← parsed from the URL path
     (`/collections/{id}` → `id`)
   - `collectionTitle` ← `sd.titles[0].value`

10. **Record fields** ← from the next `sourceDescriptions[]` entry
    (typically `[1]`):
    - `recordTitle` ← `sd.titles[0].value`
    - `recordUrl` ← `sd.identifiers["http://gedcomx.org/Persistent"][0]`

    Both are undefined if the record-level entry is missing.

11. `treeMatches[]` ← `entry.hints?.map(h => ({
    treePersonId: <h.id with the "ark:/61903/4:1:" prefix stripped>,
    stars: h.stars }))`, sorted by `stars` descending. The
    extraction is "take everything after the last `:`" — e.g.,
    `"ark:/61903/4:1:GQWZ-GPX"` → `"GQWZ-GPX"`. Empty array when
    `hints` is absent.

**Top-level fields:**

- `query` ← echo of input (only fields the caller supplied).
- `totalMatches` ← `response.results`.
- `paginationCappedAt` ← `4999` (constant).
- `returned` ← `entries.length`.
- `offset` ← `response.index ?? 0`.
- `hasMore` ← `response.links?.next?.href != null`.
- `results` ← the mapped `SearchResult[]`.

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| No anchor field present | Throw: `"search needs at least one anchor: surname or recordCountry. Searches without an anchor are too expensive on the FamilySearch API."` |
| `count` outside `[1, 100]` | Throw: `"count must be between 1 and 100."` |
| `offset` negative | Throw: `"offset must be non-negative."` |
| `offset + count > 4999` | Throw: `"offset + count must be <= 4999 (FamilySearch search depth limit). Narrow the query instead of paging deeper."` |
| Year input not a 4-digit year | Throw: `"<field> must be a 4-digit year (e.g., 1809)."` |
| `<event>YearFrom` without `<event>YearTo` (or vice versa) | Throw: `"<event>YearFrom and <event>YearTo must be provided together."` |
| `<event>YearFrom > <event>YearTo` | Throw: `"<event>YearFrom must be <= <event>YearTo."` |
| `recordSubdivision` without `recordCountry` | Throw: `"recordSubdivision requires recordCountry."` |
| `sex` not in `{Male, Female, Unknown}` (case-insensitive) | Throw: `"sex must be 'Male', 'Female', or 'Unknown' (case-insensitive)."` |
| `maritalStatus` not in the four allowed values (case-sensitive) | Throw: `"maritalStatus must be exactly one of: 'Married', 'Single', 'Divorced', 'Widowed' (case-sensitive)."` |
| `recordType` not in the eight allowed values | Throw: `"recordType must be one of: birth, marriage, death, census, immigration, military, probate, other."` |
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error. |
| API returns 401 | Throw: `"FamilySearch session not accepted; call the login tool to re-authenticate."` |
| API returns 403 | Throw: `"FamilySearch search blocked the request. The User-Agent header was rejected by the WAF — check that the MCP server is running an unmodified build."` |
| API returns 400 | Read response body as JSON, extract `body.errors[]`, join with `; `. Throw: `"FamilySearch search rejected the query: ${detail}."` Fall back to a generic message if the body isn't parseable. |
| API returns other non-OK status | Throw: `"FamilySearch search API error: ${status} ${statusText}"` |
| API returns 200 with empty `entries` | Return `{ ..., totalMatches: <upstream>, returned: 0, results: [], hasMore: false }`. |

---

## Caching

No caching. Search queries are query-specific and high-cardinality
— caching wouldn't pay off and would risk staleness when new
records are added.

---

## Files

### `mcp-server/src/types/search.ts`

API response types (`FSSearchResponse`, `FSSearchEntry`, `FSPerson`,
`FSDisplay`, `FSFact`, `FSSourceDescription`, `FSHint`) and tool I/O
types (`RecordSearchInput`, `SearchResult`, `SearchEvent`,
`TreeMatch`, `SearchToolResponse`).

### `mcp-server/src/tools/record-search.ts`

- `recordSearchToolSchema` — MCP tool schema (the JSON above).
- `recordSearchTool(input)` — main entry point: validate, authenticate,
  fetch, map, return.
- `validateInput(input)` — anchor rule + per-field validation.
  Throws LLM-aimed errors.
- `applyAltNameAutoPair(input)` — fills the missing alt half
  (`givenNameAlt = givenName` if only `surnameAlt` is set; mirror
  for the inverse).
- `buildSearchUrl(input)` — query-parameter builder. Maps each
  input field to its `q.*` / `f.*` parameter, applies `.exact`
  modifiers, encodes values, applies the default `m.*` flags.
- `mapEntry(entry)` — `FSSearchEntry → SearchResult` mapping (the
  11-step procedure above).
- `extractEvent(fact)` — `FSFact → SearchEvent`.
- `findRepresentedPerson(entry)` — the persona-by-ark match used in
  step 1 of mapping.
- `parseUpstreamErrorBody(body)` — pull `errors[]` from a 400
  response body.

### `mcp-server/src/index.ts`

Register `recordSearchTool` following the existing tool pattern (import,
ListTools, CallTool — same as `place_search`, `place_collections`).

---

## Testing

### `tests/tools/record-search.test.ts`

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns ranked results for surname + givenName | Happy path |
| 2 | Returns results for country-scoped search (`recordCountry` only, no surname) | Anchor rule — recordCountry qualifies |
| 3 | Returns results for surname + alt-name UNION (`surnameAlt` only) | Single-alt UNION + auto-pair fills `givenNameAlt` |
| 4 | Returns results for surname + alt-name UNION (`givenNameAlt` only) | Auto-pair fills `surnameAlt` |
| 5 | Throws when no anchor is supplied (only givenName + birthPlace) | Anchor rule rejection |
| 6 | Throws when count > 100 or count < 1 | Bound check |
| 7 | Throws when offset + count > 4999 | Pagination cap |
| 8 | Throws when `<event>YearFrom` is supplied without `<event>YearTo` | Range pair validation |
| 9 | Throws when `<event>YearFrom > <event>YearTo` | Range order validation |
| 10 | Throws when `recordSubdivision` is supplied without `recordCountry` | Subdivision pair validation |
| 11 | Throws on `sex` other than Male/Female/Unknown (case-insensitive) | sex enum validation |
| 12 | Throws on `maritalStatus` other than the four allowed values (case-sensitive) | maritalStatus enum validation |
| 13 | Throws on `recordType` other than the eight allowed values | recordType enum validation |
| 14 | Builds URL with all `q.*` params correctly | Param mapping |
| 15 | `surnameExact=true` emits both `q.surname.exact=on` and `q.surname.exact.1=on` when `surnameAlt` is set | Modifier + cardinality stack |
| 16 | `birthYearExact=true` emits `q.birthLikeDate.exact=on` | Year-exact mapping |
| 17 | `birthPlaceExact=true` emits `q.birthLikePlace.exact=on` | Place-exact mapping |
| 18 | `recordSubdivision` is composed into `q.recordSubcountry=<country>,<subdivision>` | Subdivision composition |
| 19 | `recordType="marriage"` maps to `f.recordType=1` | Record-type enum mapping |
| 20 | Default flags `m.queryRequireDefault=on` and `m.defaultFacets=off` are sent on every request | Default flag enforcement |
| 21 | Throws auth error when not authenticated | Auth propagation |
| 22 | Throws on 400 with extracted error-body detail | API validation errors |
| 23 | Falls back to generic 400 message when body isn't parseable | Defensive parsing |
| 24 | Throws on 401 with re-login guidance | Token-expired path |
| 25 | Throws on 403 with WAF/UA guidance | WAF rejection |
| 26 | Returns empty results when entries is empty | Zero-match handling |
| 27 | Maps entry → SearchResult correctly using `display{}` first, `facts[]` fallback | Field mapping |
| 28 | Surfaces `treeMatches` from `entry.hints` sorted by stars descending | Tree-match surfacing |
| 29 | Resolves the represented persona by ark suffix when there are multiple principals | Multi-principal handling |
| 30 | Sets `hasMore: true` when `links.next` exists | Pagination flag |
| 31 | Echoes `totalMatches` and `paginationCappedAt` correctly | Total-count surfacing |

### Smoke-test script

```bash
cd mcp-server
npx tsx dev/try-record-search.ts Lincoln Abraham
npx tsx dev/try-record-search.ts Lincoln Abraham --birth-year 1809
npx tsx dev/try-record-search.ts Smith --collection 1743384 --marriage-year 1830 1850
npx tsx dev/try-record-search.ts --given Mary --country "United States"  # surname-less + country anchor
npx tsx dev/try-record-search.ts Lincoln --alt Todd --given Mary    # maiden+married name
```

---

## Verification

### Automated

```bash
cd mcp-server && npm run build && npm test
```

### Manual Layer 1 (MCP Inspector)

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

- `search({ surname: "Lincoln", givenName: "Abraham", birthYearFrom: 1809, birthYearTo: 1809, birthPlace: "Kentucky" })` — top results should be Abraham-Lincoln-named records with `collectionId`, `collectionTitle`, and (for many) `treeMatches` populated.
- `search({ recordCountry: "United States", givenName: "John" })` — should succeed (recordCountry is an anchor).
- `search({ givenName: "John" })` — should fail with the anchor-rule error.
- `search({ surname: "Lincoln", count: 200 })` — should fail with the count-bound error.
- `search({ surname: "Lincoln", offset: 4998, count: 3 })` — should fail with the pagination-cap error (sum 5001).
- `record_search` without logging in — should return the auth error.

### Manual Layer 2 (Claude Code)

- *"Search FamilySearch for Abraham Lincoln, born 1809 in Kentucky."* — Claude calls `record_search` with a tight birth-year range, surfaces the top results.
- *"Find John Smith in Alabama marriage records from the 1830s."* — Claude chains `place_collections` then `record_search`, scoping by `collectionId` + `marriageYearFrom`/`marriageYearTo`.
- *"Look for Mary Todd Lincoln by both her names."* — Claude calls `record_search` with `surname: "Lincoln"` + `surnameAlt: "Todd"` (auto-pair fills `givenNameAlt`).
- *"Show me records that have a tree-person match suggested."* — Claude inspects `treeMatches` in returned results.

### Manual Layers 3 + 4 (Cowork via WSL2 + native Windows)
Standard end-to-end testing per `docs/testing-guides/oauth-tool-testing-guide.md`
template. Detailed playbook in `docs/testing-guides/search-tool-testing-guide.md`.

---

## What changed from v1 (summary for reviewers)

For anyone comparing this against `docs/specs/search-tool-spec.md`,
the headline changes:

1. **Endpoint switched** from `/platform/records/personas` to
   `/service/search/hr/v2/personas`. Reasons: 100× corpus,
   `f.collectionId` works, cleaner errors. Trade-off: leaner
   per-entry shape, browser-UA requirement.
2. **Anchor rule replaces "surname required"**: any of surname,
   collectionId, recordCountry, maritalStatus, year-range, or
   non-empty requireFields qualifies. Reflects the API contract
   (any q.* term required) plus the throttling concern (cheap
   anchors required).
3. **`collectionId` is a first-class input** (single value only,
   not array — multi-collection results aren't balanced).
4. **`requireFields` modifier input added**. Upgrades any
   `q.*` hint to a hard filter via `.require=on`.
5. **`recordCountry`, `maritalStatus`, `birthYearFrom/To` filter
   inputs added** (true narrowing filters from the search service's
   `f.*` family).
6. **`surnameAlt` / `givenNameAlt` inputs added** for alternate-name
   workflow (cardinality `.1` UNION semantics).
7. **`treeMatches` output field added** — surfaces FS's own
   tree-person match suggestions.
8. **`collectionId`, `collectionTitle`, `collectionUrl` outputs
   added/fixed** — derived from `sourceDescriptions[0]` (the
   collection entry), not the v1-mislabeled `/externalId/easy/` URL.
9. **`recordUrl` output added** — the per-record ark, distinct from
   the persona ark.
10. **`personaApiUrl` output dropped** — search service has no
    equivalent re-fetch URL. The persona ark itself is the
    persistent identifier.
11. **`birthDate`, `birthPlace`, `deathDate`, `deathPlace`
    surfaced as top-level SearchResult fields** (previously buried
    in `events[]`). Sourced from `display{}` for normalization.
12. **Mapping logic uses `display{}` first**, falls back to
    `facts[]` only when fields are missing. Simpler and more
    reliable.
13. **Mapping finds the persona by ark suffix**, not by picking
    the first principal. Fixes the multi-principal records issue
    flagged in v1 review.
14. **Date inputs are year-only** — same finding as v1, here
    re-confirmed for the search service.
15. **No 204 handling needed in v1** of the tool (defensive code
    only) — search service never returns it in our probes.
16. **400 errors come from response body, not Warning header** —
    simpler error parser than v1 (no Warning-header regex).
17. **Pagination cap is `offset + count >= 5000`**, not v1's
    `offset >= 4999`.
18. **`Accept-Language: en` header** required to prevent locale
    leak in `display{}` strings.
19. **Browser User-Agent header** required (WAF) — same constant
    as `place_collections`.

Everything in this spec is grounded in evidence from probe scripts
under `mcp-server/dev/probe-svc-*.ts` (run April 30 – May 4,
2026, ~170 queries total).
