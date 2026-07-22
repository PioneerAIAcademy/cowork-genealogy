# Record Read Tool Spec

## What it does

`record_read` fetches a single FamilySearch **historical record persona** by
its identifier and returns it as **simplified GEDCOMX** (the
`tree.gedcomx.json` shape defined in `simplified-gedcomx-spec.md`). It is the
read that turns a `record_search` hit (`recordId`) into the full persona —
names, facts, household relationships, and the source citation — that
`record-extraction` mines into assertions.

It has two modes:

- **Live read** (default): fetch the persona from the FamilySearch recapi
  endpoint. Guarantees the authoritative source citation.
- **Sidecar read** (`resultsRef` given): resolve the persona from a staged or
  finalized `record_search` sidecar on disk, with **no network round-trip**.

Implementation: `packages/engine/mcp-server/src/tools/record-read.ts`.

## Input

```ts
{
  recordId: string,        // required — a record-persona ARK or bare entity id
  resultsRef?: string,     // optional — a record_search sidecar handle (sidecar mode)
  projectPath?: string,    // required WHEN resultsRef is given
}
```

### recordId format

`recordId` is a FamilySearch **record persona** (`1:1:`), accepted in either
form:

- A full ARK — `"ark:/61903/1:1:QVS9-DHDB"` (feed `record_search`'s `recordId`
  directly).
- A bare entity id — `"QVS9-DHDB"`.

Both normalize to the bare entity id via `extractEntityId` (the final
colon-delimited token), which becomes the recapi path segment. A record-source
ARK (`1:2:`) is out of scope for this tool.

### The `record_read` ↔ `image_read` ARK boundary (guard)

`record_read` owns record personas (`1:1:`). A **document-image** ARK
(`3:1:`/`3:2:`, e.g. `fulltext_search`'s `id`) is **rejected before any
fetch** with an actionable error routing the caller to `image_read` — it is
never silently attempted. Without this guard `extractEntityId` would strip the
image ARK to a bare id and hit the record recapi, which 404s/403s — the
silent-attempt failure that once led an agent to wrongly conclude "image-level
ARKs are not resolvable through the available tools" (zabriskie-children e2e,
2026-07-21).

The check runs on `toArk(recordId)` (so a bare `3:1:…`/`3:2:…` id is caught
too) and **precedes the `resultsRef` branch**, so an image ARK passed with a
sidecar ref is routed to `image_read` rather than dying with a
less-actionable "not found in staged results" error. The `3:[12]:` matcher is
`DOCUMENT_IMAGE_ARK_PATTERN` in `src/utils/ark.ts`, shared with `image_read`
(whose reciprocal `"Unrecognized ark"` rejection of `1:1:`/`1:2:` ARKs is
specced in `image-read-spec.md`). Pinned error string — see Errors.

### Sidecar mode (`resultsRef` + `projectPath`)

When `resultsRef` is supplied, the persona is read from a `record_search`
sidecar host-side, without a live fetch:

- `resultsRef` is either a `staged.resultsRef` handle from `record_search`
  (`results/.staging/<uuid>.json`) or a finalized `results/<log_id>.json` ref.
- `projectPath` is **required** in this mode (the sidecar lives under the
  project's `results/` directory) — its absence is an error.
- The record is matched within the sidecar by entity id (full-ARK and
  bare-id forms are reconciled), so the caller may pass either form.
- The sidecar returns the persona **plus** other household members
  (co-residents) it captured, but co-residents carry **reduced facts** — so
  use a **live read** (omit `resultsRef`) when you need a co-resident's full
  facts, or for a record that was not part of a staged search.

## Output

Simplified GEDCOMX (`SimplifiedGedcomX`): `persons`, `relationships`,
`sources` (and `places`), with URI-prefixed GEDCOMX types stripped to the
short forms (`http://gedcomx.org/Birth` → `Birth`). An empty or person-less
recapi response is returned as an empty object rather than throwing.

**Place standardization differs by mode — deliberately:**

- **Live read** leaves `standard_place` **unset**. The recapi persona carries
  no FS-normalized place (only the `original` string plus parsed
  County/City/State fields). Re-standardizing an ambiguous *name* through the
  place resolver mis-places it (observed: "Southampton, NY" →
  "Southampton, England"; "Rochdale, England" → "Rochdale, South Africa").
  Leaving `standard_place` unset is correct — the tool never fabricates a
  wrong one. (`toSimplified`, not `toSimplifiedStandardized`.)
- **Sidecar read** returns the staged persona **as-is**, including the
  `standard_place` values FamilySearch already attached to the `record_search`
  result. Those are the more trustworthy value, so the tool deliberately does
  **not** re-run standardization on the sidecar path.

## Errors

Each row is an LLM-instruction error message thrown by the tool.

| Condition | Message |
|-----------|---------|
| Empty / non-string `recordId` | "The record_read tool requires a non-empty recordId string (e.g., \"QVS9-DHDB\" or \"ark:/61903/1:1:QVS9-DHDB\")." |
| Document-image ARK (`3:1:`/`3:2:`) | "'\<ark\>' is a document-image ARK (3:1:/3:2:), not a record persona. record_read reads record personas (1:1:); use the image_read tool with this ARK to fetch the image." |
| `resultsRef` without `projectPath` | "record_read with `resultsRef` also requires `projectPath` — the sidecar lives under the project's results/ directory." |
| Record not in the named sidecar | "record '\<id\>' was not found in staged results '\<ref\>'. Do a live read (omit `resultsRef`) instead, or verify the ref/id." |
| 401 (token rejected) | "FamilySearch rejected the access token (401). The session may have expired or been revoked — call the login tool to re-authenticate." |
| 403 (restricted) | "Record \<id\> is restricted and cannot be viewed." |
| 404 (not found) | "Record \<id\> was not found in FamilySearch historical records." |
| 429 (rate limited) | "FamilySearch rate limit reached. Wait a moment and try again." |
| Other non-OK status | "FamilySearch recapi error: \<status\>" |

The document-image-ARK, empty-`recordId`, and missing-`projectPath` errors are
raised **before** any network call. Auth errors from `getValidToken()`
propagate before the fetch as well.

## Auth

Live reads go through `getValidToken()` (the single auth entry point;
`src/auth/refresh.ts`) and send the shared `BROWSER_USER_AGENT`
(`src/constants.ts`) — FamilySearch sits behind Imperva and 403s non-browser
UAs. Sidecar reads require no token (no network). The recapi base is
`https://sg30p0.familysearch.org/service/cds/recapi/records/persona`.

## What NOT to return / do

- Do not re-standardize places on a live read (see Output) — leave
  `standard_place` unset rather than resolve an ambiguous name.
- Do not accept `3:1:`/`3:2:` image ARKs — route to `image_read`.
- Do not re-implement token loading/refresh — use `getValidToken()`.

## Downstream use

- `record_search` returns a `recordId` (a `1:1:` ARK); feed it straight to
  `record_read`.
- `record-extraction` mines the returned persona into assertions. When an
  assertion is created from a staged sidecar record, `research_append`
  **auto-fills** the assertion's `record_persona_id` from that persona in the
  unambiguous case (a single-persona record, or a single-record/single-role
  batch); otherwise it errors and asks for `record_persona_id` per assertion
  rather than guessing. So prefer the sidecar path (`resultsRef`) when
  extracting, and confirm each record_search-derived assertion carries
  `record_persona_id` (enforced by the `record-extraction` validator
  `test_record_persona_id_set`).
- For the page image behind a record, use `image_read` with the document-image
  ARK — not this tool.
```
