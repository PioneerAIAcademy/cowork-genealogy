# `match by id` MCP Tools — Implementation Spec

## Overview

Four MCP tools, each wrapping a specific direction of FamilySearch's
match-resolutions endpoint. All four hit the same URL with the same
query parameters — only the `collection` value and the **type prefix**
of the ARK's id differ. Splitting into four tools (rather than one
parameterized tool) is Sir Dallan's explicit direction (see Design
decisions). Each tool's name and description make its research purpose
unambiguous to the LLM.

| Tool | Subject ARK prefix | `collection` (hardcoded) | Purpose |
|---|---|---|---|
| `person_record_matches` | `4:1:` (tree) | `records` | Historical record hints for a tree person — the **record hints** workflow |
| `record_person_matches` | `1:1:` (record) | `tree` | Tree people that might be the subject of a record — record-to-tree routing |
| `person_person_matches` | `4:1:` (tree) | `tree` | Other tree people that may duplicate this one — duplicate-tree-person detection |
| `record_record_matches` | `1:1:` (record) | `records` | Other historical records similar to this one — similar-records discovery |

The naming pattern is `<subject>_<target>_matches`: the first word
names the kind of thing you're asking about, the second names the
kind of thing you want back. `person` = tree person; `record` =
historical record persona.

Requires authentication (OAuth tokens obtained via the `login` tool).

The endpoint serves the match-resolution layer of FamilySearch's hint
system — the data that powers the "record hints" badges and the
duplicate-detection prompts in the FS UI. Unlike `match_two_examples`
(which is a one-vs-one **verify** primitive), the match-by-id tools
are one-to-**many discovery** primitives that return every known
match for a single subject above a confidence threshold.

---

## Design decisions

### Four tools, not one

Sir Dallan's original brief left this open: *"Do we want a single
tool or multiple tools for this functionality?"* A first revision of
this spec proposed a single parameterized `match_by_id` tool; Sir
Dallan then updated the task title to **"Create several 'match by id'
tools"** and named the four. The spec follows his direction.

**Why four tools (the chosen design):**

