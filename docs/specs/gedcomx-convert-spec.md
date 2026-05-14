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
  preferred?: boolean;       // Present only when true
  given?: string;
  surname?: string;
  sources?: SimplifiedSourceReference[];
};

export type SimplifiedFact = {
  id?: string;
  type?: string;             // PascalCase, e.g. "Birth"
  primary?: boolean;         // Present only when true
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
  quality?: number;          // 0-3
};

export type SimplifiedSourceDescription = {
  id?: string;
  title?: string;
  citation?: string;
  author?: string;
  url?: string;
};

export type SimplifiedPlaceDescription = {
  id?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
};
```

`preferred`, `primary`, and `quality` follow the **omit-when-false /
omit-when-undefined** convention: the field is written only when meaningfully
present. `preferred: false`, `primary: false`, and `quality: 0` (when the
research pipeline hasn't classified the evidence) must not be emitted —
`quality: 0` carries the meaning "unreliable" and would corrupt downstream
GPS reasoning.

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

### 3. Names — given / surname extraction

**Primary path:** read `nameForms[0].parts`, taking the first `Given`-typed
entry and the first `Surname`-typed entry.

**Fallback path:** if `parts` is missing or empty but `nameForms[0].fullText`
is present, split on the **last** whitespace — everything before becomes
`given`, the trailing token becomes `surname`. A single token (mononym)
becomes `surname` with `given: ""`.

```
parts: [{Given: "John"}, {Surname: "Doe"}]         →  given: "John",          surname: "Doe"
fullText: "William Henry Turner" (no parts)        →  given: "William Henry", surname: "Turner"
fullText: "Plato" (no parts)                       →  given: "",              surname: "Plato"
nameForms missing                                  →  given and surname omitted
```

`toGedcomX`: reconstruct `nameForms: [{ fullText, parts }]`:
- `fullText` is `` `${given} ${surname}`.trim() ``
- `parts` contains entries only for non-empty `given` / `surname`

### 4. `preferred` on names

The first name in `names[]` is the preferred name.

- `names[0]` → `preferred: true`
- `names[1..n]` → field **omitted**

`toGedcomX`: place the `preferred: true` name first; never emit
`preferred: false`.

### 5. `primary` on facts

The first fact in `facts[]` is the primary fact.

- `facts[0]` → `primary: true`
- `facts[1..n]` → field **omitted**

`toGedcomX`: place the `primary: true` fact first; never emit `primary: false`.

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
{ "ref": "S1", "page": "1920 Census, ED 47", "quality": 3 }
```

- `description: "#S1"` → `ref: "S1"` (strip `#`)
- Qualifier with `name === "http://gedcomx.org/CitationDetail"` → `page`
- Qualifier with `name === "fsmcp:quality"` → `quality` as `Number(value)`
- All other qualifiers are dropped
- When `quality` is absent or non-numeric, **omit** the field

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
- `author` has no GedcomX equivalent — `toSimplified` leaves it undefined.
  `toGedcomX` drops `author` (no destination field).

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

### 13. `Census` fact type

The simplified format introduces `Census` as an extension type
(`simplified-gedcomx-spec.md` §5). Standard GedcomX has no `Census` type.

- `toSimplified`: pass input fact types through unchanged. Input GedcomX
  uses `Residence` for census events; downstream skills may rewrite it to
  `Census` when context is known.
- `toGedcomX`: when input fact `type === "Census"`, emit
  `type: "http://gedcomx.org/Residence"` and add a qualifier
  `{ name: "fsmcp:event", value: "Census" }` on the fact so the round trip
  is recoverable on re-read.

### 14. IDs

IDs are passed through verbatim. The functions do not generate IDs. If input
GedcomX lacks an ID on a name, fact, or relationship, the simplified output
also lacks it. ID generation (with `I`/`N`/`F`/`R`/`S` prefixes per
`simplified-gedcomx-spec.md` §3) is the caller's responsibility.

---

## Edge cases

