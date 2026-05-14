# Tree Tool — Implementation Spec

## Overview

An MCP tool that reads person data from the shared FamilySearch Family Tree —
a collaborative, crowd-sourced tree with millions of contributors. It can
retrieve a person's facts, names, relationships, ancestor chart, and attached
sources. Requires authentication (OAuth tokens obtained via the `login` tool).

The tool supports two actions through a single `tree` tool:

| Action | What it does |
|--------|--------------|
| `person` (default) | Get details for a single person, with optional family and source data |
| `ancestry` | Get an ancestor chart (up to 8 generations) |

The `person` action accepts two optional boolean flags — `relatives` and
`sourceDescriptions` — that bundle family and source data into a single
API call. The skill decides which flags to set based on what the user
asked for:

| Flags | What the response includes |
|-------|---------------------------|
| (neither) | Person details only (lean response) |
| `relatives: true` | Person details + parents, spouses, children |
| `sourceDescriptions: true` | Person details + attached source citations |
| Both flags | Person details + family + sources (one API call) |

All actions use the FamilySearch platform tree API at
`api.familysearch.org/platform/tree/`.

### Current-user shortcut

When `personId` is omitted, the tool resolves the logged-in user's tree
person via `/platform/tree/current-person` (303 redirect to a person URL).
This lets users say "show me my family tree" without knowing their person ID.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `personId` | string | No | FamilySearch person ID (e.g., `"KNDX-MKG"`). Omit to use the current logged-in user's tree person. |
| `action` | string | No | One of `"person"`, `"ancestry"`. Defaults to `"person"`. |
| `generations` | number | No | Number of ancestor generations (1–8). Only used with `action: "ancestry"`. Defaults to `4`. |
| `relatives` | boolean | No | When `true`, includes parents, spouses, and children in the person response. Only used with `action: "person"`. Defaults to `false`. |
| `sourceDescriptions` | boolean | No | When `true`, includes attached source citations in the person response. Only used with `action: "person"`. Defaults to `false`. |

Examples:

```json
{ "personId": "KNDX-MKG" }
```

```json
{ "personId": "KNDX-MKG", "relatives": true }
```

```json
{ "personId": "KNDX-MKG", "sourceDescriptions": true }
```

```json
{ "personId": "KNDX-MKG", "relatives": true, "sourceDescriptions": true }
```

```json
{ "personId": "KNDX-MKG", "action": "ancestry", "generations": 4 }
```

```json
{ "action": "person", "relatives": true }
```

---

## Output

### Action: `person`

**Base fields** (always present):

| Field | Type | Description |
|-------|------|-------------|
| `personId` | string | FamilySearch person ID |
| `name` | string | Full display name |
| `gender` | string | `"Male"`, `"Female"`, or `"Unknown"` |
| `living` | boolean | Whether the person is marked as living |
| `lifespan` | string | Display lifespan (e.g., `"1732-1799"`) |
| `birth` | EventSummary? | Birth date and place |
| `death` | EventSummary? | Death date and place |
| `facts` | FactSummary[] | Other life facts (burial, military service, occupation, etc.) |
| `url` | string | Link to the person on FamilySearch |

**Family fields** (present when `relatives: true`):

| Field | Type | Description |
|-------|------|-------------|
| `couples` | CoupleRef[] | Couple relationships the focal person is in (spouse info + marriage) |
| `parentsFamily` | FamilyGroup? | The focal person's parents and siblings |
| `spouseFamilies` | FamilyGroup[] | Families where the focal person is a parent (one per spouse) |

**Source fields** (present when `sourceDescriptions: true`):

| Field | Type | Description |
|-------|------|-------------|
| `totalSources` | number | Total number of sources attached |
| `sources` | SourceSummary[] | Source citations |

`EventSummary`:

| Field | Type | Description |
|-------|------|-------------|
| `date` | string? | Formatted date string |
| `place` | string? | Formatted place string |

`FactSummary`:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Human-readable fact type (e.g., `"Burial"`, `"Military Service"`) |
| `date` | string? | Formatted date string |
| `place` | string? | Formatted place string |
| `value` | string? | Fact value when present (e.g., job title for Occupation, denomination for Religion) |

Example (person only — no flags):

```json
{
  "personId": "KNDX-MKG",
  "name": "President George Washington",
  "gender": "Male",
  "living": false,
  "lifespan": "1732-1799",
  "birth": {
    "date": "22 February 1732",
    "place": "Westmoreland, Virginia, British Colonial America"
  },
  "death": {
    "date": "14 December 1799",
    "place": "Mount Vernon, Fairfax County, Virginia, United States"
  },
  "facts": [
    { "type": "Christening", "date": "5 April 1732", "place": "Virginia, British Colonial America" },
    { "type": "Occupation", "date": "1749", "value": "Surveyor" },
    { "type": "Military Service", "date": "between 1752 and 1758", "place": "Virginia, British Colonial America" },
    { "type": "Burial", "date": "18 December 1799", "place": "Mount Vernon Estate, Mount Vernon, Fairfax, Virginia, United States" }
  ],
  "url": "https://www.familysearch.org/tree/person/details/KNDX-MKG"
}
```

Example (with both flags — `relatives: true, sourceDescriptions: true`):

