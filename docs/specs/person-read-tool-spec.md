# person_read Tool — Implementation Spec

## Overview

An MCP tool that reads person data from the shared FamilySearch Family Tree.
It returns data in **simplified GEDCOMX format** (`persons[]`,
`relationships[]`, `sources[]`) following the conventions in
`docs/specs/simplified-gedcomx-spec.md`.

The tool accepts a FamilySearch person ID (required) and two optional boolean
flags that bundle additional data into a single API call:

| Flag | What it adds to the response |
|------|------------------------------|
| `relatives: true` | Parents, spouses, and children in `persons[]` + `relationships[]` |
| `sourceDescriptions: true` | Attached source citations in `sources[]` |

Requires authentication (OAuth tokens obtained via the `login` tool).

**v1 accepts person IDs only — not names.** Name-based person search
requires a separate tool with disambiguation (birth date, spouse, location,
etc.) and is out of scope for v1.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `personId` | string | **Yes** | FamilySearch person ID (e.g., `"KNDX-MKG"`). |
| `relatives` | boolean | No | Include parents, **siblings**, spouses, and children. Defaults to `false`. Siblings are a second hop and cost **one extra request per parent** — see "The sibling fan-out" below. |
| `sourceDescriptions` | boolean | No | Include attached source citations — and, for a non-living subject, that person's source-style memories. Defaults to `false`. |
| `projectPath` | string | No | Absolute project-folder path. When set, a memory scan transcribed during the read is retained under `images/` and its ref returned as that source's `image_ref`. A path is not a mode flag, so decision 1's "no third flag" does not reach it. Without it, scans are transcribed but not kept. |

Examples:

```json
{ "personId": "KNDX-MKG" }
```

```json
{ "personId": "KNDX-MKG", "relatives": true }
```

```json
{ "personId": "KNDX-MKG", "sourceDescriptions": true }
```

```json
{ "personId": "KNDX-MKG", "relatives": true, "sourceDescriptions": true }
```

```json
{ "personId": "KNDX-MKG", "sourceDescriptions": true, "projectPath": "/home/me/projects/clegg" }
```

---

## Output

The tool returns simplified GEDCOMX. The top-level shape is always:

```json
{
  "persons": [],
  "relationships": [],
  "sources": []
}
```

- `persons[]` is always present (at minimum, the requested person)
- `relationships[]` is present when `relatives: true` (empty array otherwise)
- `sources[]` is present when `sourceDescriptions: true` (empty array otherwise)

### `persons[]`

Each person object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | FamilySearch person ID (e.g., `"KNDX-MKG"`) |
| `ark` | string | no | Canonical persistent ARK for the tree person (e.g., `"ark:/61903/4:1:KNDX-MKG"`). Lifted from the raw `identifiers["http://gedcomx.org/Persistent"][0]` resolver URL and normalized by `toArk`. Present on every person FamilySearch returns a Persistent identifier for — in practice all of them; omitted entirely when it supplies none |
| `gender` | string | yes | `"Male"`, `"Female"`, or `"Unknown"` |
| `living` | boolean | yes | Whether the person is marked as living |
| `names` | object[] | yes | Every name FamilySearch holds for the person, preferred-first (see "Names" below). At least one — a person FS returns with no name at all gets a single `{ given: "", surname: "" }` placeholder |
| `facts` | object[] | no | Life facts (birth, death, etc.). Omitted for living persons with no data. |

**Names:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | no | Name id, passed through when FamilySearch supplies one (`simplifyName`). Absent otherwise |
| `preferred` | boolean | no | `true` on the name FamilySearch marks preferred, and **only** that name. Present-or-absent, never `false` — the schema pins it to `const: true`, so an unpreferred name omits the key rather than carrying `preferred: false` |
| `given` | string | yes | Given name(s) (e.g., `"George"`) |
| `surname` | string | yes | Surname (e.g., `"Washington"`) |
| `type` | string | no | Name type, URI-stripped (e.g., `"BirthName"`, `"MarriedName"`, `"AlsoKnownAs"`, `"Nickname"`). An **open** enum (`gedcomx_name_type_recommended`) — treat unrecognized values as data, not as errors. Absent when FS supplies no type |
| `prefix` | string | no | Name prefix (e.g., `"Dr."`, `"Reverend"`) |
| `suffix` | string | no | Name suffix (e.g., `"Jr."`, `"III"`, `"Esq."`) |

**Facts:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | no | Fact id, passed through when FamilySearch supplies one (`simplifyFact`). Absent otherwise — the caller mints one before persisting |
| `type` | string | yes | Fact type — last segment of the GEDCOMX URI (e.g., `"Birth"`, `"Death"`, `"MilitaryService"`) |
| `date` | string | no | Date string as entered (from `date.original`) |
| `standard_date` | string | no | Canonical GEDCOM-form sidecar for `date`, from `stdDate` (e.g., `"Abt 1845"`, `"12 Mar 1908"`). Omitted only when `stdDate` cannot parse the input |
| `place` | string | no | Place string as entered (from `place.original`) |
| `standard_place` | string | no | Standardized place-name sidecar for `place`: from the raw GedcomX `place.normalized` when present, otherwise filled by the document-level resolver pass (`toSimplifiedStandardized`). Best-effort — omitted when the resolver cannot match the free-text place |
| `value` | string | no | Fact value when present (e.g., job title for Occupation) |

