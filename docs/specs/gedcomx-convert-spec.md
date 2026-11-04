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
export function toSimplifiedRecordRead(gedcomx: GedcomX): {
  doc: SimplifiedGedcomX;
  placeIds: Map<SimplifiedFact, RecordReadPlace>; // { placeId: string; original?: string; formal?: string }
};
export function toGedcomX(simplified: SimplifiedGedcomX): GedcomX;
```

All three are pure (no I/O, no side effects). None throws on missing or
malformed optional fields. `toSimplifiedRecordRead` is `toSimplified` for a
record read, with the record-read place rules on (Rule 7).

---

## Input types — GedcomX

The functions accept the subset of GedcomX that FamilySearch returns through
the `person_read`, `cets`, `record_search` and `record_read` endpoints.
(`record_search` runs each search entry's `content.gedcomx` through
`toSimplified` so downstream tools get the faithful record shape instead of the
flattened summary; `record_read` runs the recapi persona body through
`toSimplifiedRecordRead`.)
Fields outside this subset are dropped during simplification.

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
  place?: {
    original?: string;
    normalized?: { value: string; lang?: string }[];
    description?: string;   // "#place_1831208" (record read), "#11692585" (search)
    fields?: GedcomXField[];
  };
  sources?: GedcomXSourceReference[];
};

export type GedcomXField = {
  type?: string;            // URI, e.g. "http://gedcomx.org/Place"
  values?: {
    type?: string;          // "http://gedcomx.org/Original" | "http://gedcomx.org/Interpreted"
    labelId?: string;       // e.g. "EVENT_PLACE", "PR_RES_PLACE_ORIG"
    text?: string;
    resource?: string;      // e.g. "https://www.familysearch.org/platform/places/description/1831208"
    qualifiers?: GedcomXQualifier[];
  }[];
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
  resourceType?: string;    // URI, e.g. "http://gedcomx.org/DigitalArtifact"
  titles?: { value: string }[];
  citations?: { value: string }[];
  about?: string;
  coverage?: {
    spatial?: { description?: string };
    temporal?: { original?: string; formal?: string };
    recordType?: string;
  }[];
};

export type GedcomXPlaceDescription = {
  id?: string;
  identifiers?: Record<string, string[]>; // e.g. "http://gedcomx.org/Primary"
  place?: { resource?: string; resourceId?: string }; // a record read's entry with no id
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
  assertion_id?: string;     // Backlink to the research.json assertion this fact was minted from.
                             // A third simplified-format-only sidecar, like standard_date and
                             // standard_place: `expandFact`'s allow-list drops it on the reverse
                             // path by construction. Never produced by toSimplified (raw GedcomX
                             // has no such concept) — only materialize_facts stamps it.
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
  quality?: number;          // GEDCOM QUAY integer 0–3 (string-encoded in the qualifier)
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

`simplifyPerson` stable-reorders `preferred: true` names to the front so
`names[0]` upholds the first-position convention (`simplified-gedcomx-spec.md`
§2) even when FamilySearch orders an alternate (e.g. `AlsoKnownAs`) before the
preferred name; relative order within the preferred and non-preferred groups is
preserved. Without this, every `names[0]` consumer (`person_read`,
`person_ancestors`) can show an alternate as the primary name.

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
"data:,Military+Draft+Registration"         →  "Military Draft Registration"
"data:,will"                                →  "Will"
"data:,%22Presented+to+Society%22"          →  "Presented to Society"
"data:,100%25+english"                      →  "Custom 100% english"
"http://familysearch.org/v1/Foo"            →  "Foo"
"Foo" (already a short name)                →  "Foo"
```

Algorithm:
1. If the value starts with `http://gedcomx.org/`, strip that prefix.
2. Else if it starts with `data:,`, strip that prefix, and read each `+` in
   what remains as a space (a literal plus arrives as `%2B`).
