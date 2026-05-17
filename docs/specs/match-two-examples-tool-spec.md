# `match_two_examples` MCP Tool — Implementation Spec

## Overview

An MCP tool that asks FamilySearch's `matchTwoExamples` API whether two
record extractions describe the same real-world person. The caller passes
two simplified-GedcomX personas (a "query" and a "candidate", each with
optional parent context). The tool inflates them to verbose GedcomX,
POSTs to FamilySearch, and returns a small match result to the LLM.

Requires authentication (OAuth tokens obtained via the `login` tool).
Uses the website-service endpoint at
`https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples`.

The tool is the **verify** primitive of the genealogy toolkit. It chains
naturally after `search`:

```
search(name, place, year)               // find candidates
   ↓
(user picks two candidates)
   ↓
match_two_examples(query, candidate)    // "are these the same person?"
```

The matching algorithm uses name + date + place. Parent context, when
provided, improves accuracy for ambiguous cases (common names, fuzzy
dates). For strong-signal matches the algorithm scores essentially the
same with or without parents.

---

## Input

Two required personas, each carrying its persistent ARK identifier
alongside the simplified persona data.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | `MatchPersonaInput` | yes | The person being asked about. Becomes `entries[0]` in the API request. The API response's `title` field references this persona's ARK. |
| `candidate` | `MatchPersonaInput` | yes | The possible duplicate. Becomes `entries[1]`. The API response's `entries[].id` field references this persona's ARK on a match. |

### `MatchPersonaInput`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ark` | string | **yes** | The persistent FS ARK URL for this person (e.g. `https://familysearch.org/ark:/61903/4:1:KGS8-LY1`). Required — without it the API returns `MMMM-MMM` placeholders in the response. |
| `persona` | `SimplifiedPerson` | yes | The focus person's simplified-format data (gender, names, facts). The `persona.id` is used as the in-document anchor; if omitted, the tool generates `primaryPerson`. The `persona.ark` field, if present, is overridden by the top-level `ark`. |
| `parents` | `MatchPersonaInput[]` | no | Up to two parent personas. Each carries the same shape: `{ ark, persona }`. Optional; improves matching accuracy for ambiguous cases. |

### Example

```typescript
match_two_examples({
  query: {
    ark: "https://familysearch.org/ark:/61903/4:1:KGS8-LY1",
    persona: {
      id: "primaryPerson",
      gender: "Male",
      names: [{ preferred: true, type: "BirthName",
                given: "Johann Georg", surname: "Hufenreuter" }],
      facts: [{ type: "Birth", date: "11Jan1758",
                place: "Biesenrode, Schsn, Prss" }],
    },
    parents: [
      { ark: "https://familysearch.org/ark:/61903/4:1:KGS8-LY7",
        persona: { id: "father", gender: "Male",
                   names: [{ preferred: true, type: "BirthName",
                             given: "Johann Tobias", surname: "Hufenreuter" }],
                   facts: [{ type: "Birth", date: "16Mar1721",
                             place: "Biesenrode, Schsn, Prss" }] } },
    ],
  },
  candidate: {
    ark: "https://familysearch.org/ark:/61903/4:1:KCWM-J9H",
    persona: { /* same shape as query.persona */ },
  },
})
```

The tool does NOT take a `minConfidence` parameter. The query parameter
the upstream API exposes is a no-op (see "Out of Scope" below).

---

## Output

A small object the LLM can reason over. The verbose GedcomX response
from the API is parsed and reduced.

