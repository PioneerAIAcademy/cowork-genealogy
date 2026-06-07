# GedcomX Conversion — Implementation Spec

## Overview

Two TypeScript utility functions that translate between FamilySearch's
verbose **GedcomX** format and a token-efficient **simplified** format. MCP
tools call these functions to keep LLM-facing payloads compact and to
re-inflate LLM output for upload.

```
GedcomX (from FamilySearch)  → toSimplified  → SimplifiedGedcomX (to LLM)
SimplifiedGedcomX (from LLM) → toGedcomX     → GedcomX (to FamilySearch)
```

The output schema is normatively defined in
[`simplified-gedcomx-spec.md`](./simplified-gedcomx-spec.md). The functions
must produce output that conforms to that schema. `research.json`
(`research-schema-spec.md`) references the simplified format by ID as a
foreign-key target, so the produced shape is part of an existing contract.

---

## Function signatures

```typescript
export function toSimplified(gedcomx: GedcomX): SimplifiedGedcomX;
export function toGedcomX(simplified: SimplifiedGedcomX): GedcomX;
```

Both functions are pure (no I/O, no side effects). Neither throws on missing
or malformed optional fields.

---

## Input types — GedcomX

The functions accept the subset of GedcomX that FamilySearch returns through
the `person_read`, `cets`, and `record_search` endpoints. (`record_search` runs
each search entry's `content.gedcomx` through `toSimplified` so downstream tools
get the faithful record shape instead of the flattened summary.) Fields outside
this subset are dropped during simplification.

```typescript
export type GedcomX = {
  persons?: GedcomXPerson[];
  relationships?: GedcomXRelationship[];
  sourceDescriptions?: GedcomXSourceDescription[];
  places?: GedcomXPlaceDescription[];
};

export type GedcomXPerson = {
  id?: string;
  gender?: { type: string };
  names?: GedcomXName[];
  facts?: GedcomXFact[];
  sources?: GedcomXSourceReference[];
  identifiers?: Record<string, string[]>;
};

export type GedcomXName = {
  id?: string;
  type?: string;            // URI, e.g. "http://gedcomx.org/BirthName"
  preferred?: boolean;
  nameForms?: GedcomXNameForm[];
  sources?: GedcomXSourceReference[];
};

export type GedcomXNameForm = {
  lang?: string;
  fullText?: string;
  parts?: GedcomXNamePart[];
};

export type GedcomXNamePart = {
  type?: string;            // URI, e.g. "http://gedcomx.org/Given"
  value?: string;
};

export type GedcomXFact = {
  id?: string;
  type?: string;            // URI, e.g. "http://gedcomx.org/Birth"
  primary?: boolean;
  date?: { original?: string; formal?: string };
  place?: { original?: string; description?: string };
  sources?: GedcomXSourceReference[];
};

export type GedcomXRelationship = {
  id?: string;
  type?: string;            // URI, e.g. "http://gedcomx.org/Couple"
  person1?: { resource: string };
  person2?: { resource: string };
  facts?: GedcomXFact[];
  notes?: GedcomXNote[];
  sources?: GedcomXSourceReference[];
};

export type GedcomXNote = {
  subject?: string;
  text?: string;
  lang?: string;
};

export type GedcomXSourceReference = {
  description?: string;     // Fragment, e.g. "#S1"
  qualifiers?: GedcomXQualifier[];
};

export type GedcomXQualifier = {
  name: string;             // URI, e.g. "http://gedcomx.org/CitationDetail"
  value?: string;
};

export type GedcomXSourceDescription = {
  id?: string;
  titles?: { value: string }[];
  citations?: { value: string }[];
  about?: string;
};

export type GedcomXPlaceDescription = {
  id?: string;
  names?: { value: string }[];
  latitude?: number;
  longitude?: number;
};
```

---

## Output types — SimplifiedGedcomX

