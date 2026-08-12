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

- **It changes the COUNT; what it does to ordering was never measured beyond
  one record.** A marriage
  search scoped to
  Nevada County, Arkansas returned tens of thousands of hits fuzzy and
  **a couple** with `marriagePlaceExact` — and the target record ranked
  **first in both** (rank checked by record id, not by name). That is a
  single-target observation, not a finding that the qualifier leaves the order
  alone; on the surname qualifier, where whole result sets were compared,
  exactness does re-shuffle what it keeps. Either way it is not the lever for
  surfacing a record you could not otherwise reach: do not set it hoping to
  find something; the fuzzy search has already put the best match at the top.
- **An unqualified county scope barely discriminates.** From the *same*
  query, the *wrong* Arkansas county (`Yell`) returned a total within about
  **a tenth of a percent** of the right county's, and the target was not
  in the wrong county's top 20. (Not in the top 20 is *not* the same as
  absent: nothing scanned that whole pool, and the API caps search depth
  well below its size, so "absent" is not reachable here at all.) A
  county-level total therefore tells you almost nothing about whether the
  records you want are in that county.
- **What the qualifier is genuinely for:** making a count mean
  something. If you are about to log `results_available` or argue a
  search was reasonably exhaustive, an unqualified place total will not
  support the claim; an exact-place total will.

Full figures and method are repo-side and not readable from here:
`docs/specs/record-search-tool-spec-v2.md`, section "What `.exact=on`
actually does", reproduced by the qualifier probe. The summary above is
the operative version.

### Filter-based place restriction

For strict place filtering the API offers `f.*` place parameters
*(not reachable through `record_search` — the tool exposes no equivalent. The
nearest reachable substitute is `<event>PlaceExact`, whose effect **is**
measured; `recordSubdivision` is also available but its filtering behaviour has
not been measured — see the qualifier table in `search-strategy-levers.md`)*:

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
bounds. Like the place qualifier this narrows the count; its effect on the
order of what it keeps was not measured. Measured 2026-08-08 on the birth
family, with the enumerated legs re-done 2026-08-10/11 — the `any`
family was never tested (qualifier probe, sections H, N and Y — host-side):

- **The fuzz is real but only WEAKLY evidenced.** An unqualified single-year
  range returned a handful of sampled records dated outside it — and every one
  carried an *approximate* date (an "about" year); precise dates did not leak.
  On a pool small enough to read to the end, only one classifiable row fell
  outside the range, **and it survived `.exact` as well**, which is not the
  shape of fuzz. Treat the fuzz as unconfirmed rather than measured, and do not
  read either count as its size.
- **`.exact=on` narrows hard:** nothing outside the range in the same sample,
  and the total fell by about two orders of magnitude.
- **How a year range treats a record with NO indexed year is NOT established.**
  Neither direction is measured: not that an unqualified range keeps such
  records, and not that `.exact` drops them. The test behind both could not tell
  a record with no indexed year from one whose year the result payload simply
  does not show, so both readings were withdrawn rather than
  reversed. **Do not quote a share of tolerated silence, and do not quote a
  year-less rate** — a relevance-ranked sample of a vanishing fraction of a
  multi-million-record pool was read as a population figure twice before, each
  time producing a confident wrong answer. Practically: a year range, set or
  unset, is not a reliable way to include or exclude undated records. If that
  distinction matters to your search, check the records you get back rather than
  the count.