- **Semantic affordance for the LLM.** Each tool name describes a
  specific research action (`person_record_matches` literally = "find
  record matches for this person"). The LLM picks the tool by intent;
  it doesn't have to compute the right `(collection, id-prefix)`
  combination.
- **Cleaner skill scoping.** A future "record hints" skill only needs
  `person_record_matches` in its `allowed-tools`. A "find duplicates"
  skill only needs `person_person_matches`. Bundling them under one
  tool name would inflate every skill's surface unnecessarily.
- **Stricter validation per tool.** Each tool can validate that the
  id matches its expected prefix (`person_*` tools reject `1:1:`
  ids; `record_*` tools reject `4:1:` ids) and surface a clear
  error — rather than silently returning the wrong direction's
  results.

**What we'd want from a single-tool design** — lower context cost in
the global tool list, less per-tool boilerplate — is mitigated by the
shared HTTP client (see Files to Create) and by skill-level scoping
of `allowed-tools` (so any given skill loads only the 1–2 tools it
actually uses).

---

## Shared concepts

All four tools share the upstream endpoint, query parameters, response
shape, authentication, and most of the error model. This section is
the source of truth for those shared concepts; the per-tool sections
below describe only what's specific to each tool.

### Endpoint

```
GET https://sg30p0.familysearch.org/search/match/resolutions/match/matches
```

Same `sg30p0.familysearch.org` service-tier host that the existing
`image_read` tool already uses.

### Required headers

```
Authorization: Bearer <access token from getValidToken()>
Accept: application/json
User-Agent: <BROWSER_USER_AGENT from src/constants.ts>
```

The `User-Agent` must be the browser-style Mozilla string — same
WAF-avoidance pattern as `place_collections`, `record_search`,
`match_two_examples`, `image_read`.

### Query parameters (shared across all 4 tools)

| Param | Type | Tool input? | Default | Notes |
|-------|------|-------------|---------|-------|
| `collection` | `records` \| `tree` | **no** (hardcoded per tool) | — | Set internally by each tool — never exposed as a user parameter. |
| `id` | string (full ARK) | yes | — | Validated per-tool against the expected type prefix. |
| `minConfidence` | integer 1–5 | yes (optional) | `2` | Minimum confidence band to return. `5` is the strongest match band; `1` returns everything including low-confidence hints. |
| `status` | array of `"accepted" \| "pending" \| "rejected"` | yes (optional) | `["accepted", "pending", "rejected"]` | Which match states to include. Default returns all three so the LLM sees the full match picture; pass `["pending"]` alone for the actionable subset. |
| `includeFlags` | boolean | yes (optional) | `true` | Include match-level flag metadata in the response. |
| `includeSummary` | boolean | yes (optional) | `false` | Include compact summary info about the matched persona/tree person on each entry. `true` makes the response significantly larger. |

The upstream API takes `status` as a repeated query param (one
`status=value` per state). The tools serialize their `status[]` input
the same way.

### Why these defaults?

- **`minConfidence: 2`** — Returns "probable and above" hints. Band 1
  is low-signal noise that callers rarely want; bands 3–5 alone miss
  legitimate-but-uncertain candidates. Band 2 matches the canonical
  curl in the design brief.
- **`status: ["accepted", "pending", "rejected"]`** — Returns the
  full match picture by default so the LLM can reason across all
  states without a follow-up call (e.g., "is this hint already
  attached?", "did we previously dismiss it?"). Matches the canonical
  curl pattern.
- **`includeSummary: false`** — Summary blocks are large. Most callers
  want the match list and will look up persona/tree details on demand
  via `record_search`, `tree_read`, or follow-up match-by-id calls.
- **`includeFlags: true` vs `includeSummary: false`** — The two
  defaults look asymmetric on purpose. Flag arrays are small (a few
  strings per match like `"high-quality"` / `"conflict"`) and inform
  the LLM's triage of which matches deserve attention, so on-by-default
  costs almost nothing. Summary blocks carry full persona metadata
  (names, life facts, places) and can dominate the response size when
  matches are numerous, so off-by-default keeps payloads tractable.

### Bare ARK IDs vs full ARK URLs

The `id` field is a **bare ARK** (`ark:/61903/4:1:KD96-TV2`), not a
full URL (`https://www.familysearch.org/ark:/61903/4:1:KD96-TV2`).
This matches the upstream API's expected format. Callers that hold
a bare tree person id (e.g., `KD96-TV2`) must prepend the prefix
themselves: `ark:/61903/4:1:<id>`.

The tools **do not** auto-prepend the prefix. The id type (tree vs
record) is part of the caller's intent; silently coercing would mask
caller mistakes that result in misdirected match queries.

### Shared response shape

All four tools return the same shape, parsed from the upstream
response and flattened for the LLM.

| Field | Type | Always present? | Description |
|-------|------|-----------------|-------------|
| `subjectArk` | string | yes | The ARK passed in `id`, echoed back. |
| `subjectKind` | `"tree"` \| `"record"` | yes | Constant per tool: `person_*` tools → `"tree"`; `record_*` tools → `"record"`. |
| `targetCollection` | `"records"` \| `"tree"` | yes | Constant per tool — the `collection` value the tool sent upstream. |
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
| `summary` | `MatchSummary` | when `includeSummary: true` | Compact identifying info about the matched entity. Omitted by default. |
| `lastModified` | string | when upstream provides it | ISO timestamp of the most recent state change for this match. |

### Empty-result response

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

### Shared error handling

All errors are LLM-instruction errors (the message tells Claude what
to do next), thrown as `Error` objects. The per-tool validation rules
(id prefix) are listed in each tool's section.

| Condition | Throw message |
|-----------|--------------|
| No FamilySearch session (no tokens / refresh failed) | `"User is not logged in to FamilySearch. Call the login tool to authenticate."` (re-raised from `getValidToken()`) |
| API returns 401 | `"FamilySearch session not accepted; call the login tool to re-authenticate."` |
| API returns 403 with Imperva body (errorCode 15) | `"FamilySearch match endpoint blocked by WAF. The User-Agent header was rejected — check that the MCP server is running an unmodified build."` |
| API returns 404 | `"FamilySearch match endpoint returned 404 for id <id>. The ARK may not exist in FamilySearch, or it may have no match resolutions recorded. (Client-side prefix validation runs first, so a 404 reaching this branch is not a malformed-ARK problem.)"` |
| API returns 400 with JSON body | `"FamilySearch match endpoint rejected the request: ${detail-from-body}."` |
| API returns other 4xx/5xx | `"FamilySearch match endpoint error: ${status} ${statusText}."` |
| `minConfidence` out of range (1–5) | `"<tool_name>: minConfidence must be 1, 2, 3, 4, or 5. Got: ${minConfidence}"` |
| `status` array contains an unknown value | `"<tool_name>: status entries must be one of 'accepted', 'pending', 'rejected'. Got: ${entry}"` |
| `status` array is empty | `"<tool_name>: status must contain at least one of 'accepted', 'pending', 'rejected'."` |
| `fetch()` itself fails (network) | `"Could not reach FamilySearch match endpoint: ${error.message}."` |

### Shared internal pipeline

The shared HTTP client (`src/tools/match-by-id-client.ts`) handles
everything common to all four tools:

```
input: { id, collection, subjectKind, minConfidence?, status?, includeFlags?, includeSummary? }
  │   (collection + subjectKind are supplied by the calling tool,
  │    never by the user; id is supplied + validated by the calling tool)
  │
  ├─ 1. Validate shared inputs:
  │     - minConfidence ∈ {1, 2, 3, 4, 5} when provided
  │     - status[] items ∈ {accepted, pending, rejected} when provided
  │     - status[] is non-empty when provided
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
  ├─ 5. Map upstream HTTP errors per the shared Error Handling table.
  │
  ├─ 6. Parse the response body. Map to the shared response shape:
  │     - subjectArk = id (echoed)
  │     - subjectKind = supplied by the calling tool (constant)
  │     - targetCollection = collection (supplied by the calling tool)
  │     - matches = body.matches.map(flattenMatch)
  │     - totalReturned = matches.length
  │     - apiUpdated = body.updated
  │
  └─ return: typed MatchByIdResult
```

Each tool wrapper is responsible for:
- Validating its tool-specific id prefix (rejecting wrong-prefix input
  with a tool-name-prefixed error message)
- Calling the shared client with the appropriate `collection` and
  `subjectKind` constants
- Exposing the tool's MCP schema (description tuned to the tool's
  research purpose)

---

## Per-tool sections

### 1. `person_record_matches`

**Purpose.** Find historical record matches for a tree person — the
"record hints" workflow. This is the primary use case from the
design brief.

**Hardcoded:** `collection = "records"`, `subjectKind = "tree"`.

**Id validation:** The `id` must match the `4:1:` prefix shape
(`ark:/61903/4:1:<bare-id>`).

| Validation failure | Error message |
|---|---|
| `id` doesn't match `^ark:\/61903\/4:1:.+$` | `"person_record_matches: id must be a tree-person ARK like 'ark:/61903/4:1:KD96-TV2' (note the 4:1: prefix). Got: ${id}. To look up a record persona instead, use record_person_matches."` |

**Example call:**

```typescript
person_record_matches({
  id: "ark:/61903/4:1:KD96-TV2",
})
```

**Example output:**

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

**Tool schema description (LLM-facing):**

> Find historical record matches ("record hints") for a Family Tree
> person. Pass the tree person's full ARK (with the `4:1:` prefix,
> e.g., `ark:/61903/4:1:KD96-TV2`). Returns ranked matches above
> `minConfidence` (default 2; 1=weak, 5=strong) in the states named
> by `status` (default `["accepted","pending","rejected"]`).
> To look up tree people for a record persona instead, use
> `record_person_matches`.

