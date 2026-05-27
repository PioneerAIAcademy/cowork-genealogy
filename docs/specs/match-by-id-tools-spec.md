# Match-by-ID Tools — Spec

Four MCP tools that query the FamilySearch match-resolutions API. Each
tool answers a different user question but shares one upstream endpoint
and one helper function.

| Tool                     | Input ARK prefix | Target collection | Question it answers                          |
|--------------------------|------------------|-------------------|----------------------------------------------|
| `person_record_matches`  | `4:1:` (tree)    | `records`         | What records match this tree person?         |
| `record_person_matches`  | `1:1:` (record)  | `tree`            | What tree people match this record persona?  |
| `person_person_matches`  | `4:1:` (tree)    | `tree`            | What tree people are possible duplicates?    |
| `record_record_matches`  | `1:1:` (record)  | `records`         | What other records describe the same person? |

These are the standard *matches* primitives: paired with `record_search`
and `tree_read`, they let Claude pivot between tree and record worlds.

Requires authentication (OAuth tokens via the `login` tool).

Source issue: <https://github.com/PioneerAIAcademy/cowork-genealogy/issues/176>.

---

## Endpoint

```
GET https://sg30p0.familysearch.org/search/match/resolutions/match/matches
```

Authenticated. Standard FamilySearch tools use this exact host plus the
shared browser `User-Agent` constant — these tools must do the same.

---

## Input

All four tools take the same input shape:

```typescript
{
  id: string;                                         // required
  minConfidence?: 1 | 2 | 3 | 4 | 5;                  // default 2
  status?: Array<"accepted" | "pending" | "rejected">; // default all three
  includeSummary?: boolean;                           // default false
  count?: number;                                     // 1..50, default 20
}
```

### `id` — required

Either a bare FamilySearch personId (e.g. `"KD96-TV2"`, `"QPTX-TMQ2"`)
or a full ARK. The tool prepends the correct prefix (`4:1:` for tree
tools, `1:1:` for record tools) if the user supplies just a pid. If the
user supplies a full ARK, the tool validates the prefix matches the
tool's contract and rejects mismatches with a clear error.

Examples that all resolve to `ark:/61903/4:1:KNDX-MKG` inside
`person_record_matches` and `person_person_matches`:

- `"KNDX-MKG"`
- `"ark:/61903/4:1:KNDX-MKG"`
- `"https://familysearch.org/ark:/61903/4:1:KNDX-MKG"`

Examples that **error** inside `person_record_matches` (which expects a
tree person):

- `"ark:/61903/1:1:QPTX-TMQ2"` → "Expected a tree person ARK
  (`ark:/61903/4:1:...`) but received a record persona ARK
  (`1:1:`). Did you mean `record_record_matches`?"

### `minConfidence` — optional

Integer 1..5. Higher = stronger matches only. FS API default is 1; we
default to **2** to filter out the weakest noise while still surfacing
plausible candidates.

### `status` — optional

Array of zero or more of `"accepted"`, `"pending"`, `"rejected"`.

| User intent                                    | Recommended status                       |
|------------------------------------------------|------------------------------------------|
| "What is currently attached?"                  | `["accepted"]`                            |
| "What hints should I review?"                  | `["pending"]`                             |
| "What was already ruled out?"                  | `["rejected"]`                            |
| "Show me everything that's been touched"       | `["accepted", "pending", "rejected"]` (default) |

**Critical default behavior:** the raw API defaults to `Pending` only
when the caller omits `status`. Our tools default to **all three** so
the LLM sees the full picture unless it explicitly narrows. This is a
deliberate divergence from the upstream default — the issue's curl
example also uses all three.

The values are sent lowercase as repeated `status=` query params. The
upstream API accepts both lowercase (`accepted`) and the URI form
(`http://familysearch.org/v1/Accepted`); we use the lowercase form.

### `includeSummary` — optional

When `true`, each match includes the full GEDCOMX summary of the
matched entity (persons, places, source descriptions). Default `false`
keeps responses compact.

### `count` — optional

