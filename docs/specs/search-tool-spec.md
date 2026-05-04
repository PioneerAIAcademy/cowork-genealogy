# Search Tool — Implementation Spec

## Overview

An MCP tool that searches FamilySearch's historical record index and
returns ranked person matches with their key facts, ark URLs, and source
record titles. Requires authentication (OAuth tokens obtained via the
`login` tool). Wraps the documented Record Persona Search endpoint
(`/platform/records/personas`).

The primary inputs are name fields (`surname` is required, `givenName`
is optional) and event/relationship filters that narrow ranking. The
tool applies client-side input validation, calls the API, flattens
each GEDCOMX entry to a clean shape, and returns the top results
ranked by FamilySearch's relevance score.

### Endpoint choice (design note)

Two FamilySearch endpoints serve persona search: the documented
`api.familysearch.org/platform/records/personas` and the lower-level
`www.familysearch.org/service/search/hr/v2/personas` that the
`collections` tool uses. Both work; we use the documented one
because it has a stable contract, does **not** require the
browser-User-Agent WAF workaround, and returns richer per-entry
data (`title`, `links.person`, `matchInfo`) that simplifies mapping.

Trade-off: the documented endpoint exposes a smaller corpus than the
service endpoint (e.g., 4,905 candidates for "Lincoln" vs 579,446).
The documented endpoint appears to be deduplicated or clustered. For
top-of-ranking use (the top 20 results actually surfaced to users)
this is not a limitation.

### Pagination cap vs `results` total (design note)

The `results` field on the API response is the **true** total count
of records matching the query — not a cap, not a candidate-pool
proxy. It scales with surname frequency: 1,016 for "Quesnelle",
4,905 for "Lincoln", 533,546 for "Smith". Adding non-surname filters
(`givenName`, `birthLikeDate`, etc.) does *not* change this number;
it changes the **ranking** of returned entries.

The API enforces a separate hard **page-depth cap of 4,999**: any
request with `offset >= 4999` returns 400. For high-volume surnames
(Smith, Johnson) only the first ~5,000 best-ranked records are
reachable via pagination. The tool surfaces both numbers
(`totalMatches` and `paginationCappedAt`) so callers can reason
about how much of `totalMatches` is actually walkable.

### Limitation: no collection scoping (design note)

The natural multi-tool flow is `collections({query: "Alabama"})` →
pick a collection → `search` *within that collection*. The documented
endpoint does **not** support this. Probed April 2026 against
`/platform/records/personas`:

- `q.surname=Smith&f.collectionId=1743384` → 533,546 results, first
  entry `JNWK-VZS`. Identical to baseline `q.surname=Smith` (533,546,
  `JNWK-VZS`). The filter is silently ignored.
- `q.surname=Smith&f.collectionId=999999999` (bogus ID) → still
  533,546 / `JNWK-VZS`. Bogus IDs are accepted without validation
  error, confirming the parameter has no effect.
- Sibling filters (`f.collection`, `f.recordSource`, `f.sourceCollection`,
  `f.recordType`, `f.collectionTitle`) all return HTTP 400 — so filter
  validation exists at the resource level; `f.collectionId` itself is
  the broken/disabled term.
- The `q.collectionId` form returns *more* results (892,432 vs
  baseline 533,546) — interpreted as expansion, not filter. Wrong
  semantic for our use case.

**Substitute for v1:** scope geographically via `birthLikePlace` /
`deathLikePlace` / `marriagePlace` (e.g., `birthPlace: "Alabama"`).
The `collections` tool remains useful for *discovery* (which
collections cover a place, with record counts) even though their IDs
cannot be passed back into `search`.