```json
{
  "personId": "KNDX-MKG",
  "name": "President George Washington",
  "gender": "Male",
  "living": false,
  "lifespan": "1732-1799",
  "birth": {
    "date": "22 February 1732",
    "place": "Westmoreland, Virginia, British Colonial America"
  },
  "death": {
    "date": "14 December 1799",
    "place": "Mount Vernon, Fairfax County, Virginia, United States"
  },
  "facts": [
    { "type": "Christening", "date": "5 April 1732", "place": "Virginia, British Colonial America" },
    { "type": "Burial", "date": "18 December 1799", "place": "Mount Vernon Estate, Mount Vernon, Fairfax, Virginia, United States" }
  ],
  "couples": [
    {
      "spouse": {
        "personId": "KNZC-6QV",
        "name": "Martha Dandridge",
        "lifespan": "1731-1802",
        "url": "https://www.familysearch.org/tree/person/details/KNZC-6QV"
      },
      "marriageDate": "6 January 1759",
      "marriagePlace": "New Kent, Virginia, British Colonial America"
    }
  ],
  "parentsFamily": {
    "parent1": {
      "personId": "KNDX-MFX",
      "name": "Augustine Washington",
      "lifespan": "1694-1743",
      "url": "https://www.familysearch.org/tree/person/details/KNDX-MFX"
    },
    "parent2": {
      "personId": "KNDD-GXQ",
      "name": "Mary Ball",
      "lifespan": "1708-1789",
      "url": "https://www.familysearch.org/tree/person/details/KNDD-GXQ"
    },
    "children": [
      {
        "personId": "KNDX-MKG",
        "name": "President George Washington",
        "lifespan": "1732-1799",
        "relationshipToParent1": "Biological",
        "relationshipToParent2": "Biological",
        "url": "https://www.familysearch.org/tree/person/details/KNDX-MKG"
      }
    ]
  },
  "spouseFamilies": [
    {
      "parent1": {
        "personId": "KNDX-MKG",
        "name": "President George Washington",
        "lifespan": "1732-1799",
        "url": "https://www.familysearch.org/tree/person/details/KNDX-MKG"
      },
      "parent2": {
        "personId": "KNZC-6QV",
        "name": "Martha Dandridge",
        "lifespan": "1731-1802",
        "url": "https://www.familysearch.org/tree/person/details/KNZC-6QV"
      },
      "children": [
        {
          "personId": "L8S6-24S",
          "name": "John Parke Custis",
          "lifespan": "1754-1781",
          "relationshipToParent1": "Step",
          "relationshipToParent2": "Biological",
          "url": "https://www.familysearch.org/tree/person/details/L8S6-24S"
        }
      ]
    }
  ],
  "totalSources": 24,
  "sources": [
    {
      "id": "7X6N-4WR",
      "title": "George Washington, \"United States, Rosters of Revolutionary War Soldiers...\"",
      "url": "https://familysearch.org/ark:/61903/1:1:QRHS-D1T2",
      "citation": "\"United States, Rosters of Revolutionary War Soldiers...\"",
      "resourceType": "FSREADONLY",
      "contributor": "cis.wkca.MMMM-M93P"
    }
  ],
  "url": "https://www.familysearch.org/tree/person/details/KNDX-MKG"
}
```

### Action: `ancestry`

| Field | Type | Description |
|-------|------|-------------|
| `personId` | string | The root person ID |
| `generations` | number | Number of generations returned |
| `persons` | AncestorSummary[] | Ancestor list in Ahnentafel order |

`AncestorSummary`:

| Field | Type | Description |
|-------|------|-------------|
| `personId` | string | FamilySearch person ID |
| `name` | string | Full display name |
| `gender` | string | `"Male"`, `"Female"`, or `"Unknown"` |
| `lifespan` | string | Display lifespan |
| `living` | boolean | Whether marked as living |
| `ascendancyNumber` | string | Ahnentafel number as string. Standard ancestors use integers (`"1"`, `"2"`, `"3"`). Spouses use the `-S` suffix (e.g., `"1-S"` for the root person's spouse). |
| `birth` | EventSummary? | Birth date and place |
| `death` | EventSummary? | Death date and place |
| `url` | string | Link to the person on FamilySearch |

**Note on spouses in ancestry.** The API includes the root person's spouse
with ascendancy number `"1-S"`. This is not standard Ahnentafel numbering.
The tool should include spouses in the output (they're useful context) but
mark them clearly. The `-S` suffix distinguishes them from ancestors.

Example:

```json
{
  "personId": "KNDX-MKG",
  "generations": 2,
  "persons": [
    {
      "personId": "KNDX-MKG",
      "name": "President George Washington",
      "gender": "Male",
      "lifespan": "1732-1799",
      "living": false,
      "ascendancyNumber": "1",
      "birth": { "date": "22 February 1732", "place": "Westmoreland, Virginia, British Colonial America" },
      "death": { "date": "14 December 1799", "place": "Mount Vernon, Fairfax County, Virginia, United States" },
      "url": "https://www.familysearch.org/tree/person/details/KNDX-MKG"
    },
    {
      "personId": "KNZC-6QV",
      "name": "Martha Dandridge",
      "gender": "Female",
      "lifespan": "1731-1802",
      "living": false,
      "ascendancyNumber": "1-S",
      "birth": { "date": "2 June 1731" },
      "death": { "date": "22 May 1802" },
      "url": "https://www.familysearch.org/tree/person/details/KNZC-6QV"
    },
    {
      "personId": "KNDX-MFX",
      "name": "Augustine Washington",
      "gender": "Male",
      "lifespan": "1694-1743",
      "living": false,
      "ascendancyNumber": "2",
      "birth": { "date": "1694", "place": "Westmoreland, Virginia, British Colonial America" },
      "death": { "date": "12 April 1743", "place": "King George, Virginia, British Colonial America" },
      "url": "https://www.familysearch.org/tree/person/details/KNDX-MFX"
    },
    {
      "personId": "KNDD-GXQ",
      "name": "Mary Ball",
      "gender": "Female",
      "lifespan": "1708-1789",
      "living": false,
      "ascendancyNumber": "3",
      "url": "https://www.familysearch.org/tree/person/details/KNDD-GXQ"
    }
  ]
}
```

### Shared types for family and source fields

`CoupleRef`:

| Field | Type | Description |
|-------|------|-------------|
| `spouse` | PersonRef | The spouse |
| `marriageDate` | string? | Marriage date |
| `marriagePlace` | string? | Marriage place |

`FamilyGroup`:

| Field | Type | Description |
|-------|------|-------------|
| `parent1` | PersonRef? | First parent |
| `parent2` | PersonRef? | Second parent |
| `children` | ChildRef[] | Children in this family group |

`ChildRef`:

| Field | Type | Description |
|-------|------|-------------|
| `personId` | string | FamilySearch person ID |
| `name` | string | Full display name |
| `lifespan` | string | Display lifespan |
| `relationshipToParent1` | string? | Relationship type to parent1 (e.g., `"Biological"`, `"Step"`, `"Guardianship"`, `"Foster"`) |
| `relationshipToParent2` | string? | Relationship type to parent2 |
| `url` | string | Link to the person on FamilySearch |

`PersonRef`:

| Field | Type | Description |
|-------|------|-------------|
| `personId` | string | FamilySearch person ID |
| `name` | string | Full display name |
| `lifespan` | string | Display lifespan |
| `url` | string | Link to the person on FamilySearch |

`SourceSummary`:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Source description ID (e.g., `"7X6N-4WR"`) |
| `title` | string | Source title |
| `url` | string? | URL to the source — an ark URL for indexed FamilySearch records, or an external URL for user-attached sources |
| `citation` | string? | Full formatted citation string (may contain HTML). Present on indexed records, often absent on user-attached sources. |
| `notes` | string? | User-entered description of the source |
| `resourceType` | string | `"FSREADONLY"` for indexed FamilySearch records, `"DEFAULT"` for user-attached sources |
| `contributor` | string? | User agent ID of the person who attached the source |
| `created` | number? | Timestamp (ms since epoch) when the source was attached |
| `modified` | number? | Timestamp (ms since epoch) when the source was last modified |

**Note on source types.** The `resourceType` field distinguishes two kinds:

- `"FSREADONLY"` — indexed FamilySearch records. These have a `citations`
  array with a full formatted citation and an `about` URL pointing to an
  ark (e.g., `https://familysearch.org/ark:/61903/1:1:QRHS-D1T2`).
- `"DEFAULT"` — user-attached sources. These typically have a title and
  an `about` URL pointing to an external website, but no formatted
  citation. May have notes.

**Contributor prefix convention.** The `attribution.contributor.resourceId`
value encodes provenance:

- `cis.wkca.*` — FamilySearch-curated (auto-attached by the system)
- `cis.user.*` — user-attached

This can be used alongside `resourceType` to distinguish source origins.

**Note on relationship types.** The `?relatives=true` response includes
`childAndParentsRelationships` with `parent1Facts` and `parent2Facts`
arrays. These hold facts with `type` values like
`"http://gedcomx.org/BiologicalParent"`, `"http://gedcomx.org/StepParent"`,
`"http://gedcomx.org/GuardianParent"`, or `"http://gedcomx.org/FosterParent"`.
Extract the last URI segment as the human-readable label (e.g.,
`"BiologicalParent"` → `"Biological"`). When no parent facts are present,
default to `"Biological"`.

**Note on couple relationships.** Spouse and marriage data lives in the
`relationships` array at the top level of the response (when
`?relatives=true`), not in `childAndParentsRelationships`. Each couple
relationship has `type: "http://gedcomx.org/Couple"`,
`person1.resourceId`, `person2.resourceId`, and optionally `facts[]`
containing marriage events.

**Note on source descriptions metadata.** The `?sourceDescriptions=true`
response includes 3 extra metadata entries with IDs starting with `SD_`
(`SD_PERSON_*`, `SD_TREE_*`, `SD_COLLECTION_*`). Filter these out by
skipping entries where `id.startsWith("SD_")`.

---

## Tool Schema

```typescript
{
  name: "tree",
  description: "Read person data from the FamilySearch Family Tree. " +
    "Use action \"person\" (default) for details — set relatives=true to " +
    "include parents, spouses, and children, and sourceDescriptions=true " +
    "to include attached sources. Use action \"ancestry\" for an ancestor " +
    "chart. Omit personId to start from the logged-in user. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      personId: {
        type: "string",
        description: "FamilySearch person ID (e.g., \"KNDX-MKG\"). " +
          "Omit to use the current logged-in user's tree person."
      },
      action: {
        type: "string",
        enum: ["person", "ancestry"],
        description: "What to retrieve: \"person\" for details (default), " +
          "\"ancestry\" for ancestor chart."
      },
      generations: {
        type: "number",
        description: "Number of ancestor generations (1-8). " +
          "Only used with action \"ancestry\". Defaults to 4."
      },
      relatives: {
        type: "boolean",
        description: "Include parents, spouses, and children in the response. " +
          "Only used with action \"person\". Defaults to false."
      },
      sourceDescriptions: {
        type: "boolean",
        description: "Include attached source citations in the response. " +
          "Only used with action \"person\". Defaults to false."
      }
    }
  }
}
```

---

## Authentication

This tool requires a valid FamilySearch access token. It must call
`getValidToken()` from `src/auth/refresh.ts` — the single entry point for
all authenticated tools. Do not re-implement token plumbing.

If the user is not authenticated, `getValidToken()` throws an LLM-instruction
error directing the user to call the `login` tool. The tool handler should let
this error propagate (same try/catch pattern as other tools in `index.ts`).

---

## FamilySearch API Reference

### Base URL and headers

All tree endpoints use `api.familysearch.org` (not `www.familysearch.org`).
Unlike the collections API, the tree API does not require a browser-like
`User-Agent` header — there is no WAF issue on `api.familysearch.org`.

```
Authorization: Bearer <access_token>
Accept: application/x-fs-v1+json
```

**Verified:** `Accept: application/json` also returns the same response
structure, but use `application/x-fs-v1+json` to be explicit about the
v1 GEDCOMX format.

### Endpoint: Current person

```
GET https://api.familysearch.org/platform/tree/current-person
```

Returns **303 See Other** with a `Location` header pointing to the user's
tree person URL (e.g., `/platform/tree/persons/XXXX-YYY`). Extract the
person ID from the redirect URL rather than following the redirect.

### Endpoint: Person details

```
GET https://api.familysearch.org/platform/tree/persons/{pid}
GET https://api.familysearch.org/platform/tree/persons/{pid}?relatives=true
GET https://api.familysearch.org/platform/tree/persons/{pid}?sourceDescriptions=true
GET https://api.familysearch.org/platform/tree/persons/{pid}?relatives=true&sourceDescriptions=true
```

The person endpoint accepts two optional query parameters that bundle
related data into the response:

| Parameter | Effect |
|-----------|--------|
| `relatives=true` | Includes parents, spouses, and children (8 persons for George Washington) in `persons[]`, plus `childAndParentsRelationships[]` and `relationships[]` |
| `sourceDescriptions=true` | Includes attached source citations in `sourceDescriptions[]` (24 real sources + 3 `SD_*` metadata entries to filter out) |

Both can be combined in a single call.

Returns a GEDCOMX response with the person object. Key fields:

```
response.persons[0].id          — person ID
response.persons[0].living      — boolean
response.persons[0].gender.type — "http://gedcomx.org/Male" etc.
response.persons[0].display     — pre-formatted summary object
response.persons[0].facts[]     — structured life events
response.persons[0].names[]     — structured name forms
```

When `relatives=true`, additional top-level arrays are populated:

```
response.persons[]                          — focal person + family members
response.childAndParentsRelationships[]     — parent-child family groups
response.relationships[]                    — couple relationships (marriages)
```

When `sourceDescriptions=true`, source data is populated:

```
response.sourceDescriptions[]    — source citations (filter out IDs starting with "SD_")
```

**Note on `?relatives=true` vs the `/families` endpoint.** The query
parameter returns only immediate family (parents, spouse, children —
8 persons for George Washington). The dedicated `/families` endpoint
returns the entire extended family network including siblings (17
persons). Since siblings are not included in the `?relatives=true`
response, the tool does not expose them. This is an acceptable
trade-off — siblings can be discovered via ancestry or by looking up
a parent's family.

**Display object** (pre-formatted by the server):

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Full display name |
| `gender` | string | `"Male"`, `"Female"`, `"Unknown"` |
| `lifespan` | string | e.g., `"1732-1799"` |
| `birthDate` | string? | Formatted birth date |
| `birthPlace` | string? | Formatted birth place |
| `deathDate` | string? | Formatted death date |
| `deathPlace` | string? | Formatted death place |
| `ascendancyNumber` | string? | Present in ancestry responses |
| `descendancyNumber` | string? | Present in some responses |
| `familiesAsParent` | array? | Family structure refs (not used — get from families endpoint instead) |
| `familiesAsChild` | array? | Family structure refs (not used — get from families endpoint instead) |

**Facts array** — each fact object:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | GEDCOMX URI (e.g., `"http://gedcomx.org/Birth"`) or custom type (e.g., `"data:,Elected"`) |
| `date.original` | string? | Date as entered |
| `place.original` | string? | Place as entered |
| `value` | string? | Fact value — present on Occupation (job title), Religion (denomination), MilitaryService (rank/description), LifeSketch (bio text), TitleOfNobility, and custom types |
| `id` | string | Fact ID (not needed for output) |
| `attribution` | object | Who/when (not needed for output) |

Common GEDCOMX fact types: `Birth`, `Death`, `Burial`, `Christening`,
`Marriage`, `Immigration`, `Emigration`, `Residence`, `Occupation`,
`MilitaryService`, `Naturalization`, `Census`, `Will`, `Probate`,
`Religion`, `LifeSketch`, `TitleOfNobility`.

Custom fact types use the `data:,` prefix (e.g., `data:,Elected`,
`data:,Will`, `data:,Military`). See the GEDCOMX Fact Type Mapping
section for handling these.

### Endpoint: Ancestry

```
GET https://api.familysearch.org/platform/tree/ancestry?person={pid}&generations={n}&personDetails
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `person` | string | Root person ID |
| `generations` | number | 1–8 (max 8) |
| `personDetails` | flag | Include display properties and facts |

Returns a `persons` array where each person has a
`display.ascendancyNumber` field (string type) using Ahnentafel numbering:

| Number | Relationship |
|--------|-------------|
| `"1"` | Self |
| `"1-S"` | Self's spouse |
| `"2"` | Father |
| `"3"` | Mother |
| `"4"` | Paternal grandfather |
| `"5"` | Paternal grandmother |
| `"6"` | Maternal grandfather |
| `"7"` | Maternal grandmother |
| `"2n"` | Father of person n |
| `"2n+1"` | Mother of person n |

The API includes the root person's spouse with the `"-S"` suffix. This
is not standard Ahnentafel numbering — include them in the output but
preserve the string so consumers can distinguish spouses from ancestors.

The maximum number of ancestors returned is 2^(generations) - 1 plus
the root person and optionally the spouse, but most ancestries have
gaps — missing ancestors are simply absent.

### Response: `childAndParentsRelationships[]` (when `relatives=true`)

Each `childAndParentsRelationship` contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Relationship ID |
| `parent1.resourceId` | string | Person ID of first parent |
| `parent2.resourceId` | string | Person ID of second parent |
| `child.resourceId` | string | Person ID of child |
| `parent1Facts` | FSFact[]? | Relationship type facts for parent1 (e.g., `BiologicalParent`, `StepParent`, `GuardianParent`, `FosterParent`) |
| `parent2Facts` | FSFact[]? | Relationship type facts for parent2 |

### Response: `relationships[]` (when `relatives=true`)

Each couple relationship contains:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"http://gedcomx.org/Couple"` |
| `person1.resourceId` | string | First person ID |
| `person2.resourceId` | string | Second person ID |
| `facts` | FSFact[]? | Marriage facts with `date.original` and `place.original` |

The `persons` array includes display data for all referenced persons,
allowing the tool to resolve person IDs to names and lifespans without
additional API calls.

### Response: `sourceDescriptions[]` (when `sourceDescriptions=true`)

Each `sourceDescription` contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Source description ID |
| `about` | string | URL — ark URL for indexed records, external URL for user-attached |
| `titles` | `{ value: string }[]` | Source title(s) |
| `citations` | `{ value: string }[]?` | Formatted citation(s) — may contain HTML. Typically present on `FSREADONLY`, absent on `DEFAULT`. |
| `notes` | `{ value: string }[]?` | User-entered notes |
| `attribution.contributor.resourceId` | string | Who attached it |
| `attribution.created` | number | When attached (ms since epoch) |
| `attribution.modified` | number | When last modified (ms since epoch) |
| `resourceType` | string | `"FSREADONLY"` (indexed record) or `"DEFAULT"` (user-attached) |

Filter out entries where `id.startsWith("SD_")` — these are metadata
entries, not real sources.

### Special HTTP status codes

| Status | Meaning | How to handle |
|--------|---------|---------------|
| 200 | Success | Parse response |
| 204 | Living person (empty body) | Return result with `living: true` and explanation |
| 301 | Person merged into another | Read new ID from `Location` header, re-fetch |
| 303 | Redirect (current-person) | Extract person ID from `Location` header |
| 400 | Bad request (e.g., invalid generations value) | Throw descriptive error. Prevent by clamping generations client-side. |
| 401 | Token expired/invalid | Let auth error propagate |
| 403 | Restricted person | Throw: `"Person {pid} is restricted and cannot be viewed."` |
| 404 | Person not found | Return descriptive error |
| 410 | Person deleted | Return descriptive error |
| 429 | Rate limited | Throw error with retry guidance |

### Living persons

Living persons return **HTTP 204 with an empty body** — not restricted
data, but no data at all. The tool should detect the 204 status and
return a result with `living: true` and a message explaining that
FamilySearch does not expose data for living persons unless the user
has special access.

For living persons found in family groups (via the families endpoint),
the `persons` array may include them with `living: true` and a display
name, but facts and details will be absent.

---

## Resolving the current user's person ID

When `personId` is omitted:

1. Call `GET /platform/tree/current-person` with `redirect: "manual"` in
   the fetch options (do not follow the redirect automatically).
2. Read the `Location` header from the 303 response.
3. Extract the person ID from the URL path (last segment after `/persons/`).
4. Use that ID for the requested action.

If the endpoint returns a non-303 status, throw an error:
`"Could not determine your tree person. Are you logged in to FamilySearch?"`

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error |
| Invalid action value | Throw: `"Invalid action. Use \"person\" or \"ancestry\"."` |
| Generations out of range | Clamp to 1–8 silently (the API returns 400 for values like 0 or 9) |
| Person not found (404) | Throw: `"Person {pid} not found in the FamilySearch Family Tree."` |
| Person deleted (410) | Throw: `"Person {pid} has been deleted from the FamilySearch Family Tree."` |
| Person restricted (403) | Throw: `"Person {pid} is restricted and cannot be viewed."` |
| Person merged (301) | Follow the redirect to the new person ID automatically |
| Living person (204) | Return result with `living: true` and message: `"FamilySearch does not expose data for living persons."` |
| Rate limited (429) | Throw: `"FamilySearch rate limit reached. Wait a moment and try again."` |
| Non-OK status (other) | Throw: `"FamilySearch tree API error: {status}"` |
| Current-person fails | Throw: `"Could not determine your tree person. Are you logged in to FamilySearch?"` |

---

## GEDCOMX Fact Type Mapping

Map GEDCOMX type URIs to human-readable labels:

```typescript
const FACT_TYPE_LABELS: Record<string, string> = {
  "http://gedcomx.org/Birth": "Birth",
  "http://gedcomx.org/Death": "Death",
  "http://gedcomx.org/Burial": "Burial",
  "http://gedcomx.org/Christening": "Christening",
  "http://gedcomx.org/Marriage": "Marriage",
  "http://gedcomx.org/Immigration": "Immigration",
  "http://gedcomx.org/Emigration": "Emigration",
  "http://gedcomx.org/Residence": "Residence",
  "http://gedcomx.org/Occupation": "Occupation",
  "http://gedcomx.org/MilitaryService": "Military Service",
  "http://gedcomx.org/Naturalization": "Naturalization",
  "http://gedcomx.org/Census": "Census",
  "http://gedcomx.org/Will": "Will",
  "http://gedcomx.org/Probate": "Probate",
  "http://gedcomx.org/Religion": "Religion",
  "http://gedcomx.org/LifeSketch": "Life Sketch",
  "http://gedcomx.org/TitleOfNobility": "Title of Nobility",
  "http://gedcomx.org/BiologicalParent": "Biological",
  "http://gedcomx.org/StepParent": "Step",
  "http://gedcomx.org/GuardianParent": "Guardianship",
  "http://gedcomx.org/FosterParent": "Foster",
};
```

For unknown types: first check for `data:,` prefix — strip it and use the
remainder as the label (e.g., `"data:,Elected"` → `"Elected"`). Otherwise,
extract the last segment of the URI (e.g., `"http://gedcomx.org/SomethingNew"`
→ `"SomethingNew"`).

---

## GEDCOMX Simplification Layer

The tree tool must route raw FamilySearch API responses through the shared
GEDCOMX simplification functions before returning data. These functions are
defined by Pascal's simplified GEDCOMX spec (`docs/specs/simplified-gedcomx-spec.md`)
and live in a shared module that other tools can also use.

### Processing pipeline

```
FamilySearch API (full GEDCOMX)
        │
        ▼
  Simplification functions (shared module)
        │  - Strip URI prefixes: "http://gedcomx.org/Birth" → "Birth"
        │  - Flatten gender: { type: "http://gedcomx.org/Male" } → "Male"
        │  - Flatten names: nameForms[0].parts → { given, surname }
        │  - Flatten sources: titles[0].value → title, citations[0].value → citation
        │  - Simplify relationships: person1/person2 → parent/child (for ParentChild)
        │  - Simplify fact types: full URI → PascalCase label
        │
        ▼
  Tree tool output (simplified data + display fields)
```

### Which simplification rules apply

The tree tool output uses the simplified GEDCOMX conventions from
Section 2 of the simplified GEDCOMX spec:

| Full GEDCOMX (from API) | Simplified (in tool output) | Spec rule |
|-------------------------|---------------------------|-----------|
| `"http://gedcomx.org/Birth"` | `"Birth"` | URI prefixes dropped |
| `gender.type: "http://gedcomx.org/Male"` | `gender: "Male"` | Flattened to string |
| `nameForms[0].parts` with Given/Surname | `given`, `surname` on names | Nested → flat |
| `sourceDescriptions[].titles[0].value` | `title` | Flattened |
| `sourceDescriptions[].citations[0].value` | `citation` | Flattened |
| `"http://gedcomx.org/BiologicalParent"` | `"Biological"` | URI prefix + suffix stripped |
| `"http://gedcomx.org/Couple"` relationship | Couple with `person1`/`person2` | Symmetric kept |
| `date.original` | `date` (flat string) | Nested → flat |
| `place.original` | `place` (flat string) | Nested → flat |

### Display fields beyond simplified GEDCOMX

The simplified GEDCOMX format (`tree.gedcomx.json`) is designed for file
storage and round-tripping. The tree tool output extends it with display
fields that help the skill present data to the user:

| Field | Source | Not in simplified GEDCOMX |
|-------|--------|--------------------------|
| `personId` | `persons[].id` | Uses `personId` key (simplified uses `id`) |
| `name` | `display.name` | Full display name string (simplified uses `given`/`surname`) |
| `lifespan` | `display.lifespan` | Pre-formatted lifespan (e.g., `"1732-1799"`) |
| `living` | `persons[].living` | Boolean flag |
| `url` | Constructed | FamilySearch tree link |
| `ascendancyNumber` | `display.ascendancyNumber` | Ahnentafel number (ancestry only) |
| `resourceType` | `sourceDescriptions[].resourceType` | `FSREADONLY` vs `DEFAULT` |
| `contributor` | `attribution.contributor.resourceId` | Who attached the source |

The simplification functions handle the GEDCOMX data transformation. The
tree tool then arranges the simplified data into its response shape and
adds these display fields on top.

### Implementation note

The simplification functions should be a shared module (e.g.,
`src/utils/simplify-gedcomx.ts` or wherever Pascal places them) that the
tree tool imports. The tree tool should **not** duplicate the
simplification logic inline — it calls the shared functions and then adds
display metadata. This ensures consistency with other tools and with the
`tree.gedcomx.json` format.

The GEDCOMX Fact Type Mapping table above should be implemented inside
the shared simplification module, not in the tree tool itself.

---

## Files

### `mcp-server/src/types/tree.ts`

API response types matching the GEDCOMX format and output types for each
action.

**API types:**

```typescript
interface FSPersonDisplay {
  name: string;
  gender: string;
  lifespan: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  ascendancyNumber?: string;   // present in ancestry responses
  descendancyNumber?: string;  // present in some responses
  familiesAsParent?: unknown[]; // not used — get from families endpoint
  familiesAsChild?: unknown[];  // not used — get from families endpoint
}

interface FSFact {
  type: string;                // GEDCOMX URI or "data:," custom type
  date?: { original?: string };
  place?: { original?: string };
  value?: string;              // present on Occupation, Religion, MilitaryService, etc.
}

interface FSNameForm {
  fullText?: string;
  parts?: Array<{ type: string; value: string }>;
}

interface FSPerson {
  id: string;
  living?: boolean;
  gender?: { type: string };
  display?: FSPersonDisplay;
  facts?: FSFact[];
  names?: Array<{ nameForms?: FSNameForm[] }>;
}

interface FSRelationshipRef {
  resource?: string;
  resourceId: string;
}

interface FSChildAndParentsRelationship {
  id?: string;
  parent1?: FSRelationshipRef;
  parent2?: FSRelationshipRef;
  child?: FSRelationshipRef;
  parent1Facts?: FSFact[];     // relationship type facts
  parent2Facts?: FSFact[];     // relationship type facts
}

interface FSCoupleRelationship {
  id?: string;
  type: string;                // "http://gedcomx.org/Couple"
  person1: FSRelationshipRef;
  person2: FSRelationshipRef;
  facts?: FSFact[];            // marriage facts
}

interface FSSourceDescription {
  id: string;
  about?: string;
  titles?: Array<{ value: string }>;
  citations?: Array<{ value: string }>;
  notes?: Array<{ value: string }>;
  attribution?: {
    contributor?: { resourceId: string };
    creator?: { resourceId: string };
    created?: number;
    modified?: number;
  };
  resourceType?: string;
}

// Unified response — shape varies based on query parameters
interface FSPersonResponse {
  persons?: FSPerson[];
  // Present when ?relatives=true
  childAndParentsRelationships?: FSChildAndParentsRelationship[];
  relationships?: FSCoupleRelationship[];
  // Present when ?sourceDescriptions=true
  sourceDescriptions?: FSSourceDescription[];
}
```

**Output types:**

```typescript
interface EventSummary {
  date?: string;
  place?: string;
}

interface FactSummary {
  type: string;
  date?: string;
  place?: string;
  value?: string;
}

interface PersonResult {
  personId: string;
  name: string;
  gender: string;
  living: boolean;
  lifespan: string;
  birth?: EventSummary;
  death?: EventSummary;
  facts: FactSummary[];
  url: string;
  // Present when relatives=true
  couples?: CoupleRef[];
  parentsFamily?: FamilyGroup;
  spouseFamilies?: FamilyGroup[];
  // Present when sourceDescriptions=true
  totalSources?: number;
  sources?: SourceSummary[];
}

interface AncestorSummary {
  personId: string;
  name: string;
  gender: string;
  lifespan: string;
  living: boolean;
  ascendancyNumber: string;  // string because of "-S" spouse suffix
  birth?: EventSummary;
  death?: EventSummary;
  url: string;
}

interface PersonRef {
  personId: string;
  name: string;
  lifespan: string;
  url: string;
}

interface ChildRef extends PersonRef {
  relationshipToParent1?: string;
  relationshipToParent2?: string;
}

interface CoupleRef {
  spouse: PersonRef;
  marriageDate?: string;
  marriagePlace?: string;
}

interface FamilyGroup {
  parent1?: PersonRef;
  parent2?: PersonRef;
  children: ChildRef[];
}

interface SourceSummary {
  id: string;
  title: string;
  url?: string;
  citation?: string;
  notes?: string;
  resourceType: string;
  contributor?: string;
  created?: number;
  modified?: number;
}

interface AncestryResult {
  personId: string;
  generations: number;
  persons: AncestorSummary[];
}

type TreeResult = PersonResult | AncestryResult;
```

### `mcp-server/src/tools/tree.ts`

- `treeToolSchema` — MCP tool schema
- `treeTool(input)` — main function (routes by action)
- `resolvePersonId(token)` — resolves current user's person ID
- `fetchPerson(token, pid, options?)` — GET person details with optional `relatives` and `sourceDescriptions` query params
- `fetchAncestry(token, pid, generations)` — GET ancestry
- `mapPerson(fsPerson)` — runs FSPerson through simplification, then adds display fields → PersonResult
- `mapAncestor(fsPerson)` — runs FSPerson through simplification, then adds display fields → AncestorSummary
- `mapFamilyFields(data, focalPid)` — extracts couples, parentsFamily, spouseFamilies from the simplified response when `relatives=true`
- `mapSourceFields(data)` — extracts totalSources and sources from the simplified response when `sourceDescriptions=true` (filters out `SD_*` metadata)
- `buildHeaders(token)` — returns auth + accept headers

**Note:** `mapPerson` and `mapAncestor` call the shared GEDCOMX
simplification functions (from Pascal's module) for data transformation
(URI stripping, name flattening, fact type simplification, source
flattening). The tree tool does not duplicate this logic. Fact type
mapping, relationship type mapping, and other GEDCOMX conversions live
in the shared module.

### `mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools, CallTool).

---

## Testing

### `tests/tools/tree.test.ts`

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns person details for a valid person ID | Person happy path (no flags) |
| 2 | Resolves current user when personId is omitted | Current-person redirect |
| 3 | Returns ancestry with correct Ahnentafel numbers | Ancestry happy path |
| 4 | Includes spouse with "-S" suffix in ancestry | Spouse in ancestry |
| 5 | Clamps generations to 1–8 range | Input validation |
| 6 | Includes family fields when relatives=true | Relatives flag happy path |
| 7 | Includes couples with marriage date/place when relatives=true | Couple relationship parsing |
| 8 | Extracts relationship types (Biological, Step, Guardianship) | Relationship type mapping |
| 9 | Includes source fields when sourceDescriptions=true | Sources flag happy path |
| 10 | Filters out SD_* metadata from sourceDescriptions | Source metadata filtering |
| 11 | Distinguishes FSREADONLY and DEFAULT source types | Source type handling |
| 12 | Returns person + family + sources when both flags set | Combined flags |
| 13 | Does not include family/source fields when flags are false | No-flag response shape |
| 14 | Throws auth error when not authenticated | Auth propagation |
| 15 | Throws on 404 (person not found) | HTTP error handling |
| 16 | Throws on 410 (person deleted) | HTTP error handling |
| 17 | Follows 301 redirect (person merged) | Merge handling |
| 18 | Maps GEDCOMX fact types to human-readable labels | Fact type mapping |
| 19 | Maps custom data: fact types correctly | Custom fact type handling |
| 20 | Includes fact value field when present | Fact value extraction |
| 21 | Handles living persons (restricted data) | Living flag + partial data |
| 22 | Throws on invalid action | Input validation |
| 23 | Handles missing display properties gracefully | Null safety |
| 24 | Builds correct FamilySearch URLs | URL construction |
| 25 | Returns living=true with message on 204 response | Living person handling |
| 26 | Throws on 403 restricted person | Restricted person handling |
| 27 | Appends correct query params to person URL | Query param construction |

### Smoke-test script

`mcp-server/dev/try-tree.ts`:

```bash
cd mcp-server
npx tsx dev/try-tree.ts KNDX-MKG                              # Person details only
npx tsx dev/try-tree.ts KNDX-MKG --relatives                   # Person + family
npx tsx dev/try-tree.ts KNDX-MKG --sources                     # Person + sources
npx tsx dev/try-tree.ts KNDX-MKG --relatives --sources         # Person + family + sources
npx tsx dev/try-tree.ts KNDX-MKG ancestry 2                    # Ancestry (2 gens)
npx tsx dev/try-tree.ts                                        # Current user
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

- Call `tree({ personId: "KNDX-MKG" })` — returns George Washington's details only
- Call `tree({ personId: "KNDX-MKG", relatives: true })` — returns details + parents, spouse, children
- Call `tree({ personId: "KNDX-MKG", sourceDescriptions: true })` — returns details + 24 sources
- Call `tree({ personId: "KNDX-MKG", relatives: true, sourceDescriptions: true })` — returns everything
- Call `tree({ personId: "KNDX-MKG", action: "ancestry", generations: 2 })` — returns 2 generations with spouse
- Call `tree({})` — returns current user's details (requires login)
- Call `tree` without logging in first — returns auth error message

### Manual Layer 2 (Claude Code)

- "Tell me about George Washington in the FamilySearch Family Tree" — Claude
  should call `tree` with `personId: "KNDX-MKG"` and present the person details
- "Show me George Washington's ancestors" — Claude should call `tree` with
  `action: "ancestry"`
- "Who are George Washington's family members?" — Claude should call `tree`
  with `relatives: true` and show parents, spouse, children with relationship types
- "What sources are attached to George Washington in the Family Tree?" — Claude
  should call `tree` with `sourceDescriptions: true`
- "Tell me everything about George Washington" — Claude should call `tree` with
  both `relatives: true` and `sourceDescriptions: true`
- "Who is in my family tree?" — Claude should call `tree` with no personId
  (resolves current user)
