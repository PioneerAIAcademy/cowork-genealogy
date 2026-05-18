# `tree_attachments` tool — design notes

A planned follow-up tool/skill that, given a list of FamilySearch
persona ARKs, returns which of those personas are already **attached**
to a Family Tree person.

This is distinct from the `treeMatches` field on `search` results,
which only carries *suggested* tree matches (the small person icon in
the FS UI, sourced from `entry.hints[]` on the persona search
response). Attachments are the *pedigree icon* in the FS UI — they
indicate an existing link a user has already made between the source
record and a tree person.

The data is **not** available on the persona search response and
requires a separate endpoint.

## Endpoint

`POST https://www.familysearch.org/service/tree/links/sources/attachments`

**Auth:** `Authorization: Bearer <access_token>` from
`getValidToken()`, plus the same browser-style `User-Agent` header used
by `collections` and `search`. Same auth pattern as the rest of the
authenticated tools.

**Request payload:**

```json
{ "uris": ["https://www.familysearch.org/ark:/61903/1:1:QVTD-PTXB", "..."] }
```

Full persona ARK **URLs**, not bare IDs.

**Response:**

```json
{
  "attachedSourcesMap": {
    "https://www.familysearch.org/ark:/61903/1:1:QVTD-PTXB": [
      {
        "sourceId": "QY12-233",
        "persons": [
          {
            "entityId": "GMY9-4VT",
            "contributorId": "MM6D-2K6",
            "tags": ["Burial", "Death", "Gender", "Birth", "Name"],
            "modified": 1716606373368,
            "tfEntityRefId": "abed7c38-...-02e7b07858b9"
          }
        ]
      },
      {
        "sourceId": "SQYP-3QF",
        "parentChildRelationships": [
          { "entityId": "972R-T5X", "contributorId": "MMWM-73L", "modified": 1548209273329 }
        ]
      }
    ]
  }
}
```

## Key shape facts

- Only **attached** personas appear in `attachedSourcesMap`. Absence
  from the map = no attachment exists for that persona.
- Each persona maps to an array of source attachments; one persona can
  be attached more than once.
- Each source attachment is either to a **person** (`persons[]`, with
  `entityId` = bare tree-person ID like `GMY9-4VT`) **or** to a
  **relationship** (`parentChildRelationships[]`, with `entityId` = a
  tree relationship ID). Both flavors occur in real responses; the
  eventual tool/skill should expose a `kind` discriminator so callers
  can filter.
- The `entityId` is the **bare** tree-person ID (e.g., `"GMY9-4VT"`),
  without an ARK prefix. The future `tree_attachments` skill should
  surface this bare ID as-is — matching the convention used by
  `treeMatches[].treePersonId` on the `search` tool's output. Callers
  that need a full ARK reconstruct it as `ark:/61903/4:1:<entityId>`.
  Note: the raw `entry.hints[].id` field on the persona search
  response *does* include the full ARK prefix, but the `search` tool
  strips it before surfacing — both tools should present the bare ID.

## Evidence trail

- `mcp-server/dev/probe-svc-attach-endpoint.ts` — confirms the
  endpoint works with our Bearer token, runs the James Martin search,
  and cross-references attachment data against hints per persona.
- `mcp-server/dev/probe-svc-attachment-shape.ts` — dumps full
  structural comparison of an attached entry (QVTD-PTXB) vs a hinted
  entry (Q24K-MK1G) in the search response, demonstrating that
  attachment data is **not** carried on the search response and must
  be fetched from this separate endpoint.

## Why it's a separate tool/skill rather than merged into `search`

The attachments endpoint takes a list of ARKs and is composable with
the output of *any* persona-returning tool — not just `search`.
Keeping it out of `search` keeps the search tool focused and lets
callers opt into the extra fan-out only when they need it.
