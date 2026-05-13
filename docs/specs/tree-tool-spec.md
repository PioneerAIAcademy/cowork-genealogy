# Tree Tool — Implementation Spec

## Overview

An MCP tool that reads person data from the shared FamilySearch Family Tree —
a collaborative, crowd-sourced tree with millions of contributors. It can
retrieve a person's facts, names, relationships, ancestor chart, and attached
sources. Requires authentication (OAuth tokens obtained via the `login` tool).

The tool supports four actions through a single `tree` tool:

| Action | What it does |
|--------|--------------|
| `person` (default) | Get details for a single person |
| `ancestry` | Get an ancestor chart (up to 8 generations) |
| `families` | Get immediate family (parents, spouses, children) with relationship types |
| `sources` | Get source citations attached to a person |

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
| `action` | string | No | One of `"person"`, `"ancestry"`, `"families"`, `"sources"`. Defaults to `"person"`. |
| `generations` | number | No | Number of ancestor generations (1–8). Only used with `action: "ancestry"`. Defaults to `4`. |

Examples:

```json
{ "personId": "KNDX-MKG" }
```

```json
{ "personId": "KNDX-MKG", "action": "ancestry", "generations": 4 }
```

```json
{ "action": "families" }
```

```json
{ "personId": "KNDX-MKG", "action": "sources" }
```

---

## Output

### Action: `person`

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

Example:

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

### Action: `families`

| Field | Type | Description |
|-------|------|-------------|
| `personId` | string | The focal person ID |
| `couples` | CoupleRef[] | Couple relationships the focal person is in (spouse info + marriage) |
| `parentsFamily` | FamilyGroup? | The focal person's parents and siblings |
| `spouseFamilies` | FamilyGroup[] | Families where the focal person is a parent (one per spouse) |

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

**Note on the families endpoint response.** The raw API returns the entire
extended family network (49 relationships for George Washington — including
grandchildren, step-children's families, half-siblings' parents). The tool
must filter this to only immediate family: the focal person's parents +
siblings, and the focal person's spouse(s) + children. Use the
`display.familiesAsParent` and `display.familiesAsChild` arrays from the
person endpoint (or filter `childAndParentsRelationships` to those where
the focal person is a parent or child) to identify relevant relationships.

**Note on couple relationships.** Spouse and marriage data lives in the
`relationships` array at the top level of the families response, not in
`childAndParentsRelationships`. Each couple relationship has
`type: "http://gedcomx.org/Couple"`, `person1.resourceId`,
`person2.resourceId`, and optionally `facts[]` containing marriage events.

**Note on relationship types.** Each `childAndParentsRelationship` may
contain `parent1Facts` and `parent2Facts` arrays. These hold facts with
`type` values like `"http://gedcomx.org/BiologicalParent"`,
`"http://gedcomx.org/StepParent"`, `"http://gedcomx.org/GuardianParent"`,
or `"http://gedcomx.org/FosterParent"`. Extract the last URI segment as
the human-readable label (e.g., `"BiologicalParent"` → `"Biological"`).
When no parent facts are present, default to `"Biological"`.

Example:

```json
{
  "personId": "KNDX-MKG",
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
      },
      {
        "personId": "LH6W-DZ7",
        "name": "Betty Washington",
        "lifespan": "1733-1797",
        "relationshipToParent1": "Biological",
        "relationshipToParent2": "Biological",
        "url": "https://www.familysearch.org/tree/person/details/LH6W-DZ7"
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
        },
        {
          "personId": "L84W-SFK",
          "name": "Eleanor Parke Custis",
          "lifespan": "1779-1852",
          "relationshipToParent1": "Guardianship",
          "relationshipToParent2": "Guardianship",
          "url": "https://www.familysearch.org/tree/person/details/L84W-SFK"
        }
      ]
    }
  ]
}
```

### Action: `sources`

| Field | Type | Description |
|-------|------|-------------|
| `personId` | string | The person ID |
| `totalSources` | number | Total number of sources attached |
| `sources` | SourceSummary[] | Source citations |

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

Example:

```json
{
  "personId": "KNDX-MKG",
  "totalSources": 24,
  "sources": [
    {
      "id": "7X6N-4WR",
      "title": "George Washington, \"United States, Rosters of Revolutionary War Soldiers and Sailors, 1775-1966\"",
      "url": "https://familysearch.org/ark:/61903/1:1:QRHS-D1T2",
      "citation": "\"United States, Rosters of Revolutionary War Soldiers and Sailors, 1775-1966\", FamilySearch ...",
      "resourceType": "FSREADONLY",
      "contributor": "cis.wkca.MMMM-M93P",
      "created": 1741462797516,
      "modified": 1741462797516
    },
    {
      "id": "Q1KF-5FS",
      "title": "George Washington's Presidential Library",
      "url": "https://www.mountvernon.org/library/",
      "resourceType": "DEFAULT",
      "contributor": "cis.wkca.MMMM-M93P",
      "created": 1719241836993,
      "modified": 1719241836993
    }
  ]
}
```