```typescript
export type SimplifiedGedcomX = {
  persons?: SimplifiedPerson[];
  relationships?: SimplifiedRelationship[];
  sources?: SimplifiedSourceDescription[];
  places?: SimplifiedPlaceDescription[];
};

export type SimplifiedPerson = {
  id?: string;
  ark?: string;              // First http://gedcomx.org/Persistent identifier
  gender?: string;           // "Male" | "Female" | "Unknown"
  names?: SimplifiedName[];
  facts?: SimplifiedFact[];
  sources?: SimplifiedSourceReference[];
};

export type SimplifiedName = {
  id?: string;
  type?: string;             // PascalCase, e.g. "BirthName"
  preferred?: boolean;       // Present only when GedcomX set it to true
  prefix?: string;
  given?: string;
  surname?: string;
  suffix?: string;
  sources?: SimplifiedSourceReference[];
};

export type SimplifiedFact = {
  id?: string;
  type?: string;             // PascalCase, e.g. "Birth"
  primary?: boolean;         // Present only when GedcomX set it to true
  date?: string;             // Verbatim from GedcomX date.original
  standard_date?: string;    // GEDCOM-canonical form of `date` (set by toSimplified when parseable)
  place?: string;            // Verbatim from GedcomX place.original
  standard_place?: string;   // Standardized place name (snake_case form of standardPlace). See Rule 7.
  sources?: SimplifiedSourceReference[];
};

export type SimplifiedRelationship = {
  id?: string;
  type?: string;             // "ParentChild" | "Couple"
  parent?: string;           // ParentChild only
  child?: string;            // ParentChild only
  subtype?: string;          // ParentChild only — Biological | Adoptive | Step | Foster | Guardian
  person1?: string;          // Couple only
  person2?: string;          // Couple only
  facts?: SimplifiedFact[];
  notes?: string[];          // Flat text content; subject/lang/attribution dropped
  sources?: SimplifiedSourceReference[];
};

export type SimplifiedSourceReference = {
  ref?: string;
  page?: string;
  quality?: string;          // Raw qualifier value, passed through as-is
};

export type SimplifiedSourceDescription = {
  id?: string;
  title?: string;
  citation?: string;
  url?: string;
};

export type SimplifiedPlaceDescription = {
  id?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
};
```

`preferred` and `primary` follow the **omit-when-false / omit-when-undefined**
convention: they are written only when the source GedcomX explicitly set them
to `true`. The conversion functions **pass these flags through** — they do
**not** synthesize them from array position. GedcomX `primary` is per-fact-type
semantics ("this is the primary Birth fact"), not a "first in list" marker; a
person can have a primary Birth, primary Marriage, and primary Death all at
once. The same logic applies to `preferred` on names.

---

## Transformation rules

### 1. URI prefix

Strip `http://gedcomx.org/` from `type` values on simplification; re-add it
on `toGedcomX`. Applies to `person.gender.type`, `name.type`,
`relationship.type`, `namePart.type`. URIs without that prefix are passed
through unchanged.

```
"http://gedcomx.org/Birth"  ↔  "Birth"
```

**`fact.type` gets extra cleanup** because FS emits non-standard URIs for
custom fact types — see Rule 5.5 below.

### 2. Gender

```
{ "type": "http://gedcomx.org/Male" }   ↔  "Male"
{ "type": "http://gedcomx.org/Female" } ↔  "Female"
(missing or unrecognized URI)           →  "Unknown"
```

`toGedcomX`: re-wrap as `{ type: "http://gedcomx.org/<value>" }`. For
`"Unknown"`, omit the `gender` field entirely.

### 3. Names — part extraction

GedcomX standard name parts are `Prefix`, `Given`, `Surname`, `Suffix`.
The simplified format exposes all four as flat string fields.

**Primary path:** read `nameForms[0].parts`, taking the first entry of each
recognized type. Emit a `console.warn` for any `namePart.type` that is not
one of the four — so future divergence in FamilySearch data is visible.

**Fallback path:** if `parts` is missing or empty but `nameForms[0].fullText`
is present, split on the **last** whitespace — everything before becomes
`given`, the trailing token becomes `surname`. A single token (mononym)
becomes `surname` with `given: ""`. Emit a `console.warn` when this path is
taken so its frequency stays visible.

> **Known limitation.** The last-whitespace split misclassifies Latin
> double-surnames (e.g. "Gabriel García Márquez" produces
> `given: "Gabriel García", surname: "Márquez"` instead of
> `given: "Gabriel", surname: "García Márquez"`). The fallback path is
> expected to be rare; real FamilySearch responses carry `parts` in nearly
> all cases.

```
parts: [{Prefix: "Dr."}, {Given: "John"}, {Surname: "Doe"}, {Suffix: "Jr."}]
                                                   →  prefix: "Dr.", given: "John", surname: "Doe", suffix: "Jr."
parts: [{Given: "John"}, {Surname: "Doe"}]         →  given: "John",          surname: "Doe"
fullText: "William Henry Turner" (no parts)        →  given: "William Henry", surname: "Turner"  (with warn)
fullText: "Plato" (no parts)                       →  given: "",              surname: "Plato"  (with warn)
nameForms missing                                  →  all four fields omitted
```

`toGedcomX`: reconstruct `nameForms: [{ fullText, parts }]`:
- `parts` contains entries for each non-empty `prefix` / `given` / `surname`
  / `suffix`, in that order
- `fullText` is the non-empty values joined with single spaces, in the order
  prefix → given → surname → suffix

### 4. `preferred` on names

`preferred` is passed through, not synthesized.

