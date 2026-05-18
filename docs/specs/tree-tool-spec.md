# Tree Tool — Implementation Spec

## Overview

An MCP tool that reads person data from the shared FamilySearch Family Tree.
It returns data in **simplified GEDCOMX format** (`persons[]`,
`relationships[]`, `sources[]`) following the conventions in
`docs/specs/simplified-gedcomx-spec.md`.

The tool accepts a FamilySearch person ID (required) and two optional boolean
flags that bundle additional data into a single API call:

| Flag | What it adds to the response |
|------|------------------------------|
| `relatives: true` | Parents, spouses, and children in `persons[]` + `relationships[]` |
| `sourceDescriptions: true` | Attached source citations in `sources[]` |

Requires authentication (OAuth tokens obtained via the `login` tool).

**v1 accepts person IDs only — not names.** Name-based person search
requires a separate tool with disambiguation (birth date, spouse, location,
etc.) and is out of scope for v1.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `personId` | string | **Yes** | FamilySearch person ID (e.g., `"KNDX-MKG"`). |
| `relatives` | boolean | No | Include parents, spouses, and children. Defaults to `false`. |
| `sourceDescriptions` | boolean | No | Include attached source citations. Defaults to `false`. |

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

---

## Output

The tool returns simplified GEDCOMX. The top-level shape is always:

```json
{
  "persons": [],
  "relationships": [],
  "sources": []
}
```

- `persons[]` is always present (at minimum, the requested person)
- `relationships[]` is present when `relatives: true` (empty array otherwise)
- `sources[]` is present when `sourceDescriptions: true` (empty array otherwise)

### `persons[]`

Each person object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | FamilySearch person ID (e.g., `"KNDX-MKG"`) |
| `gender` | string | yes | `"Male"`, `"Female"`, or `"Unknown"` |
| `living` | boolean | yes | Whether the person is marked as living |
| `names` | object[] | yes | At least one name |
| `facts` | object[] | no | Life facts (birth, death, etc.). Omitted for living persons with no data. |

**Names:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `given` | string | yes | Given name(s) (e.g., `"George"`) |
| `surname` | string | yes | Surname (e.g., `"Washington"`) |
| `prefix` | string | no | Name prefix (e.g., `"Dr."`, `"Reverend"`) |
| `suffix` | string | no | Name suffix (e.g., `"Jr."`, `"III"`, `"Esq."`) |

**Facts:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | Fact type — last segment of the GEDCOMX URI (e.g., `"Birth"`, `"Death"`, `"MilitaryService"`) |
| `date` | string | no | Date string as entered (from `date.original`) |
| `place` | string | no | Place string as entered (from `place.original`) |
| `value` | string | no | Fact value when present (e.g., job title for Occupation) |

### `relationships[]`

Present when `relatives: true`. Two types:

**ParentChild:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"ParentChild"` |
| `parent` | string | yes | Person ID of the parent |
| `child` | string | yes | Person ID of the child |
| `subtype` | string | no | `"Biological"`, `"Adoptive"`, `"Step"`, `"Foster"`, `"Guardian"`. Omit when the API does not provide this information. |

**Couple:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"Couple"` |
| `person1` | string | yes | Person ID of first partner |
| `person2` | string | yes | Person ID of second partner |
| `facts` | object[] | no | Relationship facts (e.g., marriage). Same schema as person facts. |

### `sources[]`

Present when `sourceDescriptions: true`. Each source object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Source description ID |
| `title` | string | yes | Source title |
| `citation` | string | no | Formatted citation string |
| `url` | string | no | URL to the source (ark URL or external URL) |
| `notes` | string[] | no | User-attached notes. Each entry is the text of one note. Omit when empty. |

### Example output

