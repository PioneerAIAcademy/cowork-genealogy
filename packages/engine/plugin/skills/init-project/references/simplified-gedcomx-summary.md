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
- `ark`: the FamilySearch anchor, and what marks tree membership. For a person
  read from the tree it is `ark:/61903/4:1:<their FamilySearch person id>` — the
  canonical form, identical to what `person_search` returns for that person.
  Omit the key on local stubs. Never a page URL, never a bare id
- `preferred` on names: omit rather than setting false
- `primary` on facts: omit rather than setting false
- `type` on names: `BirthName`, `MarriedName`, `AlsoKnownAs`, etc.
- `type` on facts: PascalCase — `Birth`, `Death`, `Marriage`,
  `Residence`, `Immigration`, `Military`, `Occupation`, etc.
- `standard_date` / `standard_place` on facts: the standardized sidecars beside
  the raw `date`/`place`. `person_read` supplies both — carry them through, do
  not re-derive them
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
  key fails the write. `person_read` may return a source carrying `notes` —
  drop it

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

- ALL persons: `I` prefix (`I1`, `I2`) — including FamilySearch-seeded ones.
  Never a FamilySearch PID. A person's FamilySearch identity travels in `ark`,
  not in `id`
- Names: `N` prefix (`N1`, `N2`)
- Facts: `F` prefix (`F1`, `F2`)
- Relationships: `R` prefix (`R1`, `R2`)
- Sources: `S` prefix (`S1`, `S2`)

## Converting a `person_read` response

`person_read` already returns this format — persons/relationships/sources,
snake_case, `standard_place` on facts. It is not full GedcomX and needs no
field renaming. What it does need:

- **Re-id.** Persons get `I` ids; names and relationships arrive with no ids, so
  mint `N`/`R`, and mint `F` for any fact the tool did not id. Rewrite every
  relationship endpoint to the new person ids
- **Drop `notes`** from returned source descriptions
- **Add source references** — `{ "ref": "S1", "quality": 1 }` on every fact and
  every relationship
- **Keep both standardized sidecars** — `standard_place` and `standard_date` —
  exactly as returned; never re-derive either from the raw `place`/`date`. For a
  fact that has `place` but no `standard_place`, resolve it with `place_search` —
  never copy `place` into `standard_place`