- Input GedcomX has `preferred: true` on a name → simplified has `preferred: true`
- Input GedcomX omits `preferred` (or sets it `false`) → simplified omits it

The conversion preserves the order of `names[]` as it appears in the input;
it does **not** reorder by `preferred`.

`toGedcomX` is the mirror image: if simplified has `preferred: true`, emit
`preferred: true` on the GedcomX name; otherwise omit. Never emit
`preferred: false`.

### 5. `primary` on facts

`primary` is passed through, not synthesized. GedcomX `primary` is
per-fact-type semantics — a person can have a primary Birth, primary
Marriage, and primary Death all at once. The conversion does **not** treat
"first fact in the array" as primary.

- Input GedcomX has `primary: true` on a fact → simplified has `primary: true`
- Input GedcomX omits `primary` (or sets it `false`) → simplified omits it

The conversion preserves the order of `facts[]` as it appears in the input;
it does **not** reorder by `primary`.

`toGedcomX` is the mirror image: if simplified has `primary: true`, emit
`primary: true` on the GedcomX fact; otherwise omit. Never emit
`primary: false`.

### 5.5 `fact.type` — extra cleanup beyond Rule 1

FS does not always emit the canonical `http://gedcomx.org/X` URI for fact
types. Custom fact types come back as `data:,X` URIs, and the trailing
segment may carry URL-encoded characters. The converter normalizes all of
these to clean PascalCase / space-separated names:

```
"http://gedcomx.org/Birth"                  →  "Birth"
"data:,Baptism"                             →  "Baptism"
"data:,Military%20Draft%20Registration"     →  "Military Draft Registration"
"http://familysearch.org/v1/Foo"            →  "Foo"
"Foo" (already a short name)                →  "Foo"
```

Algorithm:
1. If the value starts with `http://gedcomx.org/`, strip that prefix.
2. Else if it starts with `data:,`, strip that prefix.
3. Else if it contains `://`, take the trailing path segment.
4. Otherwise pass through.
5. URL-decode the result (`decodeURIComponent`). If decoding throws on a
   malformed percent sequence, the undecoded value is returned.

`toGedcomX` re-prepends `http://gedcomx.org/` on the reverse path. Custom
fact types that originated as `data:,X` round-trip to
`http://gedcomx.org/X`; this is acceptable because FS treats them as
equivalent.

### 6. Dates on facts

```
{ "original": "15 June 1850" }              →  date: "15 June 1850", standard_date: "15 Jun 1850"
{ "original": "1900", "formal": "+1900" }   →  date: "1900",         standard_date: "1900"
{ "original": "garbled junk" }              →  date: "garbled junk"  (standard_date omitted)
{ "formal": "+1900" } (no original)         →  date omitted, standard_date omitted
```

`date` is `fact.date.original` verbatim — whatever a contributor typed. `standard_date` is the GEDCOM-canonical form produced by `stdDate(date.original)`; it is omitted when the standardizer cannot parse the input.

`date.formal` is dropped — the standardized sidecar replaces its role. `toGedcomX` writes only `{ original: dateString }` from `date`; `standard_date` is ignored on the reverse path (it is a simplified-format-only sidecar).

### 7. Places on facts

```
{ "original": "Denver, Colorado, USA", "description": "#place1" }  →  place: "Denver, Colorado, USA"
{ "original": "Denver", "normalized": [{ "value": "Denver, Colorado, United States", "lang": "en" }] }
                                                  →  place: "Denver", standard_place: "Denver, Colorado, United States"
```

`place` is `place.original` verbatim. `standard_place` is the standardized
name: `toSimplified` (pure) takes it from `place.normalized` — preferring the
`lang === "en"` entry, else the first. The `description` reference is dropped;
richer place data lives in the top-level `places[]` array (Rule 12).

`standard_place` is a simplified-format-only sidecar (like `standard_date`):
`toGedcomX` writes only `{ original: placeString }` and ignores
`standard_place` on the reverse path.

Free-text places with no `normalized` value are left without a
`standard_place` by the pure converter. The async wrapper
`toSimplifiedStandardized` fills them by resolving `place` through
`place_search` (network) — deduping identical strings, resolving ≤8 in
parallel, best-effort (never throws, leaves the field empty on failure). Tools
that return facts to the model call `toSimplifiedStandardized` (single doc) or
run `standardizePlaces` over the flattened facts of a multi-result response
(`record_search` / `person_search`). The pure `toSimplified` remains for
callers that want no I/O.

### 7.5 `value` on facts

For fact types whose meaning isn't fully captured by `type + date + place`,
FS carries an extra qualifier in `fact.value`. The converter preserves it
verbatim on both directions.

