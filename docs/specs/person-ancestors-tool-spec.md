# Person Ancestors Tool — Implementation Spec

## Overview

An MCP tool that reads a person's **pedigree** from the FamilySearch
Family Tree: given one tree-person ID, it returns that person plus up to
N generations of ancestors, each tagged with its **Ahnentafel
(ascendancy) number** so the caller can reconstruct the tree. Results
are returned as simplified GedcomX.

Requires authentication (OAuth tokens from the `login` tool). Wraps the
documented FamilySearch platform endpoint
`GET /platform/tree/ancestry` ("Read Ancestry").

This is the **walk-up-the-tree** primitive. It complements:

- `person_search` — find a candidate person in the tree (returns a
  tree-person ID).
- `person_read` — read one person plus immediate relatives (parents,
  spouses, children).
- **`person_ancestors`** (this tool) — read many generations upward in
  one call, as a numbered pedigree.

```
person_search({ surname, givenName, ... })   // find the starting person
  ↓  user picks one → personId (e.g. "LZJW-C31")
person_ancestors({ personId, generations: 4 })   // walk up 4 generations
```

### The ascendancy number (the one field we add — and why)

The endpoint returns a flat list of persons (up to 215 at
`generations=8`) and — confirmed by probe — **no parent-child
relationships at all**. The *only* thing encoding the tree structure is
the **ascendancy number** FamilySearch puts on each person
(`display.ascendancyNumber`). It is the classic Ahnentafel numbering:

- `1` = the starting person (the root).
- `1-S` = the root's spouse. The `-S` suffix marks a spouse; the root's
  spouse is returned by default.
- `2` = father, `3` = mother.
- Rule: a person numbered *n* has father *2n* and mother *2n + 1*.

So `4`/`5` are the father's parents, `6`/`7` are the mother's parents,
and so on. **`ascendancyNumber` is a string** (`"1"`, `"2"`, `"1-S"`),
not an integer — the `-S` suffix and future variants require it.

`toSimplified` reads only `names`, `gender`, `facts`, and `identifiers`
— it never looks at the `display` block, so the ascendancy number is
**not carried through conversion**. Because simplified GedcomX has no
slot for a pedigree position, this tool **re-attaches the number onto
each converted person afterward** (read from the raw person still in
hand). This is the identical move `person_read` makes to re-attach
`living`. Without it the output would be a meaningless flat list, so this
one addition is what makes "convert the results" preserve the result's
meaning — it is not optional enrichment. Nothing else is added: no
envelope, no derived summary fields.

---

