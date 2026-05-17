# `match_two_examples` MCP Tool — Implementation Spec

## Overview

An MCP tool that asks FamilySearch's `matchTwoExamples` API whether two
record extractions describe the same real-world person. The caller passes
two **simplified-GedcomX documents** (exactly as the LLM received them
from prior tool calls) plus two **person ids** identifying which person
in each document is the focus of the comparison. The tool inflates the
GedcomX, adds a `sourceDescription` anchor pointing at each focus
person, POSTs to FamilySearch, and returns a small match result to the
LLM.

Requires authentication (OAuth tokens obtained via the `login` tool).
Uses the website-service endpoint at
`https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples`.

The tool is the **verify** primitive of the genealogy toolkit. It chains
naturally after `search`:

```
search(name, place, year)                                    // find candidates
   ↓
LLM holds simplified-GedcomX of each candidate in its memory
   ↓
(user picks two and asks: "are result 1 and result 10 the same person?")
   ↓
LLM calls match_two_examples(gedcomx1, primaryId1, gedcomx2, primaryId2)
```

The matching algorithm uses name + date + place. Parent context, when
provided, improves accuracy for ambiguous cases (common names, fuzzy
dates). For strong-signal matches the algorithm scores essentially the
same with or without parents.

---

## Input

Four required fields: two simplified-GedcomX documents and two
in-document person IDs identifying which person in each document is
the focus of the comparison.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `gedcomx1` | `SimplifiedGedcomX` | yes | First record's full simplified-GedcomX document — exactly as the LLM received it from a prior tool call (typically `search`). May contain multiple persons (focus + parents + relatives). Sent as `entries[0]` to the FS API. |
| `primaryId1` | string | yes | The in-document `id` of the person in `gedcomx1` to match against (e.g. `"I1"`, `"primaryPerson"`). Must match a `persons[].id` in `gedcomx1`. |
| `gedcomx2` | `SimplifiedGedcomX` | yes | Second record's full simplified-GedcomX document. Sent as `entries[1]`. |
| `primaryId2` | string | yes | The in-document `id` of the focus person in `gedcomx2`. Must match a `persons[].id` in `gedcomx2`. |

### Why this shape?

The LLM stores simplified-GedcomX documents in its conversation context
after a search. When the user asks *"are result 1 and result 10 the same
person?"*, the LLM has both documents — it just needs to tell us **which
person in each one** is the focus. Sending `(gedcomx, id)` per side is a
**selector** pattern: the GedcomX is the document, the id picks the
person inside it.

We don't infer the primary from order (Dallan and Richard explicitly
rejected the "first person is primary" fallback in design discussion
— *"never know when they'll change it underneath"*). The id is required.

### Persistent ARKs

The simplified GedcomX should carry `persons[].ark` (the persistent FS
ARK URL) on every person — added to the simplifier in commit `e44a6dd`.
The tool relies on this: if a person has `ark`, `toGedcomX()` rebuilds
the `identifiers["http://gedcomx.org/Persistent"]` field, and the FS
API response carries real ARKs instead of `MMMM-MMM` placeholders.

If the LLM's simplified GedcomX doesn't have `ark` on the primary
persons, the API response will still match (the algorithm uses
name/date/place) but `entries[].id` and `title` will contain placeholder
ARKs. The tool surfaces this faithfully — we don't error on it.

### Example

```typescript
match_two_examples({
  gedcomx1: {
    persons: [
      {
        id: "I1",
        ark: "https://familysearch.org/ark:/61903/4:1:KGS8-LY1",
        gender: "Male",
        names: [{ preferred: true, type: "BirthName",
                  given: "Johann Georg", surname: "Hufenreuter" }],
        facts: [{ type: "Birth", date: "11Jan1758",
                  place: "Biesenrode, Schsn, Prss" }],
      },
      {
        id: "I2",
        ark: "https://familysearch.org/ark:/61903/4:1:KGS8-LY7",
        gender: "Male",
        names: [{ preferred: true, type: "BirthName",
                  given: "Johann Tobias", surname: "Hufenreuter" }],
        facts: [{ type: "Birth", date: "16Mar1721",
                  place: "Biesenrode, Schsn, Prss" }],
      },
    ],
    relationships: [
      { type: "ParentChild", parent: "I2", child: "I1" },
    ],
  },
  primaryId1: "I1",                            // ← match against Johann Georg, not his father
  gedcomx2: { /* analogous shape */ },
  primaryId2: "I1",
})
```