Reasonable when you hold a date from a vital record. Note what it costs: the
out-of-range records it removes were, where seen, *approximate* dates — the
population where a record reported an age rather than a date, though that leg is
weakly evidenced. Whether it also drops records with no indexed year, or in-range
approximate dates, was **not** established.

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
    collapses the result set — measured, a few hundred results fell to
    single digits on a gibberish given name.
  - For a field a record can simply **omit**, silence is not a
    contradiction, so those records are kept. A father term that nothing
    could match still returned about **97%** of its baseline: only the
    records naming a *different* father were dropped, and a record silent
    about its father cannot contradict the term. Since the dropped records
    ARE the father-bearing ones, that small drop also measures how few of
    them there are here.
    **Treat that share as slice-specific, not a general fact** — across
    six populations it ranged from roughly 3% to a third father-bearing
    (Italian parish records the highest). Records naming a father are a
    minority everywhere measured, but "almost none" holds only for this US
    census-era slice. Do not estimate it from a page of results either:
    the sampled father-bearing rate swings wildly from one page of results
    to the next, so only totals answer the question.

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
  records naming a *different* relative. Seen on a rare real father
  name: of a 300-record survey the overwhelming majority named no father at
  all, and nearly all of the few that did named the term or a variant of it
  (`Zachariah`, `Zachie`, `Zacharius`, `Zacharish`, `Zacaria`) — so the
  matching is fuzzy, silence is kept, and conflicts are dropped. (That survey
  is a **sample** of a pool far too large to read to the end; the enumerated
  version of the same finding is two bullets down. The recorded tally keeps
  only the commonest handful of forms, so do not read that list as
  exhaustive.)
  That is the right trade — absence in an index is not
  disconfirming, and sparse entries often omit parents — but it means a
  father-anchored hit **may contain no father at all**, so do not report
  one as confirming a parent without opening the record. Setting the
  matching `*Exact` requires the relative to be present, which drops the
  silent records *and* variant forms the unqualified search did reach — both
  sets read in full. Whether it drops indexed **abbreviations** (`Wm` for
  `William`) specifically is **not** measured: the enumerated set held none to
  drop, and the 300-result `fatherGivenName=William` survey that once stood
  here is a sample of a pool too large to read to the end.
- **How much a relative name narrows depends on WHICH relative — the spread is
  wide enough to change what a nil means.** Measured on two marriage
  populations, for the **father** and **spouse** names only, every pool read to
  the end: an unmatchable *father* name returned about 70-93% of the baseline,
  while an unmatchable *spouse* name returned 10% in one population and 81% in
  the other — the spread tracking how often each relative is indexed there.
  Mother, parent and other names were not enumerated.
  A father-anchored nil is therefore weak evidence that no record exists; a
  spouse-anchored one can be stronger, though it varies too much to lean on
  alone.
  Do not carry an effect size from one relative family to another.
- **And the difference is exactly how often that relative is indexed.** Reading
  whole result sets to the end, the records an unmatchable name keeps are the
  ones silent about that relative, and the retention it produces matches the
  baseline's silent share to within about a point in every population measured.
  So there is nothing special about the parameter: where parents are rarely
  indexed a parent name barely narrows, and where spouses are almost always
  indexed a spouse name cuts most of the pool. In a population that indexes both
  sparsely, both behave alike.
- **An unqualified relative name NARROWS the result set.** Holding a query
  otherwise constant, adding `fatherGivenName` reduced a Brazilian marriage
  search by a few percent. If you have seen a parent anchor
  appear to *widen* a search, check whether something else was dropped in
  the same call: the case that prompted this investigation — a count that
  rose by half again when a parent anchor was added — turned out to have
  removed a five-year marriage-date range in the same request. Isolated, the date
  range more than doubled the count on its own, and the anchor still
  narrowed. A mother-name call in that same run, with the range likewise
  dropped and no father term at all, rose by a comparable amount — which is
  what gives the confound away.
- Cardinality (`.1` through `.9`) bundles each spouse's name with that
  spouse's own marriage date/place *(not reachable through
  `record_search`)*.

## Other parameters

| Parameter | Purpose |
|---|---|
| `q.sex` | `Male` or `Female` |
| `q.batchNumber` | IGI batch number — reachable as `batchNumber`. Shape varies: it may lead with a digit or with a letter (`B`, `C`, `I`, `M` seen), and may carry a trailing `-digit` — `C050761`, `M17288-6` and all-numeric batches all occur. Send what the source gives you; do not reject or reformat a batch on shape, and treat no shape rule here as exhaustive. A very strong filter where it applies: adding one cut a quarter-million-hit search to single digits, and a nonsense batch returns 0 rather than being ignored. (Figures from the original probe session; not reproducible from the committed probe, which has no batch section.) |
| `treeref` | Family Tree PID — binds search to a tree person for downstream Source Linker attachment *(not reachable through `record_search`; pass `subjectId` instead, which ranks results against that tree person)* |
| `f.collectionId` | Restrict to a specific collection (repeatable for multiple collections) |
| `count` | Results per page, 1–100 (default 20) |
| `offset` | Zero-based pagination, max 4999. Searches return at most 5,000 results. |
