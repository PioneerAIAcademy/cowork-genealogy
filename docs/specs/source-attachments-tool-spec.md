# source_attachments Tool — Implementation Spec

## Overview

An MCP tool that checks whether sources from search results are already
attached to persons in the FamilySearch Family Tree.

Given a list of source ARKs (canonical `ark:/61903/...` form), the tool
calls the FamilySearch attachments API and returns a map showing which
sources are attached to which tree person IDs (PIDs), along with tags
indicating what information each source contains (Name, Birth, Death, etc.).

A source ARK may be **either**:

- a **record persona** ARK (contains `1:1:`) — the `recordId` field of
  `record_search` results, or
- a **document image** ARK (contains `3:1:` or `3:2:`) — the `id` field of
  `fulltext_search` results.

Both id spaces are accepted in the same `uris` list; the caller does not
need to segregate them. This is why the tool is named `source_attachments`
rather than `record_attachments` — `fulltext_search` returns image ids
(`3:1:`/`3:2:`), not record ids, so "record" would be a misnomer.

Inputs are canonical ARKs; full resolver URLs are also accepted (the tool
expands ARKs to resolver URLs internally for the API call). Output keys
mirror the exact strings the caller passed in.

Requires authentication (OAuth tokens obtained via the `login` tool).

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uris` | string[] | **Yes** | List of source ARKs (canonical `ark:/61903/...`) — record personas (`1:1:`) and/or document images (`3:1:`/`3:2:`). Full resolver URLs are also accepted. |

Example (mixing a record persona and a document image in one call):

```json
{
  "uris": [
    "ark:/61903/1:1:QK2S-4W7G",
    "ark:/61903/1:1:QKRB-19LK",
    "ark:/61903/3:1:3Q9M-CSNL-S98H-M"
  ]
}
```

The ARKs come from the `recordId` field of `record_search` results
(`1:1:` record personas) or from the `id` field of `fulltext_search`
results (`3:1:`/`3:2:` document images).

---

## Output

```json
{
  "attachments": {
    "ark:/61903/1:1:QK2S-4W7G": [
      {
        "personId": "LTMX-5TM",
        "tags": ["Burial", "Death", "Gender", "Birth", "Name"]
      }
    ]
  },
  "unattached": [
    "ark:/61903/1:1:QKRB-19LK",
    "ark:/61903/1:1:QK55-GBVN"
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `attachments` | object | Map of source ARK → array of attached tree persons, keyed by the exact strings the caller passed in `uris`. Only ARKs with at least one attachment appear here. |
| `attachments[].personId` | string | Tree person ID (PID) the record is attached to. |
| `attachments[].tags` | string[] | What information the record contains (e.g., `"Name"`, `"Birth"`, `"Death"`, `"Burial"`, `"Gender"`). |
| `unattached` | string[] | Input URIs that had no attachments (echoed in the form the caller passed). |

---

## Tool Schema

```typescript
{
  name: "source_attachments",
  description:
    "Check whether sources from search results are already attached to " +
    "persons in the FamilySearch Family Tree. Pass a list of source ARKs — " +
    "either record personas (1:1:) from record_search results, or document " +
    "images (3:1: / 3:2:) from fulltext_search results — and get back which " +
    "tree person IDs each source is attached to, plus tags indicating what " +
    "information the source contains. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      uris: {
        type: "array",
        items: { type: "string" },
        description:
          "List of source ARKs to check, in canonical form " +
          "(e.g. 'ark:/61903/1:1:QK2S-4W7G'). Each may be a record-persona " +
          "ARK (contains '1:1:', the `recordId` from record_search results) " +
          "or a document-image ARK (contains '3:1:' or '3:2:', from " +
          "fulltext_search results). Full resolver URLs are also accepted."
      }
    },
    required: ["uris"]
  }
}
```

---

## Authentication

This tool requires a valid FamilySearch access token. It must call
`getValidToken()` from `src/auth/refresh.ts` — the single entry point for
all authenticated tools. Do not re-implement token plumbing.

If the user is not authenticated, `getValidToken()` throws an
LLM-instruction error directing the user to call the `login` tool. The
tool function must not swallow this error.

---

## FamilySearch API Reference

### Endpoint

```
POST https://www.familysearch.org/service/tree/links/sources/attachments
```

### Headers

```
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: application/json
User-Agent: <BROWSER_USER_AGENT>
```

This endpoint is on `www.familysearch.org` (not `api.familysearch.org`),
so it requires the browser-like `User-Agent` header to avoid WAF blocks.

### Request body

```json
{
  "uris": [
    "https://www.familysearch.org/ark:/61903/1:1:QK2S-4W7G",
    "https://www.familysearch.org/ark:/61903/1:1:QKRB-19LK"
  ]
}
```

### Response body

```json
{
  "attachedSourcesMap": {
    "https://www.familysearch.org/ark:/61903/1:1:QK2S-4W7G": [
      {
        "persons": [
          {
            "contributorId": "9MZN-R9X",
            "entityId": "LTMX-5TM",
            "modified": 1507265324589,
            "tags": ["Burial", "Death", "Gender", "Birth", "Name"],
            "tfEntityRefId": "dd9d8fc1-206b-4d39-9d0d-9fe9cb096ba9"
          }
        ],
        "sourceId": "9GC6-PS5"
      }
    ]
  }
}
```

**Response fields:**

- `attachedSourcesMap` — map of input ARK URLs to attachment entries
- Each entry has a `persons` array of attached tree persons
- Each person has:
  - `entityId` — the tree person ID (PID). **This is the key output.**
  - `tags` — what information the record contains
  - `contributorId` — who attached it (not returned to the agent)
  - `modified` — when it was attached (not returned to the agent)
  - `tfEntityRefId` — internal reference (not returned to the agent)
- `sourceId` — FamilySearch internal source ID (not returned to the agent)

ARKs with no attachments either do not appear in the map or map to an
empty array.

---

## Conversion: API Response → Tool Output

For each input URI:

1. Look it up in `attachedSourcesMap`.
2. If present and has entries with persons, flatten all persons across
   all entries into a single array of `{ personId, tags }`.
3. If absent or has no persons, add to the `unattached` list.

Only `entityId` (as `personId`) and `tags` are kept. All other fields
(`contributorId`, `modified`, `tfEntityRefId`, `sourceId`) are stripped.

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error |
| Empty `uris` array | Throw: `"uris array must not be empty."` |
| 401 Unauthorized | Throw: `"FamilySearch session not accepted; call the login tool to re-authenticate."` |
| 403 Forbidden (WAF) | Throw: `"FamilySearch attachments blocked by WAF. The User-Agent header was rejected."` |
| Other non-OK status | Throw: `"FamilySearch attachments API error: {status} {statusText}."` |

---

## Files

### `packages/engine/mcp-server/src/types/source-attachments.ts`

```typescript
export interface SourceAttachmentsInput {
  uris: string[];
}

export interface AttachedPersonRaw {
  contributorId: string;
  entityId: string;
  modified: number;
  tags: string[];
  tfEntityRefId: string;
}

export interface AttachmentEntryRaw {
  persons: AttachedPersonRaw[];
  sourceId: string;
}

export interface SourceAttachmentsApiResponse {
  attachedSourcesMap: Record<string, AttachmentEntryRaw[]>;
}

export interface AttachedPerson {
  personId: string;
  tags: string[];
}

export interface SourceAttachmentsResult {
  attachments: Record<string, AttachedPerson[]>;
  unattached: string[];
}
```

### `packages/engine/mcp-server/src/tools/source-attachments.ts`

- `sourceAttachmentsSchema` — MCP tool schema
- `sourceAttachmentsTool(input: SourceAttachmentsInput): Promise<SourceAttachmentsResult>` — main function

### `packages/engine/mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools, CallTool).

---

## Smoke-test script

`packages/engine/mcp-server/dev/try-source-attachments.ts`:

```bash
cd packages/engine/mcp-server
npx tsx dev/try-source-attachments.ts "ark:/61903/1:1:QK2S-4W7G" "ark:/61903/1:1:QKRB-19LK"
```

Accepts one or more ARKs (or resolver URLs) as command-line arguments.

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

- Call `source_attachments` with known attached ARKs — returns personId + tags
- Call `source_attachments` with unknown ARKs — returns them in `unattached`
- Call `source_attachments` without logging in — returns auth error

### Manual Layer 2 (Claude Code)

- Run a `record_search` first, then ask: "Are any of these records already
  attached to tree persons?" — Claude collects the `recordId` values and
  calls `source_attachments`.
