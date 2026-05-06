# Search Tool — Implementation Spec (v2)

## What this tool does

The `search` tool helps Claude find historical records about a specific
person on FamilySearch. You give it some clues about who you're
looking for — a name, a year, a place, the name of a parent or
spouse — and it returns a ranked list of records that might match.
Each result includes the key facts on the record (when and where the
person was born, who their family was, what kind of record it is) and
a link the user can click to view the original.

This is the **find** primitive of the genealogy toolkit. A typical
research session looks like:

1. User asks Claude something like *"find John Smith in Alabama
   marriage records from the 1850s."*
2. Claude calls the `places` tool to confirm "Alabama" maps to the
   place the user means.
3. Claude calls the `collections` tool to find which collections
   cover Alabama and have marriage records.
4. Claude calls **this tool** with `surname: "Smith"`,
   `givenName: "John"`, `collectionId: <Alabama Marriages id>`,
   `birthYearFrom: 1830`, `birthYearTo: 1850`, and gets a clean,
   ranked list of candidates.
5. Claude shows the top matches to the user, who picks the right
   one and clicks through to the original record.

Step 4 is what this spec describes.

---

## Why we use the search service (not the platform API)

FamilySearch exposes two endpoints that both search historical
records:

| Endpoint | URL prefix | What we get |
|---|---|---|
| Platform API | `https://api.familysearch.org/platform/records/personas` | Documented and "officially supported," but exposes only ~1% of the corpus and silently ignores the `f.collectionId` filter. |
| **Search service** | `https://www.familysearch.org/service/search/hr/v2/personas` | Undocumented in public docs but exposes the full corpus (100× larger) and `f.collectionId` actually works. The collection-scoping workflow above is impossible without this. |

We pick the search service for v2 because the architectural payoff
(collection-scoped search, full corpus) is decisive. The trade-off:

- Per-entry data is leaner (no pre-formatted `entry.title`, no
  `entry.links.person`). We derive equivalents from
  `sourceDescriptions[]`.
- A browser-style `User-Agent` header is required at the WAF
  (Web Application Firewall) layer. The `collections` tool already
  ships this, so we lift the same header constant.
- The endpoint is undocumented, so behavior may shift without
  notice. Same risk class as `collections`. We'll know if it
  breaks because every probed behavior is covered in tests.

The previous version of this spec (`docs/specs/search-tool-spec.md`)
targeted the platform endpoint. It remains in the repo as a
reference for the platform-specific findings (silent-no-op
`f.collectionId`, smaller corpus, etc.) that motivated the switch.

---

## Composition: the workflow this tool unlocks

Three tools chain together to answer most genealogy questions:

```
places(query: "Alabama")
  ↓ confirms which "Alabama" the user means
collections(query: "Alabama")
  ↓ returns the collection IDs that cover Alabama with their record counts
search({ surname, collectionId, ... })
  ↓ returns ranked person matches inside that specific collection
```

This is the architectural intent the v1 spec implied but couldn't
deliver — on the platform endpoint, `collections` and `search`
returned IDs that were incompatible. On the search service, the
collection IDs from `collections` flow directly into `search` as
filters.

---

## Two important limits to know up front

### Pagination cap (4,999 walkable results)

The API rejects any request where `offset + count >= 5000`. So if
"Smith" has 65 million matches, only the first ~5,000 best-ranked
records can ever be reached through pagination. The tool surfaces
both the true total (`totalMatches`) and the walkable cap
(`paginationCappedAt`) so the LLM can tell the user "your query is
too broad — please narrow it." The right response to a high
`totalMatches` isn't to paginate; it's to add filters.

### Multi-collection scoping is misleading

You can pass multiple collection IDs (e.g.,
`collectionId: [1743384, 5000016]`) and the API accepts it — but
results from the two collections are sorted globally by score, not
balanced. In practice you get pages of records from one collection
before any records from the other appear. **For v2 we only support
a single `collectionId`**. If the user really wants to search across
multiple collections, the LLM should issue separate `search` calls
and merge.

---

## Input

Every field is optional individually, but the tool requires **at
least one anchor** (see "Anchor rule" below).