```
{ "type": "http://gedcomx.org/Occupation",
  "date": { "original": "about 1940" },
  "value": "Newpaper Editor" }                →  value: "Newpaper Editor"

{ "type": "data:,Elected",
  "value": "Continental Congress" }            →  value: "Continental Congress"

{ "type": "http://gedcomx.org/Birth",
  "date": { "original": "1900" } }             →  value omitted (raw has none)
```

`toGedcomX` passes `value` through unchanged when set. The field is omitted
when the simplified fact has no `value`.

### 8. Relationships — `ParentChild`

```
{
  "type": "http://gedcomx.org/ParentChild",
  "person1": { "resource": "#I2" },
  "person2": { "resource": "#I1" },
  "facts": [
    { "type": "http://gedcomx.org/BiologicalParent" }
  ]
}
↓
{ "type": "ParentChild", "parent": "I2", "child": "I1", "subtype": "Biological" }
```

- `person1` → `parent` (strip leading `#`)
- `person2` → `child` (strip leading `#`)
- `toGedcomX`: re-wrap `{ resource: "#<id>" }`

**Subtype mapping.** The simplified `subtype` field captures the kind of
parent-child relationship. Five values are recognized; their corresponding
GedcomX fact URIs are:

| `subtype` value | GedcomX fact URI |
|---|---|
| `Biological` | `http://gedcomx.org/BiologicalParent` |
| `Adoptive` | `http://gedcomx.org/AdoptiveParent` |
| `Step` | `http://gedcomx.org/StepParent` |
| `Foster` | `http://gedcomx.org/FosterParent` |
| `Guardian` | `http://gedcomx.org/GuardianParent` |

- `toSimplified` on a ParentChild relationship: scan `facts[]` for the first
  fact whose `type` matches one of the five URIs above. Strip the `Parent`
  suffix and lift the short name to `subtype`. **The matched fact is
  removed from the `facts[]` carried into simplified output** so the
  information lives in exactly one place. Other facts (e.g. an adoption
  date) stay in `facts[]`.
- `toGedcomX` on a simplified ParentChild relationship with `subtype` set:
  synthesize a fact `{ type: "http://gedcomx.org/<Subtype>Parent" }` and
  **prepend it** to the GedcomX `facts[]` array.
- Unrecognized subtype-style facts pass through unchanged in `facts[]`;
  `subtype` is omitted.

**Round-trip caveat.** If the input GedcomX had the subtype fact at a
non-zero index in `facts[]`, the round trip normalizes it to index 0. This
is a deliberate, documented loss; GedcomX does not assign semantic ordering
to facts.

**Out of scope.** FamilySearch's `ChildAndParentsRelationship` extension
(which uses `parent1Facts` / `parent2Facts` rather than standard
`Relationship.facts`) is not handled here. The `person_read` MCP tool is
responsible for normalizing FS extension responses into standard GedcomX
shape before calling `toSimplified`.

### 9. Relationships — `Couple`

```
{
  "type": "http://gedcomx.org/Couple",
  "person1": { "resource": "#I2" },
  "person2": { "resource": "#I3" }
}
↓
{ "type": "Couple", "person1": "I2", "person2": "I3" }
```

Strip `#` from both resources. `toGedcomX` re-wraps.

### 10. Source references

```
{
  "description": "#S1",
  "qualifiers": [
    { "name": "http://gedcomx.org/CitationDetail", "value": "1920 Census, ED 47" },
    { "name": "fsmcp:quality", "value": "3" }
  ]
}
↓
{ "ref": "S1", "page": "1920 Census, ED 47", "quality": "3" }
```

- `description: "#S1"` → `ref: "S1"` (strip `#`)
- Qualifier with `name === "http://gedcomx.org/CitationDetail"` → `page`
- Qualifier with `name === "fsmcp:quality"` → `quality` as **a string**,
  passed through as-is (no coercion)
- All other qualifiers are dropped
- When the qualifier is absent, **omit** the field

`toGedcomX`: rebuild `qualifiers[]` with only `CitationDetail` and
`fsmcp:quality` entries, emitting each only when the corresponding
simplified field is present.

`fsmcp:quality` is a project-internal namespace; it is not a published
GedcomX qualifier.

### 11. Source descriptions

```
{
  "id": "S1",
  "titles": [{ "value": "1910 U.S. Federal Census" }],
  "citations": [{ "value": "1910 United States Federal Census. NARA." }],
  "about": "https://www.archives.gov/..."
}
↓
{
  "id": "S1",
  "title": "1910 U.S. Federal Census",
  "citation": "1910 United States Federal Census. NARA.",
  "url": "https://www.archives.gov/..."
}
```

- `titles[0].value` → `title` (omit if titles missing/empty)
- `citations[0].value` → `citation` (omit if citations missing/empty)
- `about` → `url`

The top-level array is renamed `sourceDescriptions` ↔ `sources`.

### 12. Place descriptions