**Future migration path** (out of scope for v1): the lower-level
service endpoint `/service/search/hr/v2/personas` *does* honor
`f.collectionId` (probed: Smith narrows from 66.8M baseline to 358,886
with `f.collectionId=1743384`, first entry changes). Switching to that
endpoint trades away the per-entry niceties (`title`, `links.person`,
`matchInfo`) and adds a WAF-bypass User-Agent requirement. Revisit if
real usage shows collection scoping is load-bearing.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `surname` | string | Yes | Surname / family name |
| `givenName` | string | No | Given / first name |
| `sex` | `"Male"` \| `"Female"` \| `"Unknown"` | No | Sex of the principal person. API param is `q.sex` (`q.gender` is rejected). Case-insensitive — `"male"` is normalized to `"Male"`. `Unknown` is accepted but does not effectively narrow (probe-confirmed: same top-rank as no `sex` filter). |
| `birthDate` | number \| string | No | Birth date as a single GEDCOMX simple date — `YYYY` (number or string) or `YYYY-MM-DD` (string). Maps to `q.birthLikeDate`. Mutually exclusive with `birthDateFrom` / `birthDateTo`. |
| `birthDateFrom` | number \| string | No | Inclusive lower bound of a birth-date range. `YYYY` or `YYYY-MM-DD`. Maps to `q.birthLikeDate.from`. |
| `birthDateTo` | number \| string | No | Inclusive upper bound of a birth-date range. `YYYY` or `YYYY-MM-DD`. Maps to `q.birthLikeDate.to`. |
| `birthPlace` | string | No | Birth place (e.g., `"Kentucky"` or `"Hodgenville, Kentucky"`) |
| `deathDate` | number \| string | No | Death date — same format as `birthDate`. Maps to `q.deathLikeDate`. Mutually exclusive with `deathDateFrom` / `deathDateTo`. |
| `deathDateFrom` | number \| string | No | Inclusive lower bound of a death-date range. Maps to `q.deathLikeDate.from`. |
| `deathDateTo` | number \| string | No | Inclusive upper bound of a death-date range. Maps to `q.deathLikeDate.to`. |
| `deathPlace` | string | No | Death place |
| `marriageDate` | number \| string | No | Marriage date — same format. Maps to `q.marriageLikeDate`. Mutually exclusive with `marriageDateFrom` / `marriageDateTo`. |
| `marriageDateFrom` | number \| string | No | Inclusive lower bound of a marriage-date range. Maps to `q.marriageLikeDate.from`. |
| `marriageDateTo` | number \| string | No | Inclusive upper bound of a marriage-date range. Maps to `q.marriageLikeDate.to`. |
| `marriagePlace` | string | No | Marriage place |
| `residenceDate` | number \| string | No | Residence date — `YYYY` or `YYYY-MM-DD`. Maps to `q.residenceDate`. (Census-style anchor.) |
| `residencePlace` | string | No | Residence place. Maps to `q.residencePlace`. |
| `spouseGivenName` | string | No | Spouse's given name |
| `spouseSurname` | string | No | Spouse's surname |
| `fatherGivenName` | string | No | Father's given name |
| `fatherSurname` | string | No | Father's surname |
| `fatherBirthLikePlace` | string | No | Father's birth place. Maps to `q.fatherBirthLikePlace`. |
| `motherGivenName` | string | No | Mother's given name |
| `motherSurname` | string | No | Mother's surname |
| `motherBirthLikePlace` | string | No | Mother's birth place. Maps to `q.motherBirthLikePlace`. |
| `parentGivenName` | string | No | Parent's given name when sex unknown. Maps to `q.parentGivenName`. |
| `parentSurname` | string | No | Parent's family name when sex unknown. Maps to `q.parentSurname`. |
| `parentBirthLikePlace` | string | No | Parent's birth place when sex unknown. Maps to `q.parentBirthLikePlace`. |
| `count` | number | No | Results to return. Default 20. Max 100. |
| `offset` | number | No | Pagination offset. Default 0. Max 4998. |

`surname` is required by tool policy. The upstream API technically
accepts given-only queries but result quality is poor — surname is
the genealogy-research anchor. The `places` tool is useful upstream
for disambiguating place names (e.g., which "Madison"?).