| Field | Type | Description |
|---|---|---|
| `surname` | string | Family name. The single strongest anchor for genealogy queries. |
| `givenName` | string | First name. |
| `surnameAlt` | string | Alternate family name (e.g., maiden name when searching by married name). Maps to `q.surname.1`. The API performs a UNION — results match `surname` OR `surnameAlt`. |
| `givenNameAlt` | string | Alternate given name. Maps to `q.givenName.1`. UNION semantics. |
| `sex` | `"Male" \| "Female" \| "Unknown"` | Case-insensitive (`"male"` is normalized to `"Male"`). `"Unknown"` is accepted by the API but produces no narrowing — included for parity with FS's own enum. |
| `birthDate` | number | Year only, e.g. `1809`. The API accepts `YYYY-MM-DD` per its docs but probes confirm month/day are silently dropped — the tool restricts input to year for honesty. |
| `birthYearFrom` | number | Lower bound of a birth-year range. Maps to `f.birthYear0`. Must be paired with `birthYearTo`. |
| `birthYearTo` | number | Upper bound of a birth-year range. Maps to `f.birthYear1`. Must be paired with `birthYearFrom`. |
| `birthPlace` | string | Birth place name. Free text — the API does fuzzy matching across three jurisdiction levels (so `"Hodgenville, Kentucky"` also matches all of Kentucky). |
| `deathDate` | number | Year only. |
| `deathPlace` | string | Death place. |
| `marriageDate` | number | Year only. |
| `marriagePlace` | string | Marriage place. |
| `residenceDate` | number | Year only — useful for census-anchored searches. |
| `residencePlace` | string | Residence place. |
| `spouseGivenName` | string | Spouse's given name. |
| `spouseSurname` | string | Spouse's family name. |
| `fatherGivenName` | string | Father's given name. |
| `fatherSurname` | string | Father's family name. |
| `fatherBirthLikePlace` | string | Father's birth place. **Only narrows when listed in `requireFields`** — see below. |
| `motherGivenName` | string | Mother's given name. |
| `motherSurname` | string | Mother's family name. |
| `motherBirthLikePlace` | string | Mother's birth place. **Only narrows when listed in `requireFields`.** |
| `parentGivenName` | string | Parent's given name when sex is unknown. |
| `parentSurname` | string | Parent's family name when sex is unknown. |
| `parentBirthLikePlace` | string | Parent's birth place when sex is unknown. **Only narrows when listed in `requireFields`.** |
| `collectionId` | number | A FamilySearch collection ID (from the `collections` tool). Hard filter — typically narrows the candidate pool by 99%+. |
| `recordCountry` | string | Filter by the country where the record was created (e.g., `"United States"`, `"England"`). Hard filter. |
| `maritalStatus` | `"Married" \| "Single" \| "Divorced" \| "Widowed"` | Case-sensitive. The API recognizes other values (`"Unknown"`, `"Annulled"`, `"Separated"`) but they return zero records, so we don't expose them. |
| `requireFields` | string[] | Names of other fields the API should treat as **required** rather than as soft hints. Without this, most `q.*` fields only rerank — they don't narrow. With this, they narrow strongly. Example: `requireFields: ["spouseSurname"]` will only return records that actually have a spouse named what you asked for. |
| `count` | number | How many results to return per call. Default 20, max 100. |
| `offset` | number | Pagination offset. Default 0. The API rejects requests where `offset + count >= 5000`. |

### Anchor rule

The API requires *some* search criterion (a query with no `q.*`
parameters returns an error). On top of that, the search service
throttles expensive surname-less queries. To keep the tool fast and
useful, the validator requires **at least one of these anchors**:

- `surname`
- `collectionId`
- `recordCountry`
- `maritalStatus`
- both `birthYearFrom` *and* `birthYearTo`
- a non-empty `requireFields` array (with at least one field that's
  also supplied)

A query with only `givenName` or only `birthPlace` will be rejected
client-side. The error message tells the LLM how to fix it.

This is more flexible than v1's "surname required" rule. It
unblocks real research workflows (women whose maiden name is
unknown, immigrants with anglicized surnames) while still
preventing the unanchored queries that the API throttles.

### Examples

**Specific person (classic):**
```json
{
  "surname": "Lincoln",
  "givenName": "Abraham",
  "birthDate": 1809,
  "birthPlace": "Kentucky"
}
```

**Scoped to a single collection (the new v2 capability):**
```json
{
  "surname": "Smith",
  "givenName": "John",
  "collectionId": 1743384,
  "birthYearFrom": 1830,
  "birthYearTo": 1850
}
```

**Maiden name + married name search:**
```json
{
  "givenName": "Mary",
  "surname": "Lincoln",
  "surnameAlt": "Todd"
}
```

**Hard kin filter (parents must match, not just rerank):**
```json
{
  "surname": "Smith",
  "fatherGivenName": "Thomas",
  "fatherSurname": "Smith",
  "fatherBirthLikePlace": "Virginia",
  "requireFields": ["fatherBirthLikePlace"]
}
```

**Country-scoped (no collection in mind):**
```json
{
  "surname": "Quesnelle",
  "recordCountry": "Canada"
}
```

---

## Output

The tool returns a JSON object with these top-level fields:

| Field | Type | Description |
|---|---|---|
| `query` | object | Echoes back the input so the caller (and the LLM) can confirm what was searched. Only fields the caller supplied appear. |
| `totalMatches` | number | The total number of records that match the query in the FS corpus. Can be much larger than `paginationCappedAt`. |
| `paginationCappedAt` | number | The hard limit on how many results are reachable through pagination (4,999). When `totalMatches > paginationCappedAt`, the rest are unreachable — narrow the query instead. |
| `returned` | number | How many results are in this response (≤ `count`). |
| `offset` | number | Echo of the input offset (0 if not supplied). |
| `hasMore` | boolean | `true` when the API response includes a `links.next` (i.e., more pages are available). |
| `results` | SearchResult[] | The ranked results, best-scoring first. |

Each `SearchResult` looks like:

| Field | Type | Description |
|---|---|---|
| `personId` | string | The persona ID (e.g., `"6K9K-3HN9"`). Same as the suffix of the ark URL. |
| `personName` | string | The person's name as written on the source record (e.g., `"Abraham Lincoln"`). |
| `score` | number | The API's relevance score for this result *within this query*. Higher means better-ranked. **This is not an absolute quality signal** — every supplied filter lifts top scores by a fixed-looking amount, and scores are not comparable across different queries. Use `score` to sort within a result set, not to judge "is this match good enough." |
| `confidence` | number | A 1–5 confidence band on this result. Documented as the API's per-result confidence, but in practice every entry on the same page returns the same value (page-uniform). Surface it for transparency; don't use it for ranking. |
| `sex` | string \| undefined | `"Male"`, `"Female"`, or undefined when the record didn't record sex. |
| `birthDate` | string \| undefined | Birth date as the record wrote it (e.g., `"12 February 1809"` or `"1809"`). |
| `birthPlace` | string \| undefined | Birth place as written. |
| `deathDate` | string \| undefined | Death date as written. |
| `deathPlace` | string \| undefined | Death place as written. |
| `events` | Event[] | All other extracted facts (residence, immigration, marriage, etc.) that aren't already surfaced as birth/death. Each `Event` has `type`, `date?`, `place?`, `value?`. |
| `arkUrl` | string | Persistent link to the persona on FamilySearch (e.g., `https://familysearch.org/ark:/61903/1:1:6K9K-3HN9`). The user can click this. |
| `collectionId` | string | The ID of the collection this record belongs to. Lets the LLM tell the user *which* collection a hit came from. |
| `collectionTitle` | string | Human-readable collection name (e.g., `"United States, Social Security Numerical Identification Files (NUMIDENT), 1936-2007"`). |
| `collectionUrl` | string | Link to the collection page on FamilySearch. |
| `recordTitle` | string \| undefined | Human-readable description of the specific record (e.g., `"Entry for Abraham Lincoln, ..."`). |
| `recordUrl` | string \| undefined | Persistent link to the source record (different from `arkUrl`, which links to the persona). |
| `treeMatches` | TreeMatch[] | Suggested matches between this record persona and existing FamilySearch Family Tree people, with FS's own confidence rating. Bridges record search to tree research. |

Each `Event`:

| Field | Type | Description |
|---|---|---|
| `type` | string | The fact type as a short label (e.g., `"Birth"`, `"Residence"`, `"Marriage"`, `"Immigration"`). |
| `date` | string \| undefined | Date as written on the record. |
| `place` | string \| undefined | Place as written. |
| `value` | string \| undefined | Free-text value for non-event facts (e.g., `"US Citizen"` for a Nationality fact). |

Each `TreeMatch`:

| Field | Type | Description |
|---|---|---|
| `treePersonId` | string | The Family Tree person ID this record may correspond to (e.g., `"GQWZ-GPX"`). Resolves via `/platform/tree/persons/{id}` — same scheme the (future) `tree` tool will use. |
| `stars` | number | Match confidence on a 1–5 scale (5 = highest). This is the same scale FS uses in its own "Possible Duplicates" UI. |

`treeMatches` is sorted by `stars` descending so the strongest match is first.

### Example response

