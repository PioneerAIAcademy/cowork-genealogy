# Tree Tool — Implementation Spec

## Overview

An MCP tool that reads person data from the shared FamilySearch Family Tree —
a collaborative, crowd-sourced tree with millions of contributors. It can
retrieve a person's facts, names, relationships, and ancestor chart. Requires
authentication (OAuth tokens obtained via the `login` tool).

The tool supports three actions through a single `tree` tool:

| Action | What it does |
|--------|--------------|
| `person` (default) | Get details for a single person |
| `ancestry` | Get an ancestor chart (up to 8 generations) |
| `families` | Get immediate family (parents, spouses, children) |

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
| `personId` | string | No | FamilySearch person ID (e.g., `"L6N4-4GW"`). Omit to use the current logged-in user's tree person. |
| `action` | string | No | One of `"person"`, `"ancestry"`, `"families"`. Defaults to `"person"`. |
| `generations` | number | No | Number of ancestor generations (1–8). Only used with `action: "ancestry"`. Defaults to `4`. |

Examples:

```json
{ "personId": "L6N4-4GW" }
```

```json
{ "personId": "L6N4-4GW", "action": "ancestry", "generations": 4 }
```

```json
{ "action": "families" }
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
| `facts` | FactSummary[] | Other life facts (marriage, burial, etc.) |
| `url` | string | Link to the person on FamilySearch |

`EventSummary`:

| Field | Type | Description |
|-------|------|-------------|
| `date` | string? | Formatted date string |
| `place` | string? | Formatted place string |

`FactSummary`:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Human-readable fact type (e.g., `"Marriage"`, `"Burial"`) |
| `date` | string? | Formatted date string |
| `place` | string? | Formatted place string |

Example:

```json
{
  "personId": "L6N4-4GW",
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
    "place": "Mount Vernon, Fairfax, Virginia, United States"
  },
  "facts": [],
  "url": "https://www.familysearch.org/tree/person/details/L6N4-4GW"
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
| `ascendancyNumber` | number | Ahnentafel number (1=self, 2=father, 3=mother, 4=paternal grandfather, ...) |
| `birth` | EventSummary? | Birth date and place |
| `death` | EventSummary? | Death date and place |
| `url` | string | Link to the person on FamilySearch |

Example:

```json
{
  "personId": "L6N4-4GW",
  "generations": 2,
  "persons": [
    {
      "personId": "L6N4-4GW",
      "name": "President George Washington",
      "gender": "Male",
      "lifespan": "1732-1799",
      "living": false,
      "ascendancyNumber": 1,
      "birth": { "date": "22 February 1732", "place": "Westmoreland, Virginia, British Colonial America" },
      "death": { "date": "14 December 1799", "place": "Mount Vernon, Fairfax, Virginia, United States" },
      "url": "https://www.familysearch.org/tree/person/details/L6N4-4GW"
    },
    {
      "personId": "PZRX-82F",
      "name": "Augustine Washington",
      "gender": "Male",
      "lifespan": "1694-1743",
      "living": false,
      "ascendancyNumber": 2,
      "birth": { "date": "1694", "place": "Westmoreland, Virginia, British Colonial America" },
      "death": { "date": "12 April 1743", "place": "King George, Virginia, British Colonial America" },
      "url": "https://www.familysearch.org/tree/person/details/PZRX-82F"
    }
  ]
}
```

### Action: `families`

| Field | Type | Description |
|-------|------|-------------|
| `personId` | string | The focal person ID |
| `families` | FamilySummary[] | Family groups this person belongs to |

`FamilySummary`:

| Field | Type | Description |
|-------|------|-------------|
| `parent1` | PersonRef? | First parent/spouse |
| `parent2` | PersonRef? | Second parent/spouse |
| `children` | PersonRef[] | Children in this family group |
| `relationship` | string | `"parentChild"` or `"couple"` — indicates whether the focal person is a child or parent in this group |

