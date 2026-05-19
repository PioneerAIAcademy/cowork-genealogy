# Place, Date, and Relationship Mechanics — FamilySearch Records API

Reference for constructing place, date, and relationship parameters
in `search` queries. All examples use API query parameters.

## Place parameters

### Standardized places

Place parameters accept standardized place strings (e.g.,
"Lehi, Utah County, Utah, United States"). The API resolves these
to internal Place IDs. Use the full hierarchical form for best
results. Non-standardized strings fall back to brittle string
matching.

### Fuzzy place (default) vs. exact place

- **Default (no `.exact=on`):** Matches the specified place AND
  places within 3 jurisdiction levels above it. `q.birthLikePlace=
  Lehi, Utah County, Utah` returns records in Lehi, Utah County,
  and Utah — but not all of USA.
- **With `.exact=on`:** Still descends to child localities, but does
  NOT expand upward. `q.birthLikePlace=Utah County, Utah` with
  `.exact=on` finds Lehi, Provo, etc. but excludes records indexed
  only as "Utah, USA."

**Key insight:** Exact place does NOT prevent matching child
localities — it prevents matching parent localities.

### Filter-based place restriction

For strict place filtering, use `f.*` parameters instead of `q.*`:

```
f.birthLikePlace0=10
f.birthLikePlace1=10,Ohio
f.birthLikePlace2=10,Ohio,Monroe
```

Values use the format `{parent_place_id},{place_name}`. Place IDs
come from the FamilySearch Places API.

### Multi-place / multiple events

Use cardinality suffixes (`.1` through `.9`) for multiple events of
the same type:

```
q.marriagePlace=Colorado&q.marriageDate.from=1920&q.marriageDate.to=1920
&q.marriagePlace.1=Nevada&q.marriageDate.1.from=1940&q.marriageDate.1.to=1940
```

Cardinality must match across grouped fields.

## Date parameters

### Fuzzy date behavior

- No published fixed tolerance. Empirically: ±2 years for
  Birth/Marriage/Death, ±5 years for Any/Residence.
- **For deterministic behavior, always use a year range:**
  `q.birthLikeDate.from=1850&q.birthLikeDate.to=1860`
- **Ranges are inclusive** on both ends.

### Date granularity

**Only the year is honored at search time.** Day and month are
accepted but discarded for matching.

### Exact year

With `.exact=on` on a date parameter, only records indexed with that
exact year match. Records with no indexed year are excluded.

### Event types

| Parameter prefix | Matches |
|---|---|
| `birthLike` | Birth, christening, baptism, naming |
| `deathLike` | Death, burial, cremation |
| `marriageLike` | Marriage, engagement, license, banns |
| `residence` | Census, directory, tax, land residence |
| `any` | ALL event types — use when event type is uncertain |

When you specify a typed date+place pair (e.g., `q.birthLikeDate`
+ `q.birthLikePlace`), both must match the same event for a hit.
For "any record in this place at this time," use `q.anyDate` +
`q.anyPlace`.

## Relationship parameters

### Available fields

| Relationship | Given name | Surname | Other |
|---|---|---|---|
| Spouse | `q.spouseGivenName` | `q.spouseSurname` | `q.marriageLikeDate`, `q.marriageLikePlace` |
| Father | `q.fatherGivenName` | `q.fatherSurname` | `q.fatherBirthLikePlace` |
| Mother | `q.motherGivenName` | `q.motherSurname` | `q.motherBirthLikePlace` |
| Parent (sex unknown) | `q.parentGivenName` | `q.parentSurname` | `q.parentBirthLikePlace` |

Each name field independently supports wildcards and `.exact=on`.

### Narrowing behavior

- Surname is auto-required when supplied (`.require=on` is
  implicit for surname fields).
- Given name only (e.g., spouse "Frank" with unknown surname)
  returns broader results. Useful for finding women with unknown
  maiden names.
- Use cardinality (`.1` through `.9`) to bundle each spouse's name
  with that spouse's marriage date/place.

## Other parameters

| Parameter | Purpose |
|---|---|
| `q.sex` | `Male` or `Female` |
| `q.batchNumber` | IGI batch number (e.g., `C050761`). Must be exactly 6 digits after letter prefix. |
| `treeref` | Family Tree PID — binds search to a tree person for downstream Source Linker attachment |
| `f.collectionId` | Restrict to a specific collection (repeatable for multiple collections) |
| `count` | Results per page, 1–100 (default 20) |
| `offset` | Zero-based pagination, max 4999. Searches return at most 5,000 results. |