```json
{
  "query": {
    "surname": "Lincoln",
    "givenName": "Abraham",
    "birthDate": 1809,
    "birthPlace": "Kentucky"
  },
  "totalMatches": 569368,
  "paginationCappedAt": 4999,
  "returned": 1,
  "offset": 0,
  "hasMore": true,
  "results": [
    {
      "personId": "QPRC-WPBZ",
      "personName": "Abraham Lincoln",
      "score": 4.234,
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

## MCP Tool Schema

```typescript
{
  name: "search",
  description:
    "Search FamilySearch's historical record index for a specific person. " +
    "Requires at least one anchor: surname, collectionId, recordCountry, " +
    "maritalStatus, a birth-year range (birthYearFrom + birthYearTo), or " +
    "a non-empty requireFields. Other fields narrow ranking. Returns " +
    "ranked person matches with key facts, persistent URLs, source-record " +
    "details, and Family-Tree-person match suggestions. Requires " +
    "authentication — call the login tool first if not logged in. " +
    "For ambiguous place names, call the places tool first. To scope " +
    "to a specific record collection (recommended for narrow searches), " +
    "call the collections tool first to find the right collectionId.",
  inputSchema: {
    type: "object",
    properties: {
      surname:               { type: "string", description: "Family name." },
      givenName:             { type: "string", description: "Given (first) name." },
      surnameAlt:            { type: "string", description: "Alternate family name (e.g., maiden name). Performs a UNION with surname." },
      givenNameAlt:          { type: "string", description: "Alternate given name. UNION semantics." },
      sex:                   { type: "string", enum: ["Male", "Female", "Unknown"], description: "Case-insensitive. 'Unknown' parses but does not narrow." },
      birthDate:             { type: "number", description: "Birth year only (e.g., 1809). MM-DD is silently dropped by the API." },
      birthYearFrom:         { type: "number", description: "Lower bound of birth-year range. Must be paired with birthYearTo." },
      birthYearTo:           { type: "number", description: "Upper bound of birth-year range. Must be paired with birthYearFrom." },
      birthPlace:            { type: "string", description: "Birth place. Free text; fuzzy match expands to three jurisdiction levels." },
      deathDate:             { type: "number", description: "Death year only." },
      deathPlace:            { type: "string", description: "Death place." },
      marriageDate:          { type: "number", description: "Marriage year only." },
      marriagePlace:         { type: "string", description: "Marriage place." },
      residenceDate:         { type: "number", description: "Residence year (census-style anchor)." },
      residencePlace:        { type: "string", description: "Residence place." },
      spouseGivenName:       { type: "string", description: "Spouse's given name." },
      spouseSurname:         { type: "string", description: "Spouse's family name." },
      fatherGivenName:       { type: "string", description: "Father's given name." },
      fatherSurname:         { type: "string", description: "Father's family name." },
      fatherBirthLikePlace:  { type: "string", description: "Father's birth place. Only narrows when listed in requireFields." },
      motherGivenName:       { type: "string", description: "Mother's given name." },
      motherSurname:         { type: "string", description: "Mother's family name." },
      motherBirthLikePlace:  { type: "string", description: "Mother's birth place. Only narrows when listed in requireFields." },
      parentGivenName:       { type: "string", description: "Parent's given name when sex unknown." },
      parentSurname:         { type: "string", description: "Parent's family name when sex unknown." },
      parentBirthLikePlace:  { type: "string", description: "Parent's birth place when sex unknown. Only narrows when listed in requireFields." },
      collectionId:          { type: "number", description: "FamilySearch collection ID (from the collections tool). Hard filter that typically narrows by 99%+." },
      recordCountry:         { type: "string", description: "Country the record was created in (e.g., 'United States', 'England')." },
      maritalStatus:         { type: "string", enum: ["Married", "Single", "Divorced", "Widowed"], description: "Case-sensitive." },
      requireFields:         { type: "array", items: { type: "string" }, description: "Field names to mark as required (hard filters) instead of soft hints. Without this, most q.* fields only rerank." },
      count:                 { type: "number", description: "Results per call. Default 20, max 100." },
      offset:                { type: "number", description: "Pagination offset. The API rejects offset + count >= 5000." }
    }
  }
}
```

(No `required` array — anchor rule is enforced in `validateInput`.)

---

## Authentication

This tool requires a valid FamilySearch access token. It calls
`getValidToken()` from `src/auth/refresh.ts` — the single entry
point for all authenticated tools. Don't re-implement token
plumbing.

If the user isn't logged in, `getValidToken()` throws an
LLM-instruction error directing them to call the `login` tool. The
handler lets that error propagate (same try/catch pattern as other
tools in `index.ts`).

---

## Search-Service API Reference

### Endpoint

```
GET https://www.familysearch.org/service/search/hr/v2/personas
Authorization: Bearer <access_token>
Accept: application/json
Accept-Language: en
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36
```

**Three header notes:**

1. **`User-Agent` must be browser-style.** Probed 2026-05-03: a
   plain identifier (`genealogy-mcp-server/0.0.1`) and a curl-style
   UA (`curl/8.5.0`) both return HTTP 403 from the WAF. The full
   browser string above gets HTTP 200. Same constant the
   `collections` tool uses — lift it.

2. **`Accept-Language: en` prevents locale leak.** Without it, the
   `display{}` fields on results can come back in the user's
   session locale (we observed Mongolian-language place names in
   testing). Force English for stable strings.

3. **`Authorization: Bearer <token>`** is mandatory. Probed: a
   request without it returns HTTP 401 with an empty body.

### Query parameter mapping

| Tool input | API parameter | Notes |
|---|---|---|
| `surname` | `q.surname` | |
| `givenName` | `q.givenName` | |
| `surnameAlt` | `q.surname.1` | UNION semantics with `q.surname`. |
| `givenNameAlt` | `q.givenName.1` | |
| `sex` | `q.sex` | Case-insensitive; tool normalizes to canonical capitalization before sending. |
| `birthDate` | `q.birthLikeDate` | Year (`YYYY`) only. |
| `birthYearFrom` | `f.birthYear0` | Required pair. |
| `birthYearTo` | `f.birthYear1` | Required pair. |
| `birthPlace` | `q.birthLikePlace` | |
| `deathDate` | `q.deathLikeDate` | |
| `deathPlace` | `q.deathLikePlace` | |
| `marriageDate` | `q.marriageLikeDate` | |
| `marriagePlace` | `q.marriageLikePlace` | |
| `residenceDate` | `q.residenceDate` | |
| `residencePlace` | `q.residencePlace` | |
| `spouseGivenName` | `q.spouseGivenName` | |
| `spouseSurname` | `q.spouseSurname` | |
| `fatherGivenName` | `q.fatherGivenName` | |
| `fatherSurname` | `q.fatherSurname` | |
| `fatherBirthLikePlace` | `q.fatherBirthLikePlace` | Use `requireFields` to make this narrow. |
| `motherGivenName` | `q.motherGivenName` | |
| `motherSurname` | `q.motherSurname` | |
| `motherBirthLikePlace` | `q.motherBirthLikePlace` | Use `requireFields` to make this narrow. |
| `parentGivenName` | `q.parentGivenName` | |
| `parentSurname` | `q.parentSurname` | |
| `parentBirthLikePlace` | `q.parentBirthLikePlace` | Use `requireFields` to make this narrow. |
| `collectionId` | `f.collectionId` | Hard filter. |
| `recordCountry` | `f.recordCountry` | Hard filter. |
| `maritalStatus` | `f.maritalStatus` | Hard filter. |
| `requireFields: ["X"]` | `q.X.require=on` | One `q.<field>.require=on` per field name listed. |
| `count` | `count` | Max 100. |
| `offset` | `offset` | Validated client-side: `offset + count <= 4999`. |

URL-encode every value with `encodeURIComponent`.

### Response shape

```
response.results                           -> number, total matches in corpus
response.index                             -> number, current offset
response.links.next.href                   -> string, next-page URL (absent on last page)
response.entries[]
  .id                                      -> string, persona ID (e.g. "6K9K-3HN9")
  .score                                   -> number
  .confidence                              -> number, 1-5
  .hints                                   -> array, present on most entries
    [].id                                  -> string, ark of a tree person
    [].stars                               -> number, 1-5 match confidence
  .content.gedcomx
    .persons[]                             -> usually 1 element, can be many
      .principal                           -> boolean (multiple principals per record possible)
      .id                                  -> string, internal ID (e.g. "p_298200778681")
      .display                             -> object, pre-normalized fields
        .name                              -> string
        .gender                            -> "Male" | "Female"
        .birthDate                         -> string, e.g. "12 February 1809"
        .birthPlace                        -> string
        .deathDate                         -> string (when known)
        .deathPlace                        -> string (when known)
        .role                              -> "Principal" | other
      .names[0].nameForms[0].fullText      -> fallback name
      .gender.type                         -> URL form (often missing)
      .facts[]
        .type                              -> URL, e.g. "http://gedcomx.org/Birth"
        .date.original                     -> string
        .place.original                    -> string
        .value                             -> string (for non-event facts)
      .identifiers
        ["http://gedcomx.org/Persistent"][0] -> ark URL of the persona
    .sourceDescriptions[]
      [0]                                  -> the COLLECTION
        .resourceType                      -> "http://gedcomx.org/Collection"
        .about                             -> "https://familysearch.org/collections/{id}"
        .titles[0].value                   -> collection name
      [1]                                  -> the RECORD
        .titles[0].value                   -> record description
        .identifiers["http://gedcomx.org/Persistent"][0] -> record ark URL
      [2+]                                 -> internal pointers (ignore)