Result page size. FS API default is 5 — too small for a useful
LLM-facing tool. We default to **20** and clamp to `[1, 50]`.

### What we deliberately don't expose

- `includeFlags` — when populated, surfaces per-match boolean flags on
  `matchInfo[]` (e.g. `hasFourOrMorePeople`, `addsOtherFact`) that
  would be useful to a `tree-edit` skill. We don't expose it yet:
  with the team's shared internal-dev token, sending `includeFlags=true`
  silently returns `{"entries": []}` for every call we tested,
  including the exact shape that works on Richard's account. The
  divergence is the OAuth scope/permission set on the token, not the
  param itself. Worth revisiting once we know what unlocks it. Sending
  `none`/`false`/omitted behave identically (server default `none`);
  `all`/`person` return `400 Bad Request`.

---

## Output

Same shape for all four tools:

```typescript
{
  queryArk: string;     // The full ARK we actually sent (after normalization)
  resultCount: number;  // body.results — total matches at this status/confidence
  returned: number;     // entries.length — what came back in this response
  title: string;        // body.title — e.g. "Matches for ark:/61903/4:1:KNDX-MKG"
  updated: string;      // body.updated — ISO timestamp of the last index refresh
  matches: Array<{
    ark: string;                                              // full persistent URL
    pid: string;                                              // bare personId
    arkType: "1:1:" | "4:1:";
    confidence: 1 | 2 | 3 | 4 | 5;
    score: number;                                            // 0..1
    title: string;                                            // source/collection title
    status: "accepted" | "pending" | "rejected";
    collection: string;                                       // matchInfo[0].collection URI
    published?: string;                                       // ISO timestamp
    summary?: SimplifiedSummary;                              // only when includeSummary=true
  }>;
}
```

The status URI form returned by the API
(`http://familysearch.org/v1/Accepted`) is mapped back to bare lowercase
(`"accepted"`) before returning to the LLM, matching the input shape.

The `arkType` is derived from the `id` field — `1:1:` for record
personas, `4:1:` for tree people.

### `summary` — only when `includeSummary=true`

Pass-through of `entry.content.gedcomx`. We do **not** run this through
`toSimplified()` from `gedcomx-convert` yet — the summary is a
single-person GEDCOMX with sourceDescriptions, not a full record GEDCOMX,
and the simplifier has not been tested against this shape. Future
revision may add simplification once we confirm the round-trip works.

---

## Real example (verified live, 2026-05-25)

`person_record_matches({ id: "KNDX-MKG" })` (George Washington, tree
person, status defaulting to all three):

Sent:
```
GET https://sg30p0.familysearch.org/search/match/resolutions/match/matches?
  collection=records&
  id=ark:/61903/4:1:KNDX-MKG&
  minConfidence=2&
  status=accepted&status=pending&status=rejected&
  count=20
```

Received (truncated): `{ title: "Matches for ark:/61903/4:1:KNDX-MKG",
results: 3, entries: [3 entries — 1 accepted, 2 rejected], updated:
"2025-09-11T..." }`.

Mapped output:
```jsonc
{
  "queryArk": "ark:/61903/4:1:KNDX-MKG",
  "resultCount": 3,
  "returned": 3,
  "title": "Matches for ark:/61903/4:1:KNDX-MKG",
  "updated": "2025-09-11T16:56:42.040Z",
  "matches": [
    {
      "ark": "https://familysearch.org/ark:/61903/1:1:QPZP-Y6G4",
      "pid": "QPZP-Y6G4",
      "arkType": "1:1:",
      "confidence": 5,
      "score": 0.97402465,
      "title": "BillionGraves Index",
      "status": "accepted",
      "collection": "https://familysearch.org/platform/collections/records",
      "published": "2024-09-19T20:07:47.508Z"
    }
    // ...two more
  ]
}
```

---

## Errors