---

### 2. `record_person_matches`

**Purpose.** Find tree-person matches for a historical record
persona — record-to-tree routing.

**Hardcoded:** `collection = "tree"`, `subjectKind = "record"`.

**Id validation:** The `id` must match the `1:1:` prefix shape
(`ark:/61903/1:1:<bare-id>`).

| Validation failure | Error message |
|---|---|
| `id` doesn't match `^ark:\/61903\/1:1:.+$` | `"record_person_matches: id must be a record-persona ARK like 'ark:/61903/1:1:QVK1-LK96' (note the 1:1: prefix). Got: ${id}. To look up record hints for a tree person instead, use person_record_matches."` |

**Example call:**

```typescript
record_person_matches({
  id: "ark:/61903/1:1:QVK1-LK96",
})
```

**Tool schema description (LLM-facing):**

> Find Family Tree people that might be the subject of a historical
> record persona. Pass the record persona's full ARK (with the `1:1:`
> prefix, e.g., `ark:/61903/1:1:QVK1-LK96`). Useful for routing a
> standalone record discovery toward existing tree people. To look
> up record hints for a tree person instead, use
> `person_record_matches`.

---

### 3. `person_person_matches`

**Purpose.** Find other tree people that may be duplicates of this
one — duplicate-tree-person detection.