### `relationships[]`

Present when `relatives: true`. Two types:

**ParentChild:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"ParentChild"` |
| `parent` | string | yes | Person ID of the parent |
| `child` | string | yes | Person ID of the child |
| `subtype` | string | no | `"Biological"`, `"Adoptive"`, `"Step"`, `"Foster"`, `"Guardian"`. Omit when the API does not provide this information. |

**Couple:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"Couple"` |
| `person1` | string | yes | Person ID of first partner |
| `person2` | string | yes | Person ID of second partner |
| `facts` | object[] | no | Relationship facts (e.g., marriage). Same schema as person facts. |

### `sources[]`

Present when `sourceDescriptions: true`. Each source object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Source description ID |
| `title` | string | yes | Source title |
| `citation` | string | no | Formatted citation string |
| `url` | string | no | URL to the source (ark URL or external URL) |
| `notes` | string[] | no | User-attached notes. Each entry is the text of one note. Also carries the tool's own note when a memory was not transcribed (see below). Omit when empty. |
| `text` | string | no | A memory's text: a story's own words, or OCR of a scan. Absent for an ordinary tree source, and absent for a memory that was not transcribed. |
| `image_ref` | string | no | Project-relative path (`images/<key>.jpg`) of a retained memory scan. Present only when `projectPath` was supplied and the save succeeded. |
| `artifact_url` | string | no | The memory artifact's bytes URL, present on every memory source. This is the value `image_transcribe`/`image_read` accept as `memoryArtifactUrl`; `url` is the human `/memories/<id>` page and is refused. Response-only — absent from `TREE_SOURCE_FIELDS`, so a caller copying a memory source into `tree.gedcomx.json` must drop it. |

#### Memories are merged into `sources[]`

For a **non-living subject**, `sourceDescriptions: true` also returns that
person's **source-style memories** as ordinary entries in `sources[]` — nothing
else changes. The top level stays `{persons, relationships, sources}`: there is
no new key and **no memory-vs-source discriminator**, so no downstream reader
has to branch on where a source came from (lead, 2026-08-21). Memory ids and
tree source-description ids are disjoint id spaces (`3475` vs
`SD_PERSON_KWCJ-RN4`, measured 0 overlap), so the two never collide.

**The filter is a proxy on media kind, not an exact test.** FamilySearch
classifies a memory as photo / document / story / audio, **the uploader chooses
it**, and it is not derived from content — no field in the payload answers "is
this a source". So the tool returns *most* source-style memories and *only
rarely* a non-source one, and **it will miss a record scan filed under Photos**.
The one payload-verifiable non-source marker is the person's designated
portrait, which is excluded. Audio and video are dropped.

**Scope: the subject only.** Memories are never fetched for relatives, whatever
`relatives` is set to.

**Transcription (decisions 3 and 4).** Every memory the filter keeps is
transcribed inside the read: a story's full text is fetched from its artifact,
and a scan or PDF is OCR'd through the same `image_transcribe` path. Both land
in `text`, so nothing downstream branches on how the text was obtained, and
both reach `research.json` `sources[].transcription` by the same route. A
story's payload text is a 200-character preview cut mid-word, so the artifact is
the only route to the whole story; when that artifact is unavailable the field
is left **absent rather than filled with the preview**, which would read as a
complete short story.

The phase runs under **one ~40s wall-clock budget for the whole phase**, about
five transcriptions in flight, in record-language rank order, with **no count
cap**. The budget exists for the Cowork device bridge's 60s abort on every MCP
call: an unbudgeted phase does not cost a transcription, it costs the whole
person read. **Anything the budget did not reach still comes back** — as a
metadata entry whose `notes` says why, never dropped. **No OCR failure can fail
the read**: a missing OpenRouter key, an OpenRouter error, a timeout, or a 403
on the artifact all degrade to a metadata-only entry.

A memory the budget skipped, the filter missed, or the OCR failed on can be read
directly with `image_transcribe`'s `memoryArtifactUrl` input. **The value to pass
is the source's `artifact_url`, not its `url`** — `url` is the human
`/memories/<id>` page and `memoryArtifactUrl` refuses it. Like `text` and
`notes`, `artifact_url` is response-only: it is absent from `TREE_SOURCE_FIELDS`,
so a caller copying a memory source into `tree.gedcomx.json` must drop it, and
the write fails loudly rather than silently persisting it.

A **merged** person (301) is resolved before any of this runs: memories are
fetched for the id the redirect landed on, not the id the caller passed.

### Example output