```
{
  "id": "place1",
  "names": [{ "value": "Springfield, Illinois, United States" }],
  "latitude": 39.7817,
  "longitude": -89.6501
}
↓
{
  "id": "place1",
  "name": "Springfield, Illinois, United States",
  "latitude": 39.7817,
  "longitude": -89.6501
}
```

- `names[0].value` → `name` (omit if names missing/empty)
- Top-level array key stays `places` on both sides

### 13. Notes on relationships

```
{
  "type": "http://gedcomx.org/ParentChild",
  "person1": { "resource": "#I2" },
  "person2": { "resource": "#I1" },
  "notes": [
    { "subject": "Adoption record", "text": "Adopted in 1923 per county records.", "lang": "en" }
  ]
}
↓
{
  "type": "ParentChild",
  "parent": "I2",
  "child": "I1",
  "notes": ["Adopted in 1923 per county records."]
}
```

- `toSimplified`: for each entry in `relationship.notes[]`, take the `text`
  field as a flat string. Entries missing `text` are dropped. The
  simplified `notes` array preserves order. If the input has no notes (or
  the array is empty after filtering), the field is omitted.
- `toGedcomX`: wrap each simplified string in `{ text: <string> }`. Order
  preserved.
- **Lossy fields.** `subject`, `lang`, and `attribution` are not preserved.
  Round-trip identity holds for the `text` value only.

This rule applies to both `ParentChild` and `Couple` relationships.

### 14. IDs

IDs are passed through verbatim. The functions do not generate IDs. If input
GedcomX lacks an ID on a name, fact, or relationship, the simplified output
also lacks it. ID generation (with `I`/`N`/`F`/`R`/`S` prefixes per
`simplified-gedcomx-spec.md` §3) is the caller's responsibility.

### 15. Person identifiers — flat `ark`

GedcomX `Person.identifiers` is a map from identifier-type URI to a list of
identifier values. The entry under `http://gedcomx.org/Persistent` carries
the canonical FamilySearch ARK URL for the persona — the anchor that
record-search APIs use to identify which record a persona represents.

The simplified format lifts the first Persistent value to a flat `ark`
string on `SimplifiedPerson`, following the same flattening convention used
by other single-dominant-value structures in the spec (`date.original` →
`date`, `place.original` → `place`, `titles[0].value` → `title`,
`nameForms[0].parts` → `given`/`surname`). Other identifier types
(`Primary`, `Authority`, etc.) are dropped — this is a documented loss,
matching Rule 6's drop of `date.formal` and Rule 10's drop of qualifiers
outside `CitationDetail` / `fsmcp:quality`.

```
{
  "http://gedcomx.org/Persistent": ["https://familysearch.org/ark:/61903/4:1:KGS8-LY1"],
  "http://gedcomx.org/Primary":    ["KGS8-LY1"]
}
↓
"ark": "ark:/61903/4:1:KGS8-LY1"
```

- `toSimplified`: read `person.identifiers["http://gedcomx.org/Persistent"][0]`.
  If it is a non-empty string, set `out.ark` to it **normalized to canonical
  `ark:/61903/...` form** (the resolver-URL prefix `https://[www.]familysearch.org/`
  is stripped; a value with no recognizable ARK passes through unchanged). All
  other entries in the `identifiers` map are dropped. If the Persistent entry is
  missing, empty, or the first value is not a non-empty string, omit `ark`.
- `toGedcomX`: when `person.ark` is a non-empty string, **reduce it to the bare
  8-character persona id** (the segment after the ARK's last colon, e.g.
  `ark:/61903/4:1:KGS8-LY1` → `KGS8-LY1`) and write
  `out.identifiers = { "http://gedcomx.org/Persistent": [<bareId>] }`.
  FamilySearch APIs that consume the round-tripped GedcomX (e.g. matchTwoExamples)
  want the bare id, not an ARK or resolver URL. A value with no recognizable ARK
  passes through unchanged. When `ark` is missing or an empty string, omit
  `identifiers`.

**Documented losses.** Round-tripping through this rule loses:
1. Identifier types other than `Persistent` (input → output).
2. Persistent values beyond the first one in the array (multiple-value collapse).
3. The ARK form itself on `toGedcomX`: the `n:n:` type prefix is dropped when
   reducing `ark:/61903/...` to the bare id, so `simplified → raw → simplified`
   does not preserve `ark` (the raw side carries only the bare id).

---

## Edge cases

