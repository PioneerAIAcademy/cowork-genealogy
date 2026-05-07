# Simplified GedcomX Quick Reference

This is a condensed reference for the `tree.gedcomx.json` format.
Full spec: `docs/specs/simplified-gedcomx-spec.md`.

## File structure

```json
{
  "persons": [],
  "relationships": [],
  "sources": []
}
```

## Persons

```json
{
  "id": "KWCJ-RN4",
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
      "sources": [{ "ref": "S1", "page": "1850 Census, dwelling 84" }]
    }
  ]
}
```

- `gender`: `Male`, `Female`, `Unknown`
- `preferred` on names: omit rather than setting false
- `primary` on facts: omit rather than setting false
- `type` on names: `BirthName`, `MarriedName`, `AlsoKnownAs`, etc.
- `type` on facts: PascalCase — `Birth`, `Death`, `Marriage`,
  `Residence`, `Immigration`, `Military`, `Occupation`, etc.
- `sources` on facts/names: optional array of source references

## Stub persons (minimal valid person)

```json
{
  "id": "I1",
  "gender": "Unknown",
  "names": [{ "id": "N1", "preferred": true, "given": "", "surname": "Flynn" }]
}
```

## Relationships

**ParentChild** (asymmetric — use parent/child):
```json
{
  "id": "R1",
  "type": "ParentChild",
  "parent": "KWCJ-RN4",
  "child": "KWCJ-RN5",
  "sources": [{ "ref": "S1", "page": "..." }]
}
```

**Couple** (symmetric — use person1/person2):
```json
{
  "id": "R2",
  "type": "Couple",
  "person1": "KWCJ-RN4",
  "person2": "KWCJ-RN6",
  "facts": [
    { "id": "F5", "type": "Marriage", "date": "1870", "place": "..." }
  ]
}
```

## Sources

```json
{ "id": "S1", "title": "1850 U.S. Federal Census", "author": "U.S. Census Bureau" }
```

- `citation`: omit during active research (populated at upload time)
- `url`: optional

## Source references (on facts, names, relationships)

```json
{ "ref": "S1", "page": "Schuylkill Co., dwelling 84", "quality": 2 }
```

- `quality`: optional. 0=unreliable, 1=questionable, 2=secondary, 3=direct+primary

## Date formats

- Exact: `1845-03-12`
- Year: `1845`
- Approximate: `~1845`
- Range: `1840-1850`
- Before/after: `before 1850`, `after 1840`

## ID conventions

- FamilySearch persons: use their real IDs (e.g., `KWCJ-RN4`)
- Locally created persons: `I` prefix (`I1`, `I2`)
- Names: `N` prefix (`N1`, `N2`)
- Facts: `F` prefix (`F1`, `F2`)
- Relationships: `R` prefix (`R1`, `R2`)
- Sources: `S` prefix (`S1`, `S2`)
