# Tree Tool — Live-API Verification Notes

Notes from running probes against the FamilySearch tree API to verify
`docs/specs/tree-tool-spec.md` before extending it with a `sources`
section. These are *findings to discuss with the team*, not spec
changes. The spec itself stays untouched until everyone has compared
notes and we agree on the rewrite.

**Probe scripts (evidence trail):**

- `mcp-server/dev/probe-tree-families.ts` — verifies the `families`
  action against the live `/families` endpoint.
- `mcp-server/dev/probe-tree-sources.ts` — explores the
  `/persons/{id}/sources` endpoint (the new section).
- `mcp-server/dev/probe-tree-person.ts` — full verification of the
  `person` action against `/persons/{id}`.
- `mcp-server/dev/probe-tree-ancestry.ts` — full verification of the
  `ancestry` action against `/platform/tree/ancestry`.
- `mcp-server/dev/probe-tree-edge-discover.ts` /
  `mcp-server/dev/probe-tree-edge-hunt.ts` /
  `mcp-server/dev/probe-tree-edge-final.ts` — edge-case discovery and
  verification (multi-spouse, living, merged, pagination, minimal-family).

All scripts use `getValidToken()` and `Accept: application/x-fs-v1+json`.
Re-run anytime — token refresh is automatic.

**Test subjects used:**