| Scenario | `toSimplified` | `toGedcomX` |
|---|---|---|
| `nameForms` missing and `fullText` missing | All four part fields omitted | `nameForms` omitted |
| `parts` missing, `fullText` present | Split last whitespace into `given`/`surname`; warn | Reconstruct `parts` from non-empty part fields |
| `parts` has `Given` only | `given` populated; others omitted | Emit one `Given` part |
| `parts` has `Surname` only | `surname` populated; others omitted | Emit one `Surname` part |
| `parts` has `Prefix` and/or `Suffix` | Corresponding fields populated | Emit matching parts |
| `parts` has unrecognized `type` URI | Skip that part; warn | n/a |
| Mononym (`fullText: "Plato"`) | `given: ""`, `surname: "Plato"`; warn | `fullText: "Plato"`, `parts: [{ Surname: "Plato" }]` |
| `preferred` absent on input name | Field omitted | n/a |
| `preferred: false` on input name | Field omitted | Emit nothing (never `false`) |
| `primary` absent on input fact | Field omitted | n/a |
| `primary: false` on input fact | Field omitted | Emit nothing (never `false`) |
| `date` object missing on fact | `date` omitted | `date` omitted |
| `formal` present, `original` missing | `date` omitted | n/a |
| `place` object missing on fact | `place` omitted | `place` omitted |
| `place.original` missing but object exists | `place` omitted | n/a |
| `qualifiers` missing on source ref | `page` and `quality` omitted | `qualifiers` omitted |
| `CitationDetail` qualifier absent | `page` omitted | Omit `CitationDetail` qualifier |
| `fsmcp:quality` qualifier absent | `quality` omitted | Omit `fsmcp:quality` qualifier |
| `sources` array empty | Omit `sources` | Omit `sources` |
| `names` array empty | Omit `names` | Omit `names` |
| `facts` array empty | Omit `facts` | Omit `facts` |
| `titles` empty on source description | Omit `title` | Omit `titles` |
| `citations` empty on source description | Omit `citation` | Omit `citations` |
| Top-level array missing | Omit array from output | Omit array from output |
| Person with no name | Include person with `id` and `gender` only | Same |
| Unknown gender URI | `gender: "Unknown"` | Omit `gender` |
| Non-`gedcomx.org` URI in `type` field | Pass through unchanged | Pass through unchanged |
| ParentChild with no subtype-fact in `facts[]` | `subtype` omitted | No subtype-fact emitted |
| ParentChild subtype-fact at non-zero index in `facts[]` | Subtype lifted; other facts retain order | Subtype-fact prepended at index 0 (round-trip normalizes ordering) |
| ParentChild with subtype-fact + unrelated facts | Subtype lifted; unrelated facts stay in `facts[]` | Subtype-fact prepended; unrelated facts follow in original order |
| ParentChild with parent-style fact URI outside the recognized five | Fact passes through unchanged in `facts[]`; `subtype` omitted | Same on the way back |
| `notes` array missing or empty | Omit `notes` | Omit `notes` |
| `notes` entry has no `text` field | Drop that entry from simplified output | n/a |
| `identifiers` map missing | Omit `ark` | n/a |
| `identifiers` present but no `Persistent` key | Omit `ark` | n/a |
| `Persistent` array empty | Omit `ark` | n/a |
| `Persistent[0]` not a string or empty string | Omit `ark` | n/a |
| `Persistent` array has multiple values | Lift first; rest dropped | Round-trip emits single-element array containing only the first |
| Other identifier types present alongside `Persistent` (e.g. `Primary`) | First Persistent surfaces as `ark`; other types dropped | n/a |
| `ark` missing or empty string on simplified input | n/a | Omit `identifiers` |

---

## Error handling

| Condition | Behavior |
|---|---|
| Top-level structural field is not an array (e.g. `persons: null`) | Treat as missing; omit from output |
| Person, name, fact, or relationship has only partial data | Include in output with available fields; do not drop the entity |
| Function called with `undefined` or `null` | Return `{}` |
| Malformed nested object (e.g. `gender` is a string instead of `{ type }`) | Treat the field as missing; do not throw |

Functions must not throw under any input shape. Use optional chaining and
nullish coalescing throughout.

---

## Files

### `packages/engine/mcp-server/src/types/gedcomx.ts`

All `GedcomX*` and `Simplified*` type definitions from the **Input types** and
**Output types** sections above. Export each type.

### `packages/engine/mcp-server/src/utils/gedcomx-convert.ts`

New file in a new `src/utils/` directory.

Exports:
- `toSimplified(gedcomx: GedcomX): SimplifiedGedcomX`
- `toGedcomX(simplified: SimplifiedGedcomX): GedcomX`

Internal helpers (not exported) for repeated logic — URI strip/restore, name
part extraction with fullText fallback, source reference round-tripping.

### `packages/engine/mcp-server/tests/utils/gedcomx-convert.test.ts`

Vitest suite. See **Testing** section below.

### `packages/engine/mcp-server/dev/try-gedcomx-convert.ts`