`PersonRef`:

| Field | Type | Description |
|-------|------|-------------|
| `personId` | string | FamilySearch person ID |
| `name` | string | Full display name |
| `lifespan` | string | Display lifespan |
| `url` | string | Link to the person on FamilySearch |

Example:

```json
{
  "personId": "L6N4-4GW",
  "families": [
    {
      "parent1": {
        "personId": "PZRX-82F",
        "name": "Augustine Washington",
        "lifespan": "1694-1743",
        "url": "https://www.familysearch.org/tree/person/details/PZRX-82F"
      },
      "parent2": {
        "personId": "LZWP-836",
        "name": "Mary Ball",
        "lifespan": "1708-1789",
        "url": "https://www.familysearch.org/tree/person/details/LZWP-836"
      },
      "children": [],
      "relationship": "parentChild"
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
    "or \"families\" for immediate family members. Omit personId to start from " +
    "the logged-in user. Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      personId: {
        type: "string",
        description: "FamilySearch person ID (e.g., \"L6N4-4GW\"). " +
          "Omit to use the current logged-in user's tree person."
      },
      action: {
        type: "string",
        enum: ["person", "ancestry", "families"],
        description: "What to retrieve: \"person\" for details (default), " +
          "\"ancestry\" for ancestor chart, \"families\" for immediate family."
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

The `Accept` header must be `application/x-fs-v1+json` to receive the v1
GEDCOMX response format.

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

**Facts array** — each fact object:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | GEDCOMX URI (e.g., `"http://gedcomx.org/Birth"`) |
| `date.original` | string? | Date as entered |
| `place.original` | string? | Place as entered |

Common fact types: `Birth`, `Death`, `Burial`, `Christening`, `Marriage`,
`Immigration`, `Emigration`, `Military`, `Occupation`, `Residence`.

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
`display.ascendancyNumber` field using Ahnentafel numbering:

| Number | Relationship |
|--------|-------------|
| 1 | Self |
| 2 | Father |
| 3 | Mother |
| 4 | Paternal grandfather |
| 5 | Paternal grandmother |
| 6 | Maternal grandfather |
| 7 | Maternal grandmother |
| 2n | Father of person n |
| 2n+1 | Mother of person n |

The maximum number of persons returned is 2^(generations+1) - 1, but
most ancestries have gaps — missing ancestors are simply absent.

### Endpoint: Families

```
GET https://api.familysearch.org/platform/tree/persons/{pid}/families
```

Returns a response with:

```
response.childAndParentsRelationships[]  — family groups
response.persons[]                       — all referenced persons
```

Each `childAndParentsRelationship` contains:

| Field | Type | Description |
|-------|------|-------------|
| `parent1.resourceId` | string | Person ID of first parent |
| `parent2.resourceId` | string | Person ID of second parent |
| `child.resourceId` | string | Person ID of child |

The `persons` array includes display data for all referenced persons,
allowing the tool to resolve person IDs to names and lifespans without
additional API calls.

### Special HTTP status codes

| Status | Meaning | How to handle |
|--------|---------|---------------|
| 200 | Success | Parse response |
| 301 | Person merged into another | Read new ID from `Location` header, re-fetch |
| 303 | Redirect (current-person) | Extract person ID from `Location` header |
| 401 | Token expired/invalid | Let auth error propagate |
| 404 | Person not found | Return descriptive error |
| 410 | Person deleted | Return descriptive error |
| 429 | Rate limited | Throw error with retry guidance |

### Living persons

Living persons return restricted data — names and some facts may be
withheld unless the user has special access. The `living` field will be
`true`. The tool should include the `living` flag in its output so the
LLM can explain any missing data to the user.

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
| Invalid action value | Throw: `"Invalid action. Use \"person\", \"ancestry\", or \"families\"."` |
| Generations out of range | Clamp to 1–8 silently |
| Person not found (404) | Throw: `"Person {pid} not found in the FamilySearch Family Tree."` |
| Person deleted (410) | Throw: `"Person {pid} has been deleted from the FamilySearch Family Tree."` |
| Person merged (301) | Follow the redirect to the new person ID automatically |
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
};
```