---

## Tool Schema

```typescript
{
  name: "tree",
  description: "Read person data from the FamilySearch Family Tree. " +
    "Use action \"person\" (default) for details, \"ancestry\" for an ancestor chart, " +
    "\"families\" for immediate family members (parents, spouses, children with " +
    "relationship types), or \"sources\" for attached source citations. " +
    "Omit personId to start from the logged-in user. " +
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
        enum: ["person", "ancestry", "families", "sources"],
        description: "What to retrieve: \"person\" for details (default), " +
          "\"ancestry\" for ancestor chart, \"families\" for immediate family, " +
          "\"sources\" for attached source citations."
      },
      generations: {
        type: "number",
        description: "Number of ancestor generations (1-8). " +
          "Only used with action \"ancestry\". Defaults to 4."
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
```

Returns a GEDCOMX response with the person object. Key fields:

```
response.persons[0].id          — person ID
response.persons[0].living      — boolean
response.persons[0].gender.type — "http://gedcomx.org/Male" etc.
response.persons[0].display     — pre-formatted summary object
response.persons[0].facts[]     — structured life events
response.persons[0].names[]     — structured name forms
```

The response also includes top-level `relationships`, `sourceDescriptions`,
`places`, and `childAndParentsRelationships` arrays, but the `person`
action only needs the `persons` array.

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

### Endpoint: Families

```
GET https://api.familysearch.org/platform/tree/persons/{pid}/families
```

Returns a response with:

```
response.childAndParentsRelationships[]  — parent-child family groups
response.relationships[]                 — couple relationships (marriages)
response.persons[]                       — all referenced persons
response.sourceDescriptions[]            — source refs (not needed)
response.places[]                        — place details (not needed)
```

**Warning:** The families endpoint returns the **entire extended family
network**, not just immediate family. For George Washington, this is
49 `childAndParentsRelationships` including grandchildren's families,
step-children's families, and half-siblings' parents. The tool must
filter to only relationships where the focal person is directly a
parent or child.

Each `childAndParentsRelationship` contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Relationship ID |
| `parent1.resourceId` | string | Person ID of first parent |
| `parent2.resourceId` | string | Person ID of second parent |
| `child.resourceId` | string | Person ID of child |
| `parent1Facts` | FSFact[]? | Relationship type facts for parent1 (e.g., `BiologicalParent`, `StepParent`, `GuardianParent`, `FosterParent`) |
| `parent2Facts` | FSFact[]? | Relationship type facts for parent2 |

Each entry in `relationships` (couple relationship) contains:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"http://gedcomx.org/Couple"` |
| `person1.resourceId` | string | First person ID |
| `person2.resourceId` | string | Second person ID |
| `facts` | FSFact[]? | Marriage facts with `date.original` and `place.original` |

The `persons` array includes display data for all referenced persons,
allowing the tool to resolve person IDs to names and lifespans without
additional API calls.

### Endpoint: Sources

```
GET https://api.familysearch.org/platform/tree/persons/{pid}/sources
```

**Note:** This is the only correct sources endpoint. Both
`/source-references` and `/source-descriptions` return 404.

**No pagination.** The endpoint ignores `count`, `start`, and `offset`
parameters — all sources are returned in a single response.

Returns:

```
response.sourceDescriptions[]  — source citation objects
response.persons[]             — the person (single entry)
```

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
| Invalid action value | Throw: `"Invalid action. Use \"person\", \"ancestry\", \"families\", or \"sources\"."` |
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

interface FSPersonResponse {
  persons?: FSPerson[];
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

interface FSFamiliesResponse {
  childAndParentsRelationships?: FSChildAndParentsRelationship[];
  relationships?: FSCoupleRelationship[];
  persons?: FSPerson[];
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

interface FSSourcesResponse {
  sourceDescriptions?: FSSourceDescription[];
  persons?: FSPerson[];
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

interface FamiliesResult {
  personId: string;
  couples: CoupleRef[];
  parentsFamily?: FamilyGroup;
  spouseFamilies: FamilyGroup[];
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

interface SourcesResult {
  personId: string;
  totalSources: number;
  sources: SourceSummary[];
}

interface AncestryResult {
  personId: string;
  generations: number;
  persons: AncestorSummary[];
}

type TreeResult = PersonResult | AncestryResult | FamiliesResult | SourcesResult;
```