| Field | Type | Always present? | Description |
|-------|------|-----------------|-------------|
| `matched` | boolean | yes | `true` when the API returned a `confidence` field on the entry. `false` indicates the API treated the comparison as "no real match" (confidence omitted, near-zero score). |
| `confidence` | number | only when `matched: true` | Integer 1–10. The API's coarse-bucket confidence rating. Higher is better. |
| `score` | number | yes | Float 0–1. Fine-grained match score from the API's algorithm. Near-1 means strong match; near-0 means no signal. |
| `queryArk` | string | yes | The ARK passed in as `query.ark`. Echoed for clarity. |
| `candidateArk` | string | yes | The ARK passed in as `candidate.ark`. Echoed for clarity. |
| `apiTitle` | string | yes | The raw `title` field from the API response, e.g. `"Matches for ark:/61903/4:1:KGS8-LY1"`. Surfaced so the LLM can confirm which persona was treated as the query. |
| `updated` | string | yes | ISO timestamp from the API response. Useful for debugging. |

### Example output

```json
{
  "matched": true,
  "confidence": 5,
  "score": 0.99983513,
  "queryArk": "https://familysearch.org/ark:/61903/4:1:KGS8-LY1",
  "candidateArk": "https://familysearch.org/ark:/61903/4:1:KCWM-J9H",
  "apiTitle": "Matches for ark:/61903/4:1:KGS8-LY1",
  "updated": "2026-05-15T01:58:23.913Z"
}
```

### Non-match example

```json
{
  "matched": false,
  "score": 2.4603711e-8,
  "queryArk": "https://familysearch.org/ark:/61903/4:1:KGS8-LY1",
  "candidateArk": "https://familysearch.org/ark:/61903/4:1:NONMATCH",
  "apiTitle": "Matches for ark:/61903/4:1:KGS8-LY1",
  "updated": "2026-05-15T02:03:48.073Z"
}
```

Note: `confidence` is omitted. The score is essentially zero. `matched: false`.

---

## Error Handling

All errors are LLM-instruction errors (the message tells Claude what to
do next), thrown as `Error` objects.

| Condition | Throw message |
|-----------|--------------|
| No FamilySearch session (no tokens / refresh failed) | `"User is not logged in to FamilySearch. Call the login tool to authenticate."` (re-raised from `getValidToken()`) |
| API returns 401 | `"FamilySearch session not accepted; call the login tool to re-authenticate."` |
| API returns 403 with Imperva body (errorCode 15) | `"FamilySearch matchTwoExamples blocked by WAF. The User-Agent header was rejected — check that the MCP server is running an unmodified build."` |
| API returns 400 with JSON body | `"FamilySearch matchTwoExamples rejected the payload: ${detail-from-body}."` |
| API returns other 4xx/5xx | `"FamilySearch matchTwoExamples API error: ${status} ${statusText}."` |
| Required input field missing (no `query.ark` / `candidate.ark` / `query.persona` / `candidate.persona`) | `"matchTwoExamples requires both 'query' and 'candidate', each with 'ark' and 'persona' fields. See the tool description for the expected shape."` |
| `fetch()` itself fails (network) | `"Could not reach FamilySearch matchTwoExamples API: ${error.message}."` |

---

## FamilySearch matchTwoExamples API Reference

**Endpoint:**
```
POST https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples
```

**Required headers:**
```
Authorization: Bearer <access token from getValidToken()>
Accept: application/json
Content-Type: application/json
User-Agent: <BROWSER_USER_AGENT from src/constants.ts>
```

The `User-Agent` must be the browser-style Mozilla string (the same one
`collections`, `search`, `external_links`, `image-reader` use). The
literal string `"fs-search-agent"` suggested in the issue triggers an
Imperva WAF block (errorCode 15).

**Query parameters:**

The endpoint accepts `?minConfidence=N` but **ignores it**. The API
normalizes to `minConfidence=0` internally regardless of value sent.
The tool omits the parameter.

**Request body shape:**

```json
{
  "entries": [
    { "content": { "gedcomx": <query-side verbose GedcomX> }},
    { "content": { "gedcomx": <candidate-side verbose GedcomX> }}
  ]
}
```