Smoke script that runs the worked example below through `toSimplified` and
then `toGedcomX`, printing both results to stdout. Follows the pattern of
`dev/try-wikipedia.ts`.

---

## Worked example

### Input — GedcomX

```json
{
  "places": [
    {
      "id": "place1",
      "names": [{ "value": "Liverpool, England, United Kingdom" }],
      "latitude": 53.4084,
      "longitude": -2.9916
    }
  ],
  "sourceDescriptions": [
    {
      "id": "sd1",
      "titles": [{ "value": "Turner Family Bible" }],
      "citations": [{ "value": "Turner Family Bible, Liverpool, England, 1900" }]
    }
  ],
  "persons": [
    {
      "id": "p1",
      "gender": { "type": "http://gedcomx.org/Male" },
      "names": [
        {
          "type": "http://gedcomx.org/BirthName",
          "nameForms": [{ "fullText": "William Turner" }]
        }
      ],
      "facts": [
        {
          "type": "http://gedcomx.org/Birth",
          "date": { "original": "15 June 1850", "formal": "+1850-06-15" },
          "place": { "original": "Liverpool, England", "description": "#place1" }
        }
      ],
      "sources": [{ "description": "#sd1" }]
    },
    {
      "id": "p2",
      "gender": { "type": "http://gedcomx.org/Female" },
      "names": [
        {
          "type": "http://gedcomx.org/BirthName",
          "nameForms": [{ "fullText": "Elizabeth Turner" }]
        }
      ],
      "facts": [
        {
          "type": "http://gedcomx.org/Birth",
          "date": { "original": "3 March 1855", "formal": "+1855-03-03" },
          "place": { "original": "Manchester, England" }
        }
      ],
      "sources": [{ "description": "#sd1" }]
    }
  ],
  "relationships": [
    {
      "type": "http://gedcomx.org/Couple",
      "person1": { "resource": "#p1" },
      "person2": { "resource": "#p2" },
      "facts": [
        {
          "type": "http://gedcomx.org/Marriage",
          "date": { "original": "20 April 1875", "formal": "+1875-04-20" }
        }
      ]
    }
  ]
}
```

### Expected output — `toSimplified(input)`

The input GedcomX has no `preferred` on its names and no `primary` on its
facts, so the simplified output omits those flags accordingly. Both names
fall into the `fullText` fallback path and emit a warning.

```json
{
  "persons": [
    {
      "id": "p1",
      "gender": "Male",
      "names": [
        {
          "type": "BirthName",
          "given": "William",
          "surname": "Turner"
        }
      ],
      "facts": [
        {
          "type": "Birth",
          "date": "15 June 1850",
          "standard_date": "15 Jun 1850",
          "place": "Liverpool, England"
        }
      ],
      "sources": [{ "ref": "sd1" }]
    },
    {
      "id": "p2",
      "gender": "Female",
      "names": [
        {
          "type": "BirthName",
          "given": "Elizabeth",
          "surname": "Turner"
        }
      ],
      "facts": [
        {
          "type": "Birth",
          "date": "3 March 1855",
          "standard_date": "3 Mar 1855",
          "place": "Manchester, England"
        }
      ],
      "sources": [{ "ref": "sd1" }]
    }
  ],
  "relationships": [
    {
      "type": "Couple",
      "person1": "p1",
      "person2": "p2",
      "facts": [
        {
          "type": "Marriage",
          "date": "20 April 1875",
          "standard_date": "20 Apr 1875"
        }
      ]
    }
  ],
  "places": [
    {
      "id": "place1",
      "name": "Liverpool, England, United Kingdom",
      "latitude": 53.4084,
      "longitude": -2.9916
    }
  ],
  "sources": [
    {
      "id": "sd1",
      "title": "Turner Family Bible",
      "citation": "Turner Family Bible, Liverpool, England, 1900"
    }
  ]
}
```

---

## Testing

### `tests/utils/gedcomx-convert.test.ts`