**Hardcoded:** `collection = "tree"`, `subjectKind = "tree"`.

**Id validation:** The `id` must match the `4:1:` prefix shape
(`ark:/61903/4:1:<bare-id>`).

| Validation failure | Error message |
|---|---|
| `id` doesn't match `^ark:\/61903\/4:1:.+$` | `"person_person_matches: id must be a tree-person ARK like 'ark:/61903/4:1:KD96-TV2' (note the 4:1: prefix). Got: ${id}."` |

**Example call:**

```typescript
person_person_matches({
  id: "ark:/61903/4:1:KD96-TV2",
})
```

**Tool schema description (LLM-facing):**

> Find other Family Tree people that may be duplicates of the given
> tree person. Pass the tree person's full ARK (with the `4:1:`
> prefix, e.g., `ark:/61903/4:1:KD96-TV2`). Useful as a tree-cleanup
> sanity check before attaching new records or merging.

---

### 4. `record_record_matches`

**Purpose.** Find other historical records similar to a given
record persona — similar-records discovery.

**Hardcoded:** `collection = "records"`, `subjectKind = "record"`.

**Id validation:** The `id` must match the `1:1:` prefix shape
(`ark:/61903/1:1:<bare-id>`).

| Validation failure | Error message |
|---|---|
| `id` doesn't match `^ark:\/61903\/1:1:.+$` | `"record_record_matches: id must be a record-persona ARK like 'ark:/61903/1:1:QVK1-LK96' (note the 1:1: prefix). Got: ${id}."` |

**Example call:**

```typescript
record_record_matches({
  id: "ark:/61903/1:1:QVK1-LK96",
})
```

**Tool schema description (LLM-facing):**

> Find other historical records similar to a given record persona.
> Pass the record persona's full ARK (with the `1:1:` prefix, e.g.,
> `ark:/61903/1:1:QVK1-LK96`). Useful when triaging a record that
> may have near-duplicates in the index, or when expanding a search
> from one known persona to related records.

---

## Files to Create

### 1. `mcp-server/src/types/matchById.ts`

Shared types used by all four tools and the shared client.

