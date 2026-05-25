# `match_by_id` MCP Tool — Implementation Spec

## Overview

An MCP tool that fetches FamilySearch match resolutions for a given ARK.
The same upstream endpoint serves four distinct research operations,
selected by the combination of the `collection` parameter and the
**type prefix** of the ARK's id (`4:1:` for a tree person, `1:1:` for
a historical record persona):

| `collection` | ARK prefix | What you get | Common use case |
|---|---|---|---|
| `records` | `4:1:` (tree) | Historical record hints for a tree person | "What records match this tree person?" — the **record hints** workflow |
| `tree` | `1:1:` (record) | Tree people that might be the subject of a record | "Who in the tree might this record be?" — record-to-tree routing |
| `tree` | `4:1:` (tree) | Other tree people that may duplicate this one | Duplicate-tree-person detection |
| `records` | `1:1:` (record) | Other historical records similar to this one | Similar-records discovery |

All four use the same query parameters (`minConfidence`, `status`,
`includeFlags`, `includeSummary`). Requires authentication (OAuth
tokens obtained via the `login` tool).

The endpoint serves the match-resolution layer of FamilySearch's hint
system — the data that powers the "record hints" badges and the
duplicate-detection prompts in the FS UI. Unlike `match_two_examples`
(which is a one-vs-one **verify** primitive), `match_by_id` is a
one-to-**many discovery** primitive that returns every known match
for a single subject above a confidence threshold.

---

## Input

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `collection` | `"records" \| "tree"` | yes | — | Which side of the match graph to fetch. `records` returns historical record matches; `tree` returns tree-person matches. |
| `id` | string | yes | — | Full FamilySearch ARK for the subject. Tree persons use the `4:1:` prefix (e.g., `ark:/61903/4:1:KD96-TV2`); record personas use the `1:1:` prefix (e.g., `ark:/61903/1:1:QK2S-4W7G`). |
| `minConfidence` | integer (1–5) | no | `2` | Minimum confidence band to return. `5` is the strongest match band; `1` returns everything including low-confidence hints. |
| `status` | array of `"accepted" \| "pending" \| "rejected"` | no | `["accepted", "pending", "rejected"]` | Which match states to include. `accepted` = already attached to a tree person/record; `pending` = a probable match no one has acted on; `rejected` = previously dismissed. The default returns the full match picture so the LLM sees all known matches; pass `["pending"]` alone for the actionable subset. |
| `includeFlags` | boolean | no | `true` | Include match-level flag metadata in the response. |
| `includeSummary` | boolean | no | `false` | Include summary information about the matched persona/tree person on each entry. `true` makes the response significantly larger but saves a follow-up call when the caller needs basic identifying info on the matches. |

### Bare ARK IDs vs full ARK URLs

The `id` field is a **bare ARK** (`ark:/61903/4:1:KD96-TV2`), not a
full URL (`https://www.familysearch.org/ark:/61903/4:1:KD96-TV2`).
This matches the upstream API's expected format. Callers that hold
a bare tree person id (e.g., `KD96-TV2`) must prepend the prefix
themselves: `ark:/61903/4:1:<id>`.

The tool **does not** auto-prepend the prefix. The id type (tree vs
record) is part of the caller's intent; silently coercing would mask
caller mistakes that result in misdirected match queries.

### Why three default behaviors?

- **`minConfidence: 2`** — Returns "probable and above" hints. Bands
  1 are low-signal noise that callers rarely want; bands 3–5 alone
  miss legitimate-but-uncertain candidates. Band 2 is the FS-UI
  default for surfaced record hints.
- **`status: ["accepted", "pending", "rejected"]`** — Returns the full
  match picture by default so the LLM can reason across all states
  without a follow-up call (e.g., "is this hint already attached?",
  "did we previously dismiss it?"). Matches the canonical curl pattern
  in the design brief. Callers who only want actionable hints pass
  `["pending"]`.
- **`includeSummary: false`** — Summary blocks are large. Most callers
  want the match list and will look up persona/tree details on demand
  via `record_search`, `tree_read`, or follow-up `match_by_id` calls.