```json
{
  "persons": [
    {
      "id": "KNDX-MKG",
      "gender": "Male",
      "living": false,
      "names": [{ "prefix": "General", "given": "George", "surname": "Washington" }],
      "facts": [
        { "type": "Birth", "date": "22 February 1732", "standard_date": "22 Feb 1732", "place": "Westmoreland, Virginia, British Colonial America", "standard_place": "Westmoreland, Virginia, United States" },
        { "type": "Death", "date": "14 December 1799", "standard_date": "14 Dec 1799", "place": "Mount Vernon, Fairfax County, Virginia, United States", "standard_place": "Mount Vernon, Fairfax, Virginia, United States" },
        { "type": "Burial", "date": "18 December 1799", "standard_date": "18 Dec 1799", "place": "Mount Vernon Estate, Mount Vernon, Fairfax, Virginia, United States", "standard_place": "Mount Vernon, Fairfax, Virginia, United States" },
        { "type": "Occupation", "date": "1749", "standard_date": "1749", "value": "Surveyor" },
        { "type": "MilitaryService", "date": "between 1752 and 1758", "standard_date": "Bet 1752 and 1758", "place": "Virginia, British Colonial America", "standard_place": "Virginia, United States" }
      ]
    },
    {
      "id": "KNZC-6QV",
      "gender": "Female",
      "living": false,
      "names": [{ "given": "Martha", "surname": "Dandridge" }],
      "facts": [
        { "type": "Birth", "date": "2 June 1731", "standard_date": "2 Jun 1731" },
        { "type": "Death", "date": "22 May 1802", "standard_date": "22 May 1802" }
      ]
    },
    {
      "id": "KNDX-MFX",
      "gender": "Male",
      "living": false,
      "names": [{ "given": "Augustine", "surname": "Washington", "suffix": "Sr." }],
      "facts": [
        { "type": "Birth", "date": "1694", "standard_date": "1694", "place": "Westmoreland, Virginia, British Colonial America", "standard_place": "Westmoreland, Virginia, United States" },
        { "type": "Death", "date": "12 April 1743", "standard_date": "12 Apr 1743", "place": "King George, Virginia, British Colonial America", "standard_place": "King George, Virginia, United States" }
      ]
    }
  ],
  "relationships": [
    { "type": "ParentChild", "parent": "KNDX-MFX", "child": "KNDX-MKG", "subtype": "Biological" },
    {
      "type": "Couple",
      "person1": "KNDX-MKG",
      "person2": "KNZC-6QV",
      "facts": [
        { "type": "Marriage", "date": "6 January 1759", "standard_date": "6 Jan 1759", "place": "New Kent, Virginia, British Colonial America", "standard_place": "New Kent, Virginia, United States" }
      ]
    }
  ],
  "sources": [
    {
      "id": "7X6N-4WR",
      "title": "George Washington, \"United States, Rosters of Revolutionary War Soldiers and Sailors, 1775-1966\"",
      "citation": "\"United States, Rosters of Revolutionary War Soldiers and Sailors, 1775-1966\", FamilySearch ...",
      "url": "https://familysearch.org/ark:/61903/1:1:QRHS-D1T2"
    },
    {
      "id": "Q1KF-5FS",
      "title": "George Washington's Presidential Library",
      "url": "https://www.mountvernon.org/library/",
      "notes": ["See also the Mount Vernon digital collections for primary source images."]
    }
  ]
}
```

---

## Tool Schema

```typescript
{
  name: "person_read",
  description: "Read person data from the FamilySearch Family Tree. " +
    "Returns simplified GEDCOMX (persons, relationships, sources). " +
    "Set relatives=true to include parents, siblings, spouses, and children. " +
    "Set sourceDescriptions=true to include attached sources — for a " +
    "non-living subject this also returns source-style memories (scanned " +
    "wills, certificates, obituaries, family stories), transcribed where the " +
    "read's time budget allowed. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      personId: {
        type: "string",
        description: "FamilySearch person ID (e.g., \"KNDX-MKG\"). Required."
      },
      relatives: {
        type: "boolean",
        description:
          "Include parents, siblings, spouses, and children. Siblings are " +
          "reached by reading each parent, so this costs one extra request " +
          "per parent. Defaults to false."
      },
      sourceDescriptions: {
        type: "boolean",
        description: "Include attached source citations. Defaults to false."
      },
      projectPath: {
        type: "string",
        description:
          "Optional absolute path to the project folder. When set, any memory " +
          "scan transcribed during this read is saved under images/ and its " +
          "project-relative path returned on that source as image_ref, so a " +
          "retained source can cite it. Without it the scan is transcribed but " +
          "not kept."
      }
    },
    required: ["personId"]
  }
}
```

---

## Authentication

This tool requires a valid FamilySearch access token. It must call
`getValidToken(principal)` from `src/auth/refresh.ts` — the single entry point for
all authenticated tools. Do not re-implement token plumbing.

If the user is not authenticated, `getValidToken(principal)` throws an LLM-instruction
error directing the user to call the `login` tool. The tool function must not
swallow this error — it lets the error throw, and the MCP server in
`src/index.ts` catches it and returns the message as `isError: true`.

---

## FamilySearch API Reference

### Base URL and headers

```
Authorization: Bearer <access_token>
Accept: application/x-fs-v1+json
```

All tree endpoints use `api.familysearch.org`. No browser-like `User-Agent`
header is needed (no WAF issue on this domain).