```json
{
  "persons": [
    {
      "id": "KNDX-MKG",
      "gender": "Male",
      "living": false,
      "names": [{ "prefix": "General", "given": "George", "surname": "Washington" }],
      "facts": [
        { "type": "Birth", "date": "22 February 1732", "place": "Westmoreland, Virginia, British Colonial America" },
        { "type": "Death", "date": "14 December 1799", "place": "Mount Vernon, Fairfax County, Virginia, United States" },
        { "type": "Burial", "date": "18 December 1799", "place": "Mount Vernon Estate, Mount Vernon, Fairfax, Virginia, United States" },
        { "type": "Occupation", "date": "1749", "value": "Surveyor" },
        { "type": "MilitaryService", "date": "between 1752 and 1758", "place": "Virginia, British Colonial America" }
      ]
    },
    {
      "id": "KNZC-6QV",
      "gender": "Female",
      "living": false,
      "names": [{ "given": "Martha", "surname": "Dandridge" }],
      "facts": [
        { "type": "Birth", "date": "2 June 1731" },
        { "type": "Death", "date": "22 May 1802" }
      ]
    },
    {
      "id": "KNDX-MFX",
      "gender": "Male",
      "living": false,
      "names": [{ "given": "Augustine", "surname": "Washington", "suffix": "Sr." }],
      "facts": [
        { "type": "Birth", "date": "1694", "place": "Westmoreland, Virginia, British Colonial America" },
        { "type": "Death", "date": "12 April 1743", "place": "King George, Virginia, British Colonial America" }
      ]
    }
  ],
  "relationships": [
    { "type": "ParentChild", "parent": "KNDX-MFX", "child": "KNDX-MKG", "subtype": "Biological" },
    {
      "type": "Couple",
      "person1": "KNDX-MKG",
      "person2": "KNZC-6QV",
      "facts": [
        { "type": "Marriage", "date": "6 January 1759", "place": "New Kent, Virginia, British Colonial America" }
      ]
    }
  ],
  "sources": [
    {
      "id": "7X6N-4WR",
      "title": "George Washington, \"United States, Rosters of Revolutionary War Soldiers and Sailors, 1775-1966\"",
      "citation": "\"United States, Rosters of Revolutionary War Soldiers and Sailors, 1775-1966\", FamilySearch ...",
      "url": "https://familysearch.org/ark:/61903/1:1:QRHS-D1T2"
    },
    {
      "id": "Q1KF-5FS",
      "title": "George Washington's Presidential Library",
      "url": "https://www.mountvernon.org/library/",
      "notes": ["See also the Mount Vernon digital collections for primary source images."]
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
    "Returns simplified GEDCOMX (persons, relationships, sources). " +
    "Set relatives=true to include parents, spouses, and children. " +
    "Set sourceDescriptions=true to include attached sources. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      personId: {
        type: "string",
        description: "FamilySearch person ID (e.g., \"KNDX-MKG\"). Required."
      },
      relatives: {
        type: "boolean",
        description: "Include parents, spouses, and children. Defaults to false."
      },
      sourceDescriptions: {
        type: "boolean",
        description: "Include attached source citations. Defaults to false."
      }
    },
    required: ["personId"]
  }
}
```

---

## Authentication

This tool requires a valid FamilySearch access token. It must call
`getValidToken()` from `src/auth/refresh.ts` — the single entry point for
all authenticated tools. Do not re-implement token plumbing.

If the user is not authenticated, `getValidToken()` throws an LLM-instruction
error directing the user to call the `login` tool. The tool function must not
swallow this error — it lets the error throw, and the MCP server in
`src/index.ts` catches it and returns the message as `isError: true`.

---

## FamilySearch API Reference

### Base URL and headers

```
Authorization: Bearer <access_token>
Accept: application/x-fs-v1+json
```

All tree endpoints use `api.familysearch.org`. No browser-like `User-Agent`
header is needed (no WAF issue on this domain).

**Note on Accept header:** Both `application/x-fs-v1+json` and
`application/x-gedcomx-v1+json` return identical responses. The FamilySearch
platform API always returns FS-extended GEDCOMX regardless of the Accept
header. Confirmed by the FamilySearch team (Todd Chapman, Erik Wilford).

### Endpoint: Person details

```
GET https://api.familysearch.org/platform/tree/persons/{pid}
GET https://api.familysearch.org/platform/tree/persons/{pid}?relatives=true
GET https://api.familysearch.org/platform/tree/persons/{pid}?sourceDescriptions=true
GET https://api.familysearch.org/platform/tree/persons/{pid}?relatives=true&sourceDescriptions=true
```

| Query Parameter | Effect |
|-----------------|--------|
| `relatives=true` | Includes family members in `persons[]`, plus `childAndParentsRelationships[]` and `relationships[]` |
| `sourceDescriptions=true` | Includes source citations in `sourceDescriptions[]` |

Both can be combined in a single call.

### Response structure (FS-extended GEDCOMX)

The API returns FS-extended GEDCOMX with these top-level arrays:

```
response.persons[]                          — person objects
response.relationships[]                    — couple relationships
response.childAndParentsRelationships[]     — parent-child family groups
response.sourceDescriptions[]               — source citations
response.places[]                           — place details (not needed)
```

Each person object contains:

```
person.id                    — FamilySearch person ID
person.living                — boolean
person.gender.type           — URI (e.g., "http://gedcomx.org/Male")
person.names[].nameForms[].parts[]  — name components with type/value
person.facts[]               — life events with type/date/place/value
person.display               — pre-formatted summary (FS extension, not used)
```