Each entry's `gedcomx` must include:
- `persons[]` with at least one person carrying `identifiers["http://gedcomx.org/Persistent"]` — required for the API to return real ARKs in the response.
- `sourceDescriptions[]` with `{ id: "mainSrc", about: "#<primary-id>" }` declaring which person is the focus. Per the FS docs ([Person Matches by Example resource](https://www.familysearch.org/developers/docs/api/tree/Person_Matches_by_Example_resource)), this is required. The API tolerates absence (falls back to `persons[0]`) but the tool always emits it.
- Optionally `relationships[]` of `ParentChild` linking parent personas to the primary.

**Response shape (200 OK):**

```json
{
  "entries": [
    {
      "confidence": 5,                                      // int 1–10; OMITTED on no-match
      "id": "https://familysearch.org/ark:/61903/4:1:<CAND>",  // candidate ARK
      "score": 0.99983513                                   // float 0–1
    }
  ],
  "links": { "self": { "href": "/match-ws/match/matchTwoExamples?minConfidence=0" }},
  "results": 1,
  "title": "Matches for ark:/61903/4:1:<QUERY>",
  "updated": "2026-05-15T01:58:23.913Z"
}
```

Note: even for non-matches the API returns `results: 1` with one `entries[]`
item. The signal for "no real match" is the **absence of the `confidence`
field** on the entry, paired with a near-zero `score` (~1e-8).

---

## Internal Pipeline

The tool's `match_two_examples()` function:

```
input: { query: MatchPersonaInput, candidate: MatchPersonaInput }
  │
  ├─ 1. Validate: both have `ark` and `persona`. Throw if not.
  │
  ├─ 2. For each side (query, candidate), build a SimplifiedGedcomX:
  │     - persons: [primary, ...parents]    (primary first)
  │     - relationships: ParentChild edges from each parent to primary
  │     - sources: [{ id: "mainSrc", url: "#<primary-id>" }]
  │     - Ensure each persona has an `ark` (use input.ark if persona.ark is empty)
  │     - Generate stable in-document IDs: "primaryPerson", "father", "mother"
  │
  ├─ 3. toGedcomX(simplified) → verbose GedcomX for each side
  │     - Simplifier handles: URI prefix re-addition, nameForms rebuild,
  │       sourceDescriptions with `about` anchor from `sources[].url`,
  │       `identifiers["...Persistent"]` from `ark`.
  │     - No post-processing needed.
  │
  ├─ 4. Build request body: { entries: [{content:{gedcomx: Q}}, {content:{gedcomx: C}}] }
  │
  ├─ 5. POST to URL with Bearer + browser UA + Accept JSON
  │
  ├─ 6. Parse response. Map to output shape:
  │     - matched = (entries[0]?.confidence !== undefined)
  │     - confidence = entries[0]?.confidence
  │     - score = entries[0]?.score
  │     - candidateArk = entries[0]?.id
  │     - queryArk = parse from title  OR  use input.query.ark
  │     - apiTitle = title
  │     - updated = updated
  │
  └─ return: typed MatchTwoExamplesResult
```

---

## Files to Create

### 1. `mcp-server/src/types/matchTwoExamples.ts`

Types for tool input, tool output, and the raw API response shape.

```typescript
import type { SimplifiedPerson } from "./gedcomx.js";

export interface MatchPersonaInput {
  ark: string;
  persona: SimplifiedPerson;
  parents?: MatchPersonaInput[];
}

export interface MatchTwoExamplesInput {
  query: MatchPersonaInput;
  candidate: MatchPersonaInput;
}

export interface MatchTwoExamplesResult {
  matched: boolean;
  confidence?: number;
  score: number;
  queryArk: string;
  candidateArk: string;
  apiTitle: string;
  updated: string;
}

// Raw upstream response shape — internal use only.
export interface MatchTwoExamplesApiResponse {
  entries: Array<{
    confidence?: number;
    id: string;
    score: number;
  }>;
  links?: { self?: { href?: string } };
  results: number;
  title: string;
  updated: string;
}
```

### 2. `mcp-server/src/tools/matchTwoExamples.ts`

The tool function + the MCP schema. Pattern mirrors `searchWiki.ts` (thin
HTTP wrapper) and `collections.ts` (authenticated FS service tier with
browser UA).

```typescript
import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { toGedcomX } from "../utils/gedcomx-convert.js";
import type {
  MatchPersonaInput,
  MatchTwoExamplesInput,
  MatchTwoExamplesResult,
  MatchTwoExamplesApiResponse,
} from "../types/matchTwoExamples.js";
import type { SimplifiedGedcomX } from "../types/gedcomx.js";

const URL =
  "https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples";

export async function matchTwoExamples(
  input: MatchTwoExamplesInput,
): Promise<MatchTwoExamplesResult> {
  validateInput(input);

  const token = await getValidToken();
  const queryGedcomx = buildEntryGedcomX(input.query);
  const candidateGedcomX = buildEntryGedcomX(input.candidate);

  const res = await fetch(URL, { /* ... */ });
  // handle status codes per Error Handling section
  // parse and map to MatchTwoExamplesResult per Internal Pipeline step 6
}

function buildEntryGedcomX(entry: MatchPersonaInput): GedcomX {
  // construct SimplifiedGedcomX with primary + parents + ParentChild rels
  // + sources[].url anchor
  // call toGedcomX()
}

export const matchTwoExamplesSchema = { /* see Tool Schema section */ };
```

### 3. `mcp-server/dev/try-match-two-examples.ts`

One-shot smoke test calling the function directly with the Hufenreuter
example. Mirrors `dev/try-search-wiki.ts`.

### 4. `mcp-server/tests/tools/match-two-examples.test.ts`

Vitest with mocked `fetch`. Cases to cover:

- Happy path → matched=true with confidence + score + ARKs
- No-match (entries[0] has no `confidence`) → matched=false
- 401 → re-login error
- 403 with Imperva body → WAF error
- 400 with JSON detail → quote the detail
- Missing `ark` on input → validation error
- Missing `persona` on input → validation error
- Empty `parents` array (or omitted) → builds entry without ParentChild relationships

---

## Files to Modify

### `mcp-server/src/index.ts`

Three additions in the same pattern as other tools:

1. Import: `import { matchTwoExamples, matchTwoExamplesSchema, type MatchTwoExamplesInput } from "./tools/matchTwoExamples.js";`
2. Schema in `ListToolsRequestSchema` array.
3. `if (request.params.name === "match_two_examples") { ... }` block in `CallToolRequestSchema`.

---

## Tool Schema

```typescript
export const matchTwoExamplesSchema = {
  name: "match_two_examples",
  description:
    "Ask FamilySearch whether two record extractions describe the same person. " +
    "Use this when the user wants to verify a potential duplicate between two " +
    "records — typically after a search returns multiple candidates and the " +
    "user picks two to compare. Pass each persona's persistent ARK URL alongside " +
    "their simplified-format data (name, gender, birth date+place). Returns a " +
    "match decision with confidence (1–10 integer) and score (0–1 float). " +
    "Returns `matched: false` when no real match is detected.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "object", description: "The person being asked about. ..." },
      candidate: { type: "object", description: "The possible duplicate. ..." },
    },
    required: ["query", "candidate"],
  },
};
```

(Schema details elided here — see types in `types/matchTwoExamples.ts`.)

---

## Patterns to Follow

- **Auth:** call `getValidToken()` from `src/auth/refresh.ts`. Never read tokens directly.
- **Headers:** use `BROWSER_USER_AGENT` from `src/constants.ts`. Do not hardcode the Mozilla string.
- **HTTP errors:** map each upstream status to an LLM-instruction error message per the Error Handling table. Never surface raw HTTP errors to the LLM.
- **Simplifier:** use `toGedcomX()` from `src/utils/gedcomx-convert.ts`. Do not roll your own inflation logic.
- **No post-processing:** if the simplified input is properly shaped (ark on each persona, `sources[].url` for the anchor), `toGedcomX()` produces an API-ready payload. Do not add identifiers or sourceDescriptions manually after the call.

---

## Out of Scope for v1

- **`minConfidence` parameter.** The upstream API ignores it (normalizes to 0); exposing it would mislead the caller. Filter client-side if needed.
- **`date.formal` round-trip.** The simplifier intentionally drops formal dates. The algorithm uses `date.original` and doesn't need formal.
- **Multiple ARK identifiers per person.** Only the first `http://gedcomx.org/Persistent` ARK is used.
- **Match against multiple candidates in one call.** The API name is `matchTwoExamples` — exactly two entries per call. Batch processing is the caller's responsibility.
- **Tree-merge use case.** The platform endpoint `api.familysearch.org/platform/tree/persons/matches` is a different operation (find merge candidates for a tree person). If we eventually want that, it's a separate tool.

---

## Evidence Trail (probes committed on `10-match-two-examples`)

Behavioral claims in this spec are backed by live-API probes under
`mcp-server/dev/probe-match-*.ts`:

| Probe | What it proves |
|-------|---------------|
| `probe-match-baseline.ts` | API works end-to-end with the canonical recipe (Bearer + browser UA + Accept JSON). Parameterized for ad-hoc testing via `FS_ACCESS_TOKEN` env var. |
| `probe-match-ua-comparison.ts` | Back-to-back A/B confirming `User-Agent` is the sole WAF-deciding variable. `fs-search-agent` → 403, Mozilla → 200, same machine same token same second. |
| `probe-match-confidence-levels.ts` | `?minConfidence=N` is a no-op for N ∈ {0, 2, 5, 6, 10, 20} — every response identical. API normalizes to `minConfidence=0` (visible in `links.self.href`). |
| `probe-match-symmetry.ts` | Algorithm is symmetric (same score either direction). Response framing follows input order: `entries[0]` is query (referenced by `title`), `entries[1]` is candidate (referenced by `entries[].id`). |
| `probe-match-focus-only.ts` | For strong-signal matches (name + date + place all match), `confidence` and `score` are identical with or without parent context. Parents likely matter more for ambiguous cases. |
| `probe-match-nomatch.ts` | Non-match response: `confidence` field is omitted; `score` is ~1e-8. API still returns `results: 1` with placeholder behaviour for the candidate `id`. |
| `probe-roundtrip-vs-api.ts` | A/B confirming `identifiers["...Persistent"]` is required on persons for the API response to carry real ARKs. Without it, response has `MMMM-MMM` placeholders. |
| `probe-roundtrip-proper.ts` | Confirms `sourceDescriptions[].about: "#primaryPerson"` survives the simplifier round-trip (mapped through `sources[].url` in the simplified shape). |

---

## Open Questions (deferred to integration testing)

- **Rate limits.** Not stress-tested. Will be discovered when tool is used in real Cowork sessions.
- **Score determinism.** Observed scores vary ~0.001 between calls with the same payload (likely embedding noise upstream). Spec doesn't promise bit-exact reproducibility.
- **Sensitivity to ambiguous matches.** Strong-signal Hufenreuter case scored 0.99996 with or without parents. Behavior on common names with conflicting facts is untested; worth probing once the tool sees real usage.

---

## What changed from earlier drafts

- Removed the post-processing step for identifiers — preserved by the simplifier as of commit `e44a6dd` (`ark` field on `SimplifiedPerson`).
- Removed the post-processing step for the `sourceDescriptions[].about` anchor — preserved by the simplifier via the `sources[].url` mapping.
- Confirmed `minConfidence` is a no-op upstream; removed from tool input.
- Confirmed non-match response shape (`confidence` field omitted, near-zero score) — drives the `matched: boolean` derivation.