**Note on Accept header:** Both `application/x-fs-v1+json` and
`application/x-gedcomx-v1+json` return identical responses. The FamilySearch
platform API always returns FS-extended GEDCOMX regardless of the Accept
header. Confirmed by the FamilySearch team (Todd Chapman, Erik Wilford).

### Endpoint: Person details

```
GET https://api.familysearch.org/platform/tree/persons/{pid}
GET https://api.familysearch.org/platform/tree/persons/{pid}?relatives=true
GET https://api.familysearch.org/platform/tree/persons/{pid}?sourceDescriptions=true
GET https://api.familysearch.org/platform/tree/persons/{pid}?relatives=true&sourceDescriptions=true
```

| Query Parameter | Effect |
|-----------------|--------|
| `relatives=true` | Includes family members in `persons[]`, plus `childAndParentsRelationships[]` and `relationships[]`. **Does not include siblings** — see the fan-out below. |
| `sourceDescriptions=true` | Includes source citations in `sourceDescriptions[]` |

**This is no longer a single call when `relatives=true`.** The endpoint returns a
person's parents but not their siblings, so the tool additionally issues one
`?relatives=true` read **per parent**, concurrently, bounded at 4 in flight:

```
GET .../persons/{parentPid}?relatives=true          (once per parent)
```

The subject's own read is always made first — the parent ids come out of its
`childAndParentsRelationships[]`. A subject with no parents issues no extra
request at all. Each parent read is independently fail-soft: a non-200 (403,
404, 410, 429, or a 204 living stub) or a transport error yields no siblings
from that parent and is not retried beyond `fetchWithRetry`'s normal budget.

Note that `relationships[]` and `childAndParentsRelationships[]` reach **one hop
further than `persons[]`** in any FamilySearch response — a parent's read names
the subject's great-grandparents and the siblings' spouses without returning
person records for them. Every such edge is dropped before the response is
returned, so the tool's output is endpoint-closed on all four endpoint spellings
(`parent`, `child`, `person1`, `person2`).

Both can be combined in a single call.

### Response structure (FS-extended GEDCOMX)

The API returns FS-extended GEDCOMX with these top-level arrays:

```
response.persons[]                          — person objects
response.relationships[]                    — couple relationships
response.childAndParentsRelationships[]     — parent-child family groups
response.sourceDescriptions[]               — source citations
response.places[]                           — place details (not needed)
```

Each person object contains:

```
person.id                    — FamilySearch person ID
person.living                — boolean
person.gender.type           — URI (e.g., "http://gedcomx.org/Male")
person.names[].nameForms[].parts[]  — name components with type/value
person.facts[]               — life events with type/date/place/value
person.display               — pre-formatted summary (FS extension, not used)
```

Each fact contains:

```
fact.type           — URI (e.g., "http://gedcomx.org/Birth")
fact.date.original  — date as entered
fact.place.original — place as entered
fact.value          — value (present on Occupation, Religion, etc.)
```

Each `childAndParentsRelationship` contains:

```
rel.parent1.resourceId   — person ID of first parent
rel.parent2.resourceId   — person ID of second parent
rel.child.resourceId     — person ID of child
rel.parent1Facts[]       — relationship type facts (BiologicalParent, StepParent, etc.)
rel.parent2Facts[]       — relationship type facts
```

Each couple relationship contains:

```
rel.type                 — "http://gedcomx.org/Couple"
rel.person1.resourceId   — person ID
rel.person2.resourceId   — person ID
rel.facts[]              — marriage facts with date/place
```

Each sourceDescription contains:

```
sd.id                    — source description ID
sd.about                 — URL (ark or external)
sd.titles[].value        — title strings
sd.citations[].value     — citation strings
sd.notes[].value         — user notes
sd.resourceType          — "FSREADONLY" or "DEFAULT"
sd.attribution.contributor.resourceId — who attached it
```

### Special HTTP status codes

| Status | Meaning | How to handle |
|--------|---------|---------------|
| 200 | Success | Parse and convert response |
| 204 | Living person (empty body) | Return `{ persons: [{ id, living: true, ... }], relationships: [], sources: [] }` |
| 301 | Person merged into another | Read new ID from `Location` header, re-fetch |
| 401 | Token expired/invalid | Let auth error propagate |
| 403 | Restricted person | Throw descriptive error |
| 404 | Person not found | Throw descriptive error |
| 410 | Person deleted | Throw descriptive error |
| 429 | Rate limited | Throw error with retry guidance |

---

## Conversion: FS-extended GEDCOMX → Simplified GEDCOMX

The tool converts the raw API response to simplified GEDCOMX before
returning it. **This conversion uses the shared `toSimplified`
function** from `src/utils/gedcomx-convert.ts`. Do not write a custom
converter — all tools use the shared function.

The simplified GEDCOMX schema includes `subtype` on ParentChild
relationships (Biological, Adoptive, Step, Foster, Guardian).

### Conversion rules

#### 1. Persons

For each person in `response.persons[]`:

| FS-extended field | Simplified field | Conversion |
|-------------------|-----------------|------------|
| `id` | `id` | Copy directly |
| `identifiers["http://gedcomx.org/Persistent"][0]` | `ark` | Lift the first Persistent identifier and normalize the resolver URL to the canonical `ark:/61903/4:1:<id>` form (`toArk`). Other identifier types are dropped |
| `living` | `living` | Copy directly |
| `gender.type` | `gender` | Last segment of URI (e.g., `"Male"`) |
| `names[]` | `names[]` | **All** names are kept, not only the primary one. Per name: `id` and `type` (URI-stripped) pass through, `preferred` is carried only when `true`, and `nameForms[0].parts[]` yields `given` / `surname` / `prefix` / `suffix`. Names marked `preferred: true` are stable-reordered to the front, so simplified `names[0]` is the preferred name even when FS lists an alternate first (`gedcomx-convert-spec.md` § "Rule 4") |
| `facts[]` | `facts[]` | See fact conversion below |

Strip: `display`, `links`, `sortKey`, `evidence`, `personInfo`, `sources`,
`attribution`, and every `identifiers` entry except the Persistent one lifted
to `ark` above.

#### 2. Fact type mapping

**One rule:** take whatever follows the last `/` in the URI.

```
"http://gedcomx.org/Birth"           → "Birth"
"http://gedcomx.org/MilitaryService" → "MilitaryService"
"http://gedcomx.org/Couple"          → "Couple"
```

For `data:,` prefix types (custom facts): strip `data:,` and use the
remainder.

```
"data:,Elected" → "Elected"
```

#### 3. Facts

For each fact:

| FS-extended field | Simplified field | Conversion |
|-------------------|-----------------|------------|
| `type` | `type` | Last segment of URI (see above) |
| `date.original` | `date` | Copy string directly |
| `place.original` | `place` | Copy string directly |
| `value` | `value` | Copy when present |

Strip: `id`, `attribution`, `links`.

#### 4. Names

Extract from each name's `nameForms[0].parts[]`:

- Find part with `type` containing `"Given"` → `given` value
- Find part with `type` containing `"Surname"` → `surname` value
- Find part with `type` containing `"Prefix"` → `prefix` value (omit if absent)
- Find part with `type` containing `"Suffix"` → `suffix` value (omit if absent)
- Ignore other part types (e.g., `Title`)

If no Given found, use `""`. If no Surname found, use `""`.

**Every name is returned, not just the primary one.** The converter
stable-reorders `preferred: true` names to the front and preserves the relative
order within the preferred and non-preferred groups, so `names[0]` is the
preferred name regardless of the order FamilySearch returned — and `names[1..]`
are the alternates, each carrying its own `type` and `id`. This matters on live
data: FamilySearch routinely lists alternates ahead of the primary name, and an
alternate is frequently an initials-only or surname-less form of the same
person.

Consumers that want one display name should read `names[0]`. Consumers matching,
deduplicating or auditing identity must read the whole array — a surname that
disagrees with `names[0]` is normal (a married name, an `AlsoKnownAs`, a spelling
variant) and is not on its own evidence of a conflated record.

#### 5. Relationships (when `relatives: true`)

**ParentChild** — convert from `childAndParentsRelationships[]`:

For each entry, create one or two ParentChild relationships. If both
`parent1` and `parent2` exist, create **two** (one per parent).

```json
{ "type": "ParentChild", "parent": "<parent1.resourceId>", "child": "<child.resourceId>", "subtype": "Biological" }
```

Extract `subtype` from `parent1Facts[]` / `parent2Facts[]`:
the fact `type` URI's last segment, stripped of `"Parent"` suffix
(e.g., `"http://gedcomx.org/BiologicalParent"` → `"Biological"`,
`"http://gedcomx.org/StepParent"` → `"Step"`). Omit the field when
no parent facts are present for that parent.

**Keep all relationships.** Do not filter to the focal person —
include every relationship returned by the API. When `relatives: true`,
the response includes extended-family relationships; return them all.

**Couple** — convert from `relationships[]` where `type` ends with `"Couple"`:

For each entry, create:
```json
{
  "type": "Couple",
  "person1": "<person1.resourceId>",
  "person2": "<person2.resourceId>",
  "facts": [{ "type": "Marriage", "date": "...", "place": "..." }]
}
```

**Keep all couple relationships.** Do not filter to the focal person.

#### 5a. The sibling fan-out (when `relatives: true`)

FamilySearch returns a person's parents but **not their siblings**. Siblings sit
two hops out, so each parent is read to find them.

- **Parent ids** come from the subject's own `childAndParentsRelationships[]` —
  `parent1.resourceId` / `parent2.resourceId` on entries whose
  `child.resourceId` is the subject. `resourceId` is the production spelling on
  a CAPR ref, and the fan-out must agree with `synthesizeParentChild`, which
  reads only that spelling.
- **No parents ⇒ zero extra requests.** An isolated person costs exactly one
  request, as before.
- **Not capped at two.** A person can have three or four parents — biological
  plus adoptive, or an unmerged duplicate. Measured across the 95 committed e2e
  trees: 438 children have 2 parents, 4 have 3, and 3 have 4. Parents are read
  concurrently, bounded at 4 in flight.
