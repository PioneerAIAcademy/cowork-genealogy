# record_attachments Tool — Implementation Spec

## Overview

An MCP tool that checks whether historical record personas from search
results are already attached to persons in the FamilySearch Family Tree.

Given a list of record persona ARK URLs (from `record_search` or
`fulltext_search` results), the tool calls the FamilySearch attachments
API and returns a map showing which records are attached to which tree
person IDs (PIDs), along with tags indicating what information each
record contains (Name, Birth, Death, etc.).

Requires authentication (OAuth tokens obtained via the `login` tool).

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uris` | string[] | **Yes** | List of historical record persona ARK URLs. |

Example:

```json
{
  "uris": [
    "https://www.familysearch.org/ark:/61903/1:1:QK2S-4W7G",
    "https://www.familysearch.org/ark:/61903/1:1:QKRB-19LK",
    "https://www.familysearch.org/ark:/61903/1:1:QK55-GBVN"
  ]
}
```

The ARK URLs come from the `arkUrl` field of `record_search` results or
from `fulltext_search` result links.

---

## Output

```json
{
  "attachments": {
    "https://www.familysearch.org/ark:/61903/1:1:QK2S-4W7G": [
      {
        "personId": "LTMX-5TM",
        "tags": ["Burial", "Death", "Gender", "Birth", "Name"]
      }
    ]
  },
  "unattached": [
    "https://www.familysearch.org/ark:/61903/1:1:QKRB-19LK",
    "https://www.familysearch.org/ark:/61903/1:1:QK55-GBVN"
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `attachments` | object | Map of ARK URL → array of attached tree persons. Only ARKs with at least one attachment appear here. |
| `attachments[].personId` | string | Tree person ID (PID) the record is attached to. |
| `attachments[].tags` | string[] | What information the record contains (e.g., `"Name"`, `"Birth"`, `"Death"`, `"Burial"`, `"Gender"`). |
| `unattached` | string[] | Input URIs that had no attachments. |

---

## Tool Schema

```typescript
{
  name: "record_attachments",
  description:
    "Check whether historical records from search results are already " +
    "attached to persons in the FamilySearch Family Tree. Pass a list of " +
    "record persona ARK URLs (the arkUrl field from record_search results) " +
    "and get back which tree person IDs each record is attached to, plus " +
    "tags indicating what information the record contains. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      uris: {
        type: "array",
        items: { type: "string" },
        description:
          "List of historical record persona ARK URLs to check. " +
          "These come from the arkUrl field of record_search results."
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

### `mcp-server/src/types/record-attachments.ts`

```typescript
export interface RecordAttachmentsInput {
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

export interface RecordAttachmentsApiResponse {
  attachedSourcesMap: Record<string, AttachmentEntryRaw[]>;
}

export interface AttachedPerson {
  personId: string;
  tags: string[];
}

export interface RecordAttachmentsResult {
  attachments: Record<string, AttachedPerson[]>;
  unattached: string[];
}
```

### `mcp-server/src/tools/record-attachments.ts`

- `recordAttachmentsSchema` — MCP tool schema
- `recordAttachmentsTool(input: RecordAttachmentsInput): Promise<RecordAttachmentsResult>` — main function

### `mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools, CallTool).

---

## Smoke-test script

`mcp-server/dev/try-record-attachments.ts`:

```bash
cd mcp-server
npx tsx dev/try-record-attachments.ts "https://www.familysearch.org/ark:/61903/1:1:QK2S-4W7G" "https://www.familysearch.org/ark:/61903/1:1:QKRB-19LK"
```

Accepts one or more ARK URLs as command-line arguments.

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

- Call `record_attachments` with known attached ARKs — returns personId + tags
- Call `record_attachments` with unknown ARKs — returns them in `unattached`
- Call `record_attachments` without logging in — returns auth error

### Manual Layer 2 (Claude Code)

- Run a `record_search` first, then ask: "Are any of these records already
  attached to tree persons?" — Claude collects the `arkUrl` values and
  calls `record_attachments`.