| # | Test case | What it verifies |
|---|---|---|
| 1 | `toSimplified` on the Turner example produces the expected output | Worked-example happy path |
| 2 | URI prefix stripped from `gender.type`, `name.type`, `fact.type`, `relationship.type` | Rule 1 |
| 3 | `gender: "Unknown"` is produced for unrecognized URIs | Rule 2 |
| 4 | All four part types (`Prefix`, `Given`, `Surname`, `Suffix`) extracted when present | Rule 3 primary |
| 5 | Unrecognized `namePart.type` emits a `console.warn` | Rule 3 primary |
| 6 | Given/surname extracted from `fullText` when `parts` missing, with `console.warn` | Rule 3 fallback |
| 7 | Mononym `"Plato"` → `given: ""`, `surname: "Plato"`, with `console.warn` | Rule 3 mononym |
| 8 | `preferred: true` is passed through when set on input; omitted otherwise | Rule 4 |
| 9 | Multiple names can independently have `preferred: true` | Rule 4 |
| 10 | `primary: true` is passed through when set on input; omitted otherwise | Rule 5 |
| 11 | Multiple facts of different types can each be `primary: true` | Rule 5 |
| 12 | `date.formal` is dropped, only `date.original` surfaces as `date` | Rule 6 |
| 13 | `place.description` is dropped on simplification | Rule 7 |
| 14 | ParentChild round-trips as `parent`/`child` | Rule 8 |
| 15 | Couple round-trips as `person1`/`person2` | Rule 9 |
| 16 | `CitationDetail` qualifier → `page`; other (non-quality) qualifiers dropped | Rule 10 |
| 17 | `fsmcp:quality` qualifier → `quality` as string; passed through unchanged | Rule 10 |
| 18 | Source descriptions round-trip with `title`, `citation`, `url` | Rule 11 |
| 19 | Top-level `places[]` array round-trips | Rule 12 |
| 20 | Each of the five subtype URIs (Biological/Adoptive/Step/Foster/Guardian) round-trips correctly | Rule 8 |
| 21 | ParentChild with subtype-fact + unrelated facts: subtype lifted, unrelated facts preserved in `facts[]` | Rule 8 |
| 22 | ParentChild with no recognized subtype-fact has no `subtype` field; other facts pass through | Rule 8 |
| 23 | Note `text` content is preserved on relationships; entries without `text` are dropped | Rule 13 |
| 24 | Multiple notes on a relationship preserve order | Rule 13 |
| 25 | Empty/missing `notes` array is omitted from simplified output | Rule 13 |
| 26 | IDs pass through verbatim; no IDs are generated | Rule 14 |
| 27 | Function returns `{}` on `null` / `undefined` input | Error handling |
| 28 | Person with no names is preserved in output | Error handling |
| 29 | Malformed `gender` (string instead of object) does not throw | Error handling |
| 30 | Empty top-level arrays are omitted from output | Edge case |
| 31 | `preferred: false` and `primary: false` are never emitted | Schema compliance |
| 32 | **Identity round-trip A** — `toGedcomX(toSimplified(raw))` equals `raw` for a "clean" GedcomX input (no `date.formal`, no `place.description`, parts-based names, no lossy qualifiers; includes a ParentChild with subtype and notes) | Round-trip identity |
| 33 | **Identity round-trip B** — `toSimplified(toGedcomX(simplified))` equals `simplified` for a comprehensive simplified input (includes a ParentChild with subtype and notes) | Round-trip identity |
| 34 | First `Persistent` value lifts to `SimplifiedPerson.ark`; `toGedcomX` rebuilds `identifiers["http://gedcomx.org/Persistent"]: [ark]` | Rule 15 |
| 35 | Other identifier types (`Primary`, `Authority`, etc.) are dropped on simplification; round-trip emits only Persistent | Rule 15 |
| 36 | Missing `identifiers` and missing `Persistent` key both omit `ark`; missing or empty-string `ark` omits `identifiers` on `toGedcomX` | Rule 15 |
| 37 | Multiple Persistent values: first wins, rest dropped; round-trip emits a single-element array | Rule 15 |

### Smoke-test script

```bash
cd packages/engine/mcp-server
npx tsx dev/try-gedcomx-convert.ts
```

The script runs the Turner example through `toSimplified`, then through
`toGedcomX`, and prints both intermediate and final JSON to stdout. Used for
quick visual inspection during development.

---

## Verification

### Automated

```bash
cd packages/engine/mcp-server && npm run build && npm test
```

### Manual

```bash
cd packages/engine/mcp-server && npx tsx dev/try-gedcomx-convert.ts
```

Inspect that the simplified output matches the **Expected output** above and
that the round-tripped GedcomX is structurally equivalent to the input on
all surviving fields.

---

## References

- [Simplified GedcomX schema spec](./simplified-gedcomx-spec.md) — the
  authoritative definition of the output format
- [Research schema spec](./research-schema-spec.md) — downstream consumer
  that depends on this format's IDs as foreign keys
- [GedcomX JSON Serialization Spec](https://github.com/FamilySearch/gedcomx/blob/master/specifications/json-format-specification.md)
  — canonical JSON format for persons, names, facts, relationships,
  source references, qualifiers
- [GedcomX Conceptual Model Spec](https://github.com/FamilySearch/gedcomx/blob/master/specifications/conceptual-model-specification.md)
  — abstract data model independent of serialization
- [GedcomX Date Format Spec](https://github.com/FamilySearch/gedcomx/blob/master/specifications/date-format-specification.md)
  — formal date encoding (`+YYYY`, `A+YYYY`, ranges, before/after)