The tool does NOT take a `minConfidence` parameter. The query parameter
the upstream API exposes is a no-op — confirmed by Dallan in design
discussion: *"just min confidence and zero is just fine, just leave it
there."* (See "Out of Scope" below.)

---

## Output

A small object the LLM can reason over. The verbose GedcomX response
from the API is parsed and reduced.

| Field | Type | Always present? | Description |
|-------|------|-----------------|-------------|
| `matched` | boolean | yes | `true` when the API returned a `confidence` field on the entry. `false` indicates the API treated the comparison as "no real match" (confidence omitted, near-zero score). |
| `confidence` | number | only when `matched: true` | Integer 1–10. The API's coarse-bucket confidence rating. Higher is better. |
| `score` | number | yes | Float 0–1. Fine-grained match score from the API's algorithm. Near-1 means strong match; near-0 means no signal. |
| `queryArk` | string | yes | The persistent ARK of the focus person in `gedcomx1`. Parsed out of the API response's `title` field, e.g. `"Matches for ark:/61903/4:1:KGS8-LY1"`. Will be a `MMMM-MMM` placeholder if the focus person in `gedcomx1` had no `ark`. |
| `candidateArk` | string | yes | The persistent ARK of the matched person in `gedcomx2`. Comes from `entries[0].id` in the API response. Will be `MMMM-MMM` placeholder if the focus person in `gedcomx2` had no `ark`. |
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
| `primaryId1` or `primaryId2` doesn't match any `persons[].id` in the corresponding GedcomX | `"matchTwoExamples: primaryId \"<id>\" not found in <side>. Available ids in <side>: <comma-list>."` (lists valid options so Claude can self-correct and retry) |
| `gedcomx1` or `gedcomx2` is missing or has no `persons[]` array | Schema-level validation catches it before the function runs. |
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
input: { gedcomx1, primaryId1, gedcomx2, primaryId2 }
  │
  ├─ 1. Validate inputs:
  │     - gedcomx1 has a person with id === primaryId1; throw if not
  │     - gedcomx2 has a person with id === primaryId2; throw if not
  │     (Error messages list available IDs so Claude can self-correct.)
  │
  ├─ 2. toGedcomX(gedcomx1) → raw GedcomX for side 1
  │     toGedcomX(gedcomx2) → raw GedcomX for side 2
  │     - Simplifier handles: URI prefix re-addition, nameForms rebuild,
  │       persons[].identifiers from each persona's `ark` field
  │       (when present), and all the standard inverse mappings.
  │     - We do NOT pre-structure or re-assemble the persons. Whatever
  │       was in the simplified GedcomX (focus + parents + relationships)
  │       comes through into the raw GedcomX as-is.
  │
  ├─ 3. ADD a sourceDescription to each raw GedcomX:
  │       gedcomx1Raw.sourceDescriptions = [
  │         ...(gedcomx1Raw.sourceDescriptions ?? []),
  │         { id: "mainSrc", about: "#" + primaryId1 }
  │       ];
  │     (Same for gedcomx2Raw with primaryId2.)
  │     - Appended, not replaced — preserves any existing source descriptions.
  │     - This anchor tells FS which person is the focus per the docs.
  │
  ├─ 4. Build request body:
  │       { entries: [
  │         { content: { gedcomx: gedcomx1Raw } },
  │         { content: { gedcomx: gedcomx2Raw } }
  │       ] }
  │
  ├─ 5. POST to the FS URL with:
  │       Authorization: Bearer <getValidToken()>
  │       User-Agent: BROWSER_USER_AGENT
  │       Accept: application/json
  │       Content-Type: application/json
  │
  ├─ 6. Parse the response. Map to output shape:
  │     - matched = (entries[0]?.confidence !== undefined)
  │     - confidence = entries[0]?.confidence  (omitted on no-match)
  │     - score = entries[0]?.score
  │     - candidateArk = entries[0]?.id
  │     - queryArk = parse from title  (e.g. "Matches for ark:/61903/4:1:XXXX")
  │     - apiTitle = title
  │     - updated = updated
  │
  └─ return: typed MatchTwoExamplesResult