```

### Key API details (probe-grounded)

Each item below cites the probe script that validated it.

**Hint vs filter (q.* vs f.*).** Per the documented FS query
grammar, `q.*` parameters are *hints* that affect ranking, and
`f.*` parameters are *hard filters* that narrow the candidate pool.
We confirmed this experimentally
(`probe-svc-q-terms.ts`, `probe-svc-filters.ts`): every `q.*` term
we tested kept the candidate count at the surname-baseline and only
shifted top-3 IDs (RERANKS-ONLY); every `f.*` filter we exposed in
the spec actually shrunk the pool (NARROWS).

**The `.require=on` modifier upgrades a `q.*` hint to a hard
filter.** `probe-svc-modifiers.ts` and `probe-svc-followups.ts`:
`q.spouseSurname=Todd` alone reranks (569,368 → 569,368);
`q.spouseSurname=Todd&q.spouseSurname.require=on` narrows to
419,870. Same upgrade observed for the kin-place fields
(`q.fatherBirthLikePlace`, etc.) which are SILENT-NO-OPs without
the modifier and narrow by 94% with it.

**Date inputs are year-only.** `probe-svc-modifiers.ts`: four
variants (`1809`, `1809-02-12`, `1809-12-31`, `1809-01-01`) against
Lincoln returned identical results, IDs, and scores. The API
accepts the longer formats per its docs but the search ranker
silently drops month and day. The tool restricts input to year so
we don't lie to the LLM about granularity.

**`f.birthYear0/1` is a year-range filter that requires both
bounds.** `probe-svc-followups.ts`: standalone `f.birthYear0=1800`
NARROWS to 160,037; standalone `f.birthYear1=1820` returns ZERO;
the pair NARROWS as expected. Tight ranges (e.g., 1808–1810)
returned ZERO — the filter appears to be bucket-aligned at scales
we don't fully understand. Wide ranges (1700–2000) sometimes
returned *fewer* results than narrower ranges (1700-2000 → 11,087
vs 1800-1900 → 270,153) — likely an interaction with the 4,999
walkable cap. **Tool restricts ranges to "reasonable" widths and
documents the ZERO-RESULTS-on-narrow-range behavior in error
handling.**

**Multi-collection results aren't balanced.** `probe-svc-final.ts`:
`f.collectionId=1743384&f.collectionId=5000016&count=20` returned
20 entries all from collection `5000016` (NUMIDENT), zero from
`1743384` (Alabama Marriages). The `results` count was 1.5M ≈ A+B,
but ranking is global, not balanced. **This is why the v2 input
restricts `collectionId` to a single value.**

**`q.collectionId` is also a filter (NARROWS) on this endpoint** —
unlike platform, where it expanded the pool. We pick `f.collectionId`
in v2 because it's the documented filter namespace, validates input
(rejects bogus formats with HTTP 400), and supports multi-value via
repeated params (though we don't expose multi).

**`maritalStatus` enum is exactly four values.**
`probe-svc-final.ts`: `Married`, `Single`, `Divorced`, `Widowed`
NARROW. `Unknown`, `Annulled`, `Separated` parse but return zero
records. Lowercase variants (`married`, `MARRIED`) return zero —
the API is case-sensitive on this field. Other values (`foo`,
multi-word) return zero silently. Only `""` (empty) returns 400.
Tool validates the enum client-side.

**`q.sex` accepted values.** `probe-svc-edge.ts`: `Male`, `Female`,
`Unknown`, plus lowercase variants (`male`, `female`) all return
HTTP 200. `Unspecified`, `M`, `F`, `U` return HTTP 400 with
`"Unable to map supplied value=… to gedcomx sex"`. `q.sex=`
(empty) returns HTTP 400 with `"Invalid Syntax"`. Tool enum is
`{Male, Female, Unknown}`; tool normalizes case before sending.

**Confidence is page-uniform.** Across 16+ queries probed
(`probe-svc-edge.ts` and earlier), every page returned a single
distinct confidence value. Narrowing the query lowers it (e.g.,
broad Lincoln Abraham → 5; with birth-year + birth-place → 4).
The reviewer reports variance is possible; we couldn't elicit it.
**Surface `confidence` for transparency but do not use it for
ranking — use `score`.**

**Score is a within-query rerank signal, not absolute quality.**
Every supplied `q.*` filter lifts top scores by a fixed-looking
amount (~0.5 to ~1.0 per added term), regardless of whether the
filter is meaningful or even satisfiable. Scores from different
queries are not comparable. Document this so the LLM doesn't
treat a 4.2 vs 3.6 across two different searches as meaningful.

**`principal:true` semantics.** The reviewer confirmed (and
`probe-svc-edge.ts` re-confirmed): `principal` flags the *main
person(s) the record is about*, not "the person matching the
query." A birth record's principal is the child. A marriage
record's principals are both bride and groom. A census record can
flag the entire household as principals. Our test query for
parent-anchored search returned an entry with 5 principals (a
household). **Mapping logic must find the persona this entry
actually represents (match by ark suffix), not just pick the
first principal.**

**No 204 No Content from this endpoint.** The Resource page
documents 204 as the no-results status. We never observed it in
~170 probes (`probe-svc-edge.ts` group 4, plus all earlier
probes). Even nonsense surnames fuzzy-expand into 1,000+ results.
True zero-results requires a hard filter that matches nothing
(e.g., `f.collectionId=999999999`), which returns **HTTP 200 with
`results: 0` and `entries: []`** in a 36-byte body. Tool only
needs the 200-with-empty path; documenting the 204 contract for
honesty.

**400 errors carry a JSON body, no Warning header.** Across 7
different 400 conditions probed (`probe-svc-edge.ts` group 5),
every one had `Warning header: (none)` and the diagnostic in the
response body as `{"message": "Validation failed.", "errors":
["..."]}`. Tool parses `body.errors[]` and surfaces the joined
detail. (v1 needed a Warning-header parser for the platform
endpoint; v2 doesn't.)

**Pagination cap is `offset + count >= 5000`, not `offset >=
4999`.** `probe-svc-edge.ts` group 1: `offset=4998&count=3` (sum
5001) rejects with `"Max results depth exceeded. offset=4998 plus
count=3 is >= 5000"`. Tool validates the sum client-side.