For unknown types, extract the last segment of the URI as the label
(e.g., `"http://gedcomx.org/SomethingNew"` → `"SomethingNew"`).

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
  ascendancyNumber?: string;  // present in ancestry responses
}

interface FSFact {
  type: string;                // GEDCOMX URI
  date?: { original?: string };
  place?: { original?: string };
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
  resourceId: string;
}

interface FSChildAndParentsRelationship {
  parent1?: FSRelationshipRef;
  parent2?: FSRelationshipRef;
  child?: FSRelationshipRef;
}

interface FSFamiliesResponse {
  childAndParentsRelationships?: FSChildAndParentsRelationship[];
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
  ascendancyNumber: number;
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

interface FamilySummary {
  parent1?: PersonRef;
  parent2?: PersonRef;
  children: PersonRef[];
  relationship: string;
}

interface AncestryResult {
  personId: string;
  generations: number;
  persons: AncestorSummary[];
}

interface FamiliesResult {
  personId: string;
  families: FamilySummary[];
}

type TreeResult = PersonResult | AncestryResult | FamiliesResult;
```

### `mcp-server/src/tools/tree.ts`

- `treeToolSchema` — MCP tool schema
- `treeTool(input)` — main function (routes by action)
- `resolvePersonId(token)` — resolves current user's person ID
- `fetchPerson(token, pid)` — GET person details
- `fetchAncestry(token, pid, generations)` — GET ancestry
- `fetchFamilies(token, pid)` — GET families
- `mapPerson(fsPerson)` — maps FSPerson → PersonResult
- `mapAncestor(fsPerson)` — maps FSPerson → AncestorSummary
- `mapFactType(uri)` — GEDCOMX URI → human-readable label
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
| 4 | Clamps generations to 1–8 range | Input validation |
| 5 | Returns families with parent and child refs | Families happy path |
| 6 | Throws auth error when not authenticated | Auth propagation |
| 7 | Throws on 404 (person not found) | HTTP error handling |
| 8 | Throws on 410 (person deleted) | HTTP error handling |
| 9 | Follows 301 redirect (person merged) | Merge handling |
| 10 | Maps GEDCOMX fact types to human-readable labels | Fact type mapping |
| 11 | Handles living persons (restricted data) | Living flag + partial data |
| 12 | Throws on invalid action | Input validation |
| 13 | Handles missing display properties gracefully | Null safety |
| 14 | Builds correct FamilySearch URLs | URL construction |

### Smoke-test script

`mcp-server/scripts/try-tree.ts`:

```bash
cd mcp-server
npx tsx scripts/try-tree.ts L6N4-4GW                    # Person details
npx tsx scripts/try-tree.ts L6N4-4GW ancestry 2          # Ancestry (2 gens)
npx tsx scripts/try-tree.ts L6N4-4GW families             # Families
npx tsx scripts/try-tree.ts                               # Current user
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

- Call `tree({ personId: "L6N4-4GW" })` — returns George Washington's details
- Call `tree({ personId: "L6N4-4GW", action: "ancestry", generations: 2 })` — returns 2 generations
- Call `tree({ personId: "L6N4-4GW", action: "families" })` — returns family groups
- Call `tree({})` — returns current user's details (requires login)
- Call `tree` without logging in first — returns auth error message

### Manual Layer 2 (Claude Code)

- "Tell me about George Washington in the FamilySearch Family Tree" — Claude
  should call `tree` with `personId: "L6N4-4GW"` and present the person details
- "Show me George Washington's ancestors" — Claude should call `tree` with
  `action: "ancestry"`
- "Who is in my family tree?" — Claude should call `tree` with no personId
  (resolves current user)
