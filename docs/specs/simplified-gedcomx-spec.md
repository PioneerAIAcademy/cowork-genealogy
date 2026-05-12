# Simplified GedcomX Specification

This document defines the complete schema for `tree.gedcomx.json`, the deliverable file in a genealogy research project. It formalizes the simplification rules described in `docs/gps/simplified-gedcomx.md`.

## 1. Overview

`tree.gedcomx.json` contains resolved persons, relationships, facts, and source descriptions in a simplified GedcomX format. It is the file that eventually uploads to FamilySearch. MCP tools handle conversion between full GedcomX (from FamilySearch APIs) and this simplified format.

### Design goals

- **Token-efficient.** URI prefixes dropped, nested structures flattened. The LLM reads and writes this format directly.
- **Round-trippable.** Every simplification is mechanically reversible. The MCP conversion functions can reconstruct full GedcomX from this format without loss.
- **ID-rich.** IDs on names and facts, not just persons. Lets the LLM and `research.json` reference "fact F1" or "name N2" unambiguously.

### Relationship to `research.json`

`research.json` references this file at two points:

1. **Person IDs** — `project.subject_person_ids`, `person_evidence.person_id`, and `timelines.person_ids` reference `persons[].id`.
2. **Source description IDs** — `sources[].gedcomx_source_description_id` in `research.json` references `sources[].id` here.

`tree.gedcomx.json` is updated when a proof summary reaches tier `probable` or higher (see `research-schema-spec.md` Section 8, "tree.gedcomx.json update timing"). During early research, it contains stub persons with whatever is known at project initialization.

### Top-level structure

```json
{
  "persons": [ ],
  "relationships": [ ],
  "sources": [ ]
}
```

---

## 2. Simplification Rules

These rules define how full GedcomX maps to simplified GedcomX. The MCP conversion functions implement these rules.

| Full GedcomX | Simplified | Rationale |
|-------------|-----------|-----------|
| `http://gedcomx.org/Birth` | `Birth` | URI prefixes dropped. Saves tokens, no ambiguity. |
| `gender.type: "http://gedcomx.org/Male"` | `gender: "Male"` | Flattened from object to string. |
| `nameForms[0].parts` with Given/Surname | `given`, `surname` directly on name | Deeper nesting only matters for multi-script names. |
| `nameForms[0].fullText` | (omitted) | Reconstructible from `given` + `surname`. |
| `preferred` on names | `preferred: true` | Explicit boolean. Redundant with first-position convention — both signals point the same way. |
| `primary` on facts | `primary: true` | Explicit boolean for the primary/preferred fact of each type. |
| ParentChild: `person1`/`person2` | `parent`/`child` | Semantic roles are clearer than positional naming. |
| Couple: `person1`/`person2` | `person1`/`person2` | Kept — the relationship is symmetric. |
| Source references: `description: "#S1"` + qualifiers | `ref: "S1"`, `page: "..."`, `quality: N` | Flattened. `quality` mimics GEDCOM's QUAY. |
| `sourceDescriptions[].citations[0].value` | `sources[].citation` | Flattened from nested array. |
| `sourceDescriptions[].titles[0].value` | `sources[].title` | Flattened from nested array. |

---

## 3. ID Conventions

| Prefix | Entity | Example |
|--------|--------|---------|
| `I` | persons | `I1`, `I2` |
| `N` | names | `N1`, `N2` |
| `F` | facts | `F1`, `F2` |
| `R` | relationships | `R1`, `R2` |
| `S` | sources | `S1`, `S2` |

IDs are strings, unique within their array, immutable once created. The prefix + number convention matches FamilySearch's GedcomX patterns and ensures no collisions across entity types.

---

## 4. Section Schemas

### 4.1 `persons`

Array of person objects.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Person ID (`I` prefix) |
| `gender` | string | yes | `Male`, `Female`, or `Unknown` |
| `names` | object[] | yes | At least one name. See below |
| `facts` | object[] | no | Person facts (birth, death, etc.). May be empty or omitted for stub persons |

**Stub persons:** A minimal valid person requires `id`, `gender` (which may be `Unknown`), and one name with at least a `surname`. `given` may be an empty string when only the surname is known. `facts` may be omitted entirely. Example: `{ "id": "I1", "gender": "Unknown", "names": [{ "id": "N1", "preferred": true, "given": "", "surname": "Flynn" }] }`