- **Merged into the raw payload, before conversion.** The subtype on a
  parent-child link is derived from CAPRs, place standardization runs once
  inside the converter, and `living` is read back off the raw persons — merging
  after conversion would lose all three.

**What is kept: children of that parent, and nothing else.** A parent's read
also returns the subject's grandparents, that parent's other spouses, non-spouse
co-parents, the subject's own other parent, and the grandparents' `Couple`
relationship. Rather than enumerate those exclusions, the filter keeps exactly
one category — persons who are children of the parent being read — and
everything else drops out in one move.

**Every endpoint of every relationship in the response is a person in
`persons[]`.** The response is endpoint-closed: a caller can resolve any
`parent`, `child`, `person1` or `person2` against `persons[]` and will always
find it.

This is enforced on the whole output, not only on the edges the fan-out
contributes. FamilySearch's relationship arrays reach **one hop further than its
persons array** — a read names the subject's great-grandparents, a child's
spouse, or a non-spouse co-parent without returning a person record for them,
and its refs carry an absolute-URL form used precisely "when the person isn't in
this response". Any such edge is dropped.

The reason is that emitting one is not free. `validate_research_schema` treats an
unresolvable endpoint as a hard error on all four spellings — `parent` and
`child`, `person1` and `person2` — and `project_create`, alone among the tree
writers in never calling `sanitizeTree`, refuses the **entire write** on any
error. A single edge pointing one hop past the data therefore costs the user
their whole project, and the failure names a person they never asked about.

Dropping the edge loses nothing a caller could have used: the far endpoint is not
in `persons[]`, so there is no person to link to. What is lost is the hint that
some further relative exists.

**One case where that hint is the datum, and is worth stating plainly.** When
the omitted endpoint is a parent of the SUBJECT, the edge dropped is the
subject's own parentage — not a distant relative's. The caller asked about this
person, and "has a parent we cannot name" is information about them. It is still
dropped, because an unresolvable endpoint costs the whole `project_create`
write, but the loss is now SILENT where before it surfaced as a loud refusal.
There is no warning channel on this tool's result to carry it, so a caller that
needs to know a parent exists without a person record must read the raw
FamilySearch response rather than this tool's output.

A half-sibling consequently arrives linked to the shared parent only, and a CAPR
naming a child whose person record the response omitted is skipped entirely —
both for the reason stated above.

**A failing parent read degrades; it never throws.** 403, 404, 410, 429, a
timeout, a transport error, or a 204 living-person stub each mean "no siblings
from that parent" — the subject's own read still succeeds. Siblings are an
enrichment and must never cost the caller the person they asked for.

**The fan-out spends the same 40s budget the memories phase does.** The deadline
is anchored at tool entry, so each parent read is on the clock the OCR phase
later draws from. The effect is lossless — a memory the budget does not reach
comes back as a metadata entry with a note saying so — but a subject with
several slow parents will transcribe fewer memories than the same subject with
none, and that is a real interaction rather than a theoretical one.

**301 is not in that list: a merged parent is followed.** A merged person answers
301 with the surviving id in `Location`, exactly as the subject's own read
handles it, and the fan-out follows it under the same redirect cap. Treating 301
as "no siblings from that parent" would silently lose every sibling behind a
merge, and merges are routine. The merged body names the SURVIVING id in its
CAPRs while the subject's read named the old one, so the parent endpoint is
rewritten back to the id the subject used — the id every other edge and every
`persons[]` entry is keyed on. Without that rewrite the siblings arrive with
their edges pruned, which is to say as orphans.

**A parent with no person record is not read at all.** The parent ids come from
the subject's CAPRs, and FamilySearch names a parent there without always
returning that parent's person record (see the endpoint-closure rule below).
Reading such a parent cannot produce a usable sibling: every edge from them is
dropped for want of the parent endpoint, while the children they contributed
would remain in `persons[]` — unconnected persons in the user's tree, which
`validate_research_schema` does not catch because it has no persons-to-edges
rule. They are skipped, which also saves a request whose result cannot be used.

#### 6. Sources (when `sourceDescriptions: true`)

For each entry in `sourceDescriptions[]`:

| FS-extended field | Simplified field | Conversion |
|-------------------|-----------------|------------|
| `id` | `id` | Copy directly |
| `titles[0].value` | `title` | Flatten |
| `citations[0].value` | `citation` | Flatten (omit if absent) |
| `about` | `url` | Copy directly |
| `notes[].value` | `notes` | Collect all note values into a string array. Omit when empty. |

**Filter:** Skip entries where `id.startsWith("SD_")` — these are
metadata, not real sources.

##### Memories (same array, subject only, non-living only)

A second call to `GET /platform/tree/persons/{pid}/memories` runs under the same
flag. It **pages to completion** — the endpoint pages at 25 and the last page is
a **204 with an empty body**, so a pager that calls `.json()` unconditionally
throws on the final hop. Each kept memory converts to the same source shape:

| Memories field | Simplified field | Conversion |
|-------------------|-----------------|------------|
| `id` | `id` | Copy directly. Memory ids and `sourceDescription` ids are disjoint id spaces (`3475` vs `SD_PERSON_KWCJ-RN4`, measured 0 overlap), so no dedupe is possible or needed. |
| `titles[0].value` | `title` | Flatten; fall back to `artifactMetadata[0].filename`, then to `FamilySearch memory <id>`. Never empty — an empty title fails the downstream write. |
| `links.memory.href` | `url` | The user-visible memory URL, **not** `about` (which is the bytes URL). |
| story text / OCR | `text` | See the transcription paragraph above. Absent when not transcribed. |
| — | `image_ref` | Set only when `projectPath` was given and the scan was retained. Retention covers `image/*` ONLY, and the file is keyed by the **memory id** (`images/<memory id>.jpg`). A PDF is transcribed but not retained: `imageFilenameFor` writes `.jpg` and `gcUnreferencedImages` sweeps `images/*.jpg`, so a retained PDF would sit under a name the viewer cannot render and the GC mis-handles. Its `url` always leads back to the artifact. |
| — | `notes` | The tool's own note when a memory was not transcribed. |

**Kept:** `application/pdf`; anything of media kind `Document` or `Story`; and
anything whose title or description preview matches record-document language.
**Dropped:** `audio/*` and `video/*` unconditionally, and the person's
designated portrait (`/tree/persons/{pid}/portrait`). The media kind comes from
`artifactMetadata[].qualifiers[].name`
(`http://familysearch.org/v1/{Photo,Document,Story}`) and **the uploader chose
it** — hence the proxy caveat above.

**Scope:** the subject only, never per relative, whatever `relatives` is set to.
Skipped entirely when the subject is living, and when `sourceDescriptions` is
false.

**Fail-soft:** any failure of the memories fetch returns the tree sources alone.
`person_read` never fails because of memories or transcription.

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Not authenticated | Let `getValidToken(principal)` throw its LLM-instruction error |
| Person not found (404) | Throw: `"Person {pid} not found in the FamilySearch Family Tree."` |
| Person deleted (410) | Throw: `"Person {pid} has been deleted from the FamilySearch Family Tree."` |
| Person restricted (403) | Throw: `"Person {pid} is restricted and cannot be viewed."` |
| Person merged (301) | Follow the redirect to the new person ID automatically |
| Living person (204) | Return result with the person having `living: true`, no facts |
| Rate limited (429) | Throw: `"FamilySearch rate limit reached. Wait a moment and try again."` |
| Non-OK status (other) | Throw: `"FamilySearch tree API error: {status}"` |
| Memories fetch fails (any status, timeout, or throw) | **Never throws.** Return the tree sources alone and write one line to stderr. The person read is the contract; memories are an enrichment. |
| Portrait fetch fails | **Never throws.** Treated as "no portrait", so the merge still runs — at worst one profile photo is not suppressed. Losing it must not cost the whole merge. |
| Transcription fails for one memory (no `openRouterApiKey`, OpenRouter error, timeout, artifact 403) | **Never throws.** That memory degrades to a metadata-only entry carrying a `notes` line naming `image_transcribe` as the retry route. Other memories are unaffected. |
| Transcription budget expires | **Never throws.** Memories not reached come back as metadata-only entries with a `notes` line saying the budget ran out. Nothing is dropped, and the budget is not extended. |
| Story artifact unavailable | `text` is left **absent** rather than filled with the payload's 200-character preview, which is cut mid-word. A `notes` line records it. |

---

## Files

### `packages/engine/mcp-server/src/types/person-read.ts`

FS API response types (for typing the raw response) and simplified output
types.

**FS API types:**

```typescript
interface FSFact {
  type: string;
  date?: { original?: string };
  place?: { original?: string };
  value?: string;
}

interface FSNamePart {
  type: string;
  value: string;
}

interface FSNameForm {
  fullText?: string;
  parts?: FSNamePart[];
}

interface FSPerson {
  id: string;
  living?: boolean;
  gender?: { type: string };
  names?: Array<{ nameForms?: FSNameForm[] }>;
  facts?: FSFact[];
  display?: Record<string, unknown>;
}

interface FSRelationshipRef {
  resource?: string;
  resourceId: string;
}

interface FSChildAndParentsRelationship {
  parent1?: FSRelationshipRef;
  parent2?: FSRelationshipRef;
  child?: FSRelationshipRef;
  parent1Facts?: FSFact[];
  parent2Facts?: FSFact[];
}

interface FSCoupleRelationship {
  type: string;
  person1: FSRelationshipRef;
  person2: FSRelationshipRef;
  facts?: FSFact[];
}

interface FSSourceDescription {
  id: string;
  about?: string;
  titles?: Array<{ value: string }>;
  citations?: Array<{ value: string }>;
  notes?: Array<{ value: string }>;
  resourceType?: string;
}

interface FSTreeResponse {
  persons?: FSPerson[];
  relationships?: FSCoupleRelationship[];
  childAndParentsRelationships?: FSChildAndParentsRelationship[];
  sourceDescriptions?: FSSourceDescription[];
}
```

**Simplified output types:**