| Condition                                | Behavior                                                                                       |
|------------------------------------------|------------------------------------------------------------------------------------------------|
| Not logged in                            | Throws `getValidToken()`'s standard "User is not logged in to FamilySearch. Call the login tool to authenticate." |
| Empty `id`                               | Throws "`<tool_name>` requires a non-empty id (e.g. `\"KNDX-MKG\"`)."                          |
| `id` is a full ARK with the wrong prefix | Throws "Expected `<expected-prefix>` ARK but received `<actual-prefix>`. Did you mean `<sibling-tool>`?" |
| `id` has unrecognized shape              | Throws "Unrecognized id `<value>`. Expected a personId (e.g. `\"KNDX-MKG\"`) or a full FamilySearch ARK." |
| `minConfidence` out of `[1, 5]`          | Throws "minConfidence must be 1..5."                                                          |
| `count` out of `[1, 50]`                 | Throws "count must be 1..50."                                                                 |
| `status[]` contains unknown value        | Throws "Unknown status `<value>`. Expected `accepted`, `pending`, or `rejected`."             |
| Upstream 401                             | Re-throws as "FamilySearch match API rejected the request: 401 Unauthorized. Call the login tool to authenticate." |
| Upstream 400 (bad ARK)                   | Re-throws as "FamilySearch rejected the id `<value>` as a malformed ARK."                     |
| Upstream non-2xx                         | Re-throws as "FamilySearch match API error: `<status> <statusText>`."                         |
| Network error                            | Re-throws as "Could not reach FamilySearch match API: `<message>`."                           |
| Response not JSON / missing entries      | Throws "FamilySearch match API returned an unexpected response body."                          |

No retries — single attempt per call. Callers can retry if they hit
network errors. (This matches `tree_read` and `match_two_examples`.)

---

## Auth

Uses `getValidToken()` from `src/auth/refresh.ts`. Passes the token as
`Authorization: Bearer <token>`. Sends `User-Agent: BROWSER_USER_AGENT`
from `src/constants.ts` (FS WAF rejects non-browser UAs). Do not
re-implement token logic.

---

## What NOT to do

- Don't send `includeFlags=true` — silent empty-response bug.
- Don't accept arbitrary ARK prefixes (e.g. `1:2:` record sources,
  `3:1:` images) — only `1:1:` and `4:1:`.
- Don't omit `status` — the upstream default is `Pending` only, which
  hides accepted matches.
- Don't try to paginate beyond a single page — the API exposes
  `links.self.href` but no `next`-link in our probed responses.
  Callers needing more results pass a larger `count` (up to 50).
- Don't reuse `count` from `match_two_examples` — that tool is a POST
  with a totally different shape. These are GET, share nothing beyond
  the auth helper.

---

## Downstream consumers

These tools enable a class of "given this entity, what are its
neighbours" skills:

- `tree-edit` skill can suggest record attachments via
  `person_record_matches`.
- `record-extraction` skill can warn about already-attached records
  via `record_person_matches`.
- A future `merge-candidate` skill can use `person_person_matches`.
- `record-extraction` can suggest collateral records via
  `record_record_matches`.

None of these consumers are written yet — this issue only ships the
tools. Skill wiring is downstream work.

---

## Test plan

- Unit tests (`tests/tools/match-by-id.test.ts`) with mocked `fetch`:
  - Input validation (bare pid, full ARK same prefix, full ARK wrong
    prefix, empty, malformed) for one tool, plus a smoke check that
    each of the other three uses the right (collection, prefix) combo.
  - URL construction: every required + default query param appears
    exactly once in the URL; `status[]` repeats correctly.
  - `includeFlags` is NEVER part of the URL (it would trigger the
    upstream bug).
  - Happy-path parsing of a populated entry (`status` URI → lowercase,
    `id` URL → pid + ark + arkType, `matchInfo[0].collection`).
  - `includeSummary=true` passes through `content.gedcomx` as `summary`.
  - 401 / 400 / 500 / network-error paths produce the spec'd messages.
- Live smoke (`dev/try-match-by-id.ts`) hit each of the 4 tools against
  the verified Lincoln + Washington ARKs.
- Full `npm test` must pass with all pre-existing tests still green.