```

### Why this is simpler than the original spec draft

Per Dallan's direction in design discussion:

> "You call Pascal's toGedcomX with both GedcomXs, they come back, and
> then you edit the GedcomX that you get back, and add in the source
> description so that it's matching the right two IDs."

We don't reassemble personas, don't construct relationships, don't
restructure the GedcomX. We take whatever the LLM has, run it through
Pascal's inverter, add one sourceDescription per side, and POST.
**Total post-processing: 4 lines per side.**

---

## Files to Create

### 1. `mcp-server/src/types/matchTwoExamples.ts`

Types for tool input, tool output, and the raw API response shape.

```typescript
import type { SimplifiedGedcomX } from "./gedcomx.js";

export interface MatchTwoExamplesInput {
  gedcomx1: SimplifiedGedcomX;
  primaryId1: string;
  gedcomx2: SimplifiedGedcomX;
  primaryId2: string;
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
  MatchTwoExamplesInput,
  MatchTwoExamplesResult,
  MatchTwoExamplesApiResponse,
} from "../types/matchTwoExamples.js";
import type { SimplifiedGedcomX, GedcomX } from "../types/gedcomx.js";

const URL =
  "https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples";

export async function matchTwoExamples(
  input: MatchTwoExamplesInput,
): Promise<MatchTwoExamplesResult> {
  validateInput(input);

  const token = await getValidToken();
  const raw1 = buildRawWithAnchor(input.gedcomx1, input.primaryId1);
  const raw2 = buildRawWithAnchor(input.gedcomx2, input.primaryId2);

  const res = await fetch(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
    body: JSON.stringify({
      entries: [
        { content: { gedcomx: raw1 } },
        { content: { gedcomx: raw2 } },
      ],
    }),
  });

  // status handling per Error Handling section
  // parse to MatchTwoExamplesApiResponse and map to MatchTwoExamplesResult
}

function buildRawWithAnchor(
  simplified: SimplifiedGedcomX,
  primaryId: string,
): GedcomX {
  const raw = toGedcomX(simplified);
  raw.sourceDescriptions = [
    ...(raw.sourceDescriptions ?? []),
    { id: "mainSrc", about: "#" + primaryId },
  ];
  return raw;
}

