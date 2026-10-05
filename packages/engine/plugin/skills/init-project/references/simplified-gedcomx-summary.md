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
      "standard_date": "Abt 1845",
      "place": "Ireland",
      "standard_place": "Ireland",
      "sources": [{ "ref": "S1", "page": "1850 Census, dwelling 84" }]
    }
  ]
}
```

- `gender`: `Male`, `Female`, `Unknown`
- `ark`: the FamilySearch anchor, and what marks tree membership
  (`ark:/61903/4:1:<FamilySearch person id>`). `project_create` sets it on every
  person from the read. Omit the key on stubs
- `preferred` on names: omit rather than setting false
- `primary` on facts: omit rather than setting false
- `type` on names: `BirthName`, `MarriedName`, `AlsoKnownAs`, etc.
- `type` on facts: PascalCase — `Birth`, `Death`, `Marriage`,
  `Residence`, `Immigration`, `Military`, `Occupation`, etc.
- `standard_date` / `standard_place` on facts: the standardized sidecars beside
  the raw `date`/`place`. `project_create` carries the read's through; a place
  you enter by hand is resolved with `place_search`
- `sources` on persons, facts, names: optional array of source references

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
  "parent": "I1",
  "child": "I2",
  "sources": [{ "ref": "S1", "page": "..." }]
}
```

**Couple** (symmetric — use person1/person2):
```json
{
  "id": "R2",
  "type": "Couple",
  "person1": "I1",
  "person2": "I3",
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
- The whole allowed set is `id`, `title`, `citation`, `author`, `url`. Any other
  key fails the write

## Source references (on persons, facts, names, relationships)

```json
{ "ref": "S1", "page": "Schuylkill Co., dwelling 84", "quality": 1 }
```

- `quality`: 0=unreliable, 1=questionable, 2=secondary, 3=direct+primary. `project_create` cites the FamilySearch tree and the researcher's statement at `1`

## Date formats

- Exact: `1845-03-12`
- Year: `1845`
- Approximate: `~1845`
- Range: `1840-1850`
- Before/after: `before 1850`, `after 1840`

## ID conventions

`project_create` assigns every id when it builds from a staged `person_read`;
an addition's ids are labels it re-assigns. These are the conventions it uses,
and the ones an objective-only tree follows.

- ALL persons: `I` prefix (`I1`, `I2`) — including FamilySearch-seeded ones.
  Never a FamilySearch PID. A person's FamilySearch identity travels in `ark`,
  not in `id`
- Names: `N` prefix (`N1`, `N2`)
- Facts: `F` prefix (`F1`, `F2`)
- Relationships: `R` prefix (`R1`, `R2`)
- Sources: `S` prefix (`S1`, `S2`)
