# Place, Date, and Relationship Mechanics — FamilySearch Records API

Reference for constructing place, date, and relationship parameters
in `record_search` queries. Examples below are written in the upstream
API's own `q.*` / `f.*` syntax; `record_search` takes **camelCase**
parameters instead. Use this crosswalk — the names are not always a
direct rename.

| API syntax | `record_search` parameter |
|---|---|
| `q.surname` / `q.givenName` | `surname` / `givenName` (drop the `q.`) |
| `q.<relative>GivenName` / `q.<relative>Surname` | `<relative>GivenName` / `<relative>Surname` — `spouse`, `father`, `mother`, `parent`, `other` |
| `q.birthLikeDate.from` / `.to` | `birthYearFrom` / `birthYearTo` |
| `q.birthLikePlace` | `birthPlace` |
| `q.deathLikeDate` / `q.deathLikePlace` | `deathYearFrom`/`To`, `deathPlace` |
| `q.marriageLikeDate` / `q.marriageLikePlace` | `marriageYearFrom`/`To`, `marriagePlace` |
| `q.residenceDate` / `q.residencePlace` | `residenceYearFrom`/`To`, `residencePlace` |
| `q.anyDate` / `q.anyPlace` | `anyYearFrom`/`To`, `anyPlace` |
| `<term>.exact=on` | `<term>Exact: true` (e.g. `birthPlaceExact`) |
| `q.recordCountry` | `recordCountry` |
| `q.recordSubcountry` | `recordSubdivision` (the tool composes the comma form) |
| `f.collectionId` | `collectionId` |
| `q.filmNumber` | `imageGroupNumber` |
| `q.sex` | `sex` |
| `q.isPrincipal` | `isPrincipal` |

**Some API constructs below have no `record_search` parameter at all**
and are marked *(not reachable through `record_search`)* where they
appear. They are documented because they describe how the upstream index
behaves, not because you can send them.

**Before reaching for any `*Exact` qualifier, read the note at the end of
"Fuzzy place (default) vs. exact place" — measured behaviour is not what
the name suggests.**

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

### What place expansion actually costs — measured 2026-08-04

Upward expansion is far broader than "3 levels" suggests, and the
qualifier does **not** work the way its name implies.

- **It changes the COUNT, not the ranking.** A marriage search scoped to
  Nevada County, Arkansas returned **35,510** hits fuzzy and **2** with
  `marriagePlaceExact` — and the target record ranked **first in both**.
  So the qualifier cannot surface a record you could not otherwise
  reach. Do not set it hoping to find something; the fuzzy search has
  already put the best match at the top.
- **An unqualified county scope barely discriminates.** The *wrong*
  Arkansas county (`Yell`) returned **39,750** against the right
  county's **39,793**. A county-level total therefore tells you almost
  nothing about whether the records you want are in that county.
- **What the qualifier is genuinely for:** making a count mean
  something. If you are about to log `results_available` or argue a
  search was reasonably exhaustive, an unqualified place total will not
  support the claim; an exact-place total will.

Full figures and method: `docs/specs/record-search-tool-spec-v2.md`,
"What `.exact=on` actually does", reproduced by
`dev/probe-search-qualifiers.ts`.

### Filter-based place restriction

For strict place filtering the API offers `f.*` place parameters
*(not reachable through `record_search` — the tool exposes no equivalent;
use `<event>PlaceExact` or `recordSubdivision` instead)*:

```
f.birthLikePlace0=10
f.birthLikePlace1=10,Ohio
f.birthLikePlace2=10,Ohio,Monroe
```

Values use the format `{parent_place_id},{place_name}`. Place IDs
come from the FamilySearch Places API.

### Multi-place / multiple events

Use cardinality suffixes (`.1` through `.9`) for multiple events of
the same type *(not reachable through `record_search` — the tool's only
cardinality support is `surnameAlt` / `givenNameAlt`, which pair as `.1`)*:

```
q.marriageLikePlace=Colorado&q.marriageLikeDate.from=1920&q.marriageLikeDate.to=1920
&q.marriageLikePlace.1=Nevada&q.marriageLikeDate.1.from=1940&q.marriageLikeDate.1.to=1940
```

Cardinality must match across grouped fields. (Note the parameter names:
the marriage event family is `marriageLike*`, matching the table below —
an earlier revision of this file wrote `q.marriageDate` / `q.marriagePlace`
here, which the API does not use.)

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