## Input

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `personId` | string | **Yes** | — | The starting tree-person ID (e.g. `"LZJW-C31"`). The root of the pedigree (ascendancy number `1`). Maps to the endpoint's `person` parameter. |
| `generations` | number | No | `3` | How many generations of ancestors to return above the root. Integer **1–8** (FamilySearch's hard maximum). |
| `spouse` | string | No | — | Also include this spouse's ancestry. A spouse tree-person ID, or the literal `"UNKNOWN"` to let FamilySearch choose the spouse. |
| `personDetails` | boolean | No | `false` | When `true`, each person carries a full `facts` array (Birth, Death, …). When `false` (the API default), persons have only name, gender, and `ascendancyNumber` — **no facts, no dates**. The LLM sets this when the user asks for dates/vitals. |
| `marriageDetails` | boolean | No | `false` | When `true`, the response includes `relationships` — `Couple` entries with marriage facts between the ancestral couples. When `false`, no `relationships` are returned. |
| `descendants` | boolean | No | `false` | When `true`, additional descendant detail is returned for persons in the pedigree. |

`personId` is the only required field; the other five map one-to-one to
the endpoint's optional parameters (the task is to "expose the
parameters of that call"). `personDetails`, `marriageDetails`, and
`descendants` are independent per-call toggles the LLM flips based on the
user's request; their schema descriptions state exactly what each adds so
the model can choose correctly.

### Examples

Four generations of Abraham Lincoln's ancestors (lean):
```json
{ "personId": "LZJW-C31", "generations": 4 }
```

Full vitals on each ancestor, with marriage facts between couples:
```json
{ "personId": "LZJW-C31", "generations": 3,
  "personDetails": true, "marriageDetails": true }
```

Include a chosen spouse's ancestry too:
```json
{ "personId": "LZJW-C31", "generations": 4, "spouse": "LCHV-P5R" }
```

---

## Output

The tool returns the pedigree **as a simplified GedcomX graph, directly**
— the same shape `person_read` returns, with no wrapping envelope:

```typescript
{
  persons: AncestorPerson[];
  relationships?: SimplifiedRelationship[];  // present ONLY with marriageDetails
}
```

There is intentionally **no** `personId` / `generations` / `ancestorCount`
envelope: the count is `persons.length`, the generation depth is what the
caller passed, and the root is the person whose `ascendancyNumber` is
`"1"`. Adding those would be redundant metadata the task did not ask for.

Each **`AncestorPerson`** is a standard simplified person extended with
exactly one ancestry-specific field:

| Field | Type | Description |
|-------|------|-------------|
| `ascendancyNumber` | string | Ahnentafel position (`"1"`, `"2"`, `"1-S"`, …). Re-attached from the raw `display.ascendancyNumber`. **The field that encodes the tree.** |
| `id` | string | FamilySearch tree-person ID (e.g. `"9VMF-H1F"`). Preserved by `toSimplified` — **not** renumbered to `I1`/`N1` (see ID note). |
| `ark` | string \| undefined | Persistent ark URL, from the person's `identifiers`. |
| `gender` | string \| undefined | `"Male"` / `"Female"` / `"Unknown"`. |
| `names` | SimplifiedName[] | **All** name forms FamilySearch returns, each with its `preferred`/`type` flags — `given`/`surname` plus `prefix`/`suffix` when those parts exist (e.g. `prefix: "President"`, `prefix: "Capt"`). Under `personDetails` this includes alternate names (`BirthName`/`AlsoKnownAs`/`MarriedName`), kept as genealogical research clues. Unlike `person_read`, the tool does **not** narrow to a single preferred name; consumers should honor `preferred: true` to pick the display name. |
| `facts` | SimplifiedFact[] \| undefined | Present **only** when `personDetails: true`. Birth/Death/etc. with `date`/`place`. |

`gedcomx.relationships` (present **only** when `marriageDetails: true`)
is an array of simplified `Couple` relationships, each with `person1`
and `person2` as **bare tree IDs** and the marriage `facts`. When
`marriageDetails` is off, the `relationships` key is omitted.

**Per-person `sources` are stripped.** With `personDetails: true` the raw
persons carry `sources`, but the ancestry response includes **no**
top-level `sourceDescriptions`, so those refs would be dangling. They
are removed from this tool's output only; `toSimplified` is unchanged, so
other callers keep their sources. (Same rationale as `person_search`.)

**ID note (don't "fix" this):** `toSimplified` preserves the source
person's FamilySearch ID, so `persons[*].id` are real tree IDs (e.g.
`"9VMF-H1F"`), **not** the abstract `I1`/`N1`/`F1` IDs that
`simplified-gedcomx-spec.md` §3 assigns only when curating the
`tree.gedcomx.json` deliverable. Emitting FS IDs here is correct and
matches `person_read` / `person_search`.

### Example — `person_ancestors({ personId: "LZJW-C31", generations: 2 })`

```jsonc
{
  "persons": [
    { "id": "LZJW-C31", "ascendancyNumber": "1",   "gender": "Male",
      "names": [{ "prefix": "President", "given": "Abraham", "surname": "Lincoln" }] },
    { "id": "LCHV-P5R", "ascendancyNumber": "1-S", "gender": "Female",
      "names": [{ "given": "Mary Ann", "surname": "Todd" }] },
    { "id": "9VMF-H1F", "ascendancyNumber": "2",   "gender": "Male",
      "names": [{ "given": "Thomas Herring", "surname": "Lincoln" }] },
    { "id": "KN6W-CSY", "ascendancyNumber": "3",   "gender": "Female",
      "names": [{ "given": "Nancy Elizabeth", "surname": "Hanks" }] },
    { "id": "LKBG-8W2", "ascendancyNumber": "4", "gender": "Male",   "names": [{ "prefix": "Capt", "given": "Abraham", "surname": "Lincoln" }] },
    { "id": "LXQL-TV6", "ascendancyNumber": "5", "gender": "Female", "names": [{ "given": "Bathsheba", "surname": "Herring" }] },
    { "id": "L1H7-RXW", "ascendancyNumber": "6", "gender": "Male",   "names": [{ "given": "Joseph",    "surname": "Hanks" }] },
    { "id": "PSPQ-97W", "ascendancyNumber": "7", "gender": "Female", "names": [{ "given": "Ann Nanny", "surname": "Lee" }] }
  ]
}
```

How to read it: walk `persons`; `ascendancyNumber` tells you the tree —
`2` and `3` are person `1`'s parents; `4`/`5` are `2`'s parents; `6`/`7`
are `3`'s parents. No nesting needed. Persons are emitted in the order
FamilySearch returns them (root, root's spouse, then ascending Ahnentafel
order); the tool does not re-sort. In this lean default there are **no
dates** — to get them, the LLM sets `personDetails: true`.

### Example — with `personDetails: true, marriageDetails: true`

```jsonc
{
  "persons": [
    { "id": "LZJW-C31", "ascendancyNumber": "1", "gender": "Male",
      "names": [{ "prefix": "President", "given": "Abraham", "surname": "Lincoln" }],
      "facts": [
        { "type": "Birth", "date": "12 February 1809", "place": "Sinking Spring Farm, Hardin, Kentucky, United States" },
        { "type": "Death", "date": "15 April 1865",    "place": "Washington, District of Columbia, United States" }
      ] }
    // ... the other persons, each now carrying facts ...
  ],
  "relationships": [
    { "type": "Couple", "person1": "9VMF-H1F", "person2": "KN6W-CSY",
      "facts": [{ "type": "Marriage", "date": "12 June 1806", "place": "Washington, Kentucky, United States" }] }
  ]
}
```

---

## Tool Schema

```typescript
{
  name: "person_ancestors",
  description:
    "Read a person's ancestors (pedigree) from the FamilySearch Family Tree. " +
    "Given a tree-person ID, returns that person plus up to N generations of " +
    "ancestors as simplified GEDCOMX, each tagged with an ascendancyNumber " +
    "(Ahnentafel position: 1 = the person, 2 = father, 3 = mother, 2n/2n+1 = " +
    "that person's parents; the -S suffix marks a spouse). Set generations " +
    "(1-8, default 3) for depth, personDetails: true for full birth/death " +
    "facts on each ancestor, marriageDetails: true for marriage facts between " +
    "couples. Requires authentication — call the login tool first if not " +
    "logged in.",
  inputSchema: {
    type: "object",
    properties: {
      personId:        { type: "string",  description: "FamilySearch tree-person ID of the root person (e.g. \"LZJW-C31\"). Required." },
      generations:     { type: "number",  description: "Generations of ancestors to return above the root. Integer 1-8. Defaults to 3." },
      spouse:          { type: "string",  description: "Also include this spouse's ancestry. A spouse tree-person ID, or \"UNKNOWN\" to let FamilySearch choose the spouse." },
      personDetails:   { type: "boolean", description: "When true, include a full facts array (Birth, Death, ...) on each person. Defaults to false (name, gender, and ascendancyNumber only — no dates)." },
      marriageDetails: { type: "boolean", description: "When true, include relationships (Couple entries with marriage facts) between the ancestral couples. Defaults to false." },
      descendants:     { type: "boolean", description: "When true, include additional descendant detail for persons in the pedigree. Defaults to false." }
    },
    required: ["personId"]
  }
}
```

`personId` is required via JSON Schema. `generations` range (1–8) is
checked in `validateInput` for a clear error message before the call
(the server also enforces it — see Error Handling).

---

## Authentication

Requires a valid FamilySearch access token. Calls `getValidToken()` from
`src/auth/refresh.ts` — the single entry point for authenticated tools.
Do not re-implement token plumbing. If the user is not authenticated,
`getValidToken()` throws an LLM-instruction error directing them to the
`login` tool; the handler lets it propagate.

**No browser User-Agent is required.** *(Empirical, probe 2026-06-02:
the platform host `api.familysearch.org` is not behind the Imperva WAF —
requests succeed with and without a UA. Same host contract as
`person_read` / `person_search`.)*

No `Accept-Language` header is sent. The tool reads only
locale-independent fields — `fact.*.original` (via `toSimplified`) and
`display.ascendancyNumber` (a numbering token) — so the session locale
does not affect output. (Matches `person_read`.)

---

## FamilySearch API Reference

**Endpoint (auth required):**

```
GET https://api.familysearch.org/platform/tree/ancestry
Authorization: Bearer <access_token>
Accept: application/x-fs-v1+json
```

**Tool input → API parameter mapping:**

| Tool input | API parameter | Notes |
|------------|---------------|-------|
| `personId` | `person` | Required. |
| `generations` | `generations` | Sent as the resolved value (default `3`). |
| `spouse` | `spouse` | ID or `"UNKNOWN"`. Omitted when absent. |
| `personDetails=true` | `personDetails=true` | Omitted when false/absent. |
| `marriageDetails=true` | `marriageDetails=true` | Omitted when false/absent. |
| `descendants=true` | `descendants=true` | Omitted when false/absent. |

URL-encode every value with `encodeURIComponent`.

**Response shape** *(confirmed by probe 2026-06-02):*

```
response.persons[]
  .id                                  -> bare tree-person ID
  .living                              -> boolean
  .gender.type                         -> URL form (e.g. "http://gedcomx.org/Male")
  .names[].nameForms[].fullText/.parts -> name (read by toSimplified)
  .identifiers["http://gedcomx.org/Persistent"][0] -> ark URL
  .display.ascendancyNumber            -> STRING Ahnentafel number ("1", "2", "1-S")  [re-attached]
  .display.name/.gender/.lifespan      -> normalized summary (NOT read by this tool)
  .facts[]                             -> present ONLY with personDetails=true
  .sources[]                           -> present with personDetails; dangling (no sourceDescriptions) -> STRIPPED
response.relationships[]               -> present ONLY with marriageDetails=true
  .type = "http://gedcomx.org/Couple"
  .person1/.person2 { resource (URL), resourceId }   -> resource is read by toSimplified; strip URL -> bare ID
  .facts[] (Marriage)
response.sourceDescriptions            -> NOT returned by this endpoint (so per-person sources are dangling)
```

**Server-side validation (relied upon, mirrored client-side for
clarity):** `generations > 8` → `400 "readAncestry.generations: must be
less than or equal to 8"`; `generations < 1` → `400 "... greater than or
equal to 1"`. Unknown `person` → `404`.

---

## Mapping Logic

1. **Convert once.** Build
   `toSimplified({ persons: body.persons, relationships: marriageDetails ? body.relationships : [] })`.
   This yields simplified persons (id, ark, gender, names, facts) and,
   when requested, simplified `Couple` relationships.
2. **Re-attach the ascendancy number.** Index the raw persons by `id`.
   For each simplified person, set `ascendancyNumber` ←
   `raw.display.ascendancyNumber`. A person with no
   `display.ascendancyNumber` is skipped (defensive — every real ancestry
   person has one).
3. **Strip dangling sources.** Delete `sources` from every output person
   (they have no matching `sourceDescriptions`). Mutates this tool's
   result only.
4. **Shape relationships** (only when `marriageDetails`): for each
   simplified `Couple`, strip `person1`/`person2` to bare tree IDs
   (drop any `…/persons/<id>` URL prefix, same as `person_read`'s
   `extractPersonRef`) and keep the marriage `facts`.

**Assembled result:**
`{ persons, ...(marriageDetails ? { relationships } : {}) }`. After a
`301` merge the persons come from the merged-to person; the root is
identifiable as `ascendancyNumber === "1"`.

---

## Error Handling

Mirrors `person_read`'s status handling (shared host contract).

| Condition | Behavior |
|-----------|----------|
| `personId` missing / not a non-empty string | Throw: `"person_ancestors requires a non-empty personId string (e.g., \"LZJW-C31\")."` |
| `generations` supplied but not an integer in `[1, 8]` | Throw: `"generations must be an integer between 1 and 8."` |
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error. |
| API returns 204 (no body) | Return `{ persons: [] }`. |
| API returns 301 (person merged) | Follow the `Location` header to the new ID and re-fetch, capped at **1** redirect. Missing `Location` or a second redirect → throw a `"redirect loop"` / `"missing Location"` error. |
| API returns 401 | Throw: `"FamilySearch rejected the access token (401). The session may have expired or been revoked — call the login tool to re-authenticate."` |
| API returns 403 | Throw: `"Person ${personId} is restricted and cannot be viewed."` |
| API returns 404 | Throw: `"Person ${personId} not found in the FamilySearch Family Tree."` |
| API returns 410 (deleted) | Throw: `"Person ${personId} has been deleted from the FamilySearch Family Tree."` |
| API returns 400 | Read body JSON, extract `errors[0].message`, throw: `"FamilySearch ancestry request rejected: ${detail}."` Fall back to a generic message if unparseable. |
| API returns 429 | Throw: `"FamilySearch rate limit reached. Wait a moment and try again."` |
| API returns other non-OK status | Throw: `"FamilySearch ancestry API error: ${status}."` |

---

## Caching

None. The tree changes as users edit it; caching would risk staleness
for little benefit.

---

## Files

### `mcp-server/src/types/person-ancestors.ts`
FS response types (`FSAncestryPerson`, `FSAncestryDisplay`,
`FSAncestryRelationship`, `FSAncestryResponse`) and tool I/O types
(`PersonAncestorsInput`, `AncestorPerson`, `PersonAncestorsResult` =
`{ persons: AncestorPerson[]; relationships?: SimplifiedRelationship[] }`).
Reuse shared GedcomX types from `src/types/gedcomx.ts`
(`SimplifiedPerson`, `SimplifiedName`, `SimplifiedFact`,
`SimplifiedRelationship`).

### `mcp-server/src/tools/person-ancestors.ts`
- `personAncestorsToolSchema` — the MCP schema above.
- `personAncestorsTool(input)` — entry point: validate, authenticate,
  fetch (with `redirect: "manual"`), map.
- `validateInput(input)` — `personId` + `generations` range checks.
- `buildUrl(input)` — `person`/`generations`/`spouse`/`*Details` builder
  with `encodeURIComponent`.
- `mapResponse(body, marriageDetails)` — the 4-step mapping above.
- `extractPersonId(location)` — bare-ID parse from a `…/persons/<id>`
  redirect/ref (same shape as `person_read`).

### `mcp-server/src/tool-schemas.ts`
Add `personAncestorsToolSchema` to `allToolSchemas`.

### `mcp-server/src/index.ts`
Add the `person_ancestors` dispatch branch (import tool + input type,
call within the existing try/catch pattern).

### `mcp-server/manifest.json`
Add `{ "name": "person_ancestors" }` to `tools`.

### `mcp-server/dev/try-person-ancestors.ts`
Live smoke-test CLI, e.g.
`npx tsx dev/try-person-ancestors.ts LZJW-C31 --generations 4 --person-details`.

---

## Testing

### `tests/tools/person-ancestors.test.ts`

Mocks `fetch` and `getValidToken`; uses the real `toSimplified`. Fixture:
a trimmed Lincoln ancestry response (root `1`, spouse `1-S`, parents
`2`/`3`, each with `display.ascendancyNumber`, plus one person carrying
`facts` and dangling `sources` for the personDetails cases, and one
`Couple` relationship with a Marriage fact).

| # | Test case | Verifies |
|---|-----------|----------|
| 1 | Returns `{ persons }` for a valid `personId` (default generations) | Happy path |
| 2 | Each person carries `ascendancyNumber` (`"1"`, `"2"`, `"1-S"`) | Ancestry-field re-attach |
| 3 | No envelope: result is the graph directly; `persons.length` matches | Output shape |
| 4 | Throws when `personId` is missing/empty | Input validation |
| 5 | Throws when `generations` is 0, 9, or non-integer | Range validation |
| 6 | `buildUrl` maps `personId→person`, `generations`, `spouse`, `personDetails`, `marriageDetails`, `descendants`; omits absent params | Param mapping |
| 7 | `generations` defaults to 3 in the URL when not supplied | Default |
| 8 | No `User-Agent` / no `Accept-Language` header sent; `Accept: application/x-fs-v1+json` is | Host contract |
| 9 | Without `personDetails`, persons have no `facts`; with it, facts come through | personDetails switch |
| 10 | Per-person `sources` are stripped even when present in the raw person | Dangling-source strip |
| 11 | With `marriageDetails`, `relationships` has a `Couple` with bare-ID `person1`/`person2` and the Marriage fact; without it, no `relationships` key | Relationship shaping |
| 12 | Person IDs are real FS IDs (e.g. `"9VMF-H1F"`), not renumbered | ID preservation |
| 13 | 204 returns `{ persons: [] }` | Empty handling |
| 14 | 301 follows `Location` and reads the merged-to person; second redirect throws | Merge redirect |
| 15 | Throws auth error when not authenticated | Auth propagation |
| 16 | 401 / 403 / 404 / 410 / 429 each throw their specific message | Status handling |
| 17 | 400 throws with the extracted `errors[0].message` detail | Upstream-error surfacing |

### Smoke test

```bash
cd mcp-server
npx tsx dev/try-person-ancestors.ts LZJW-C31
npx tsx dev/try-person-ancestors.ts LZJW-C31 --generations 4 --person-details
npx tsx dev/try-person-ancestors.ts LZJW-C31 --generations 2 --marriage-details
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
- `person_ancestors({ personId: "LZJW-C31", generations: 2 })` — returns
  8 persons; ascendancy `1` is President Abraham Lincoln, `2`/`3` his
  parents, `1-S` Mary Ann Todd.
- `person_ancestors({ personId: "LZJW-C31", generations: 9 })` — fails
  with the generations range error.
- `person_ancestors({ personId: "XXXX-XXX" })` — fails with not-found.
- `person_ancestors` without logging in — returns the auth error.

### Manual Layer 2 (Claude Code)
- *"Show me four generations of Abraham Lincoln's ancestors."* — Claude
  calls `person_ancestors({ personId: "LZJW-C31", generations: 4 })` and
  renders the pedigree from the ascendancy numbers.
- *"…include their birth and death dates."* — Claude re-calls with
  `personDetails: true`.

### Manual Layers 0–3 (smoke → Inspector → Claude Code → Cowork)
Full layered playbook in
`docs/testing-guides/person-ancestors-tool-testing-guide.md` (OAuth setup
per `docs/testing-guides/oauth-tool-testing-guide.md`).

---

## References

- Read Ancestry (endpoint reference): https://developers.familysearch.org/main/reference/readancestry *(verified live 2026-06-02)*
- `docs/specs/simplified-gedcomx-spec.md` — output format for the persons/relationships.
- `docs/specs/person-read-tool-spec.md` — sibling tree-read tool; shared
  host contract, status handling, `personId` naming, and the
  envelope-free graph output this tool mirrors.
- `docs/specs/person-search-tool-spec.md` — sibling; dangling-source-strip
  rationale and the find→read→walk chain.

Evidence trail: `mcp-server/dev/probe-ancestry.ts`,
`probe-ancestry-numbering.ts`, `probe-ancestry-rels-sources.ts`
(run 2026-06-02).