```typescript
interface SimplifiedName {
  given: string;
  surname: string;
  prefix?: string;
  suffix?: string;
}

interface SimplifiedFact {
  type: string;
  date?: string;
  place?: string;
  value?: string;
}

interface SimplifiedPerson {
  id: string;
  gender: string;
  living: boolean;
  names: SimplifiedName[];
  facts?: SimplifiedFact[];
}

interface SimplifiedRelationship {
  type: "ParentChild" | "Couple";
  parent?: string;           // ParentChild only
  child?: string;            // ParentChild only
  subtype?: string; // ParentChild only: "Biological", "Adoptive", "Step", "Foster", "Guardian"
  person1?: string;          // Couple only
  person2?: string;          // Couple only
  facts?: SimplifiedFact[];  // Couple only
}

interface SimplifiedSource {
  id: string;
  title: string;
  citation?: string;
  url?: string;
  notes?: string[];
}

interface PersonReadResult {
  persons: SimplifiedPerson[];
  relationships: SimplifiedRelationship[];
  sources: SimplifiedSource[];
}
```

### Conversion function (shared)

The person_read tool does **not** ship its own conversion logic. It imports
the shared `toSimplified` function from `src/utils/gedcomx-convert.ts`
to convert the FS-extended GEDCOMX response to simplified GEDCOMX.

The conversion rules documented above describe the behavior of
`toSimplified` as it applies to person_read tool data. Fields `toSimplified`
does not surface (e.g., `living`, `notes`, couple `fact.value`) are
filled by post-processing the converter output against the raw
response. FS couple refs arrive as `resourceId`-only; the tool
normalizes them to `resource` refs before conversion so participants
are not dropped.

### `packages/engine/mcp-server/src/tools/person-read.ts`

- `personReadToolSchema` — MCP tool schema
- `personReadTool(input: PersonReadToolInput): Promise<PersonReadResult>` — main function
- `fetchPerson(token, pid, options)` — GET with query params, handles status codes
- `buildHeaders(token)` — returns auth + accept headers

### `packages/engine/mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools, CallTool).

---

## Testing

### `tests/tools/person-read.test.ts`

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns simplified person for valid ID | Person happy path |
| 2 | Includes relatives in persons[] and relationships[] when flag set | Relatives flag |
| 3 | Includes sources[] when flag set | Sources flag |
| 4 | Returns both when both flags set | Combined flags |
| 5 | Returns empty relationships/sources when flags are false | No-flag shape |
| 6 | Strips URI prefixes from fact types (Birth, Death, etc.) | Fact type extraction |
| 7 | Handles data: prefix custom fact types | Custom fact types |
| 8 | Extracts given/surname from name parts | Name extraction |
| 9 | Handles missing given or surname gracefully | Name edge case |
| 10 | Filters SD_* metadata from sources | Source filtering |
| 11 | Flattens source title/citation/url correctly | Source mapping |
| 12 | Converts childAndParentsRelationships to ParentChild | Relationship conversion |
| 13 | Converts couple relationships with marriage facts | Couple conversion |
| 14 | Keeps all relationships (no focal-person filtering) | Relationship scope |
| 15 | Extracts subtype from parent facts (Biological, Step, etc.) | Relationship type |
| 16 | Omits subtype when parent facts are absent | Relationship type edge case |
| 17 | Extracts prefix and suffix from name parts | Name prefix/suffix |
| 18 | Includes notes on sources when present | Source notes |
| 19 | Throws auth error when not authenticated | Auth propagation |
| 20 | Throws on 404 (person not found) | Error handling |
| 21 | Throws on 410 (person deleted) | Error handling |
| 22 | Throws on 403 (restricted person) | Error handling |
| 23 | Follows 301 redirect (person merged) | Merge handling |
| 24 | Returns living=true on 204 response | Living person |

### Smoke-test script

`packages/engine/mcp-server/dev/try-person-read.ts`:

```bash
cd packages/engine/mcp-server
npx tsx dev/try-person-read.ts KNDX-MKG                         # Person only
npx tsx dev/try-person-read.ts KNDX-MKG --relatives              # Person + family
npx tsx dev/try-person-read.ts KNDX-MKG --sources                # Person + sources
npx tsx dev/try-person-read.ts KNDX-MKG --relatives --sources    # Everything
```

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

- Call `person_read({ personId: "KNDX-MKG" })` — returns simplified person
- Call `person_read({ personId: "KNDX-MKG", relatives: true })` — returns person + family
- Call `person_read({ personId: "KNDX-MKG", sourceDescriptions: true })` — returns person + sources
- Call `person_read({ personId: "KNDX-MKG", relatives: true, sourceDescriptions: true })` — returns all
- Call `person_read` without logging in — returns auth error

### Manual Layer 2 (Claude Code)

**Note:** Claude does not know FamilySearch person IDs. The user must
provide a person ID or a FamilySearch URL (from which Claude extracts
the ID).

- "Look up KNDX-MKG in the Family Tree" — Claude calls `person_read` with the ID
- "Here is my ancestor: https://www.familysearch.org/tree/person/details/KNDX-MKG" —
  Claude extracts the ID from the URL
- "Who are his family members?" — Claude calls `person_read` with `relatives: true`
- "What sources are attached?" — Claude calls with `sourceDescriptions: true`