With `.exact=on` on a date parameter (`<event>YearExact` on the tool),
the range is matched hard instead of with the usual fuzz around its
bounds. Like the place qualifier this narrows the count rather than
re-ordering results, and it excludes records whose indexed year falls
just outside the range — common wherever the record reported an age
rather than a date. Reasonable when you hold a date from a vital record.

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
| Father | `q.fatherGivenName` | `q.fatherSurname` | `q.fatherBirthLikePlace` † |
| Mother | `q.motherGivenName` | `q.motherSurname` | `q.motherBirthLikePlace` † |
| Parent (sex unknown) | `q.parentGivenName` | `q.parentSurname` | `q.parentBirthLikePlace` † |

† *A relative's birth-place field is not reachable through
`record_search`* — the tool sends a relative's given name and surname
only. Scope the search with the principal's own event place instead.

Each name field independently supports wildcards and `.exact=on`.

### Narrowing behavior

- **Every supplied search term is already required — but there is no
  `.require` qualifier.** An earlier revision of this file said
  `.require=on` was implicit for surname fields; that parameter does not
  exist (`q.surname.required=on` returns a 400). The real mechanism is a
  single global flag, `m.queryRequireDefault=on`, which `record_search`
  sends on **every** call, so no supplied term can be made optional.
- **"Required" means the record must not *contradict* the term — not that
  the record must carry it.** This is what reconciles this bullet with the
  relative-name bullet below, and getting it backwards will make you
  misread every nil result:

  - For a field the index virtually always carries — the searched person's
    **own** given name and surname — there is nothing to be silent about,
    so required collapses to *must match*. One term that does not match
    collapses the result set (measured: 634 results fell to **6** on a
    gibberish given name).
  - For a field a record can simply **omit**, silence is not a
    contradiction, so those records are kept. A father term that nothing
    could match still returned **442,053** of a 456,644 baseline —
    because most records name no father at all, and only the ones naming
    a *different* father were dropped.

  Practical consequence: a nil result means one of the terms **on the
  person you searched** did not match. Drop or loosen one of those to
  recover, rather than adding more. A nil result is *not* evidence that
  some relative was absent from the records.
- Given name only (e.g., spouse "Frank" with unknown surname)
  returns broader results. Useful for finding women with unknown
  maiden names.
- **A relative's name does not require that relative to be present** — the
  omit-able case of the rule above. Unqualified, these fields keep records
  that match, keep records where that relative was never indexed, and drop
  records naming a *different* relative. Measured on a rare real father
  name: of 300 sampled hits, 296 named no father at all and 3 of the
  remaining 4 named a variant of the term (`Zachie`, `Zacharius`,
  `Zacaria`) — so the matching is fuzzy, silence is kept, and conflicts
  are dropped. That is the right trade — absence in an index is not
  disconfirming, and sparse entries often omit parents — but it means a
  father-anchored hit **may contain no father at all**, so do not report
  one as confirming a parent without opening the record. Setting the
  matching `*Exact` requires the relative to be present, which drops the
  silent records *and* abbreviation variants: a 300-result survey on
  `fatherGivenName=William` lost the 11% indexed `Wm`/`Wm.`
- Cardinality (`.1` through `.9`) bundles each spouse's name with that
  spouse's own marriage date/place *(not reachable through
  `record_search`)*.

## Other parameters

| Parameter | Purpose |
|---|---|
| `q.sex` | `Male` or `Female` |
| `q.batchNumber` | IGI batch number *(not reachable through `record_search`)*. Both `C050761` (letter + 6 digits) and `M17288-6` (letter + digits + dash + digit) are accepted — an earlier revision of this file claimed "exactly 6 digits after letter prefix", which the second form contradicts. A very strong filter where it applies: adding one cut a 251,867-hit search to **3**, and a nonsense batch returns 0 rather than being ignored. |
| `treeref` | Family Tree PID — binds search to a tree person for downstream Source Linker attachment *(not reachable through `record_search`; pass `subjectId` instead, which ranks results against that tree person)* |
| `f.collectionId` | Restrict to a specific collection (repeatable for multiple collections) |
| `count` | Results per page, 1–100 (default 20) |
| `offset` | Zero-based pagination, max 4999. Searches return at most 5,000 results. |