**Date format and ranges.** Per the FamilySearch [Record Persona Search
docs](https://www.familysearch.org/en/developers/docs/api/records/Record_Persona_Search_resource),
date inputs use the GEDCOMX simple date format `YYYY[-MM[-DD]]`. Negative-year
(BCE) inputs are not supported by this tool in v1 — they're accepted by the
API but probed to silently no-op (see *Date filter silent-fallback* in Key API
details). For each event (birth/death/marriage), supply **either** the
single-date field (e.g., `birthDate`) **or** a range pair (`birthDateFrom`
and/or `birthDateTo`); supplying both forms for the same event is a
client-side validation error (see Error Handling).

Example (specific person):
```json
{ "surname": "Lincoln", "givenName": "Abraham", "birthDate": 1809, "birthPlace": "Kentucky" }
```

Example (date-range):
```json
{ "surname": "Lincoln", "givenName": "Abraham", "birthDateFrom": 1800, "birthDateTo": 1820 }
```

Example (kin-anchored):
```json
{ "surname": "Lincoln", "spouseGivenName": "Mary", "spouseSurname": "Todd" }
```

Example (broad):
```json
{ "surname": "Quesnelle", "count": 50 }
```

Example (place-scoped — substitute for collection scoping):
```json
{ "surname": "Smith", "givenName": "John", "birthPlace": "Alabama" }
```
Use this pattern in place of collection scoping. The documented
endpoint does not honor `f.collectionId` (see the *Limitation: no
collection scoping* design note above), so geographic filters are the
practical way to narrow within "Alabama records" or similar.

---

## Output

| Field | Type | Description |
|-------|------|-------------|
| `query` | object | Echo of the input filters (only fields the caller supplied) |
| `totalMatches` | number | True total records matching the query in the corpus |
| `paginationCappedAt` | number | Hard offset cap from the API (4999). When `totalMatches > paginationCappedAt`, only the first 4999 records are reachable. |
| `returned` | number | Number of entries in this response (≤ `count`) |
| `offset` | number | Offset of this page (echo of input or 0) |
| `hasMore` | boolean | `true` if the upstream response includes a `links.next` |
| `results` | SearchResult[] | The ranked person matches |

Each `SearchResult` object:

| Field | Type | Description |
|-------|------|-------------|
| `personId` | string | FamilySearch persona ID (e.g., `"2H99-6MM"`) — also the suffix of the ark URL |
| `personName` | string | Full name as recorded on the source |
| `score` | number | Upstream relevance score (higher is better). **This is the ranking key.** |
| `confidence` | number | `ResultConfidence` enum, 1–5 (1 lowest, 5 highest) per the documented [AtomEntry](https://www.familysearch.org/en/developers/docs/api/types/xml_atom_Entry) schema. In practice on this endpoint, all entries on a given page share the same confidence value; sort and rank decisions should use `score`, not `confidence`. |
| `sex` | string? | `"Male"` / `"Female"` / undefined |
| `events` | Event[] | Extracted facts (Birth, Death, Marriage, Immigration, etc.) |
| `arkUrl` | string | Persistent identifier URL (e.g., `https://www.familysearch.org/ark:/61903/1:1:2H99-6MM`) |
| `personaApiUrl` | string | Direct API URL to re-fetch this persona (`entry.links.person.href`). Useful for retrieving the full persona record. **Note:** this is a *records-persona* ID, not a Family Tree person ID — the two ID spaces are disjoint. To bridge to `tree`/`cets`, use the persona's `tree-relationships` resource (out of scope for this tool). |
| `recordTitle` | string? | Source-record description (e.g., `"Entry for Abraham Lincoln, 'New York, New York Passenger and Crew Lists, 1909, 1925-1957'"`) |
| `collectionUrl` | string? | Link to the source collection |

Each `Event` object:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Last segment of the gedcomx fact type (`"Birth"`, `"Death"`, `"Marriage"`, etc.) |
| `date` | string? | Original (un-normalized) date string |
| `place` | string? | Original (un-normalized) place string |
| `value` | string? | Fact value for non-event facts (e.g., `"US Citizen"` for Nationality) |

Example:
```json
{
  "query": { "surname": "Lincoln", "givenName": "Abraham", "birthDate": 1809, "birthPlace": "Kentucky" },
  "totalMatches": 4905,
  "paginationCappedAt": 4999,
  "returned": 1,
  "offset": 0,
  "hasMore": true,
  "results": [
    {
      "personId": "2H99-6MM",
      "personName": "Abraham Lincoln",
      "score": 3.9236,
      "confidence": 3,
      "sex": "Male",
      "events": [
        { "type": "Birth", "date": "1911", "place": "U S" },
        { "type": "Immigration", "date": "1943", "place": "New York, New York, United States" }
      ],
      "arkUrl": "https://www.familysearch.org/ark:/61903/1:1:2H99-6MM",
      "personaApiUrl": "https://api.familysearch.org/platform/records/personas/2H99-6MM?flag=fsh",
      "recordTitle": "Entry for Abraham Lincoln, 'New York, New York Passenger and Crew Lists, 1909, 1925-1957'",
      "collectionUrl": "https://www.familysearch.org/platform/externalId/easy/11984221729"
    }
  ]
}
```

---

## Tool Schema

```typescript
{
  name: "search",
  description:
    "Search FamilySearch's historical record index for a person. " +
    "Requires a surname; given name, sex, birth/death/marriage date+place, " +
    "and parent/spouse names narrow ranking. Returns ranked persona matches with " +
    "key facts, ark URLs, and source record titles. " +
    "Requires authentication — call the login tool first if not logged in. " +
    "For ambiguous place names, call the places tool first to disambiguate.",
  inputSchema: {
    type: "object",
    properties: {
      surname:         { type: "string", description: "Surname / family name (required)." },
      givenName:       { type: "string", description: "Given / first name." },
      sex:             { type: "string", enum: ["Male", "Female", "Unknown"], description: "Sex of the principal person. Case-insensitive (e.g., 'male' → 'Male')." },
      birthDate:        { type: ["number", "string"], description: "Birth date as a single GEDCOMX simple date (YYYY or YYYY-MM-DD). Mutually exclusive with birthDateFrom/birthDateTo." },
      birthDateFrom:    { type: ["number", "string"], description: "Inclusive lower bound of a birth-date range (YYYY or YYYY-MM-DD)." },
      birthDateTo:      { type: ["number", "string"], description: "Inclusive upper bound of a birth-date range (YYYY or YYYY-MM-DD)." },
      birthPlace:       { type: "string", description: "Birth place name." },
      deathDate:        { type: ["number", "string"], description: "Death date (YYYY or YYYY-MM-DD). Mutually exclusive with deathDateFrom/deathDateTo." },
      deathDateFrom:    { type: ["number", "string"], description: "Inclusive lower bound of a death-date range." },
      deathDateTo:      { type: ["number", "string"], description: "Inclusive upper bound of a death-date range." },
      deathPlace:       { type: "string", description: "Death place name." },
      marriageDate:     { type: ["number", "string"], description: "Marriage date (YYYY or YYYY-MM-DD). Mutually exclusive with marriageDateFrom/marriageDateTo." },
      marriageDateFrom: { type: ["number", "string"], description: "Inclusive lower bound of a marriage-date range." },
      marriageDateTo:   { type: ["number", "string"], description: "Inclusive upper bound of a marriage-date range." },
      marriagePlace:    { type: "string", description: "Marriage place name." },
      residenceDate:    { type: ["number", "string"], description: "Residence date (YYYY or YYYY-MM-DD). Census-style anchor." },
      residencePlace:   { type: "string", description: "Residence place name." },
      spouseGivenName: { type: "string", description: "Spouse's given name." },
      spouseSurname:   { type: "string", description: "Spouse's surname." },
      fatherGivenName: { type: "string", description: "Father's given name." },
      fatherSurname:   { type: "string", description: "Father's surname." },
      fatherBirthLikePlace: { type: "string", description: "Father's birth place." },
      motherGivenName: { type: "string", description: "Mother's given name." },
      motherSurname:   { type: "string", description: "Mother's surname." },
      motherBirthLikePlace: { type: "string", description: "Mother's birth place." },
      parentGivenName: { type: "string", description: "Parent's given name when sex unknown." },
      parentSurname:   { type: "string", description: "Parent's family name when sex unknown." },
      parentBirthLikePlace: { type: "string", description: "Parent's birth place when sex unknown." },
      count:           { type: "number", description: "Results to return. Default 20, max 100." },
      offset:          { type: "number", description: "Pagination offset. Default 0, max 4998." }
    },
    required: ["surname"]
  }
}
```

---

## Authentication

This tool requires a valid FamilySearch access token. It must call
`getValidToken()` from `src/auth/refresh.ts` — the single entry point for
all authenticated tools. Do not re-implement token plumbing.

If the user is not authenticated, `getValidToken()` throws an LLM-instruction
error directing the user to call the `login` tool. The tool handler should
let this error propagate (same try/catch pattern as other tools in
`index.ts`).

---

## FamilySearch API Reference

**Endpoint (auth required):**
```
GET https://api.familysearch.org/platform/records/personas
Authorization: Bearer <access_token>
Accept: application/json
```

**Important:** This endpoint does **not** require a browser-style
User-Agent. A plain `User-Agent: genealogy-mcp-server/0.0.1` works.
This is different from the `collections` tool's endpoint, which is
WAF-protected.

**Query parameters:**

| Tool input | API parameter | Notes |
|------------|---------------|-------|
| `surname` | `q.surname` | Required |
| `givenName` | `q.givenName` | |
| `sex` | `q.sex` | `"Male"`, `"Female"`, or `"Unknown"` (case-insensitive; `q.gender` is rejected). Other values like `Unspecified`, `U`, `M` return 400 with `"Unable to map supplied value=… to gedcomx sex"`. |
| `birthDate` | `q.birthLikeDate` | GEDCOMX simple date `YYYY` or `YYYY-MM-DD`. Numbers serialize as 4-digit year. |
| `birthDateFrom` | `q.birthLikeDate.from` | Inclusive lower bound of range. Mutually exclusive with `birthDate`. |
| `birthDateTo` | `q.birthLikeDate.to` | Inclusive upper bound of range. Mutually exclusive with `birthDate`. |
| `birthPlace` | `q.birthLikePlace` | Free-text place name |
| `deathDate` | `q.deathLikeDate` | Same date format |
| `deathDateFrom` | `q.deathLikeDate.from` | Mutually exclusive with `deathDate`. |
| `deathDateTo` | `q.deathLikeDate.to` | Mutually exclusive with `deathDate`. |
| `deathPlace` | `q.deathLikePlace` | |
| `marriageDate` | `q.marriageLikeDate` | Same date format |
| `marriageDateFrom` | `q.marriageLikeDate.from` | Mutually exclusive with `marriageDate`. |
| `marriageDateTo` | `q.marriageLikeDate.to` | Mutually exclusive with `marriageDate`. |
| `marriagePlace` | `q.marriageLikePlace` | |
| `residenceDate` | `q.residenceDate` | Same date format as the *Like* terms. |
| `residencePlace` | `q.residencePlace` | |
| `spouseGivenName` | `q.spouseGivenName` | |
| `spouseSurname` | `q.spouseSurname` | |
| `fatherGivenName` | `q.fatherGivenName` | |
| `fatherSurname` | `q.fatherSurname` | |
| `fatherBirthLikePlace` | `q.fatherBirthLikePlace` | |
| `motherGivenName` | `q.motherGivenName` | |
| `motherSurname` | `q.motherSurname` | |
| `motherBirthLikePlace` | `q.motherBirthLikePlace` | |
| `parentGivenName` | `q.parentGivenName` | Parent of unknown sex. |
| `parentSurname` | `q.parentSurname` | Parent of unknown sex. |
| `parentBirthLikePlace` | `q.parentBirthLikePlace` | Parent of unknown sex. |
| `count` | `count` | Default 20; max 100 |
| `offset` | `offset` | Max 4998 (offset >= 4999 returns 400) |

URL-encode each value with `encodeURIComponent`.

**API response shape:**

```
response.results                                              -> total match count
response.index                                                -> current offset
response.links.next?.href                                     -> next-page URL (omit when no more)
response.entries[]
  .id                                                         -> persona ID (e.g. "2H99-6MM")
  .score                                                      -> relevance score
  .confidence                                                 -> 1-5
  .title                                                      -> pre-formatted record description
  .links.person.href                                          -> direct API URL for this persona
  .content.gedcomx.persons[principal=true]
    .gender.type                                              -> "http://gedcomx.org/Male" | "...Female"
    .names[0].nameForms[0].fullText                           -> full name
    .facts[].type                                             -> "http://gedcomx.org/Birth" etc.
    .facts[].date.original                                    -> "7 Feb 1883"
    .facts[].place.original                                   -> "Nelson County, Virginia, United States"
    .facts[].value                                            -> for non-event facts
    .identifiers["http://gedcomx.org/Persistent"][0]          -> ark URL (already canonical)
  .content.gedcomx.sourceDescriptions[0]
    .titles[0].value                                          -> fallback record title
    .identifiers["http://gedcomx.org/Primary"][0]             -> collection URL
```

**Key API details:**

- `entries[i].title` is a pre-formatted human-readable record
  description (e.g., `"Entry for Abraham Lincoln, 'New York, New
  York Passenger and Crew Lists, 1909, 1925-1957'"`). Use it
  directly for `recordTitle` and fall back to `sourceDescriptions[0]`
  only when `entry.title` is missing.
- `entries[i].links.person.href` is a stable API URL for re-fetching
  the persona — surface it as `personaApiUrl`. It points to
  `/platform/records/personas/{id}`, which uses a different ID space
  than `/platform/tree/persons/{pid}`. Don't represent it as a
  tree-chaining URL (the `tree`/`cets` tools cannot consume it
  directly).
- The `principal: true` person in `entry.content.gedcomx.persons`
  is the matched person; non-principal persons are relatives mentioned
  on the same record. Skip entries with no principal (defensive).
- Fact types are URLs (`http://gedcomx.org/Birth`); the human-readable
  type is the last path segment.
- The ark URL in `identifiers["http://gedcomx.org/Persistent"][0]`
  already uses the `www.familysearch.org` host. No host rewriting
  needed (different from the service endpoint, which uses
  `familysearch.org` without `www.`).
- Adding non-surname `q.*` filters does *not* change `results` — they
  affect ranking, not the candidate pool.
- **`f.collectionId` is silently ignored** on this endpoint. See the
  *Limitation: no collection scoping* design note in the Overview for
  probe details and the substitute geographic-scoping workflow.
- **Date-filter silent fallback (verified by probe).** `q.birthLikeDate`,
  `q.deathLikeDate`, `q.marriageLikeDate` and their documented `.from` /
  `.to` modifiers all work for *plausible* values — top entries cluster
  in-range and scores rise from baseline. But the API silently
  ignores filters that match nothing rather than returning empty or
  erroring. Probed April 2026 against `q.surname=Lincoln&count=20`:
  `q.birthLikeDate=1809` → top entries born 1806–1812 (filter active);
  `q.birthLikeDate.from=1800&.to=1820` → top entries born 1803–1819
  (range active); `q.birthLikeDate.from=2200&.to=2300` → identical to
  no-date baseline (years 1845–1902, filter no-op);
  `q.birthLikeDate=1300` → identical to no-date baseline (filter no-op).
  Implication: a caller passing a typo like `birthDateFrom: 22000`
  will get plausible-looking results that quietly ignored the filter.
  Tool surfaces the input via `query` echo so callers can detect this.
- Constraints found by probing (April 2026): `count > 100` returns
  400, `offset >= 4999` returns 400, `q.gender` returns 400, English
  date strings return 400, no `q.*` parameters at all returns 400,
  given-only queries return 200 (rejected by tool client-side).
- **`confidence` field — documented + empirical.** Each entry has
  `confidence` typed as `ResultConfidence` (GEDCOMX), an enum 1–5 with 5
  highest, per the documented [AtomEntry](https://www.familysearch.org/en/developers/docs/api/types/xml_atom_Entry)
  + [ResultConfidence](https://www.familysearch.org/en/developers/docs/api/types/xml_gx_ResultConfidence)
  schemas. **However, observed behavior on `/platform/records/personas`
  is page-uniform and counterintuitive:** every entry on a given page
  receives the same confidence value, and narrowing a query with correct
  filters can *lower* it. Probed (April 2026):
  `q.surname=Lincoln&q.givenName=Abraham` → all 20 entries
  `confidence=5`, score `3.62`; adding
  `q.birthLikeDate=1809&q.birthLikePlace=Kentucky` →
  all 20 entries `confidence=3`, score `3.92`; deep offset 2000 on the
  broad query → `confidence=3`. Treat `confidence` as opaque on this
  endpoint; surface it for transparency but rank with `score`.
- 400 responses come back with a generic upstream-error wrapper in
  the body (`{"errors":[{"code":400,"message":"Failure in upstream
  call: Search for record personas. (upstream 400)"}]}`), but the
  **`Warning` response header carries the field-level diagnostic** the
  body lacks. Per the docs: *"check warning headers"*. Format is RFC
  7234: comma-separated entries with `<code> <host> "<text>"`. There
  are typically two entries — an outer "Failure in upstream call" and
  an inner JSON envelope `{"message":"Validation failed.","errors":[…]}`
  whose `errors[]` is the actionable text. Examples observed (April 2026):
  - `count=200` → `"Invalid 'count' query parameter: (200) - must be less than or equal to100"`
  - `offset=5000&count=5` → `"Invalid 'count + offset' query parameter: (5005) - must be less than 5000"`
  - `q.gender=Male` → `"Term no longer supported. term=gender"`
  - `q.birthLikeDate=around 1850` → `"Parameter:q.birthLikeDate=around+1850 is not in a valid date format. Expected format: [+/-]YYYY[-MM[-DD]] or *"`
  - `q.unknownTerm=foo` → `"Unsupported Term=unknownTerm"`
  - `f.unknownFilter=foo` → `"Specified filter=unknownFilter is not an allowed filter term"`
  - no `q.*` → `"Search criteria are required"`

  The tool extracts the inner-JSON `errors[]` from the Warning header
  on every 400 and includes it in the thrown error message. Client-side
  validation still catches the common cases first (so the LLM gets a
  fast, specific message without round-trip), but the Warning extractor
  handles the long tail — including future API changes that add new
  validation rules without us shipping new client-side checks.
- **Residence + parent terms — partial empirical effectiveness.** All
  documented `q.*` terms now in the input schema (residence, kin,
  parent-of-unknown-sex variants) are accepted by the API — sanity
  probe with a fabricated `q.notARealTerm=foo` returns 400 with
  `"Unsupported Term=notARealTerm"`, so accepted-but-no-op terms are
  parse-honored. Probed effectiveness on `q.surname=Lincoln` (April 2026):
  `q.residencePlace=Illinois` reshapes top-3 and lifts scores to
  2.12–2.91; `q.parentSurname=Lincoln` reshapes top-3 and widens
  scores to 1.82–3.61; `q.residenceDate`, `q.fatherBirthLikePlace`,
  `q.motherBirthLikePlace`, `q.parentGivenName`, `q.parentBirthLikePlace`
  produced no observable shift on this query. They may be effective on
  other datasets / combined with other context — surface them per the
  documented contract, but expect uneven impact in practice.
- **`q.sex` accepted values (probed April 2026).** `Male`, `Female`,
  and `Unknown` are all accepted (case-insensitive: `male` → `Male`).
  `Unknown` parses but does not effectively narrow — same top-rank as
  the no-`sex` baseline. `Unspecified`, `U`, `M`, and other shorthand
  values return 400 with `"Unable to map supplied value=… to gedcomx
  sex"`. Tool enum is `{Male, Female, Unknown}`; tool normalizes to
  canonical (capitalized) form before passing to the API.
- **No-results status — docs vs observed.** The [Resource page](https://www.familysearch.org/en/developers/docs/api/records/Record_Persona_Search_resource)
  documents `204 No Content` as the success-with-no-results status. In
  probes against this endpoint (April 2026), 204 was never observed:
  nonsense surnames (`Zzzqxywv`, `Xqzpyqzqxw`) fuzzy-expanded into
  1,000+ results, and even highly-restrictive nonsense queries returned
  200 with a non-empty `entries[]`. Paging past the actual result count
  (e.g., `q.surname=Lincoln&offset=4990` against `results=4905`)
  produced 200 with `entries.length=0` and a full envelope. The tool
  must handle both: 204 (no body) per the documented contract, AND 200
  with empty `entries` per observed behavior. Both map to the same
  output shape (zero results).

---

## Mapping Logic

For each `entry` in the API response:

1. Find the person with `principal: true` in
   `entry.content.gedcomx.persons`. Skip the entry if none.
2. `personId` ← `entry.id`.
3. `personName` ← `person.names[0].nameForms[0].fullText`.
4. `score` ← `entry.score`. `confidence` ← `entry.confidence`.
5. `sex` ← last path segment of `person.gender.type` if present.
6. `events[]` ← for each `fact` in `person.facts`:
   - `type` ← last path segment of `fact.type`
   - `date` ← `fact.date?.original`
   - `place` ← `fact.place?.original`
   - `value` ← `fact.value`
   - Skip facts with none of date / place / value.
7. `arkUrl` ← first entry of
   `person.identifiers["http://gedcomx.org/Persistent"]`.
8. `personaApiUrl` ← `entry.links?.person?.href`.
9. `recordTitle` ← `entry.title` (when present and non-empty), else
   `content.gedcomx.sourceDescriptions[0].titles[0].value`.
10. `collectionUrl` ← first entry of
    `sourceDescriptions[0].identifiers["http://gedcomx.org/Primary"]`,
    if present.

`hasMore` on the top-level response is `true` when
`response.links?.next?.href` is present.

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| `surname` missing | Throw error: `"search requires a surname. Add a 'surname' field (e.g., {\"surname\": \"Lincoln\"})."` |
| `count` outside `[1, 100]` | Throw error: `"count must be between 1 and 100."` |
| `offset` negative | Throw error: `"offset must be non-negative."` |
| `offset >= 4999` | Throw error: `"offset must be <= 4998 (FamilySearch search depth limit)."` |
| Date param not `YYYY` or `YYYY-MM-DD` | Throw error: `"<field> must be YYYY or YYYY-MM-DD (e.g., 1809 or 1809-02-12)."` |
| Both single-date and range supplied for same event | Throw error: `"<event>Date is mutually exclusive with <event>DateFrom/<event>DateTo. Use one form or the other (e.g., birthDate: 1809 OR birthDateFrom: 1800 + birthDateTo: 1820)."` |
| `birthDateFrom` > `birthDateTo` (or same for death/marriage) | Throw error: `"<event>DateFrom must be <= <event>DateTo."` |
| `sex` not in `{Male, Female, Unknown}` (case-insensitive) | Throw error: `"sex must be 'Male', 'Female', or 'Unknown' (case-insensitive)."` |
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error |
| API returns 401 | Throw error: `"FamilySearch session not accepted; call the login tool to re-authenticate."` |
| API returns 400 | Read `response.headers.get("warning")`. Extract the inner-JSON `errors[]` (regex-capture `{"message":"Validation failed.","errors":\[…\]}` from the comma-separated Warning value, JSON.parse, join with `; `). Throw error: ``"FamilySearch search rejected the query: ${detail}. (Check field formats: dates must be YYYY or YYYY-MM-DD; sex must be 'Male' or 'Female'.)"``. If the Warning header is missing or unparseable, fall back to: `"FamilySearch search rejected the query (no diagnostic header). Check field formats (dates must be YYYY or YYYY-MM-DD; sex must be 'Male' or 'Female')."` |
| API returns other non-OK status | Throw error: `"FamilySearch search API error: {status} {statusText}"` |
| API returns 204 No Content (documented) | Skip body parsing. Return `{ ..., totalMatches: 0, returned: 0, results: [], hasMore: false }`. |
| API returns 200 with empty `entries` (observed) | Return `{ ..., totalMatches: <upstream>, returned: 0, results: [], hasMore: false }`. |

---

## Caching

No caching. Search queries are query-specific and high-cardinality;
caching would not pay off and would risk staleness when new records
are added.

---

## Files

### `mcp-server/src/types/search.ts`

API response types (`FSSearchResponse`, `FSSearchEntry`, `FSPerson`,
`FSFact`, `FSSourceDescription`) and tool I/O types (`SearchInput`,
`SearchResult`, `SearchEvent`, `SearchToolResponse`).

### `mcp-server/src/tools/search.ts`

- `searchToolSchema` — MCP tool schema
- `searchTool(input)` — main function (validate, authenticate, fetch, map)
- `validateInput(input)` — surname/count/offset/date/sex validation; throws LLM-aimed errors
- `buildSearchUrl(input)` — query-parameter builder (encodes inputs to `q.*` params, applies defaults)
- `mapEntry(entry)` — `FSSearchEntry → SearchResult` mapping
- `extractEvent(fact)` — `FSFact → SearchEvent` mapping
- `formatDate(value)` — number → `YYYY` or string passthrough; rejects invalid formats
- `parseUpstreamWarning(headerValue)` — extracts the inner-JSON `errors[]` from a 400 response's `Warning` header. Returns `null` when header is missing or unparseable.

### `mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools, CallTool).

---

## Testing

### `tests/tools/search.test.ts` (20 cases)

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns ranked results for surname + givenName | Happy path |
| 2 | Returns results for surname-only query | Minimal valid input |
| 3 | Throws when surname is missing | Required-field validation |
| 4 | Throws when count > 100 or count < 1 | Bound check |
| 5 | Throws when offset >= 4999 or offset < 0 | Depth-limit + non-negative check |
| 6 | Throws on invalid date format (English text, embedded ranges like `1800-1820`) | Date format conformance |
| 7 | Throws on `sex` other than `"Male"` / `"Female"` | Enum validation |
| 8 | Builds URL with all `q.*` params correctly (incl. spouse/parent fields) | Param mapping |
| 9 | Number `birthDate` serializes as `YYYY` to `q.birthLikeDate` | Date type coercion |
| 10 | String `birthDate="1809-02-12"` passes through | Full-date support |
| 10a | `birthDateFrom`/`birthDateTo` map to `q.birthLikeDate.from`/`.to` | Range modifier mapping (and same for death/marriage) |
| 10b | Throws when both `birthDate` and `birthDateFrom`/`birthDateTo` supplied | Mutual-exclusion validation |
| 10c | Throws when `birthDateFrom` > `birthDateTo` | Range-order validation |
| 11 | Throws auth error when not authenticated | Auth propagation |
| 12 | Throws on 400 with extracted Warning-header detail | API validation errors — diagnostic surfacing |
| 12a | Falls back to generic 400 message when Warning header is missing/unparseable | Defensive parsing |
| 13 | Throws on 401 with re-login guidance | Token-expired path |
| 14 | Returns empty results when entries is empty (200 with `entries.length=0`) | Zero-match handling — observed behavior |
| 14a | Returns empty results when status is 204 (no body) | Zero-match handling — documented behavior |
| 15 | Maps entry → SearchResult correctly (incl. arkUrl, personaApiUrl) | Field mapping |
| 16 | Extracts sex from `person.gender.type` | Sex extraction |
| 17 | Skips entries without a principal person | Defensive mapping |
| 18 | Sets `hasMore: true` when `links.next` exists | Pagination flag |
| 19 | Falls back from `entry.title` to `sourceDescriptions[0].titles[0].value` | Record-title fallback |
| 20 | Echoes `totalMatches` and `paginationCappedAt` | Total-count surfacing |

### Smoke-test script

```bash
cd mcp-server
npx tsx scripts/try-search.ts Lincoln Abraham                # surname + given
npx tsx scripts/try-search.ts Lincoln Abraham 1809 Kentucky  # full filters (single date)
npx tsx scripts/try-search.ts Lincoln Abraham --range 1800 1820  # date-range filter
npx tsx scripts/try-search.ts Quesnelle                      # less-common surname
npx tsx scripts/try-search.ts Smith --count 50               # broad surname, larger page
npx tsx scripts/try-search.ts Lincoln --spouse "Mary Todd"   # kin-anchored
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
- Call `search({ surname: "Lincoln", givenName: "Abraham", birthDate: 1809, birthPlace: "Kentucky" })` — top results should be Abraham-Lincoln-named records ranked by score.
- Call `search({ surname: "Lincoln", givenName: "Abraham", birthDateFrom: 1800, birthDateTo: 1820 })` — top entries should have birth years in 1800–1820.
- Call `search({ surname: "Lincoln", birthDate: 1809, birthDateFrom: 1800 })` — returns input-validation error about mutual exclusion.
- Call `search({ givenName: "Abraham" })` — returns input-validation error about missing surname.
- Call `search({ surname: "Lincoln", count: 200 })` — returns input-validation error.
- Call `search` without logging in — returns auth error.

### Manual Layer 2 (Claude Code)
- "Search FamilySearch for Abraham Lincoln, born 1809 in Kentucky." — Claude should call `search` with the full filter set and surface the top results.
- "Find records for someone surnamed Quesnelle." — Claude should call `search` with surname only.
- "Look for Mary Todd Lincoln." — Claude should call `search` with `surname: "Lincoln"` plus `givenName: "Mary"` (or use spouse fields).