| Person ID | Who | Why |
|-----------|-----|-----|
| `KNDX-MKG` | President George Washington | Heavily-sourced public figure; the ID the user picked in Step 1 |
| `KNDX-MFX` | Augustine Washington (George's father) | **Multi-spouse case** — married Jane Butler (1715) then Mary Ball (1730) |
| `PQD1-2T4` | The logged-in user | **Living person** — `living: true`, sparse family graph |
| `K2QT-J56` | (merged into `GDZW-NZZ`) | **301 redirect case** — confirms merge behavior |
| `KWN2-Y56` | (403 Forbidden) | **Access-restricted ID** — different from "not found" |
| `L6N4-4GW` | Joseph T. Bragg (NOT Washington) | The ID used in the *current* spec's examples |
| `9999-XXX` | Andres Migl. Hernes (random hit) | Was meant to be bogus; turned out to be a real person |
| `ZZZZ-ZZZ` | (truly invalid) | Confirms 404 shape |

> **Spec correction — example ID is wrong.** Every example in
> `tree-tool-spec.md` uses `L6N4-4GW` and labels it "President George
> Washington". The actual George Washington in the current tree is
> **`KNDX-MKG`**. `L6N4-4GW` resolves to a different person ("Joseph
> T. Bragg"). All example payloads in the spec need to be regenerated
> against `KNDX-MKG`.

---

## `/persons/{id}` — person action (full verification)

Status: **spec is mostly correct**, with several useful additions to surface.

Request:

```
GET /platform/tree/persons/KNDX-MKG
Accept: application/x-fs-v1+json
Authorization: Bearer …
```

Response (verified):

- Top level: `description`, `persons[]`, `relationships[]`,
  `sourceDescriptions[]`, `places[]`, `childAndParentsRelationships[]`
  — the response is a *full GEDCOMX envelope*, not just `persons[]`.
  The spec implies only `persons[]` matters, which is fine since we
  only read `persons[0]`.
- `persons[0].display` has all the fields the spec lists.
- `persons[0].display` **also** has `ascendancyNumber`,
  `descendancyNumber`, `familiesAsParent[]`, `familiesAsChild[]`
  (relationship-graph shortcuts). The spec doesn't mention these — we
  can ignore them for the `person` action; they're useful elsewhere.
- `facts[]` shape matches the spec exactly: `type` (GEDCOMX URI),
  `date.original`, `place.original`. Washington has 21 facts including
  `Christening`, `Occupation`, `MilitaryService`, `Religion`, …
- `gender.type` is the full GEDCOMX URI (`http://gedcomx.org/Male`)
  on the raw `gender` field, but `display.gender` is the pretty form
  (`"Male"`). The spec correctly says to use `display.gender`.

### Additional findings worth modelling

- **`persons[0].names[]` is multi-form.** Washington has *5* name
  entries: a `BirthName` (`preferred: true`) plus four `AlsoKnownAs`
  (e.g., "General George Washington", "Father of his country"). The
  spec's interface only carries a `fullText` field — losing the
  `type` and `preferred` flag means we'll only ever show one name.
  Recommend the output surface the preferred name as `name` and
  optionally an `aliases[]` of the non-preferred forms.
- **Each `facts[i]` has structured date/place beyond `original`.**
  The spec only models `date.original` / `place.original`. Live data
  also carries `date.formal` (e.g., `"+1732-02-22"` — ISO-8601 with
  leading sign), `date.normalized[0].value` (canonical text),
  `place.description` (fragment ref to `places[]`), and
  `place.normalized[0].value`. We don't have to surface all of these,
  but `date.formal` is the only machine-parseable date — worth at
  least exposing it.
- **`persons[0].sources[]` exists at the person level** with each
  entry carrying `descriptionId` and a `tags[]` array. The `tags`
  entries look like `{resource: "http://gedcomx.org/Birth"}` —
  **this is where the UI's per-fact source counts come from**.
  Aggregating tags gives the "Birth · 6 Sources" chips. Worth a
  follow-up decision: do we want per-fact source counts in the
  `person` output, or leave that to `sources`?
- **`persons[0].personInfo`** is in the response but I haven't
  inspected what it contains. Open follow-up.
- **`person.links` is rich** (17 keys: `spouses`, `change-history`,
  `ancestry`, `notes`, `non-matches`, `portraits`, `collection`,
  `families`, `portrait`, `matches`, `children`, `descendancy`,
  `person`, `source-descriptions`, `merge`, `artifacts`, `parents`).
  We don't need to surface them in the output, but the implementation
  could *follow* these links instead of constructing URLs (HATEOAS).

### Fact-type mapping — spec's table is incomplete

Live data shows fact types the spec's `FACT_TYPE_LABELS` table doesn't
cover. Found in Washington's facts alone:

| Live type URI | Spec coverage |
|---|---|
| `http://gedcomx.org/Birth` | ✅ |
| `http://gedcomx.org/Death` | ✅ |
| `http://gedcomx.org/Burial` | ✅ |
| `http://gedcomx.org/Christening` | ✅ |
| `http://gedcomx.org/Religion` | ❌ not in spec table |
| `http://gedcomx.org/MilitaryService` | ✅ |
| `http://gedcomx.org/Occupation` | ✅ |
| `http://familysearch.org/v1/LifeSketch` | ❌ FS extension, not GEDCOMX — spec's "last URI segment" fallback works |
| `http://familysearch.org/v1/TitleOfNobility` | ❌ FS extension |
| `data:,Elected` | ❌ **raw data URI** — spec fallback would return `,Elected` (broken) |
| `data:,Military` | ❌ same problem |
| `data:,Will` | ❌ same problem |

Recommend: extend `FACT_TYPE_LABELS` with the additional GEDCOMX and
FS-extension types we've observed, and improve the fallback to handle
the `data:,Foo` form (strip `data:,` prefix).

---

## Families action — significant spec drift

Status: **spec is wrong on three load-bearing claims.**

Request (verified):

```
GET /platform/tree/persons/KNDX-MKG/families
Accept: application/x-fs-v1+json
Authorization: Bearer …
```

### Drift #1 — Spouses are not in `childAndParentsRelationships`

The current spec says:

> ```
> response.childAndParentsRelationships[]  — family groups
> response.persons[]                       — all referenced persons
> ```

…and the output type returns `FamilySummary` with `parent1` /
`parent2` / `children`. But **spouse relationships are not in
`childAndParentsRelationships`** — they're in a separate
`relationships[]` array with `type: "http://gedcomx.org/Couple"`. A
tool that parses only `childAndParentsRelationships` will:

- Show stepchildren *with their step-parent* as if they were the
  focal person's biological co-parent
- Never list a spouse who has no children with the focal person
- Have no marriage date or place

Verified shape of a `Couple` relationship:

```json
{
  "id": "MCDG-G9L",
  "type": "http://gedcomx.org/Couple",
  "person1": { "resource": "#KNDX-MKG", "resourceId": "KNDX-MKG" },
  "person2": { "resource": "#KNZC-6QV", "resourceId": "KNZC-6QV" },
  "facts": [
    {
      "type": "http://gedcomx.org/Marriage",
      "date":  { "original": "6 January 1759", "formal": "+1759-01-06" },
      "place": { "original": "New Kent, Virginia, British Colonial America" }
    }
  ],
  "sources": [ { "descriptionId": "9PRN-S44", … } ]
}
```

### Drift #2 — Relationship-type labels are in `parent1Facts` / `parent2Facts`

The spec's `FamilySummary` type only carries a coarse `relationship:
"parentChild" | "couple"` field. The UI (per the user's Step 1 notes)
shows labels like **Step**, **Guardianship**, **Biological**, and
**Adopted** next to each parent. Those labels live inside each
`childAndParentsRelationship` as:

```json
{
  "id": "99J1-DJ9",
  "parent1": { "resourceId": "KNDX-MKG" },
  "parent2": { "resourceId": "KNZC-6QV" },
  "child":   { "resourceId": "L8S6-24S" },
  "parent1Facts": [ { "type": "http://gedcomx.org/StepParent", … } ],
  "parent2Facts": [ { "type": "http://gedcomx.org/BiologicalParent", … } ]
}
```

Observed `parent*Facts[].type` URIs (in Washington's payload alone):

- `http://gedcomx.org/BiologicalParent`
- `http://gedcomx.org/StepParent`
- `http://gedcomx.org/GuardianParent`

The spec needs to model these — likely as a per-parent label on the
output, e.g. `parent1.relationshipType: "Biological" | "Step" |
"Guardian" | "Adoptive"`.

### Drift #3 — Returns the entire extended graph, not just immediate family

Washington's `/families` response returned:

- 17 persons
- 49 `childAndParentsRelationships`
- 105 `relationships` (7 `Couple`, 98 `ParentChild` — the latter
  duplicating the CAPRs, one entry per parent-child edge)
- 10 sourceDescriptions, 46 places

That's **not** "immediate family" as the spec frames it. It's every
person in a 2-step relationship radius — including the focal person's
parents' other children's spouses, etc. The spec's docstring will
mislead Claude into describing the response that way.

The tool needs to **filter to relationships the focal person directly
participates in** before mapping. Specifically:

- Parents: CAPRs where `child.resourceId == focalId`
- Children: CAPRs where `parent1.resourceId == focalId || parent2.resourceId == focalId`
- Spouses: `relationships[]` entries with `type=Couple` where
  `person1.resourceId == focalId || person2.resourceId == focalId`
- Siblings (if surfaced): CAPRs with the *same* parents as the focal
  person's CAPR — derived, not a primary record

### Drift #4 — `resource` is sometimes a URL, not a fragment

The spec implies `parent1.resourceId` is the only field we read. True
— but persons referenced by `resource: "https://api.familysearch.org/
platform/tree/persons/XYZ"` (absolute URL) are **not** present in the
response's `persons[]`. Only fragment refs (`"#XYZ"`) point to in-band
`persons[]` entries.

Practical impact: when the tool maps a relative to a name + lifespan,
it must handle the "absent from persons[]" case. Two options:

1. Return the relative with just `personId` and `null` name/lifespan.
2. Make a follow-up `/persons/{id}` call per missing relative
   (expensive — Washington's response would trigger several).

The spec should pick one and say so. The first option is cheaper and
arguably what we want for V1.

### Drift #5 — `persons[].display` has fields the spec misses

Beyond what the spec lists, `display` also carries:

- `descendancyNumber` (only on focal person — irrelevant to families action)
- `ascendancyNumber` (only on focal person — relevant to ancestry action; spec already covers it there)
- `familiesAsParent[]`, `familiesAsChild[]` — pre-computed family
  group memberships. **These are gold.** Each entry has the parent /
  child resourceIds and could replace our CAPR-walking logic
  entirely. Worth a separate probe to confirm whether they're always
  populated.

### Multi-spouse case (verified)

`KNDX-MFX` (Augustine Washington — George's father) was confirmed as
a two-spouse case:

- **Spouse 1**: Jane Butler (`LHMM-9K4`), 1699–1728. Marriage: 20 April 1715, Westmoreland, Virginia.
- **Spouse 2**: Mary Ball (`KNDD-GXQ`), 1708–1789. Marriage: 6 MAR 1730, Lancaster, Virginia.

Both come back as separate `Couple` relationships in `relationships[]`,
each with its own `Marriage` fact. The order in the array is **not
chronological** — spouse[0] was the later wife in some other probes;
the tool should sort by marriage date if presentation order matters.

**Date format warning.** The two marriages' `date.original` values
are `"20 April 1715"` and `"6 MAR 1730"` — different formats from the
same person's record. The spec assumes one canonical format. Use
`date.formal` (`"+1715-04-20"`, `"+1730-03-06"`) when machine-parsing.

---

## Ancestry action — additional drift

Status: **spec has two factual errors** that need correction.

### Drift #1 — `ascendancyNumber` is a string, not a number

The spec types it as `number` in `AncestorSummary` and shows
`"ascendancyNumber": 1` in the example payload. Live data returns a
**string** in every case, including non-numeric values:

```
[0] asc="1"   (string) — focal person
[1] asc="1-S" (string) — focal person's SPOUSE (new!)
[2] asc="2"   (string) — father
[3] asc="3"   (string) — mother
...
```

The `"1-S"` suffix is the **focal person's spouse**. The spec doesn't
mention this at all — the ancestry endpoint includes spouses of the
focal person inside the same response. They share `ascendancyNumber
"1-S"` rather than being numbered by ancestral position.

Tool must:
- Accept `string` for `ascendancyNumber` (or convert to number where
  numeric, and use a separate `kind: "self" | "spouse" | "ancestor"` field)
- Document the `-S` suffix
- Probably filter out spouses from the chart unless explicitly requested

### Drift #2 — `generations` is NOT silently clamped

Spec says: *"Clamp to 1–8 silently"*. Actual behavior:

| Param | Response |
|-------|----------|
| `generations=1` | 200 OK |
| `generations=4` | 200 OK |
| `generations=8` | 200 OK |
| `generations=0` | **HTTP 400** (errors[]) |
| `generations=9` | **HTTP 400** (errors[]) |

The server rejects out-of-range values. The tool must clamp
client-side **before** sending the request, or pass through the 400
and turn it into a meaningful error.

### Other confirmed claims

- Top-level keys: `links`, `persons[]`, `places[]` — no
  `relationships[]` or `sourceDescriptions[]`. Lighter response than
  the other endpoints.
- `persons[]` is sorted by `ascendancyNumber` (verified across 2-, 4-,
  and 8-generation requests).
- Missing ancestors → entries are absent (gaps in the numbering),
  confirmed (24 persons for generations=4 instead of the theoretical
  maximum of 31).
- `personDetails` flag controls whether `facts[]` is included.
  Without it, `display` is still present but `facts` is absent.
- For Washington at generations=8: **219 persons** returned (well
  under the theoretical 2^9-1=511 cap, due to genealogical gaps).

---

## Edge cases (final sweep)

### `/sources` does NOT paginate

Tested KNDX-MKG `/sources` with no params and with `count=5`,
`start=0&count=5`, `offset=20`, `count=200`. **All five returned the
same 24 sources.** The endpoint ignores pagination params and returns
the full list every time. For V1 this is fine; if it becomes a
problem for a 200+-source person we may need to revisit.

### 301 redirect on merged persons (confirmed)

`K2QT-J56` returns:

```
HTTP/1.1 301
Location: https://api.familysearch.org/platform/tree/persons/GDZW-NZZ
```

The spec's claim ("Person merged (301) — Follow the redirect to the
new person ID automatically") is correct. The tool must use `redirect:
"manual"` and read the `Location` header — which is what the spec
already says.

Additional behavior:

- `KWN2-Y56` returned **HTTP 403 Forbidden** (not 404 / not 301). The
  spec doesn't cover this status. Likely means the person record is
  restricted (private tree / contributor-only). Recommend: surface a
  user-readable message like *"This person's record is restricted."*
  rather than the generic 4xx error.

### Living person — `/sources` returns HTTP 204

For `PQD1-2T4` (`living: true`):

- `/persons/{id}` returns full normal payload (no redaction observed,
  but this is the *logged-in user's own* record — restricted-access
  behavior may differ for *other* living persons in someone else's
  private tree).
- `/sources` returns **HTTP 204 No Content** with an empty body. The
  tool's source-parser must handle this — `JSON.parse("")` will
  throw. Treat 204 as `sources: []`.
- `/families` returns HTTP 200 with `persons[]:1` (just the focal
  person) and zero `childAndParentsRelationships` / `relationships`.

### Minimal family (no recorded relations)

Covered by the same `PQD1-2T4` test. Confirms the tool must handle
"focal person present, zero relationships" without crashing.

### 404 vs 400 vs 406 — full status taxonomy observed

| Status | When | Body shape |
|--------|------|------------|
| 200 | Success | Standard payload |
| 204 | `/sources` on a sourceless person (e.g., living user) | Empty |
| 301 | Merged person | Empty body; `Location` header to new ID |
| 400 | `generations` out of range; bad search params | `errors[]` with `code`/`label`/`message` |
| 403 | Access-restricted person record | `errors[]` |
| 404 | Person ID doesn't exist | `errors[]` |
| 406 | Endpoint doesn't accept `application/x-fs-v1+json` (e.g., `/changes`, `/tree/search`) | Spring-style `{timestamp, status, error, path}` |

The spec only enumerates 200/301/303/401/404/410/429. We've not seen
410 in practice; we *have* seen 204, 400, 403, 406.

---

## Sources action — proposed new section

Status: **endpoint behaves cleanly; ready to spec.**

Verified endpoint:

```
GET /platform/tree/persons/{pid}/sources
Accept: application/x-fs-v1+json
Authorization: Bearer …
```

Companion endpoints `/source-references` and `/source-descriptions`
**return 404** — `/sources` is the canonical path.

### Response shape (verified against KNDX-MKG and L6N4-4GW)

```
{
  "persons": [ … 1 entry — the focal person, minimal stub … ],
  "sourceDescriptions": [ … N entries … ]
}
```

No pagination, no top-level `links.next`. The 24 sources on
Washington and the 1 source on Bragg were returned in a single call.
Need to test a person with >50 sources to confirm whether the
endpoint paginates or just returns everything (followup probe).

### `sourceDescriptions[i]` fields (verified)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Tree-internal source ID (e.g., `"7X6N-4WR"`). NOT the original record's ark ID. |
| `about` | string | URL to the underlying record. Either an FS ark (`https://familysearch.org/ark:/61903/1:1:QRHS-D1T2`) or an external URL (`https://www.mountvernon.org/library/`). |
| `resourceType` | string | `"FSREADONLY"` for indexed FS records, `"DEFAULT"` for external/manual links. |
| `titles[0].value` | string | Human-readable display title. Always present. |
| `citations[0].value` | string \| undefined | Pre-formatted citation string (often with `<i>FamilySearch</i>` HTML). Present for `FSREADONLY`, frequently absent for `DEFAULT`. |
| `notes[]` | array | User-added notes ("Why this source matters" comments). Optional. |
| `attribution.contributor.resourceId` | string | Who attached it. Format reveals provenance — see below. |
| `attribution.creator.resourceId` | string | Who created the source description originally. Usually equals `contributor`. |
| `attribution.modified` | number | Unix-ms timestamp of last edit. |
| `attribution.created` | number | Unix-ms timestamp of attachment. **This is the "date attached" the UI shows.** |
| `lang` | string | Always `"en"` in our samples. |
| `sortKey` | string | Server-assigned ordering hint. Use to preserve UI order, but probably not worth surfacing. |
| `links` | object | Internal API hrefs — not user-facing. |

### Contributor / "Attached by" — provenance from `resourceId` prefix

| Prefix observed | Meaning |
|-----------------|---------|
| `cis.wkca.*`    | Attached by a FamilySearch curation system / "WikiCenter" — the source shows as "FamilySearch" in the UI. |
| `cis.user.*`    | Attached by a regular FamilySearch user. |
| Bare ID (`MMFN-RX7`) | Older attribution format — predates the cis-prefix scheme. Treat the same as user-attached for display. |

Confirmed empirically: Washington's heavily-curated sources are all
`cis.wkca.MMMM-M93P`; Bragg's user-attached source is
`cis.user.MMMM-DF5W`.

We **don't** get the contributor's display name in this response — to
show "Attached by Jane Q" the tool would need a separate fetch to
`/platform/users/agents/{resourceId}`. That's an N+1 hit for full
listings. Recommend the V1 spec surface only the prefix-derived
"FamilySearch vs user" distinction and leave the display name as a
future enhancement.

### Year of the underlying event

Not a structured field on the sourceDescription. The year visible in
the UI (e.g., "1775") is **parsed out of the citation/title text** by
the front-end. If we want a structured year in our output, the
options are:

1. Regex-extract a 4-digit year from `citations[0].value` or `titles[0].value`.
2. Fetch the full source description via `/platform/sources/descriptions/{id}` (the `links.source-description.href` link) and read its facts. Expensive.
3. Omit it — return only what's directly available.

Option 1 is good enough for V1.

### Per-fact source attachments

The list of facts that each source supports (the "Birth · 6 Sources"
counts in the UI) is **not** returned by `/sources` directly. It
would require either:

- Walking each `personState.facts[i].sources[]` from the
  `/persons/{id}` response (each fact carries its own
  `sources[].descriptionId` links).
- Calling `/persons/{id}/source-references` per source-id —
  except that endpoint 404'd in my probe; needs more investigation.

For V1 of the sources action I'd recommend **leaving per-fact
attachment counts out of scope**. Document that the `sources` action
returns the person-level source list; per-fact source linking is a
later enhancement.

### Proposed spec additions (sketch only — for discussion)

Add a fourth action:

| Action | What it does |
|--------|--------------|
| `sources` | Get the list of sources attached to a person |

New output type:

```typescript
interface SourceSummary {
  sourceId: string;           // sourceDescription.id
  title: string;              // titles[0].value
  citation?: string;          // citations[0].value (HTML may be present)
  recordUrl: string;          // about — ark or external URL
  recordType: "FamilySearchRecord" | "ExternalLink";  // derived from resourceType
  attachedBy: "FamilySearch" | "User";  // derived from contributor.resourceId prefix
  attachedAt: string;         // ISO date from attribution.created
  year?: number;              // regex-extracted from citation/title
}

interface SourcesResult {
  personId: string;
  sources: SourceSummary[];
}
```

Open spec questions for the group:

- Do we want to surface notes on the source description in V1?
- Do we want the raw HTML in `citation`, or strip tags?
- Should the action also accept `personId` omitted (current-user
  resolution), like the other actions? (Probably yes, for consistency.)

---

## Open verification gaps

These are still unanswered after the second probe pass:

1. **Restricted living person.** I only tested the logged-in user's
   *own* record. Living persons in *someone else's* private tree may
   be redacted differently (names hidden, facts withheld). Couldn't
   test without access to another user's private tree.
2. **`/tree/search` endpoint.** Returns HTTP 406 with our `Accept:
   application/x-fs-v1+json` header. Likely needs `application/json`
   or `application/x-gedcomx-atom+json`. Not in scope for the tree
   tool, but worth noting if a future feature needs tree-person
   search.
3. **`/changes` endpoint.** Same 406. Not in our tool scope.
4. **`personInfo` field on persons[0].** Present in the payload but
   I didn't open it. Probably privacy / contributor flags.
5. **Heavily-sourced person (200+ sources).** Couldn't find one (FS
   tree search didn't work). The 24-source ceiling I tested is below
   any plausible paginate-or-not threshold. Open to revisit if a
   real user runs into truncation.

---

## UI verification checklist (for human teammates)

I tried to WebFetch the four pages we were supposed to walk through
in Step 1, but FamilySearch's site is a JS-rendered SPA and the
WebFetch tool only sees a "your browser is not supported" stub on all
four URLs. **UI verification has to be done by a real human in a
real browser.** Here's a shortened checklist for whoever does:

1. **Details page** (`/tree/person/details/KNDX-MKG`):
   - Confirm display name is "President George Washington"
   - Note exact date format ("22 February 1732"?) — should match
     the `display.birthDate` value we saw in the API
   - Note exact place format — should match `display.birthPlace`
   - Confirm the source counts shown per fact ("Birth - N Sources")
     — these are *not* in the `/persons/{id}` JSON; need to know if
     they come from `/sources` aggregation or a separate endpoint

2. **Family members page** (`/tree/person/familymembers/KNDX-MKG`):
   - Confirm Washington's listed spouse is Martha Dandridge (`KNZC-6QV`)
   - Confirm the children include the Custis stepchildren (John Parke,
     Martha Parke, Eleanor Parke, George Washington Parke)
   - Note the **exact label** next to each child — UI is supposed to
     say "Step" / "Biological" / "Guardianship". Confirm those map
     to the GEDCOMX types we observed:
     `StepParent` / `BiologicalParent` / `GuardianParent`
   - Find someone with multiple spouses (search "Henry VIII") and
     note how the multiple-spouse UI is laid out

3. **Pedigree page** (`/tree/pedigree/landscape/KNDX-MKG`):
   - Default generation count?
   - Per-ancestor display: name + lifespan only, or also birth/death?

4. **Sources page** (`/tree/person/sources/KNDX-MKG`):
   - Total sources count (we saw 24 from the API — does the UI agree?)
   - For one curated and one user source, note:
     - The exact year shown (and where it appears to come from)
     - The "attached by" string format
     - The "attached on" date format
   - Confirm the difference between FS-attached and user-attached
     matches our `cis.wkca.*` vs `cis.user.*` heuristic

Once the team has both this API evidence and the UI notes, we can
finalize the spec rewrite together.