**Names:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Name ID (`N` prefix) |
| `preferred` | boolean | no | True if this is the preferred name. Omit rather than setting false |
| `given` | string | yes | Given name(s) |
| `surname` | string | yes | Surname |
| `type` | string | no | Name type: `BirthName`, `MarriedName`, `AlsoKnownAs`, `Nickname`, `Formal`, `Religious`. Omit for untyped names |
| `sources` | object[] | no | Source references for this name. See source references below |

**Facts:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Fact ID (`F` prefix) |
| `type` | string | yes | Fact type (see enum below) |
| `primary` | boolean | no | True if this is the primary fact of its type. Omit rather than setting false |
| `date` | string | no | Date string. See Section 4.5 for recognized patterns |
| `place` | string | no | Place description as a human-readable string |
| `sources` | object[] | no | Source references for this fact |

### 4.2 `relationships`

Array of relationship objects.

**ParentChild:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Relationship ID (`R` prefix) |
| `type` | string | yes | `ParentChild` |
| `parent` | string | yes | Person ID of the parent |
| `child` | string | yes | Person ID of the child |
| `sources` | object[] | no | Source references |

ParentChild relationships have no `facts` field — the relationship itself is the fact. Events related to the parent-child bond (adoption, custody changes) are not modeled in v1.

**Couple:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Relationship ID (`R` prefix) |
| `type` | string | yes | `Couple` |
| `person1` | string | yes | Person ID of first partner |
| `person2` | string | yes | Person ID of second partner |
| `facts` | object[] | no | Relationship facts (marriage, divorce, etc.). Same schema as person facts |
| `sources` | object[] | no | Source references |

### 4.3 `sources`

Array of source description objects. These are the simplified equivalents of GedcomX SourceDescriptions. `research.json` sources reference these by ID via `gedcomx_source_description_id`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Source ID (`S` prefix) |
| `title` | string | yes | Human-readable title of the source |
| `citation` | string | no | Formatted citation string. Populated by the proof-conclusion workflow at upload time (copied from `research.json` `sources[].citation`). Omit during active research |
| `author` | string | no | Creator, agency, or author |
| `url` | string | no | URL to the digital source |

### 4.4 Source References