### Example calls

```typescript
// 1. Record hints for a tree person (the original task ask)
match_by_id({
  collection: "records",
  id: "ark:/61903/4:1:KD96-TV2",
})

// 2. Tree people that might be this record persona
match_by_id({
  collection: "tree",
  id: "ark:/61903/1:1:QVK1-LK96",
})

// 3. Duplicate tree people for a tree person
match_by_id({
  collection: "tree",
  id: "ark:/61903/4:1:KD96-TV2",
})

// 4. Similar records for a record persona
match_by_id({
  collection: "records",
  id: "ark:/61903/1:1:QVK1-LK96",
})

// 5. Include attached and rejected matches with summary metadata
match_by_id({
  collection: "records",
  id: "ark:/61903/4:1:KD96-TV2",
  status: ["accepted", "pending", "rejected"],
  includeSummary: true,
})
```

---

## Output

A flattened, LLM-reasoning-friendly shape that surfaces the match list
and the essential per-entry metadata.

| Field | Type | Always present? | Description |
|-------|------|-----------------|-------------|
| `subjectArk` | string | yes | The ARK passed in `id`, echoed back so the LLM doesn't have to re-derive it. |
| `subjectKind` | `"tree"` \| `"record"` | yes | Derived from `id`'s prefix (`4:1:` → `"tree"`, `1:1:` → `"record"`). |
| `targetCollection` | `"records"` \| `"tree"` | yes | The `collection` value used. Combined with `subjectKind`, identifies which of the 4 directions this call represents. |
| `totalReturned` | integer | yes | Number of `matches[]` items returned. |
| `matches` | array of `Match` | yes | The match entries. May be empty (`[]`) when no matches meet the criteria. |
| `apiUpdated` | string | yes | ISO timestamp from the upstream response. |

### `Match` shape

| Field | Type | Always present? | Description |
|-------|------|-----------------|-------------|
| `id` | string | yes | The matched entity's ARK. Tree-person matches use `4:1:` prefix; record matches use `1:1:`. |
| `confidence` | integer 1–5 | yes | Match confidence band per the upstream API. |
| `status` | `"accepted"` \| `"pending"` \| `"rejected"` | yes | Match state. |
| `score` | number | when upstream provides it | Fine-grained match score. The upstream API does not always return this for all status values; the field is omitted when absent. |
| `flags` | array of strings | when `includeFlags: true` (default) | Match-level flags the upstream API attaches (e.g., `"conflict"`, `"high-quality"`). |
| `summary` | `MatchSummary` | when `includeSummary: true` | Compact identifying info about the matched entity (name, key facts, life span). Omitted by default. |
| `lastModified` | string | when upstream provides it | ISO timestamp of the most recent state change for this match. |

### Example output (record hints for a tree person)

```json
{
  "subjectArk": "ark:/61903/4:1:KD96-TV2",
  "subjectKind": "tree",
  "targetCollection": "records",
  "totalReturned": 3,
  "matches": [
    {
      "id": "ark:/61903/1:1:QVK1-LK96",
      "confidence": 5,
      "status": "pending",
      "score": 0.974,
      "flags": ["high-quality"],
      "lastModified": "2024-08-12T14:32:11.043Z"
    },
    {
      "id": "ark:/61903/1:1:MX2P-RKQ",
      "confidence": 4,
      "status": "pending",
      "score": 0.881,
      "flags": [],
      "lastModified": "2024-07-30T09:11:08.881Z"
    },
    {
      "id": "ark:/61903/1:1:MFLR-31D",
      "confidence": 3,
      "status": "accepted",
      "score": 0.732,
      "flags": ["conflict"],
      "lastModified": "2023-11-04T17:45:00.000Z"
    }
  ],
  "apiUpdated": "2026-05-25T13:24:51.110Z"
}
```

### Empty-result example

When the subject has no matches that meet the filter criteria:

```json
{
  "subjectArk": "ark:/61903/4:1:KQRS-LMN",
  "subjectKind": "tree",
  "targetCollection": "records",
  "totalReturned": 0,
  "matches": [],
  "apiUpdated": "2026-05-25T13:25:02.331Z"
}
```