function validateInput(input: MatchTwoExamplesInput): void {
  for (const [gedcomx, primaryId, side] of [
    [input.gedcomx1, input.primaryId1, "gedcomx1"],
    [input.gedcomx2, input.primaryId2, "gedcomx2"],
  ] as const) {
    const ids = (gedcomx?.persons ?? []).map((p) => p.id);
    if (!primaryId || !ids.includes(primaryId)) {
      throw new Error(
        `matchTwoExamples: primaryId "${primaryId}" not found in ${side}. ` +
        `Available ids in ${side}: ${ids.join(", ") || "(none)"}.`
      );
    }
  }
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
- `primaryId1` not present in `gedcomx1.persons[].id` → validation error listing available ids
- `gedcomx1.persons` is empty or missing → schema validation error
- LLM passes the wrong primaryId (e.g., parent's id instead of focus person's id) → API still returns a result, but for the wrong people. Recoverable (user notices, LLM retries with correct id).
- Focus person has no `ark` on either side → API runs, `entries[0].id` / `title` come back as `MMMM-MMM` placeholders. Surfaced faithfully in the result.

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
    "Ask FamilySearch whether two records describe the same person. Use this " +
    "when the user wants to verify whether two search results are duplicates " +
    "— typically after a `search` returned multiple records and the user picks " +
    "two to compare.\n" +
    "\n" +
    "Pass each record's full simplified-GedcomX document plus the in-document " +
    "id of the person you want to compare (e.g. \"I1\" or \"primaryPerson\"). " +
    "Each gedcomx may contain multiple persons (focus + parents); the primaryId " +
    "tells the tool which one is the focus.\n" +
    "\n" +
    "Returns a match decision with confidence (integer 1–10, omitted on " +
    "no-match) and score (float 0–1). Returns `matched: false` when the API " +
    "doesn't recognize a real match (confidence omitted, score near zero).",
  inputSchema: {
    type: "object" as const,
    properties: {
      gedcomx1: {
        type: "object",
        description:
          "First record's full simplified-GedcomX document. Pass it exactly " +
          "as received from a prior tool call (e.g. `search`)."
      },
      primaryId1: {
        type: "string",
        description:
          "The `id` of the person in gedcomx1 to compare (e.g. \"I1\"). Must " +
          "match a `persons[].id` in gedcomx1."
      },
      gedcomx2: {
        type: "object",
        description: "Second record's full simplified-GedcomX document."
      },
      primaryId2: {
        type: "string",
        description:
          "The `id` of the person in gedcomx2 to compare. Must match a " +
          "`persons[].id` in gedcomx2."
      },
    },
    required: ["gedcomx1", "primaryId1", "gedcomx2", "primaryId2"],
  },
};
```

---

## Patterns to Follow

- **Auth:** call `getValidToken()` from `src/auth/refresh.ts`. Never read tokens directly.
- **Headers:** use `BROWSER_USER_AGENT` from `src/constants.ts`. Do not hardcode the Mozilla string.
- **HTTP errors:** map each upstream status to an LLM-instruction error message per the Error Handling table. Never surface raw HTTP errors to the LLM.
- **Simplifier:** use `toGedcomX()` from `src/utils/gedcomx-convert.ts`. Do not roll your own inflation logic.
- **Minimal post-processing:** call `toGedcomX()` on the LLM's input as-is, then append one `sourceDescription` per side anchored to the primary id. Do not restructure persons, do not add identifiers (the simplifier handles them via the `ark` field), do not normalize ids.

---

## Out of Scope for v1

- **`minConfidence` parameter.** The upstream API ignores it (normalizes to 0); exposing it would mislead the caller. Confirmed by Dallan: hardcode to 0, don't surface as a tunable. Filter client-side on `confidence`/`score` if a threshold is ever needed.
- **`date.formal` round-trip.** The simplifier intentionally drops formal dates. The algorithm uses `date.original` and doesn't need formal.
- **Multiple ARK identifiers per person.** Only the first `http://gedcomx.org/Persistent` ARK (via `persons[].ark`) is used.
- **Match against multiple candidates in one call.** The API name is `matchTwoExamples` — exactly two entries per call. Batch processing is the caller's responsibility.
- **Tree-merge use case.** The platform endpoint `api.familysearch.org/platform/tree/persons/matches` is a different operation (find merge candidates for a tree person). If we eventually want that, it's a separate tool.
- **Restructuring the input GedcomX.** The tool passes whatever the LLM provides through `toGedcomX()` unchanged. It does not re-assemble persons, build relationships, or normalize ids. If the input has parents-and-relationships, they go to the API. If it's focus-only, that goes too. The only modification is appending one `sourceDescription` for the primary anchor.

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

- **Function signature redesigned per Dallan's direction** (meeting on 2026-05-17). The tool now takes `(gedcomx1, primaryId1, gedcomx2, primaryId2)` — full simplified-GedcomX documents plus selector ids — instead of the earlier `{ query: { ark, persona, parents? }, candidate: { ark, persona, parents? } }` shape. Reasons:
  - The LLM already holds simplified-GedcomX in its context from prior tool calls; making it restructure into a custom shape is unnecessary work and an error surface.
  - The id is a *selector* into a multi-person document, not a redundant copy of data. The GedcomX has multiple persons; the id picks which one is the focus.
  - "First person is primary" was explicitly rejected as a fallback (*"never know when they'll change it underneath"*).
- **Source description added by this tool, not by the simplifier.** Dallan: *"The source description, it's okay to throw that away [from the simplifier], but the ID should not be thrown away."* The tool appends `{ id: "mainSrc", about: "#<primaryId>" }` to each side's GedcomX after `toGedcomX()`.
- **Identifiers/ARKs are preserved by the simplifier** as of commit `e44a6dd` (`ark` field on `SimplifiedPerson`). The tool doesn't post-process this — `toGedcomX()` puts the ARKs back into `identifiers["...Persistent"]` automatically.
- **Confirmed `minConfidence` is a no-op upstream**; not exposed as a tool parameter.
- **Confirmed non-match response shape** (`confidence` field omitted, near-zero score) — drives the `matched: boolean` derivation.
- **Tool's internal post-processing** is now ~4 lines per side: pass the simplified GedcomX through `toGedcomX()`, append one sourceDescription. No restructuring, no person assembly.
