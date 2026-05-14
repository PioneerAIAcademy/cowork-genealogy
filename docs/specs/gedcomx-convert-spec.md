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
`tree` and `cets` endpoints. Fields outside this subset are dropped during
simplification.

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
  sources?: GedcomXSourceReference[];
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
  date?: string;
  place?: string;
  sources?: SimplifiedSourceReference[];
};

export type SimplifiedRelationship = {
  id?: string;
  type?: string;             // "ParentChild" | "Couple"
  parent?: string;           // ParentChild only
  child?: string;            // ParentChild only
  person1?: string;          // Couple only
  person2?: string;          // Couple only
  facts?: SimplifiedFact[];
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
on `toGedcomX`. Applies to `person.gender.type`, `name.type`, `fact.type`,
`relationship.type`, `namePart.type`. URIs without that prefix are passed
through unchanged.

```
"http://gedcomx.org/Birth"  ↔  "Birth"
```

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

### 6. Dates on facts

```
{ "original": "1900", "formal": "+1900" }  →  "1900"
{ "original": "15 June 1850" }             →  "15 June 1850"
{ "formal": "+1900" } (no original)        →  date omitted
```

Only `date.original` survives. `date.formal` is dropped. `toGedcomX` writes
`{ original: dateString }` with no `formal` field.

### 7. Places on facts

```
{ "original": "Denver, Colorado, USA", "description": "#place1" }  →  "Denver, Colorado, USA"
```

The `description` reference is dropped; richer place data lives in the
top-level `places[]` array (Rule 12). `toGedcomX` writes
`{ original: placeString }` with no `description`.

### 8. Relationships — `ParentChild`

```
{
  "type": "http://gedcomx.org/ParentChild",
  "person1": { "resource": "#I2" },
  "person2": { "resource": "#I1" }
}
↓
{ "type": "ParentChild", "parent": "I2", "child": "I1" }
```

- `person1` → `parent` (strip leading `#`)
- `person2` → `child` (strip leading `#`)
- `toGedcomX`: re-wrap `{ resource: "#<id>" }`

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

### 13. IDs

IDs are passed through verbatim. The functions do not generate IDs. If input
GedcomX lacks an ID on a name, fact, or relationship, the simplified output
also lacks it. ID generation (with `I`/`N`/`F`/`R`/`S` prefixes per
`simplified-gedcomx-spec.md` §3) is the caller's responsibility.

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

### `mcp-server/src/types/gedcomx.ts`

All `GedcomX*` and `Simplified*` type definitions from the **Input types** and
**Output types** sections above. Export each type.

### `mcp-server/src/utils/gedcomx-convert.ts`

New file in a new `src/utils/` directory.

Exports:
- `toSimplified(gedcomx: GedcomX): SimplifiedGedcomX`
- `toGedcomX(simplified: SimplifiedGedcomX): GedcomX`

Internal helpers (not exported) for repeated logic — URI strip/restore, name
part extraction with fullText fallback, source reference round-tripping.

### `mcp-server/tests/utils/gedcomx-convert.test.ts`

Vitest suite. See **Testing** section below.

### `mcp-server/dev/try-gedcomx-convert.ts`

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
          "date": "20 April 1875"
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
| 20 | IDs pass through verbatim; no IDs are generated | Rule 13 |
| 21 | Function returns `{}` on `null` / `undefined` input | Error handling |
| 22 | Person with no names is preserved in output | Error handling |
| 23 | Malformed `gender` (string instead of object) does not throw | Error handling |
| 24 | Empty top-level arrays are omitted from output | Edge case |
| 25 | `preferred: false` and `primary: false` are never emitted | Schema compliance |
| 26 | **Identity round-trip A** — `toGedcomX(toSimplified(raw))` equals `raw` for a "clean" GedcomX input (no `date.formal`, no `place.description`, parts-based names, no lossy qualifiers) | Round-trip identity |
| 27 | **Identity round-trip B** — `toSimplified(toGedcomX(simplified))` equals `simplified` for a comprehensive simplified input | Round-trip identity |

### Smoke-test script

```bash
cd mcp-server
npx tsx dev/try-gedcomx-convert.ts
```

The script runs the Turner example through `toSimplified`, then through
`toGedcomX`, and prints both intermediate and final JSON to stdout. Used for
quick visual inspection during development.

---

## Verification

### Automated

```bash
cd mcp-server && npm run build && npm test
```

### Manual

```bash
cd mcp-server && npx tsx dev/try-gedcomx-convert.ts
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