This is **not** an error — it's a legitimate "no hints above your
confidence band" response. Surface as-is.

---

## Error Handling

All errors are LLM-instruction errors (the message tells Claude what
to do next), thrown as `Error` objects.

| Condition | Throw message |
|-----------|--------------|
| No FamilySearch session (no tokens / refresh failed) | `"User is not logged in to FamilySearch. Call the login tool to authenticate."` (re-raised from `getValidToken()`) |
| API returns 401 | `"FamilySearch session not accepted; call the login tool to re-authenticate."` |
| API returns 403 with Imperva body (errorCode 15) | `"FamilySearch match endpoint blocked by WAF. The User-Agent header was rejected — check that the MCP server is running an unmodified build."` |
| API returns 404 | `"FamilySearch match endpoint returned 404 for id <id>. Verify the ARK exists and has the correct type prefix (4:1: for tree, 1:1: for record)."` |
| API returns 400 with JSON body | `"FamilySearch match endpoint rejected the request: ${detail-from-body}."` |
| API returns other 4xx/5xx | `"FamilySearch match endpoint error: ${status} ${statusText}."` |
| `id` doesn't match the `ark:/61903/(4:1:\|1:1:)<id>` shape | `"match_by_id: id must be a full ARK like 'ark:/61903/4:1:KD96-TV2' or 'ark:/61903/1:1:QK2S-4W7G'. Got: ${id}"` |
| `minConfidence` out of range (1–5) | `"match_by_id: minConfidence must be 1, 2, 3, 4, or 5. Got: ${minConfidence}"` |
| `status` array contains an unknown value | `"match_by_id: status entries must be one of 'accepted', 'pending', 'rejected'. Got: ${entry}"` |
| `status` array is empty | `"match_by_id: status must contain at least one of 'accepted', 'pending', 'rejected'."` |
| `fetch()` itself fails (network) | `"Could not reach FamilySearch match endpoint: ${error.message}."` |

---

## FamilySearch match API Reference

**Endpoint:**
```
GET https://sg30p0.familysearch.org/search/match/resolutions/match/matches
```

Same `sg30p0.familysearch.org` service-tier host that `image_read` already uses.

**Required headers:**
```
Authorization: Bearer <access token from getValidToken()>
Accept: application/json
User-Agent: <BROWSER_USER_AGENT from src/constants.ts>
```

The `User-Agent` must be the browser-style Mozilla string — same
WAF-avoidance pattern as `place_collections`, `record_search`,
`match_two_examples`, `image_read`.

**Query parameters:**

| Param | Type | Notes |
|-------|------|-------|
| `collection` | `records` \| `tree` | Required. |
| `id` | string | Required. Full ARK including the `ark:/61903/` prefix and the type discriminator. |
| `minConfidence` | integer 1–5 | Defaults to `2` in the tool. Upstream behavior: `5` strongest; `1` returns low-signal noise. |
| `includeFlags` | boolean | Defaults to `true` in the tool. |
| `includeSummary` | boolean | Defaults to `false` in the tool. |
| `status` | repeated string | Repeat once per state, e.g., `status=accepted&status=pending&status=rejected`. The tool serializes its `status[]` input the same way. |