```typescript
export type MatchCollection = "records" | "tree";
export type MatchStatus = "accepted" | "pending" | "rejected";
export type MatchSubjectKind = "tree" | "record";

/** Caller input to any of the four match-by-id tools. The collection
 *  is supplied internally by each tool; only `id` and the optional
 *  filters come from the user. */
export interface MatchByIdInput {
  id: string;
  minConfidence?: number; // 1–5; defaults to 2
  status?: MatchStatus[]; // defaults to ["accepted", "pending", "rejected"]
  includeFlags?: boolean; // defaults to true
  includeSummary?: boolean; // defaults to false
}

/** Internal input the shared HTTP client takes — adds the per-tool
 *  collection + subjectKind constants. Not exported to MCP. */
export interface MatchByIdClientInput extends MatchByIdInput {
  collection: MatchCollection;
  subjectKind: MatchSubjectKind;
}

export interface MatchSummary {
  // Shape confirmed during probe; carries minimal identifying info
  // (name, life span, key facts). Marked as open-shape pending probe.
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

export interface MatchByIdResult {
  subjectArk: string;
  subjectKind: MatchSubjectKind;
  targetCollection: MatchCollection;
  totalReturned: number;
  matches: Match[];
  apiUpdated: string;
}

// Raw upstream response shape — internal use only.
export interface MatchByIdApiResponse {
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

### 2. `mcp-server/src/tools/match-by-id-client.ts`

The shared HTTP client. Not registered as an MCP tool — exported only
for use by the four tool wrappers.

Pattern mirrors `match-two-examples.ts` (authenticated FS service
tier with browser UA) and `image-read.ts` (same `sg30p0` host).

Exports `callMatchByIdEndpoint(input: MatchByIdClientInput): Promise<MatchByIdResult>`
implementing the Shared Internal Pipeline.

### 3–6. Four tool wrappers

Each is a thin file that:
- Validates the id prefix using the regex from its tool section above
- Calls `callMatchByIdEndpoint()` with the hardcoded `collection` and
  `subjectKind`
- Exports its MCP schema

| File | Tool name | Hardcoded collection | Hardcoded subjectKind | Required id prefix |
|---|---|---|---|---|
| `src/tools/person-record-matches.ts` | `person_record_matches` | `records` | `tree` | `4:1:` |
| `src/tools/record-person-matches.ts` | `record_person_matches` | `tree` | `record` | `1:1:` |
| `src/tools/person-person-matches.ts` | `person_person_matches` | `tree` | `tree` | `4:1:` |
| `src/tools/record-record-matches.ts` | `record_record_matches` | `records` | `record` | `1:1:` |

### 7. `mcp-server/dev/try-match-by-id.ts`

One-shot smoke test that exercises each of the four tools in turn
with the example ids from the design brief (`KD96-TV2` for tree
sides, `QVK1-LK96` for record sides). Mirrors
`dev/try-match-two-examples.ts`. A single dev script keeps the
exercise footprint small.

### 8–11. Four test files

| File | Coverage |
|---|---|
| `tests/tools/person-record-matches.test.ts` | Happy path, empty matches, id-prefix validation rejects `1:1:`, all shared error codes |
| `tests/tools/record-person-matches.test.ts` | Same shape, id-prefix validation rejects `4:1:` |
| `tests/tools/person-person-matches.test.ts` | Same shape, id-prefix validation rejects `1:1:` |
| `tests/tools/record-record-matches.test.ts` | Same shape, id-prefix validation rejects `4:1:` |

Per-test cases per file:
- Happy path → flattened matches with confidence + status
- Empty matches → `totalReturned: 0`, `matches: []`
- 401 → re-login error
- 403 with Imperva body → WAF error
- 404 → "ARK may not exist" error
- 400 with JSON detail → quote the detail
- Validation: wrong id prefix → tool-specific error message
- Validation: id missing `ark:/61903/` prefix → same error
- Validation: `minConfidence: 0` or `6` → range error
- Validation: `status: ["bogus"]` → unknown-value error
- Validation: `status: []` → empty-array error
- Repeated `status=...` params serialized correctly when `status` has
  multiple entries
- `subjectKind` and `targetCollection` are the expected constants for
  this tool

A shared test helper for the common fetch-mocking scaffolding cuts
the per-file boilerplate; each file's test list focuses on the
tool-specific id-prefix validation plus a representative happy path.

---

## Files to Modify

### `mcp-server/src/index.ts`

For each of the four tools, three additions in the same pattern as
other tools:

1. Import the tool function and schema.
2. Schema in the `ListToolsRequestSchema` array.
3. `if (request.params.name === "<tool_name>") { ... }` block in
   `CallToolRequestSchema`.

---

## Patterns to Follow

- **Auth:** call `getValidToken()` from `src/auth/refresh.ts`. Never read tokens directly.
- **Headers:** use `BROWSER_USER_AGENT` from `src/constants.ts`. Do not hardcode the Mozilla string.
- **HTTP errors:** map each upstream status to an LLM-instruction error message per the shared Error Handling table. Never surface raw HTTP errors to the LLM.
- **URL building:** use `URL` + `searchParams.append("status", s)` for repeated params, not manual concat — encoding is otherwise easy to get wrong.
- **Service-tier host (`sg30p0.familysearch.org`):** same host the existing `image_read` tool uses (see `src/tools/image-read.ts`). Not a new host pattern. Use the same auth + browser-UA recipe.
- **Shared client, thin tool wrappers:** the four tools share so much that putting the HTTP and parsing logic in `match-by-id-client.ts` and keeping each tool wrapper focused on its id-prefix validation + collection/subjectKind constants avoids four-way drift on the shared parts.

---

## Out of Scope for v1

- **Pagination.** The four reference curls in the design brief don't show pagination params, so v1 treats the response as a single page. The probes during the implementation PR will spot-check this against persons known to have many hints; if upstream pagination exists, v2 can add `offset` / `limit` cursors.
- **`acceptedBy` / `rejectedBy` user attribution.** Even when the upstream response carries the user id who accepted/rejected a match, v1 doesn't surface it — review-metadata that complicates the LLM's match-list reasoning without enabling new use cases for current skills. Add if a skill needs it.
- **Bulk match queries.** The upstream is one ARK per call. Callers needing matches for N subjects make N calls; the tools do not batch.
- **Confidence-band string labels.** The API returns integer bands 1–5. Some FS surfaces map these to labels ("strong", "good", "fair", "weak", "very weak"). The tools surface the integer and let the caller decide on labels.
- **Auto-prepending the ARK prefix when caller passes a bare id.** Silently coercing `KD96-TV2` to `ark:/61903/4:1:KD96-TV2` masks the caller's intent about whether they meant a tree person or a record persona, both of which use the same bare-id namespace shape.
- **A `match_by_id` umbrella tool that takes `collection` as a parameter.** The earlier draft of this spec proposed exactly this; Sir Dallan picked the four-tool design instead (see Design decisions). Don't add an umbrella tool alongside the four.
- **Companion plan doc** (`docs/plan/match-by-id-tools.md`) and **testing guide** (`docs/testing-guides/match-by-id-tools-testing-guide.md`). Per CLAUDE.md convention these should exist alongside the tools — they'll be added during the implementation PR, not in this spec PR.

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
| Matched-entity id prefixes invariants | (resolved during canonical probe) — verify response carries match `id` values with the expected prefix per collection (records → `1:1:` ids; tree → `4:1:` ids) |
| `minConfidence` clamping | `dev/probe-match-by-id-confidence.ts` — request 1, 3, 5; verify monotone-decreasing result counts |
| Empty-match response shape | `dev/probe-match-by-id-empty.ts` — request a tree id known to have no matches; verify `matches: []` (not absent / not 404) |
| Status filter behavior | `dev/probe-match-by-id-status.ts` — request each of `[accepted]`, `[pending]`, `[rejected]`, and all three; verify status echo on returned entries |
| All four directions return the expected response shape | `dev/probe-match-by-id-directions.ts` — exercise each of the four (collection, id-prefix) combos with a known-good id |

Each row will be filled in during implementation; the spec will be
re-reviewed at that point to confirm the documented contract matches
upstream reality.

---

## Open Questions (deferred to integration testing)

- **Rate limits.** Not stress-tested. Will surface during real Cowork sessions.
- **Score field availability.** The brief implies `score` exists alongside `confidence`, but it's unclear whether the upstream returns it for all status values (e.g., `rejected` entries may carry just the band). Probe will confirm; the type marks `score` optional to be safe.
- **Summary shape.** Whatever upstream returns inside `summary` when `includeSummary: true`. Marked as `[key: string]: unknown` in the type pending probe; v2 can tighten the schema once we see real responses.
- **Maximum match list size.** Some tree persons could have hundreds of record hints. If we see lists in the thousands, v2 may need a `limit` parameter to cap the response.
- **Cross-tool sharing of validation/HTTP logic.** The spec assumes a single shared client file. If implementation reveals enough per-tool divergence to justify per-tool HTTP code, that's a fine deviation to record in the implementation PR.