### `mcp-server/src/tools/tree.ts`

- `treeToolSchema` — MCP tool schema
- `treeTool(input)` — main function (routes by action)
- `resolvePersonId(token)` — resolves current user's person ID
- `fetchPerson(token, pid)` — GET person details
- `fetchAncestry(token, pid, generations)` — GET ancestry
- `fetchFamilies(token, pid)` — GET families
- `fetchSources(token, pid)` — GET sources
- `mapPerson(fsPerson)` — maps FSPerson → PersonResult
- `mapAncestor(fsPerson)` — maps FSPerson → AncestorSummary
- `mapFamilies(data, focalPid)` — maps FSFamiliesResponse → FamiliesResult (filters to immediate family)
- `mapSources(data)` — maps FSSourcesResponse → SourcesResult
- `mapFactType(uri)` — GEDCOMX URI → human-readable label
- `mapRelationshipType(facts)` — parent facts → human-readable relationship type
- `buildHeaders(token)` — returns auth + accept headers

### `mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools, CallTool).

---

## Testing

### `tests/tools/tree.test.ts`

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns person details for a valid person ID | Person happy path |
| 2 | Resolves current user when personId is omitted | Current-person redirect |
| 3 | Returns ancestry with correct Ahnentafel numbers | Ancestry happy path |
| 4 | Includes spouse with "-S" suffix in ancestry | Spouse in ancestry |
| 5 | Clamps generations to 1–8 range | Input validation |
| 6 | Returns families with parent, child, and spouse refs | Families happy path |
| 7 | Filters families to immediate family only | Families filtering |
| 8 | Extracts relationship types (Biological, Step, Guardianship) | Relationship type mapping |
| 9 | Extracts marriage date and place from couple relationships | Couple relationship parsing |
| 10 | Returns sources with titles, citations, and URLs | Sources happy path |
| 11 | Distinguishes FSREADONLY and DEFAULT source types | Source type handling |
| 12 | Throws auth error when not authenticated | Auth propagation |
| 13 | Throws on 404 (person not found) | HTTP error handling |
| 14 | Throws on 410 (person deleted) | HTTP error handling |
| 15 | Follows 301 redirect (person merged) | Merge handling |
| 16 | Maps GEDCOMX fact types to human-readable labels | Fact type mapping |
| 17 | Maps custom data: fact types correctly | Custom fact type handling |
| 18 | Includes fact value field when present | Fact value extraction |
| 19 | Handles living persons (restricted data) | Living flag + partial data |
| 20 | Throws on invalid action | Input validation |
| 21 | Handles missing display properties gracefully | Null safety |
| 22 | Builds correct FamilySearch URLs | URL construction |
| 23 | Returns living=true with message on 204 response | Living person handling |
| 24 | Throws on 403 restricted person | Restricted person handling |
| 25 | Handles multi-spouse families (Augustine Washington) | Multi-spouse edge case |

### Smoke-test script

`mcp-server/dev/try-tree.ts`:

```bash
cd mcp-server
npx tsx dev/try-tree.ts KNDX-MKG                    # Person details
npx tsx dev/try-tree.ts KNDX-MKG ancestry 2          # Ancestry (2 gens)
npx tsx dev/try-tree.ts KNDX-MKG families             # Families
npx tsx dev/try-tree.ts KNDX-MKG sources              # Sources
npx tsx dev/try-tree.ts                               # Current user
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

- Call `tree({ personId: "KNDX-MKG" })` — returns George Washington's details
- Call `tree({ personId: "KNDX-MKG", action: "ancestry", generations: 2 })` — returns 2 generations with spouse
- Call `tree({ personId: "KNDX-MKG", action: "families" })` — returns family groups with relationship types
- Call `tree({ personId: "KNDX-MKG", action: "sources" })` — returns 24 sources
- Call `tree({})` — returns current user's details (requires login)
- Call `tree` without logging in first — returns auth error message

### Manual Layer 2 (Claude Code)

- "Tell me about George Washington in the FamilySearch Family Tree" — Claude
  should call `tree` with `personId: "KNDX-MKG"` and present the person details
- "Show me George Washington's ancestors" — Claude should call `tree` with
  `action: "ancestry"`
- "Who are George Washington's family members?" — Claude should call `tree`
  with `action: "families"` and show parents, spouse, children with relationship types
- "What sources are attached to George Washington in the Family Tree?" — Claude
  should call `tree` with `action: "sources"`
- "Who is in my family tree?" — Claude should call `tree` with no personId
  (resolves current user)