Source references appear on names, facts, and relationships. They link an assertion to a source description with a locator.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ref` | string | yes | Source ID (`S` prefix) |
| `page` | string | no | Specific locator within the source (page, entry, certificate number, dwelling number). Corresponds to Evidence Explained's "where-within" |
| `quality` | number | no | Source quality score mimicking GEDCOM's QUAY: `0` = unreliable, `1` = questionable, `2` = secondary evidence, `3` = direct and primary evidence. See design decision below for usage guidance |

### 4.5 Date Strings

Dates are freeform human-readable strings. The MCP conversion function best-efforts them into GedcomX formal date encoding (`+YYYY`, `A+YYYY`, etc.) at upload time. The following patterns are recognized:

| Pattern | Example | GedcomX formal | Meaning |
|---------|---------|---------------|---------|
| `YYYY-MM-DD` | `1908-03-12` | `+1908-03-12` | Exact date |
| `YYYY-MM` | `1908-03` | `+1908-03` | Month precision |
| `YYYY` | `1845` | `+1845` | Year precision |
| `~YYYY` | `~1845` | `A+1845` | Approximate (the `~` prefix is introduced by this spec, not a GedcomX convention) |
| `before YYYY` | `before 1850` | `/+1850` | Before a date |
| `after YYYY` | `after 1840` | `+1840/` | After a date |
| `YYYY-YYYY` | `1840-1850` | `+1840/+1850` | Date range |
| Free text | `about Spring 1845` | (best-effort) | Unstructured — conversion function attempts to extract year and qualifier |

Skills should prefer the recognized patterns. The conversion function will attempt to parse any string but may produce lossy GedcomX formal dates from free text. Dates that don't match any pattern are stored as `date.original` in full GedcomX with no `date.formal`.

---

## 5. Enums

### Closed enums

| Enum | Values | Used by |
|------|--------|---------|
| `gender` | `Male`, `Female`, `Unknown` | persons |
| `relationship_type` | `ParentChild`, `Couple` | relationships |

### Open enums (recommended values)

| Enum | Recommended values | Used by |
|------|-------------------|---------|
| `fact_type` | See table below | person facts, relationship facts |
| `name_type` | `BirthName`, `MarriedName`, `AlsoKnownAs`, `Nickname`, `Formal`, `Religious` | names |

**Fact type values and GedcomX compatibility:**

| Value | Standard GedcomX | Notes |
|-------|-----------------|-------|
| `Birth` | yes | |
| `Death` | yes | |
| `Burial` | yes | |
| `Christening` | yes | GedcomX-only — no lowercase equivalent in research.json (use `birth` assertions for baptism-related claims) |
| `Marriage` | yes | Used on Couple relationship facts |
| `Divorce` | yes | Used on Couple relationship facts. GedcomX-only — no research.json equivalent in v1 |
| `Residence` | yes | |
| `Census` | **no** | Extension. Standard GedcomX records census appearances as `Residence`. The conversion function maps `Census` → `Residence` with a qualifier at upload. Use `Census` in the simplified format for clarity |
| `Immigration` | yes | |
| `Emigration` | yes | |
| `Naturalization` | yes | GedcomX-only — no research.json equivalent (use `immigration` assertions) |
| `Military` | yes | Maps to research.json `military_service` |
| `Occupation` | yes | |
| `Education` | yes | |
| `Religion` | yes | |
| `Property` | **no** | Extension. No standard GedcomX type. Conversion function uses a custom type URI. May not survive FamilySearch upload processing |
| `Will` | **no** | Extension. No standard GedcomX type. Same caveat as Property |
| `Probate` | **no** | Extension. No standard GedcomX type. Same caveat as Property |

**Casing convention:** Fact and name types use PascalCase (matching GedcomX conventions with URI prefixes dropped). This contrasts with `research.json` which uses lowercase_with_underscores. When mapping between the two files, convert case: `birth` ↔ `Birth`, `military_service` ↔ `Military`, `residence` ↔ `Residence`. The research.json types `name`, `relationship`, and `other` are research-only and do not appear as GedcomX fact types.

---

## 6. Design Decisions

**Why `preferred` and `primary` are omit-when-false, not always-present.** The simplified format optimizes for token count. A person with three names only needs `preferred: true` on one; the other two need no `preferred` field at all. This saves tokens across the file. The convention: presence of the boolean means true; absence means false. Do not write `"preferred": false`.

**Why `quality` on source references, and its limitations.** The `quality` field is a quick relevance signal for the LLM, not a GPS analytical input. It maps to GEDCOM's QUAY scale and is populated when the research pipeline has classified the evidence. However, QUAY collapses three independent GPS axes (source classification, information quality, evidence type) into a single integer. Two source references with `quality: 2` may have fundamentally different GPS profiles — e.g., an original source with indirect evidence vs. an original source with a secondary informant providing direct evidence. For actual GPS reasoning — conflict resolution, independence analysis, informant evaluation — the LLM must consult `research.json` assertions, which carry the full three-layer classification. `quality` is useful for quick scanning ("which sources are strongest?") but insufficient for analytical decisions. Populate it when available; omit it when the classification hasn't been done yet (e.g., on facts populated before the analysis step).

**Why `page` instead of preserving GedcomX qualifiers.** GedcomX uses a `qualifiers` array with `CitationDetail` entries. This is verbose for what is almost always a single string. The `page` field captures the same information — the specific locator within the source — in a flat string.

**Why `author` on source descriptions.** Full GedcomX does not have an explicit author field on SourceDescriptions (it uses `contributors` or embeds authorship in the citation). The simplified format adds `author` because the LLM benefits from knowing the creator when reasoning about source classification (Original/Derivative/Authored).

**Why fact and name types use PascalCase.** The simplified format drops URI prefixes but preserves GedcomX's PascalCase convention (`Birth` not `birth`). This keeps the mapping reversible — the MCP conversion function just prepends `http://gedcomx.org/` to reconstruct the URI.

---

## 7. Relationship to Full GedcomX

The MCP server provides two conversion functions:

1. **Full GedcomX → Simplified:** Called when MCP tools return data from FamilySearch APIs. Strips URI prefixes, flattens nested structures, maps person1/person2 to parent/child for ParentChild relationships.

2. **Simplified → Full GedcomX:** Called when uploading to FamilySearch. Restores URI prefixes, wraps given/surname back into nameForms/parts, maps parent/child back to person1/person2.

### Fields lost in round-trip

The following full GedcomX fields are not represented in the simplified format and are lost during conversion:

- `nameForms[].fullText` — reconstructed as `{given} {surname}` (Western given-then-surname order). Names following other conventions (surname-first, mononyms) are not supported in v1
- Multiple `nameForms` per name — only the first is kept (multi-script names are not supported)
- `date.formal` — only `date.original` is preserved as the flat `date` string
- Source reference `qualifiers` beyond `CitationDetail` — only the citation detail qualifier maps to `page`
- `contributors`, `attribution`, `analysis` on source descriptions
- `confidence` on conclusions (use `research.json` proof tiers instead)

These losses are acceptable for the target use case (English-language Western genealogy). For projects requiring multi-script names or formal date encoding, the full GedcomX format should be used directly.

---

## 8. Worked Example

The Patrick Flynn example from `research-schema-spec.md`:

```json
{
  "persons": [
    {
      "id": "I1",
      "gender": "Male",
      "names": [
        {
          "id": "N1",
          "preferred": true,
          "given": "Patrick",
          "surname": "Flynn",
          "type": "BirthName"
        }
      ],
      "facts": [
        {
          "id": "F1",
          "type": "Birth",
          "primary": true,
          "date": "~1845",
          "place": "Ireland",
          "sources": [{ "ref": "S1", "page": "1850 Census, Schuylkill Co., dwelling 84" }]
        },
        {
          "id": "F2",
          "type": "Death",
          "date": "1908-03-12",
          "place": "Schuylkill County, Pennsylvania",
          "sources": [{ "ref": "S3", "page": "Death cert. no. 4521" }]
        }
      ]
    },
    {
      "id": "I2",
      "gender": "Male",
      "names": [
        {
          "id": "N2",
          "preferred": true,
          "given": "Thomas",
          "surname": "Flynn",
          "type": "BirthName"
        }
      ],
      "facts": [
        {
          "id": "F3",
          "type": "Birth",
          "primary": true,
          "date": "~1818",
          "place": "Ireland"
        }
      ]
    }
  ],
  "relationships": [
    {
      "id": "R1",
      "type": "ParentChild",
      "parent": "I2",
      "child": "I1",
      "sources": [
        { "ref": "S1", "page": "1850 Census, Schuylkill Co., dwelling 84", "quality": 2 },
        { "ref": "S2", "page": "1860 Census, Schuylkill Co., dwelling 112", "quality": 3 },
        { "ref": "S3", "page": "Death cert. no. 4521", "quality": 2 }
      ]
    }
  ],
  "sources": [
    { "id": "S1", "title": "1850 U.S. Federal Census", "author": "U.S. Census Bureau" },
    { "id": "S2", "title": "1860 U.S. Federal Census", "author": "U.S. Census Bureau" },
    { "id": "S3", "title": "Pennsylvania Death Certificates", "author": "Pennsylvania Dept. of Health" },
    { "id": "S4", "title": "Schuylkill County Probate Records", "author": "Schuylkill County Register of Wills" }
  ]
}
```

### Notes on the example

- **F3 has no sources array.** Thomas Flynn's birth fact is from the research pipeline's estimation (census ages), not from a single citable source. The `sources` array is optional on facts; omitting it indicates the fact is derived from analysis rather than a specific source. The detailed provenance lives in `research.json` assertions.
- **R1 has three source references.** The parentage conclusion is supported by three sources (1850 census, 1860 census, death certificate), each with a `page` locator. The `quality` values reflect the three-layer classification: `3` for the 1860 census (direct evidence, relationship explicitly stated), `2` for the 1850 census (indirect — relationship inferred from household position) and death certificate (secondary informant for parentage).
- **S4 has no referencing facts or relationships.** It exists because the probate search is in progress (`research.json` plan pl_002, item pli_006). Source descriptions may exist in anticipation of results.
- **Names have no sources array in this example.** Source references on names are optional. In a more complete project, name sources would be populated — e.g., the birth name sourced to the census, an alias sourced to a marriage record.
- **F1 and F2 lack `quality` on their source references, but R1's do.** `quality` is populated when the research pipeline has classified the evidence through the three-layer model. The relationship (R1) has been fully analyzed in `research.json` (proof summary ps_001 at `probable`), so quality scores are available. The birth and death facts were populated earlier in the research process before full classification; their quality could be backfilled but hasn't been in this example. This is the expected pattern — quality is populated incrementally as analysis progresses.