Each fact contains:

```
fact.type           — URI (e.g., "http://gedcomx.org/Birth")
fact.date.original  — date as entered
fact.place.original — place as entered
fact.value          — value (present on Occupation, Religion, etc.)
```

Each `childAndParentsRelationship` contains:

```
rel.parent1.resourceId   — person ID of first parent
rel.parent2.resourceId   — person ID of second parent
rel.child.resourceId     — person ID of child
rel.parent1Facts[]       — relationship type facts (BiologicalParent, StepParent, etc.)
rel.parent2Facts[]       — relationship type facts
```

Each couple relationship contains:

```
rel.type                 — "http://gedcomx.org/Couple"
rel.person1.resourceId   — person ID
rel.person2.resourceId   — person ID
rel.facts[]              — marriage facts with date/place
```

Each sourceDescription contains:

```
sd.id                    — source description ID
sd.about                 — URL (ark or external)
sd.titles[].value        — title strings
sd.citations[].value     — citation strings
sd.notes[].value         — user notes
sd.resourceType          — "FSREADONLY" or "DEFAULT"
sd.attribution.contributor.resourceId — who attached it
```

### Special HTTP status codes

| Status | Meaning | How to handle |
|--------|---------|---------------|
| 200 | Success | Parse and convert response |
| 204 | Living person (empty body) | Return `{ persons: [{ id, living: true, ... }], relationships: [], sources: [] }` |
| 301 | Person merged into another | Read new ID from `Location` header, re-fetch |
| 401 | Token expired/invalid | Let auth error propagate |
| 403 | Restricted person | Throw descriptive error |
| 404 | Person not found | Throw descriptive error |
| 410 | Person deleted | Throw descriptive error |
| 429 | Rate limited | Throw error with retry guidance |

---

## Conversion: FS-extended GEDCOMX → Simplified GEDCOMX

The tool converts the raw API response to simplified GEDCOMX before
returning it. **This conversion uses the shared `toSimplified`
function** from `src/utils/gedcomx-convert.ts`. Do not write a custom
converter — all tools use the shared function.

The simplified GEDCOMX schema includes `subtype` on ParentChild
relationships (Biological, Adoptive, Step, Foster, Guardian).

### Conversion rules

#### 1. Persons

For each person in `response.persons[]`:

| FS-extended field | Simplified field | Conversion |
|-------------------|-----------------|------------|
| `id` | `id` | Copy directly |
| `living` | `living` | Copy directly |
| `gender.type` | `gender` | Last segment of URI (e.g., `"Male"`) |
| `names[0].nameForms[0].parts[]` | `names[0].given`, `names[0].surname`, `names[0].prefix`, `names[0].suffix` | Extract `Given` → `given`, `Surname` → `surname`, `Prefix` → `prefix`, `Suffix` → `suffix` |
| `facts[]` | `facts[]` | See fact conversion below |

Strip: `display`, `links`, `sortKey`, `evidence`, `personInfo`,
`identifiers`, `sources`, `attribution`.

#### 2. Fact type mapping

**One rule:** take whatever follows the last `/` in the URI.

```
"http://gedcomx.org/Birth"           → "Birth"
"http://gedcomx.org/MilitaryService" → "MilitaryService"
"http://gedcomx.org/Couple"          → "Couple"
```

For `data:,` prefix types (custom facts): strip `data:,` and use the
remainder.

```
"data:,Elected" → "Elected"
```

#### 3. Facts

For each fact:

| FS-extended field | Simplified field | Conversion |
|-------------------|-----------------|------------|
| `type` | `type` | Last segment of URI (see above) |
| `date.original` | `date` | Copy string directly |
| `place.original` | `place` | Copy string directly |
| `value` | `value` | Copy when present |

Strip: `id`, `attribution`, `links`.

#### 4. Names

Extract from `names[0].nameForms[0].parts[]`:

- Find part with `type` containing `"Given"` → `given` value
- Find part with `type` containing `"Surname"` → `surname` value
- Find part with `type` containing `"Prefix"` → `prefix` value (omit if absent)
- Find part with `type` containing `"Suffix"` → `suffix` value (omit if absent)
- Ignore other part types (e.g., `Title`)

If no Given found, use `""`. If no Surname found, use `""`.

#### 5. Relationships (when `relatives: true`)

**ParentChild** — convert from `childAndParentsRelationships[]`:

For each entry, create one or two ParentChild relationships. If both
`parent1` and `parent2` exist, create **two** (one per parent).

```json
{ "type": "ParentChild", "parent": "<parent1.resourceId>", "child": "<child.resourceId>", "subtype": "Biological" }
```

Extract `subtype` from `parent1Facts[]` / `parent2Facts[]`:
the fact `type` URI's last segment, stripped of `"Parent"` suffix
(e.g., `"http://gedcomx.org/BiologicalParent"` → `"Biological"`,
`"http://gedcomx.org/StepParent"` → `"Step"`). Omit the field when
no parent facts are present for that parent.

**Keep all relationships.** Do not filter to the focal person —
include every relationship returned by the API. When `relatives: true`,
the response includes extended-family relationships; return them all.

**Couple** — convert from `relationships[]` where `type` ends with `"Couple"`:

For each entry, create:
```json
{
  "type": "Couple",
  "person1": "<person1.resourceId>",
  "person2": "<person2.resourceId>",
  "facts": [{ "type": "Marriage", "date": "...", "place": "..." }]
}
```

**Keep all couple relationships.** Do not filter to the focal person.

#### 6. Sources (when `sourceDescriptions: true`)

For each entry in `sourceDescriptions[]`:

| FS-extended field | Simplified field | Conversion |
|-------------------|-----------------|------------|
| `id` | `id` | Copy directly |
| `titles[0].value` | `title` | Flatten |
| `citations[0].value` | `citation` | Flatten (omit if absent) |
| `about` | `url` | Copy directly |
| `notes[].value` | `notes` | Collect all note values into a string array. Omit when empty. |

**Filter:** Skip entries where `id.startsWith("SD_")` — these are
metadata, not real sources.

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error |
| Person not found (404) | Throw: `"Person {pid} not found in the FamilySearch Family Tree."` |
| Person deleted (410) | Throw: `"Person {pid} has been deleted from the FamilySearch Family Tree."` |
| Person restricted (403) | Throw: `"Person {pid} is restricted and cannot be viewed."` |
| Person merged (301) | Follow the redirect to the new person ID automatically |
| Living person (204) | Return result with the person having `living: true`, no facts |
| Rate limited (429) | Throw: `"FamilySearch rate limit reached. Wait a moment and try again."` |
| Non-OK status (other) | Throw: `"FamilySearch tree API error: {status}"` |

---

## Files

### `mcp-server/src/types/tree.ts`

FS API response types (for typing the raw response) and simplified output
types.

**FS API types:**

```typescript
interface FSFact {
  type: string;
  date?: { original?: string };
  place?: { original?: string };
  value?: string;
}

interface FSNamePart {
  type: string;
  value: string;
}

interface FSNameForm {
  fullText?: string;
  parts?: FSNamePart[];
}

interface FSPerson {
  id: string;
  living?: boolean;
  gender?: { type: string };
  names?: Array<{ nameForms?: FSNameForm[] }>;
  facts?: FSFact[];
  display?: Record<string, unknown>;
}

interface FSRelationshipRef {
  resource?: string;
  resourceId: string;
}

interface FSChildAndParentsRelationship {
  parent1?: FSRelationshipRef;
  parent2?: FSRelationshipRef;
  child?: FSRelationshipRef;
  parent1Facts?: FSFact[];
  parent2Facts?: FSFact[];
}

interface FSCoupleRelationship {
  type: string;
  person1: FSRelationshipRef;
  person2: FSRelationshipRef;
  facts?: FSFact[];
}

interface FSSourceDescription {
  id: string;
  about?: string;
  titles?: Array<{ value: string }>;
  citations?: Array<{ value: string }>;
  notes?: Array<{ value: string }>;
  resourceType?: string;
}

interface FSTreeResponse {
  persons?: FSPerson[];
  relationships?: FSCoupleRelationship[];
  childAndParentsRelationships?: FSChildAndParentsRelationship[];
  sourceDescriptions?: FSSourceDescription[];
}
```

**Simplified output types:**

```typescript
interface SimplifiedName {
  given: string;
  surname: string;
  prefix?: string;
  suffix?: string;
}

interface SimplifiedFact {
  type: string;
  date?: string;
  place?: string;
  value?: string;
}

interface SimplifiedPerson {
  id: string;
  gender: string;
  living: boolean;
  names: SimplifiedName[];
  facts?: SimplifiedFact[];
}

interface SimplifiedRelationship {
  type: "ParentChild" | "Couple";
  parent?: string;           // ParentChild only
  child?: string;            // ParentChild only
  subtype?: string; // ParentChild only: "Biological", "Adoptive", "Step", "Foster", "Guardian"
  person1?: string;          // Couple only
  person2?: string;          // Couple only
  facts?: SimplifiedFact[];  // Couple only
}

interface SimplifiedSource {
  id: string;
  title: string;
  citation?: string;
  url?: string;
  notes?: string[];
}

interface TreeResult {
  persons: SimplifiedPerson[];
  relationships: SimplifiedRelationship[];
  sources: SimplifiedSource[];
}
```