3. Else if it contains `://`, take the trailing path segment.
4. Otherwise pass through.
5. URL-decode the result (`decodeURIComponent`). If decoding throws on a
   malformed percent sequence, the undecoded value is kept.
6. Tidy it into a type the tree accepts: trim, drop one pair of wrapping
   quotes (straight or curly), and raise a lowercase first letter. If it
   still does not start with an uppercase letter, prefix it with `Custom `
   (an empty one becomes `Custom`). No colon after `Custom`: the reverse path
   reads a leading `word:` as a URI scheme and would not re-prefix the type.

Steps 2 and 6 exist because a `data:,` type is a label a FamilySearch user
typed, so it arrives however they wrote it. One live tree (KNDX-MKG and its
parents' reads, 2026-10-09) held the same label as both `Previous+Residence`
and `Previous%20Residence`, and held `will`, `scholastic-achievement`,
`"Presented to Society"` and `100% english`. The tree requires a fact type to
start with an uppercase letter (`checkTreeFact`, simplified-gedcomx-spec.md),
and one such fact on any relative made `project_create` refuse the whole
starting tree. The `Custom ` prefix keeps a label that cannot be tidied
whole rather than drop the fact.

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
{ "original": "Faial, Santana, Madeira, Portugal",
  "fields": [{ "type": "http://gedcomx.org/Place", "values": [
    { "type": "http://gedcomx.org/Original", "labelId": "PR_RES_PLACE_ORIG", "text": "dos Mainhos" },
    { "type": "http://gedcomx.org/Interpreted", "labelId": "PR_RES_PLACE",
      "text": "Faial, Santana, Madeira, Portugal",
      "resource": "https://www.familysearch.org/platform/places/description/1831208",
      "qualifiers": [{ "name": "http://familysearch.org/types/qualifiers/Preferred", "value": "true" }] } ] }] }
                                                  →  place: "dos Mainhos", standard_place: "Faial, Santana, Madeira, Portugal"
                                                     (toSimplifiedRecordRead; placeIds gives this fact
                                                      { placeId: "1831208", original: "Faial, Santana, Madeira, Portugal" })
```

`place` is the place as the record wrote it: `place.original` verbatim, except
for the record-read case under **As-written text** below. `standard_place` is
FamilySearch's own standardized name, read from the response with no lookup
(pure):

1. `place.normalized` — the `lang === "en"` entry, else the first. Search and
   tree responses carry it.
2. Record reads only (`toSimplifiedRecordRead`): else an `Interpreted` value of
   the place's `http://gedcomx.org/Place` field that has both text and a
   `resource` that is a place description URL (`…/places/description/<id>`). A
   record read (the recapi persona endpoint) never sends `normalized`; this
   value's text is FamilySearch's standard full name, in the record's language
   as sent ("Kuopio, Kuopio, Suomi"). Among such values take the one marked
   with the `http://familysearch.org/types/qualifiers/Preferred` qualifier;
   else the one whose id `place.description` names as `#place_<id>`; else the
   only one. If the chosen values disagree on the name, name two place ids, or
   `description` names an id none of them carries, there is no
   `standard_place`. Nor is there when `place.original`, FamilySearch's own
   text for the fact, is the text of another candidate than the chosen one:
   FVFW-Y6P's `place.original` is the text of Tobel (11861493), while
   `place.description` names Braunau (11861494).

An `Interpreted` value with no place description URL is never used, Preferred
or not. One with no `resource` often echoes the as-written text ("Yabebyry"),
and any other reference (`#place_1927095`, `…/authorities/v1/place/1927095`)
can cite an authorities place id, which read as a representation id is another
place (1927095 is Finland as an authorities id, Mingary, South Australia as a
representation id). `toSimplified`
(search and tree responses) takes no step 2 and reads no `Place` field at all:
a search response's `Interpreted` text is often the as-written text, and a
value there would also stop `record_search`'s resolver pass from filling the
fact. Search responses carry `normalized`, which is the standard there.

**As-written text (record reads only).** Some record reads put the
standardized text in `place.original` and keep what the record says only in the
`Original` value of the same `Place` field (`labelId` like `EVENT_PLACE_ORIG`).
When `place.original` equals an `Interpreted` text of that field, the field
holds exactly one `Original` text, and the fact keeps a `standard_place`,
`place` is that `Original` text. A fact that keeps no
`standard_place` (an id-less value, an ambiguous choice, a non-place phrase)
keeps `place.original`, so the standardized text is never lost. The code
extractor decides a census's relationship column from neither: it reads the
census fact's `place.original`, which `record_read` stages beside the document
as that persona's `indexFields` `censusPlace` (`record-index-fields.ts`), so the
as-written text ("Salem, Massachusetts" decides nothing) and the English name
("…, Scotland, United Kingdom" reads as England and Wales; "Hormigueros, Puerto
Rico" drops the United States) leave the decision as `main` made it. A staged
read without it decides from `standard_place ?? place` (`record-extract.ts`).

**Place ids.** `toSimplifiedRecordRead` returns `{ doc, placeIds }`. `placeIds`
maps each fact whose `standard_place` came from step 2 to
`{ placeId, original, formal }`: the place id of the chosen value,
`place.original` (absent when the place has none), which is the fact's `place`
when it keeps no `standard_place`, and the fact's `date.formal` (absent when
the date has none), which dates the name. These ride beside the document, never
on it: a fact has no field for them
(`TREE_FACT_FIELDS` in `validation/tree-shape.ts` is a closed list).
`record_read` uses them to name each place in English, or else to give the fact
what `toSimplified` gives it (below). A fact FamilySearch gave no place id takes
none from the record's other facts, even those with the same text.

The `description` reference is otherwise dropped; richer place data lives in
the top-level `places[]` array (Rule 12).

A census or register answer that names no place ("Same House", "Same Place",
"Do", "Rural", …: `NON_PLACE_PHRASES` in `place-resolver.ts`, whole text
only, case, spacing and periods ignored) keeps `place` and never gets a
`standard_place`, neither from `normalized` nor from the resolver below.
Resolved, these became a real place sharing the word ("Same House" →
"Same, Manufahi, Timor-Leste"; "Do" → "Dominican Republic"). A phrase
followed by a jurisdiction ("Same Place, Wayne, Ohio") is not matched and
standardizes as usual.

`standard_place` is a simplified-format-only sidecar (like `standard_date`):
`toGedcomX` writes only `{ original: placeString }` and ignores
`standard_place` on the reverse path.

Free-text places with no standardized value (neither step above) are left
without a `standard_place` by the pure converter. The async wrapper
`toSimplifiedStandardized` fills them by resolving `place` through
`place_search` (network) — deduping identical strings, resolving ≤8 in
parallel, best-effort (never throws, leaves the field empty on failure).
A one-segment place ("Kent") is the exception: it is standardized only from
the bundled one-word list, with no search, and is otherwise left unset — the
converter passes no record context and no record country, so the resolver's
sibling route never applies and only the list's entries that hold on every
record do (`research-append-tool-spec.md`, lever B).
A resolved value is also omitted when `countryConsistency(place, resolved)`
returns `contradiction`: this is a read path with no warning channel to the
model, so an unset field is the only honest outcome.
This guard checks only resolver-filled values; a `standard_place` FamilySearch
supplies (`pickNormalizedPlace`) is left unchecked and carried through, so the
`person_warnings` `hasPlaceStandardOtherCountry` tag reports it instead of this
path silently dropping it — stripping it here would delete the pair that
warning surfaces and hide FamilySearch's own error from the user. Tools
that return facts to the model call `toSimplifiedStandardized` (single doc) or
run `standardizePlaces` over the flattened facts of a multi-result response
(`record_search` / `person_search`). The pure `toSimplified` remains for
callers that want no I/O. Exception — `record_read`'s live path never calls
`toSimplifiedStandardized` and never falls back to the resolver. It calls
`recordReadDocument` (`tools/record-read.ts`): `toSimplifiedRecordRead`, then
each `placeIds` fact named by its id, then each coverage place named by its id.
The step-2 text is in the record's language, and the engine compares standard
places as English text (`factsEquivalent` in `merge-gedcomx.ts`,
`standardPlaceCountry` in `research-append.ts`), so each fact's
`standard_place` is replaced by `repIdToStandardPlaceAt(placeId, years, place)`
(`place-resolver.ts`): the English name of that FamilySearch place at the
fact's date. A place has one representation per era, and the chosen id's own
one can be from another ("Olne, Prince-Bishopric of Liège, Holy Roman Empire",
valid to 1795, for an 1874 death; the 1874 one is "Olne, Liège, Belgium").
One rule: **the fact is named only when its own text names the chosen place,
and exactly one name is valid at its date across all representations of that
place.** Any doubt names nothing:

- The fact's own text is its `place`: the `Original` text where **As-written
  text** above takes it, else `place.original`. Some part of it must be one of
  the chosen place's names, in any language, as the place's listing gives them
  for every representation (`names[]`), compared as `checkFirstPlace` compares
  names (case, accents, "St"/"Saint" and type words ignored). A part is a
  comma-separated part without anything from its first "(" or `"` on:
  QLNH-QVQB's "Vorden (Bronckhorst)" is "Vorden", and ZMX8-MHT2's
  `La Matriz "El Carmen" de Guano` is "La Matriz". Any part may name a
  jurisdiction ("Liro, Piaui" names the state of Piauí), but only the first
  part may name a settlement: a place whose description types it City, Town,
  Village, Hamlet, Populated Place, Major City, Independent City, Neighborhood
  or suburb, Locality or Dispersed Settlement. KF9R-VTB's 1847 death, written
  "Троицкая церковь, Крымки, Чигирин, Киев, Украина", was given the city of
  Kyiv. Over the matcher corpus this names 872 facts fewer and 3 more (the
  rename rule below reads the same parts). `research_append` geocodes each fact
  it leaves unnamed, so end to end what `extraction_append` saves changes only
  where its geocode differs: on the 40 records whose village text was named
  the city of Kyiv, 44 assertions go from the city (1 right) to 37 right or
  coarser and 7 wrong; for 60 of the 872 facts drawn at random, every one keeps
  a standard, 49 the same one, 9 another right one, 1 goes from wrong to right
  and 1 from one wrong place to another. Otherwise FamilySearch's
  choice of place is in doubt: Q2W9-1GVF's 1881 census, written
  "Llanbadarn-Tref-Eglwys, Cardiganshire, Wales", was given the town of
  Aberayron, its registration district, and SGZQ-Y3L's "Saint Peter,
  Carmarthenshire, Wales" the town of Carmarthen. "Kuopio, Kuopio" names place
  1962838, whose 1854 representation is "Kuopion kaupunki", and "Firenze" names
  Florence. A fact with no place text is named nothing.
- A fact whose Place field has no `Original` value has no text of its own: its
  `place.original` is FamilySearch's own `Interpreted` text, which names
  FamilySearch's choice by construction, so this check cannot catch a wrong
  choice there. Such facts are still named: all 12 in the 40-record sample are
  named right (4MB5-YKPZ, 66FT-QDBL, 666R-QTQP, 6BQC-LJJP, 6FZT-K3Y1,
  6J8F-6678, 6J3W-KF7B, 6VC3-T612, WS89-MGMM, X3HZ-K14S, X7S5-8J2Z and
  XS6T-95RP, among them the era-correct Florence 1813, Olne 1874 and Caracas
  1794).
- The fact's years are its `date.formal` (`gedcomxDateYears`), which
  FamilySearch sends whatever language or form `date.original` takes ("4
  sierpnia 1794" is `+1794-08-04`); else `date.original` as `stdDate` reads
  it. A fact with neither is named nothing. A before or after date is open on
  that side (`/+1900`, "Bef 1900"; `+1850/`, "Aft 1850"), and an approximate
  formal date (`A+1874`) spans a year either way, as `Abt` does.
- A representation is valid at the date when the years fall wholly inside its
  range; one with no range is valid at every date. A date that crosses a range
  boundary is valid in no representation, and so is named nothing.
- The representations are the place's listing (`getPlaceReps`, one call per
  place, which gives each one's English full name, range and names in every
  language); the chosen one's description gives its place. Both lookups are
  cached. The description answers a retired representation id with another
  representation of its place (1829107 with 439844, "Vorden, Gelderland,
  Netherlands", valid to 2004), so the listing need not hold the id the record
  cites. Nothing is named when either lookup fails or a range in the listing
  cannot be read.
- Two names valid at once name nothing: Olne in 1830 is "Olne, Liège,
  Netherlands" (to 1830) and "Olne, Liège, Belgium" (from 1830), and
  4M3P-3SZM's Christ Church, Middlesex has two representations with no range,
  "…, British Colonial America" and "…, United States".
- Nothing is named when the place was renamed and the fact's `place` still
  gives the chosen representation's name: the valid name's own name (the first
  part of the full name) differs from the chosen representation's, and a part
  of `place` is the chosen one's own name, only the first part for a
  settlement. 6T22-VN4N's 1906 marriage, written "Maceió, Alagoas, Brasil" and
  given the town's 1815–1819 representation "Alagoas, Alagoas, Brazil", is
  "Maceió, Alagoas, Brazil": its "Alagoas" is the state. Names are compared as
  `checkFirstPlace` compares them (case, accents, "St"/"Saint" and type words
  ignored on both sides, so "Simmern" is "Kreis Simmern"). FamilySearch then
  matched the record's text to a name the place did not have at the fact's
  date. A 1980 death written "Bela Vista" was given representation 10979131,
  Bela Vista 1938–1944, whose place has been Echaporã since 1944; the record
  more likely means another Bela Vista. A text that gives the place a name from
  another era than the chosen one's is named: 6293-8K43's 1866 census, written
  "Киевское воеводство, Польша" and given the Kiev Voivodeship's 1569–1793
  representation, is "Kiev Governorate, Russian Empire". A new jurisdiction
  under the same name (Olne in Belgium) is no rename.
- When the description answers the cited id with another representation (a
  retired id), the cited one's own name is unknown, so some part of `place`
  must instead be a name the place had at the fact's date: one of the
  `names[]`, in any language, of a representation valid then. A 1980 "Bela
  Vista" citing a retired id the description answers with Echaporã's
  representation is named nothing; QLNH-QVQB's 1893 "Vorden (Bronckhorst)",
  citing 1829107, is "Vorden, Gelderland, Netherlands". Over the matcher corpus
  this holds 74 names as doubt, most of them a town's retired id the
  description now answers with its region or state ("Speyer, Pfalz, Bavaria"
  given "Palatinate, Bavaria"). Reading every language for an ordinary rename
  too would hold 67 more names as doubt (65 right, 2 coarser) and name 18 (17
  right, 1 coarser), and it caught no wrong name, so only a retired id is read
  that way.

When nothing is named, or the name contradicts the fact's `place`, the fact
gets what `toSimplified` gives it: `place.original` and no `standard_place`.
FamilySearch's own text is never kept. A name contradicts the `place` when it
names another country (`countryConsistency`, the check `research_append`
refuses a record on), or another US state, Puerto Rico or Canadian province
(`divisionContradiction`): the `place`'s last part, after a trailing "United
States", "Canada" or "British North America", names one by name or postal code
("Quebec", "Utah Territory", "Canada East", "QC"), and the name's parts after
its own name name others and not that one; when they name none, its own name
is read, so a state named for another ("Washington, United States" for
"Washington, Washington, Pennsylvania") contradicts it. X7N1-CP7N's 1921 census, written
"St Leonard, St Leonard, Quebec", was given the parish in Madawaska, New
Brunswick, and V6CR-R26's "Hormigueros, 1, Hormigueros, Puerto Rico" the town
of Puerto Rico in Hidalgo, Texas. On its own, over the matcher corpus, it
refuses those and two more shapes, 15 names in all, and no other.

A coverage place is named by its id's own name (`repIdToStandardPlace`),
whatever the coverage's dates, as on any other read: coverage describes the
volume the record sits in ("Source descriptions"), which often spans eras, not
the record's event, and no engine code copies it into an assertion or the
tree. So one place id can be named one way on a fact and another on a
coverage. Only a coverage whose `spatial.description` resolves to a place
description whose id is the coverage's `place_rep_id` is named:
a `…/places/description/<id>` URL, or a `#…` reference to a `places[]` entry
that cites one (its `Primary` identifier, else its `place.resource`). Any other
reference names nothing: an older record cites an authorities place id
(`#place_1927095`, whose entry's `Primary` identifier is
`…/authorities/v1/place/1927095`, Finland), and read as a representation id
that number is another place (Mingary, South Australia). Nor does a `#place_8`
reference whose entry cites description 9: the `place_rep_id` read from the
reference is 8. The converter copies no name from a record read's `places[]`
(its entries are `place_<id>`, never the bare id a coverage carries), so a
coverage `record_read` does not name has none. A lookup by id names
the place FamilySearch chose and resolves no place name, so it is not the
resolver fallback `record_read` stays without. See
`docs/record-read-sidecar-scope.md` for the measurement and rationale.

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
{ "ref": "S1", "page": "1920 Census, ED 47", "quality": 3 }
```

- `description: "#S1"` → `ref: "S1"` (strip `#`)
- Qualifier with `name === "http://gedcomx.org/CitationDetail"` → `page`
- Qualifier with `name === "fsmcp:quality"` → `quality` as **an integer**.
  Qualifier values are strings on the wire, but the persisted tree format
  (tree-gedcomx.schema.json, the shared TS types, simplified-gedcomx-spec.md
  §4.4) requires an integer 0–3 — a string here silently violated all three
  and, worse, the reverse direction dropped every integer quality the tree
  legally carries. A qualifier value outside the QUAY range 0–3 (or that doesn't parse as an integer at all) is
  dropped, like any other unrecognized qualifier content.
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

#### Source description fields carried by `simplifySourceDescription`

The raw GedcomX `sourceDescriptions` from the recapi persona endpoint carry
two fields that `simplifySourceDescription` now propagates into the simplified
format as `resource_type` and `coverage`:

- **`resourceType`** → `resource_type` — identifies the source description kind
  (e.g. `"DigitalArtifact"`, `"Record"`, with the URI prefix stripped).
  9 of 12 probed records carried a `DigitalArtifact` entry; without `resourceType`
  the simplified output gives no way to distinguish it from the other 6–7
  source descriptions a persona returns.

- **`coverage[]`** → `coverage` (first entry only) — volume-level provenance on
  `DigitalArtifact` entries: `place_rep_id` (from `spatial.description`, resolvable
  via `repIdToStandardPlace`; none when the description references a place of
  the document's `places[]` that is identified only by an authority place id,
  `…/authorities/v1/place/<n>`, since `<n>` is a place id and read as a rep id
  names another place — in matcher-lab m13's record reads only collection
  coverages were such references, and the authority id 1927074 read as a rep is
  Minto, New South Wales, Australia), `standard_place` (the name of the
  response's own `places[]` entry whose `id` is that id, when it gives a
  non-empty one; a coverage with no `place_rep_id` takes none, even beside an
  entry with no `id` — a search response
  names the places its record refers to, keyed by the bare id; a record read's
  entries are keyed `place_<id>` and carry no names, so `record_read` names the
  id by its own name, whatever the coverage's dates, when `spatial.description`
  resolves to that place description — "Places on facts"),
  `date_range` (from `temporal.original`, falling back to `temporal.formal`), and `record_type` (URI prefix stripped).
  Coverage describes **the volume the image sits in**, not the event — on 4 of
  9 records with coverage, the coverage place or date range contradicted the
  record's own facts (e.g. Tallapoosa county coverage on a Talladega birth;
  `Birth 1841–1890` coverage on an 1848 marriage record). Agreement rate among
  records with coverage: 4/9 (44%) agree, 4/9 partial, 1/9 disagree.

  Measured 2026-09-14, `npx tsx dev/probe-record-read-artifact-coverage.ts`,
  n=12 records across 4 families (2 returned 404). The probe changes no
  behaviour and writes nothing.

These fields are record-only: `sanitizeCandidate` strips both before a merge
write (§5b.2 of `merge-gedcomx-spec.md`), and the tree validator rejects them
on tree sources (`TREE_SOURCE_FIELDS` does not include them).

#### Persona role fields carried through simplification

The raw GedcomX persons from FamilySearch carry role information:

- **`principal`** — boolean marking the record's principal subject, now carried
  through `toSimplified` onto `SimplifiedPerson.principal`. Present on
  **100% of both endpoints** (50/50 recapi, 2,655/2,655 search).
  `sanitizeCandidate` strips it before a merge write; the tree validator
  rejects it on tree persons (`TREE_PERSON_FIELDS` does not include it).

- **`display.role`** — the persona's role on the record (`"Principal"`,
  `"Father"`, `"Mother"`, `"Spouse"`, `"Other"`). Present on **100% of search
  personas** (2,655/2,655 across 3 collections) but **0% of recapi personas**
  (0/50). The search endpoint populates it; the recapi persona endpoint does not.
  `record_search` surfaces it as a flat `role` field on each result (survives
  the staged slim block). Not on `SimplifiedPerson` — it is search-only.

  Measured 2026-09-14, `npx tsx dev/probe-persona-role-coverage.ts`,
  n=50 recapi personas + 2,655 search personas across 3 search pools.

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
- `toSimplifiedRecordRead(gedcomx: GedcomX): { doc: SimplifiedGedcomX; placeIds: Map<SimplifiedFact, RecordReadPlace> }`
- `RecordReadPlace` (type): `{ placeId: string; original?: string; formal?: string }`
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
| 9b | Preferred name is moved to `names[0]` when an alternate precedes it | Rule 4 |
| 10 | `primary: true` is passed through when set on input; omitted otherwise | Rule 5 |
| 11 | Multiple facts of different types can each be `primary: true` | Rule 5 |
| 12 | `date.formal` is dropped, only `date.original` surfaces as `date` | Rule 6 |
| 13 | `place.description` is dropped on simplification | Rule 7 |
| 14 | ParentChild round-trips as `parent`/`child` | Rule 8 |
| 15 | Couple round-trips as `person1`/`person2` | Rule 9 |
| 16 | `CitationDetail` qualifier → `page`; other (non-quality) qualifiers dropped | Rule 10 |
| 17 | `fsmcp:quality` qualifier → `quality` as integer; non-integer values dropped | Rule 10 |
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

## Source-reference id precedence

A source reference simplifies to `{ ref, page?, quality? }`. `ref` takes
**`descriptionId` first**, falling back to `description` with a leading `#` stripped.

Both name the same description wherever both appear (measured: 102/102 and 77/77 URL-form
refs, `descriptionId` equal to the URL's last segment in every one). The precedence
matters because `description` is a **full URL** on a relative's ref, pointing at a
description the tree-read body does not contain — and a URL never equals the bare id a
fetched description carries, so a consumer matching refs against `sources[]` ids by string
equality would drop every one of them. Preferring the id upstream already sends also
cannot drift from the id it names, which deriving it from the URL could.