**Reference call (from Dallan's task brief):**

```bash
curl -H 'Authorization: Bearer <token>' \
  'https://sg30p0.familysearch.org/search/match/resolutions/match/matches?collection=records&id=ark:/61903/4:1:KD96-TV2&includeFlags=true&minConfidence=2&includeSummary=false&status=accepted&status=pending&status=rejected'
```

**Response shape (200 OK):**

The exact response shape is documented during the implementation
probe (`mcp-server/dev/probe-match-by-id.ts`) and confirmed against the
live API. Expected at minimum:

```json
{
  "matches": [
    {
      "id": "ark:/61903/1:1:QVK1-LK96",
      "confidence": 5,
      "status": "pending",
      "score": 0.974,
      "flags": ["..."],
      "summary": { "...": "only when includeSummary=true" },
      "lastModified": "2024-08-12T14:32:11.043Z"
    }
  ],
  "updated": "2026-05-25T13:24:51.110Z"
}
```

Open question (resolved during probe): does the upstream wrap matches
under `matches[]` or under some other key (e.g., `results[]`)? The
probe will confirm and this section will be updated before
implementation merges.

---

## Internal Pipeline

The tool's `matchById()` function:

```
input: { collection, id, minConfidence?, status?, includeFlags?, includeSummary? }
  │
  ├─ 1. Validate inputs:
  │     - id matches the ark:/61903/(4:1:|1:1:)... regex
  │     - minConfidence ∈ {1, 2, 3, 4, 5} when provided
  │     - status[] items ∈ {accepted, pending, rejected} when provided
  │     - status[] is non-empty when provided
  │     (Error messages quote the offending value.)
  │
  ├─ 2. Apply defaults:
  │     - minConfidence ?? 2
  │     - status ?? ["accepted", "pending", "rejected"]
  │     - includeFlags ?? true
  │     - includeSummary ?? false
  │
  ├─ 3. Build URL with repeated status params:
  │       const url = new URL(ENDPOINT);
  │       url.searchParams.set("collection", collection);
  │       url.searchParams.set("id", id);
  │       url.searchParams.set("minConfidence", String(minConfidence));
  │       url.searchParams.set("includeFlags", String(includeFlags));
  │       url.searchParams.set("includeSummary", String(includeSummary));
  │       for (const s of status) url.searchParams.append("status", s);
  │
  ├─ 4. GET with auth + browser UA + Accept: application/json
  │
  ├─ 5. Map upstream HTTP errors per the Error Handling table.
  │
  ├─ 6. Parse the response body. Map to the output shape:
  │     - subjectArk = id (echoed)
  │     - subjectKind = id contains ":4:1:" ? "tree" : "record"
  │     - targetCollection = collection
  │     - matches = body.matches.map(flattenMatch)
  │     - totalReturned = matches.length
  │     - apiUpdated = body.updated
  │
  └─ return: typed MatchGetResult
```

The per-match flattening preserves what upstream returns, omitting
`score`, `flags`, `summary`, `lastModified` only when the upstream
omits them.

---

## Files to Create

### 1. `mcp-server/src/types/matchById.ts`

```typescript
export type MatchCollection = "records" | "tree";
export type MatchStatus = "accepted" | "pending" | "rejected";
export type MatchSubjectKind = "tree" | "record";

export interface MatchGetInput {
  collection: MatchCollection;
  id: string;
  minConfidence?: number; // 1–5; defaults to 2
  status?: MatchStatus[]; // defaults to ["accepted", "pending", "rejected"]
  includeFlags?: boolean; // defaults to true
  includeSummary?: boolean; // defaults to false
}

export interface MatchSummary {
  // Shape confirmed during probe; carries minimal identifying info
  // (name, life span, key facts). Marked optional pending probe.
  [key: string]: unknown;
}

export interface Match {
  id: string;
  confidence: number;
  status: MatchStatus;
  score?: number;
  flags?: string[];
  summary?: MatchSummary;
  lastModified?: string;
}

export interface MatchGetResult {
  subjectArk: string;
  subjectKind: MatchSubjectKind;
  targetCollection: MatchCollection;
  totalReturned: number;
  matches: Match[];
  apiUpdated: string;
}

// Raw upstream response shape — internal use only.
export interface MatchGetApiResponse {
  matches: Array<{
    id: string;
    confidence: number;
    status: string;
    score?: number;
    flags?: string[];
    summary?: unknown;
    lastModified?: string;
  }>;
  updated: string;
}
```

### 2. `mcp-server/src/tools/match-by-id.ts`

The tool function + the MCP schema. Pattern mirrors `match-two-examples.ts`
(authenticated FS service tier with browser UA) and `image-read.ts`
(same `sg30p0` host).

### 3. `mcp-server/dev/try-match-by-id.ts`

One-shot smoke test calling the function directly with the
`KD96-TV2` reference id from the task brief. Mirrors
`dev/try-match-two-examples.ts`.

### 4. `mcp-server/tests/tools/match-by-id.test.ts`

Vitest with mocked `fetch`. Cases to cover:

- Happy path (record hints for tree person) → flattened matches with confidence + status
- Happy path (tree dedup) → tree-tree direction
- Happy path (record similarity) → record-record direction
- Empty matches → `totalReturned: 0`, `matches: []`
- 401 → re-login error
- 403 with Imperva body → WAF error
- 404 → invalid-ARK error message
- 400 with JSON detail → quote the detail
- Validation: id missing `ark:/61903/` prefix → error listing expected formats
- Validation: id has wrong type prefix (e.g., `ark:/61903/2:1:...`) → same validation error
- Validation: `minConfidence: 0` or `6` → range error
- Validation: `status: ["bogus"]` → unknown-value error
- Validation: `status: []` → empty-array error
- `subjectKind` derived correctly for both `4:1:` and `1:1:` ids
- Repeated `status=...` params serialized correctly when `status` has multiple entries

---

## Files to Modify

### `mcp-server/src/index.ts`

Three additions in the same pattern as other tools:

1. Import: `import { matchById, matchByIdSchema, type MatchGetInput } from "./tools/match-by-id.js";`
2. Schema in the `ListToolsRequestSchema` array.
3. `if (request.params.name === "match_by_id") { ... }` block in `CallToolRequestSchema`.

---

## Tool Schema

```typescript
export const matchByIdSchema = {
  name: "match_by_id",
  description:
    "Fetch FamilySearch match resolutions for a FamilySearch ARK. " +
    "The same endpoint serves four research operations selected by " +
    "the combination of `collection` and the ARK's type prefix:\n" +
    "\n" +
    "  • Record hints for a tree person — `collection: 'records'`, " +
    "id with `4:1:` prefix (e.g., `ark:/61903/4:1:KD96-TV2`).\n" +
    "  • Tree people that might be this record persona — " +
    "`collection: 'tree'`, id with `1:1:` prefix.\n" +
    "  • Duplicate tree people for a tree person — `collection: 'tree'`, " +
    "id with `4:1:` prefix.\n" +
    "  • Similar records for a record persona — " +
    "`collection: 'records'`, id with `1:1:` prefix.\n" +
    "\n" +
    "Returns ranked matches above `minConfidence` (default 2; 1=weak, " +
    "5=strong) filtered by `status` (defaults to all three states " +
    "[\"accepted\", \"pending\", \"rejected\"]; pass [\"pending\"] " +
    "alone for the actionable subset).",
  inputSchema: {
    type: "object" as const,
    properties: {
      collection: {
        type: "string",
        enum: ["records", "tree"],
        description:
          "Which side of the match graph to return — `records` for " +
          "historical record matches, `tree` for tree-person matches.",
      },
      id: {
        type: "string",
        description:
          "Full FamilySearch ARK including the `ark:/61903/` prefix " +
          "and the type discriminator. Tree persons use `4:1:` " +
          "(e.g., `ark:/61903/4:1:KD96-TV2`); record personas use " +
          "`1:1:` (e.g., `ark:/61903/1:1:QK2S-4W7G`).",
      },
      minConfidence: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        description:
          "Minimum confidence band (1=weak, 5=strong). Defaults to 2.",
      },
      status: {
        type: "array",
        items: {
          type: "string",
          enum: ["accepted", "pending", "rejected"],
        },
        description:
          "Match states to include. Defaults to all three " +
          "[\"accepted\", \"pending\", \"rejected\"] so the LLM sees " +
          "the full match picture. Pass [\"pending\"] alone for the " +
          "actionable subset.",
      },
      includeFlags: {
        type: "boolean",
        description:
          "Include match-level flag metadata (default true).",
      },
      includeSummary: {
        type: "boolean",
        description:
          "Include compact summary info about the matched entity. " +
          "Default false; setting true grows the response substantially.",
      },
    },
    required: ["collection", "id"],
  },
};
```

---

## Patterns to Follow

- **Auth:** call `getValidToken()` from `src/auth/refresh.ts`. Never read tokens directly.
- **Headers:** use `BROWSER_USER_AGENT` from `src/constants.ts`. Do not hardcode the Mozilla string.
- **HTTP errors:** map each upstream status to an LLM-instruction error message per the Error Handling table. Never surface raw HTTP errors to the LLM.
- **URL building:** use `URL` + `searchParams.append("status", s)` for repeated params, not manual concat — encoding is otherwise easy to get wrong.

---

## Out of Scope for v1

- **Pagination.** The upstream endpoint is not currently known to paginate (the task brief implies a single response). If real-world usage surfaces large match sets, a future v2 can add `offset` / `limit` cursors after a follow-up probe.
- **`acceptedBy` / `rejectedBy` user attribution.** Even when the upstream response carries the user id who accepted/rejected a match, v1 doesn't surface it — that's review-metadata that complicates the LLM's match-list reasoning without enabling new use cases for current skills. Add if a skill needs it.
- **Bulk match queries.** The upstream is one ARK per call. Callers needing matches for N tree persons make N calls; the tool does not batch.
- **Confidence-band string labels.** The API returns integer bands 1–5. Some FS surfaces map these to labels ("strong", "good", "fair", "weak", "very weak"). The tool surfaces the integer and lets the caller decide on labels.
- **Auto-prepending the ARK prefix when caller passes a bare id.** Discussed under Input — silently coercing `KD96-TV2` to `ark:/61903/4:1:KD96-TV2` masks the caller's intent about whether they meant a tree person or a record persona, both of which use the same bare-id namespace shape.
- **Companion plan doc** (`docs/plan/match-by-id-tool.md`) and **testing guide** (`docs/testing-guides/match-by-id-tool-testing-guide.md`). Per CLAUDE.md convention these should exist alongside the tool — they'll be added during the implementation PR, not in this spec PR.

---

## Evidence Trail (live-API findings)

Behavioral claims in this spec will be established by one-shot probe
scripts run against the live FamilySearch API during the implementation
PR. The probes are exploration scaffolding and will not be checked in
permanently; their findings will be recorded here at that time.

Probes to run before implementation:

| Behavior | Probe |
|----------|-------|
| Canonical request recipe (single direction works end-to-end) | `dev/probe-match-by-id-canonical.ts` — record hints for `KD96-TV2`, confirm `200 OK` + non-empty matches |
| WAF gate | `dev/probe-match-by-id-waf.ts` — A/B `fs-search-agent` vs browser UA |
| Response wrapper key | (resolved during canonical probe) — confirm `matches[]` vs `results[]` vs other |
| `subjectKind` derivation invariants | (resolved during canonical probe) — verify response carries match `id` values with the expected prefix per collection |
| `minConfidence` clamping | `dev/probe-match-by-id-confidence.ts` — request 1, 3, 5; verify monotone-decreasing result counts |
| Empty-match response shape | `dev/probe-match-by-id-empty.ts` — request a tree id known to have no matches; verify `matches: []` (not absent / not 404) |
| Status filter behavior | `dev/probe-match-by-id-status.ts` — request each of `[accepted]`, `[pending]`, `[rejected]`, and all three; verify status echo on returned entries |

Each row will be filled in during implementation; the spec will be
re-reviewed at that point to confirm the documented contract matches
upstream reality.

---

## Open Questions (deferred to integration testing)

- **Rate limits.** Not stress-tested. Will surface during real Cowork sessions.
- **Score field availability.** The brief implies `score` exists alongside `confidence`, but it's unclear whether the upstream returns it for all status values (e.g., `rejected` entries may carry just the band). Probe will confirm; the type marks `score` optional to be safe.
- **Summary shape.** Whatever upstream returns inside `summary` when `includeSummary: true`. Marked as `[key: string]: unknown` in the type pending probe; v2 can tighten the schema once we see real responses.
- **Maximum match list size.** Some tree persons could have hundreds of record hints. If we see lists in the thousands, v2 may need a `limit` parameter to cap the response.