### Conversion function (shared)

The tree tool does **not** ship its own conversion logic. It imports
the shared `toSimplified` function from `src/utils/gedcomx-convert.ts`
to convert the FS-extended GEDCOMX response to simplified GEDCOMX.

The conversion rules documented above describe the behavior of
`toSimplified` as it applies to tree tool data. Fields `toSimplified`
does not surface (e.g., `living`, `notes`, couple `fact.value`) are
filled by post-processing the converter output against the raw
response. FS couple refs arrive as `resourceId`-only; the tool
normalizes them to `resource` refs before conversion so participants
are not dropped.

### `mcp-server/src/tools/tree.ts`

- `treeToolSchema` — MCP tool schema
- `treeTool(input: TreeToolInput): Promise<TreeResult>` — main function
- `fetchPerson(token, pid, options)` — GET with query params, handles status codes
- `buildHeaders(token)` — returns auth + accept headers

### `mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools, CallTool).

---

## Testing

### `tests/tools/tree.test.ts`

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns simplified person for valid ID | Person happy path |
| 2 | Includes relatives in persons[] and relationships[] when flag set | Relatives flag |
| 3 | Includes sources[] when flag set | Sources flag |
| 4 | Returns both when both flags set | Combined flags |
| 5 | Returns empty relationships/sources when flags are false | No-flag shape |
| 6 | Strips URI prefixes from fact types (Birth, Death, etc.) | Fact type extraction |
| 7 | Handles data: prefix custom fact types | Custom fact types |
| 8 | Extracts given/surname from name parts | Name extraction |
| 9 | Handles missing given or surname gracefully | Name edge case |
| 10 | Filters SD_* metadata from sources | Source filtering |
| 11 | Flattens source title/citation/url correctly | Source mapping |
| 12 | Converts childAndParentsRelationships to ParentChild | Relationship conversion |
| 13 | Converts couple relationships with marriage facts | Couple conversion |
| 14 | Keeps all relationships (no focal-person filtering) | Relationship scope |
| 15 | Extracts subtype from parent facts (Biological, Step, etc.) | Relationship type |
| 16 | Omits subtype when parent facts are absent | Relationship type edge case |
| 17 | Extracts prefix and suffix from name parts | Name prefix/suffix |
| 18 | Includes notes on sources when present | Source notes |
| 19 | Throws auth error when not authenticated | Auth propagation |
| 20 | Throws on 404 (person not found) | Error handling |
| 21 | Throws on 410 (person deleted) | Error handling |
| 22 | Throws on 403 (restricted person) | Error handling |
| 23 | Follows 301 redirect (person merged) | Merge handling |
| 24 | Returns living=true on 204 response | Living person |

### Smoke-test script

`mcp-server/dev/try-tree.ts`:

```bash
cd mcp-server
npx tsx dev/try-tree.ts KNDX-MKG                         # Person only
npx tsx dev/try-tree.ts KNDX-MKG --relatives              # Person + family
npx tsx dev/try-tree.ts KNDX-MKG --sources                # Person + sources
npx tsx dev/try-tree.ts KNDX-MKG --relatives --sources    # Everything
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

- Call `tree({ personId: "KNDX-MKG" })` — returns simplified person
- Call `tree({ personId: "KNDX-MKG", relatives: true })` — returns person + family
- Call `tree({ personId: "KNDX-MKG", sourceDescriptions: true })` — returns person + sources
- Call `tree({ personId: "KNDX-MKG", relatives: true, sourceDescriptions: true })` — returns all
- Call `tree` without logging in — returns auth error

### Manual Layer 2 (Claude Code)

**Note:** Claude does not know FamilySearch person IDs. The user must
provide a person ID or a FamilySearch URL (from which Claude extracts
the ID).

- "Look up KNDX-MKG in the Family Tree" — Claude calls `tree` with the ID
- "Here is my ancestor: https://www.familysearch.org/tree/person/details/KNDX-MKG" —
  Claude extracts the ID from the URL
- "Who are his family members?" — Claude calls `tree` with `relatives: true`
- "What sources are attached?" — Claude calls with `sourceDescriptions: true`