**Server queues but doesn't throttle at our rate.**
`probe-svc-edge.ts` group 8: 8 concurrent identical queries all
returned 200, but response times stretched to 12 seconds. The
search service is slower than platform under concurrency. **No
retry/429 logic in v1.** Document the slower characteristic.

**`entry.hints` are tree-person match suggestions.**
`probe-svc-final.ts` and `probe-svc-hint-ark.ts`: each hint is
`{ id: "ark:/61903/4:1:XXXX", stars: <1-5> }`. The `4:1:` prefix
ARK resolves cleanly via `/platform/tree/persons/{id}` (returns a
full Family Tree person) and 404s via
`/platform/records/personas/{id}` (the namespaces are disjoint).
This is FS's own "this record may be the same person as this tree
entry" suggestion, the same scale as the in-product Possible
Duplicates feature. **v2 surfaces these as `treeMatches`** sorted
by stars descending.

**`persons[].display{}` has pre-normalized name + dates +
places.** `probe-svc-final.ts` group 5: principal personas carry
a `display` object with `name`, `gender`, `birthDate`,
`birthPlace`, `deathDate`, `deathPlace`, and `role` already
formatted as readable strings. Mapping should use `display{}` as
the primary source and fall back to `facts[]` only when fields
are missing.

**Things the API recognizes but we don't expose.**
`probe-svc-filters.ts` and `probe-svc-filters-deep.ts`:
- `f.recordSubcountry` — accepted; all value formats we tried
  (state names, abbreviations, both place-ID systems) returned
  zero. Probably needs an internal place-ID we couldn't identify.
- `f.givenNameStandard`, `f.surnameStandard` — accepted; all
  values returned zero.
- `f.birthLikePlace<N>` — works only with the literal docs
  example `f.birthLikePlace1=3,Alberta` and an internal place-ID
  system we don't have a mapping for.
- `.exact` modifier — accepted but doesn't behave as documented
  (no observable strict-spelling effect).
- `q.isPrincipal=true` — accepted but no observable narrowing.
  The reviewer hypothesized it filters to records where the
  queried person is in a principal role; we couldn't construct a
  query that demonstrated the effect.
- Wildcards `*` and `?` — inconsistently honored across fields.
  Tool strips them in `validateInput`.

These are deferred to a future spec revision when (a) we identify
the right value formats or (b) the FS team can confirm the
intended semantics.

---

## Mapping logic (entry → SearchResult)

For each `entry` in `response.entries`:

1. **Find the persona this entry represents.** Take the entry's
   `id` (e.g., `"6K9K-3HN9"`), build the expected ark URL
   (`https://familysearch.org/ark:/61903/1:1:<id>`), and find the
   person in `entry.content.gedcomx.persons[]` whose
   `identifiers["http://gedcomx.org/Persistent"][0]` matches.
   If no match, fall back to the first `principal:true` person.
   If still none (shouldn't happen), skip the entry.

2. **`personId`** ← `entry.id`.

3. **`personName`** ← `person.display?.name`, falling back to
   `person.names[0].nameForms[0].fullText`.

4. **`score`** ← `entry.score`. **`confidence`** ← `entry.confidence`.

5. **`sex`** ← `person.display?.gender` if present (already `"Male"`
   / `"Female"`); otherwise the last path segment of
   `person.gender?.type` (e.g., `"Male"` from
   `"http://gedcomx.org/Male"`); otherwise undefined.

6. **`birthDate`** ← `person.display?.birthDate`, falling back to
   the `original` field of the `person.facts[]` entry whose `type`
   ends in `"/Birth"`. Same pattern for `birthPlace`, `deathDate`,
   `deathPlace`.

7. **`events[]`** ← every `person.facts[]` whose type isn't Birth
   or Death (those are surfaced separately above):
   - `type` ← last path segment of `fact.type`
   - `date` ← `fact.date?.original`
   - `place` ← `fact.place?.original`
   - `value` ← `fact.value`
   - Skip facts with none of date / place / value.

8. **`arkUrl`** ← first entry of
   `person.identifiers["http://gedcomx.org/Persistent"]`.

9. **Collection fields** ← from `entry.content.gedcomx.sourceDescriptions[0]`
   (the entry whose `resourceType` is `"http://gedcomx.org/Collection"`):
   - `collectionUrl` ← `sd.about`
   - `collectionId` ← parsed from the URL path
     (`/collections/{id}` → `id`)
   - `collectionTitle` ← `sd.titles[0].value`

10. **Record fields** ← from `sourceDescriptions[1]` (the entry
    whose `about` is an ark URL):
    - `recordTitle` ← `sd.titles[0].value`
    - `recordUrl` ← `sd.identifiers["http://gedcomx.org/Persistent"][0]`

    Both undefined if `sourceDescriptions[1]` is missing.

11. **`treeMatches[]`** ← `entry.hints?.map(h => ({
    treePersonId: <last path segment of h.id>, stars: h.stars }))`,
    sorted by `stars` descending. Empty array when `hints` is absent.

**Top-level fields:**

- `query` ← echo of input (only fields the caller supplied).
- `totalMatches` ← `response.results`.
- `paginationCappedAt` ← `4999` (constant).
- `returned` ← `entries.length`.
- `offset` ← `response.index ?? 0`.
- `hasMore` ← `response.links?.next?.href != null`.
- `results` ← the mapped `SearchResult[]`.

---

## Error handling

| Condition | Behavior |
|---|---|
| No anchor field present | Throw: `"search needs at least one anchor: surname, collectionId, recordCountry, maritalStatus, a birth-year range (birthYearFrom + birthYearTo), or at least one term in requireFields. Surname-only or kin-name searches without an anchor are too expensive on the FamilySearch API."` |
| `count` outside `[1, 100]` | Throw: `"count must be between 1 and 100."` |
| `offset` negative | Throw: `"offset must be non-negative."` |
| `offset + count >= 5000` | Throw: `"offset + count must be <= 4999 (FamilySearch search depth limit). Narrow the query instead of paging deeper."` |
| Date input not a 4-digit year | Throw: `"<field> must be a 4-digit year (e.g., 1809)."` |
| `birthYearFrom` without `birthYearTo` (or vice versa) | Throw: `"birthYearFrom and birthYearTo must be provided together."` |
| `birthYearFrom > birthYearTo` | Throw: `"birthYearFrom must be <= birthYearTo."` |
| `sex` not in `{Male, Female, Unknown}` (case-insensitive) | Throw: `"sex must be 'Male', 'Female', or 'Unknown' (case-insensitive)."` |
| `maritalStatus` not in `{Married, Single, Divorced, Widowed}` (case-sensitive) | Throw: `"maritalStatus must be exactly one of: 'Married', 'Single', 'Divorced', 'Widowed' (case-sensitive)."` |
| `requireFields` contains a name not in the input | Throw: `"requireFields lists '<name>' but no such field is supplied. Add the field to the query or remove it from requireFields."` |
| Wildcard `*` or `?` in a name field | Strip silently before sending; log nothing user-facing. (Inconsistent honor on the API; safer to not send.) |
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error. |
| API returns 401 | Throw: `"FamilySearch session not accepted; call the login tool to re-authenticate."` |
| API returns 403 | Throw: `"FamilySearch search blocked the request. This usually means the User-Agent header was stripped — check that the MCP server is running an unmodified build."` |
| API returns 400 | Read response body as JSON, extract `body.errors[]`, join with `; `. Throw: `"FamilySearch search rejected the query: ${detail}."` Fall back to `"FamilySearch search rejected the query (no diagnostic body)."` if the body isn't parseable. |
| API returns other non-OK status | Throw: `"FamilySearch search API error: ${status} ${statusText}"` |
| API returns 200 with empty `entries` | Return `{ ..., totalMatches: <upstream>, returned: 0, results: [], hasMore: false }`. |
| API returns 204 (documented but never observed) | Same shape as the 200-with-empty case but with `totalMatches: 0`. Defensive code only. |

---

## Caching

No caching in v1. Search queries are query-specific and
high-cardinality — caching wouldn't pay off and would risk
staleness when new records are added. Add a cache later if real
usage shows benefit (the `collections` tool's pattern is the
reference).

---

## Files

### `mcp-server/src/types/search.ts`

API response types (`FSSearchResponse`, `FSSearchEntry`, `FSPerson`,
`FSDisplay`, `FSFact`, `FSSourceDescription`, `FSHint`) and tool I/O
types (`SearchInput`, `SearchResult`, `SearchEvent`, `TreeMatch`,
`SearchToolResponse`).

### `mcp-server/src/tools/search.ts`

- `searchToolSchema` — MCP tool schema (the JSON above).
- `searchTool(input)` — main entry point: validate, authenticate,
  fetch, map, return.
- `validateInput(input)` — anchor rule + per-field validation.
  Throws LLM-aimed errors.
- `buildSearchUrl(input)` — query-parameter builder. Maps each
  input field to its `q.*` / `f.*` parameter, applies
  `requireFields` as `.require=on` modifiers, encodes values, applies
  defaults.
- `mapEntry(entry)` — `FSSearchEntry → SearchResult` mapping (the
  11-step procedure above).
- `extractEvent(fact)` — `FSFact → SearchEvent`.
- `findRepresentedPerson(entry)` — the persona-by-ark match used in
  step 1 of mapping.
- `parseUpstreamErrorBody(body)` — pull `errors[]` from a 400
  response body.
- `stripWildcards(value)` — sanitize name/place inputs.

### `mcp-server/src/index.ts`

Register `searchTool` following the existing pattern (import,
ListTools, CallTool — same as `places`, `collections`).

---

## Testing

### `tests/tools/search.test.ts` (~25 cases)

| # | Test case | What it verifies |
|---|---|---|
| 1 | Returns ranked results for surname + givenName | Happy path — basic query |
| 2 | Returns results for collection-scoped search (collectionId + givenName, no surname) | Anchor rule — collectionId qualifies |
| 3 | Returns results for surname + alt-name UNION (`surnameAlt`) | Cardinality `.1` mapping |
| 4 | Throws when no anchor is supplied (only givenName + birthPlace) | Anchor rule rejection |
| 5 | Throws when count > 100 or count < 1 | Bound check |
| 6 | Throws when offset + count >= 5000 | Pagination cap (the right rule, not v1's `offset >= 4999`) |
| 7 | Throws on invalid date format (e.g. `"1809-02-12"` string, English text) | Year-only restriction |
| 8 | Throws when birthYearFrom is supplied without birthYearTo | Range pair validation |
| 9 | Throws when birthYearFrom > birthYearTo | Range order validation |
| 10 | Throws on `sex` other than Male/Female/Unknown (case-insensitive) | sex enum validation |
| 11 | Throws on `maritalStatus` other than the four allowed values (case-sensitive) | maritalStatus enum validation |
| 12 | Throws when `requireFields` lists a field not present in input | requireFields consistency |
| 13 | Wildcards `*` and `?` are stripped silently | Sanitization |
| 14 | Builds URL with all q.* params correctly | Param mapping (broad) |
| 15 | requireFields generates `.require=on` modifiers correctly | Modifier mapping |
| 16 | collectionId, recordCountry, maritalStatus map to `f.*` | Filter mapping |
| 17 | birthYearFrom/To map to `f.birthYear0`/`f.birthYear1` | Range filter mapping |
| 18 | Throws auth error when not authenticated | Auth propagation |
| 19 | Throws on 400 with extracted error-body detail | API validation errors |
| 20 | Falls back to generic 400 message when body isn't parseable | Defensive parsing |
| 21 | Throws on 401 with re-login guidance | Token-expired path |
| 22 | Throws on 403 with WAF/UA guidance | WAF rejection |
| 23 | Returns empty results when entries is empty (200 with `entries.length=0`) | Zero-match handling |
| 24 | Maps entry → SearchResult correctly using `display{}` first, `facts[]` fallback | Field mapping |
| 25 | Surfaces `treeMatches` from `entry.hints` sorted by stars descending | Tree-match surfacing |
| 26 | Resolves the represented persona by ark suffix when there are multiple principals | Multi-principal handling |
| 27 | Sets `hasMore: true` when `links.next` exists | Pagination flag |
| 28 | Echoes `totalMatches` and `paginationCappedAt` correctly | Total-count surfacing |

### Smoke-test script (`dev/try-search.ts`)

```bash
cd mcp-server
npx tsx dev/try-search.ts Lincoln Abraham
npx tsx dev/try-search.ts Lincoln Abraham 1809 Kentucky
npx tsx dev/try-search.ts Smith --collection 1743384 --year-range 1830 1850
npx tsx dev/try-search.ts --given Mary --collection 1743384  # surname-less + collection
npx tsx dev/try-search.ts Lincoln --alt Todd --given Mary    # maiden+married name
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
- `search({ surname: "Lincoln", givenName: "Abraham", birthDate: 1809, birthPlace: "Kentucky" })` — top results should be Abraham-Lincoln-named records ranked by score, with `collectionId`, `collectionTitle`, and (for many) `treeMatches` populated.
- `search({ collectionId: 1743384, givenName: "John" })` — should succeed (collectionId is an anchor); top results should all have `collectionId: "1743384"` and `collectionTitle` containing "Alabama".
- `search({ givenName: "John" })` — should fail with the anchor-rule error.
- `search({ surname: "Lincoln", count: 200 })` — should fail with the count-bound error.
- `search({ surname: "Lincoln", offset: 4998, count: 3 })` — should fail with the pagination-cap error (sum 5001).
- `search` without logging in — should return the auth error.

### Manual Layer 2 (Claude Code)
- *"Search FamilySearch for Abraham Lincoln, born 1809 in Kentucky."* — Claude calls `search` with the full filter set, surfaces the top results.
- *"Find John Smith in Alabama marriage records from the 1830s."* — Claude chains `collections` then `search`, scoping by collectionId + birthYearFrom/To.
- *"Look for Mary Todd Lincoln by both her names."* — Claude calls `search` with `surname` + `surnameAlt` (or another reasonable equivalent).
- *"Show me records that have a tree-person match suggested."* — Claude inspects `treeMatches` in returned results.

### Manual Layers 3 + 4 (Cowork via WSL2 + native Windows)
Standard end-to-end testing per `docs/oauth-tool-testing-guide.md`
template. Detailed playbook in `docs/search-tool-testing-guide.md`
(to be authored alongside implementation).

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
    as `collections`.

Everything in this spec is grounded in evidence from probe scripts
under `mcp-server/dev/probe-svc-*.ts` (run April 30 – May 4,
2026, ~170 queries total).