| Scenario | `toSimplified` | `toGedcomX` |
|---|---|---|
| `nameForms` missing and `fullText` missing | `given` and `surname` omitted | `nameForms` omitted |
| `parts` missing, `fullText` present | Split last whitespace into given/surname | Reconstruct `parts` from `given`/`surname` |
| `parts` present but no `Given` entry | `given` omitted | Omit `Given` part |
| `parts` present but no `Surname` entry | `surname` omitted | Omit `Surname` part |
| Mononym (`fullText: "Plato"`) | `given: ""`, `surname: "Plato"` | `fullText: "Plato"`, `parts: [{ Surname: "Plato" }]` |
| `date` object missing on fact | `date` omitted | `date` omitted |
| `formal` present, `original` missing | `date` omitted | n/a |
| `place` object missing on fact | `place` omitted | `place` omitted |
| `place.original` missing but object exists | `place` omitted | n/a |
| `qualifiers` missing on source ref | `page` and `quality` omitted | `qualifiers` omitted |
| `CitationDetail` qualifier absent | `page` omitted | Omit `CitationDetail` qualifier |
| `fsmcp:quality` qualifier absent | `quality` omitted | Omit `fsmcp:quality` qualifier |
| `quality` qualifier has non-numeric value | `quality` omitted | n/a |
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

```json
{
  "persons": [
    {
      "id": "p1",
      "gender": "Male",
      "names": [
        {
          "preferred": true,
          "type": "BirthName",
          "given": "William",
          "surname": "Turner"
        }
      ],
      "facts": [
        {
          "type": "Birth",
          "primary": true,
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
          "preferred": true,
          "type": "BirthName",
          "given": "Elizabeth",
          "surname": "Turner"
        }
      ],
      "facts": [
        {
          "type": "Birth",
          "primary": true,
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
          "primary": true,
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
| 2 | `toGedcomX(toSimplified(turner))` round-trips surviving fields | Semantic round-trip |
| 3 | URI prefix stripped from `gender.type`, `name.type`, `fact.type`, `relationship.type` | Rule 1 |
| 4 | `gender: "Unknown"` is produced for unrecognized URIs | Rule 2 |
| 5 | Given/surname extracted from `parts` when present | Rule 3 primary |
| 6 | Given/surname extracted from `fullText` when `parts` missing | Rule 3 fallback |
| 7 | Mononym `"Plato"` → `given: ""`, `surname: "Plato"` | Rule 3 mononym |
| 8 | Only the first name has `preferred: true`; others have no `preferred` field | Rule 4 |
| 9 | Only the first fact has `primary: true`; others have no `primary` field | Rule 5 |
| 10 | `date.formal` is dropped, only `date.original` surfaces as `date` | Rule 6 |
| 11 | `place.description` is dropped on simplification | Rule 7 |
| 12 | ParentChild round-trips as `parent`/`child` | Rule 8 |
| 13 | Couple round-trips as `person1`/`person2` | Rule 9 |
| 14 | `CitationDetail` qualifier → `page`; other qualifiers dropped | Rule 10 |
| 15 | `fsmcp:quality` qualifier → `quality` as number; absent → field omitted | Rule 10 |
| 16 | `quality: 0` is **not** emitted as a default when no qualifier exists | Rule 10 |
| 17 | Source descriptions round-trip with `title`, `citation`, `url` | Rule 11 |
| 18 | Top-level `places[]` array round-trips | Rule 12 |
| 19 | `Census` simplified type → `Residence` + `fsmcp:event=Census` qualifier on `toGedcomX` | Rule 13 |
| 20 | IDs pass through verbatim; no IDs are generated | Rule 14 |
| 21 | Function returns `{}` on `null` / `undefined` input | Error handling |
| 22 | Person with no names is preserved in output | Error handling |
| 23 | Malformed `gender` (string instead of object) does not throw | Error handling |
| 24 | Empty top-level arrays are omitted from output | Edge case |
| 25 | `preferred: false` and `primary: false` are never emitted | Schema compliance |

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
