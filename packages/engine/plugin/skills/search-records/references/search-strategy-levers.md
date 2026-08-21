# Search Strategy Levers — FamilySearch Records API

When a search returns too many, too few, or zero results, iterate
through these levers. Levers below are expressed in the upstream API's
`q.*` / `f.*` syntax; `record_search` takes **camelCase** parameters:

| API syntax | `record_search` parameter |
|---|---|
| `q.surname` / `q.givenName` | `surname` / `givenName` |
| `q.<relative>GivenName` / `q.<relative>Surname` | `<relative>GivenName` / `<relative>Surname` — `spouse`, `father`, `mother`, `parent`, `other` |
| `q.birthLikeDate.from` / `.to` | `birthYearFrom` / `birthYearTo` (same shape for `death`, `marriage`, `residence`, `any`) |
| `q.birthLikePlace` | `birthPlace` (likewise `deathPlace`, `marriagePlace`, `residencePlace`, `anyPlace`) |
| `q.anyDate` / `q.anyPlace` | `anyYearFrom`/`To`, `anyPlace` |
| `<term>.exact=on` | `<term>Exact: true` — see the qualifier table at the end |
| `f.collectionId` | `collectionId` |
| `q.batchNumber` | `batchNumber` |
| `q.sex` | `sex` |
| `q.recordCountry` / `q.recordSubcountry` | `recordCountry` / `recordSubdivision` |

A few API constructs named below have **no** `record_search` parameter
and are marked *(not reachable through `record_search`)*.

## Default strategy: broad-to-narrow

Start with surname + place (state-level) + wide year range. Use
`f.collectionId` to narrow to specific collections that return hits.
Then add filters (narrower place, narrower date, sex, relationships).

Use **narrow-to-broad** only for known-record retrieval: when you
have high-confidence facts (full name, exact birth date, exact place)
and expect a specific record.

## Decision rules by hit count

1. **>5,000 hits** → Narrow by `f.collectionId` first, then place
   jurisdiction, then add spouse/parent names.
2. **100–5,000 hits** → Add `f.collectionId` and `q.sex`; add parent
   name. (A place qualifier will cut the count sharply, but no measurement shows
   it surfacing a record the unqualified search buried, so do not reach for it
   as a finding lever — see the qualifier table at the end.)
3. **10–100 hits** → Evaluate the top results directly.
4. **0 hits** → Apply levers in priority order (see below).

## Name levers

| Lever | API change | When to try |
|---|---|---|
| Drop surname | Clear `q.surname`; keep `q.givenName` + place + date | Surname heavily corrupted, foreign, or transliterated |
| Drop given name | Clear `q.givenName`; keep `q.surname` + place + date | Given name indexed as initials, nickname, "Infant," or in another language |
| Truncate a multi-part given name to first name only | `q.givenName="Anna Maria Eva"` → `q.givenName="Anna"` | **Only after the full given name has nilled** — a full given name is usually *more* discriminating (see SKILL.md's `givenName` guidance), so truncating it first turns a distinctive search into a generic one. |
| Drop both names | Use only place + date + `q.sex` + relationship params | Both names corrupted; only structural clues stable |
| Search by spouse | Swap principal and spouse: put spouse in `q.givenName/surname`, subject in `q.spouseGivenName/spouseSurname` | Subject's name is common; spouse's is unique |
| Search by parent | Clear principal name; fill `q.fatherGivenName/Surname` and/or `q.motherGivenName/Surname` | Looking for sibling sets; principal may have been "Baby" or stillborn; **or the subject's own vital record nils by name — re-anchor on the parent's given name + exact dates before pivoting to indirect evidence** |
| **Retry under an already-discovered name variant** | Re-run the same search with the variant **in place of** (not alongside) the name you had. A father recorded as "Friedrich Carl" on one record but "Karl" on another is indexed under two different given names, not a spelling variant a fuzzy match will bridge: `fatherGivenName: Friedrich` will not find a child's record that indexes him as `Karl`. Where the variant you hold is a multi-word given name ("Friedrich Karl"), each word alone is a candidate. | A search using the name you have **nils**, and a record already examined indexed this person or a close relative under a different given name — a call name, a dropped middle name, a translated form. Try before wildcarding or dropping the name — a known variant is a stronger lead than a guess. |
| Search by child | Search child as principal with parent name set to subject | Subject's own records scarce; child's are abundant |
| Wildcard surname | `q.surname=Sm*th` or `q.surname=*tnam` | Foreign transliteration, indexing errors, married-name variants |
| Wildcard given name | `q.givenName=Joh*` or `q.givenName=Eli?abeth` | Diminutives, abbreviations, ambiguous handwriting |
| Use initials only | `q.givenName=J W`. Fuzzy returns records indexed `W J` too — usually the same person, so do not discard on order. `.exact=on` keeps only the literal initials form: it cut a US-wide pool roughly 120-fold, and returned nothing at all in every English marriage pool read in full, because those records spell given names out | Census/directory records abbreviated as initials |
| Replace name with structural params | Fill `q.sex`, residence date+place, parent name; clear principal name | Name unrecoverable (e.g., "Negro woman aged 30") |

## Place levers

| Lever | API change | When to try |
|---|---|---|
| Broaden place (county→state→country) | Drop smaller jurisdiction levels from place string | No hits in expected county; boundary changes; ancestor crossed county lines |
| **Try the linked parish/town named alongside it** | Re-run with the broader place term from the **same jurisdiction string** the locality guide already gave you (e.g. `loc_001` names "Sindlingen, Höchst, Hesse-Nassau" — try `Höchst`, not just `Sindlingen`) | A village's own search nils. **No boundary change needed** — small villages routinely have their vital events filed under a linked market-town/deanery parish in the *same era*, not a renamed successor. This is distinct from the boundary-change lever immediately below: nothing changed over time, the record was just kept at the bigger neighboring parish all along. |
| **Boundary changed since the event** | Try the jurisdiction the plan gives you; if it nils and the plan lists a **successor jurisdiction** (research-plan stages historical + present-day from the locality guide — see the item's `rationale`), try that. If none is offered and the nil persists, **bounce to research-plan** — don't look up place history here. | Any place renamed, split, merged, or reassigned since the event. See the note below. |
| Narrow place (state→county→town) | Add smaller levels to place string | Too many hits; subject's town is known |
| Drop place | Clear all place parameters | Subject migrated unexpectedly |
| Switch event-place | Move place from `birthPlace` → `residencePlace` → `marriagePlace` → `anyPlace` | Each event occurred in a different place |

**Boundary changes are a research-plan concern, not a search-records one.** A place's records may be filed under the jurisdiction in force at the event *or* under its present-day jurisdiction — FamilySearch sometimes indexes a collection under the modern country rather than the historical one. Working out that succession (and the right jurisdictions to search, plus any indexing quirks) is `locality-guide`/`research-plan`'s job: they stage the alternatives into the plan, so a plan item may carry a fallback jurisdiction in its `rationale`. Here in search-records the reflex is general: **try the jurisdiction the plan gives you; if a boundary-related nil persists and the plan staged a successor jurisdiction, try it; otherwise bounce back to `research-plan`** rather than guessing per-country rules or looking up place history yourself.

## Date levers

| Lever | API change | When to try |
|---|---|---|
| Broaden range | Widen `.from`/`.to` to ±5 or ±10 years | Census age inflation/deflation; estimated dates |
| Drop date | Clear all date parameters | Date is uncertain; pre-1850 ancestors |
| Switch event type | Move date from `birthYearFrom`/`To` → `residenceYearFrom`/`To` → `deathYearFrom`/`To` | Original event date was wrong type |
| Use Any event | Switch to `q.anyDate` + `q.anyPlace` | Date known but event type unknown (e.g., immigration year) |

## Filter levers

| Lever | API change | When to try |
|---|---|---|
| Restrict to collection | Add `f.collectionId={id}` | Strong match expected in one collection |
| Drop all filters, single identifier | Search an uncommon spouse name with `recordCountry` as the only other field — kin names cannot anchor, so a kin name truly alone is rejected — or a `batchNumber` alone, with no other field (adding `recordCountry` to a batch is rejected) | Brick wall; brute-force exhaustive |

## Cluster / FAN club levers

| Lever | How | When to try |
|---|---|---|
| Search by neighbor | Search the adjacent census household | Subject missed by indexer or indexed badly |
| Search collateral relatives | Use uncommon brother/cousin/in-law surname | Subject's surname too common |
| Maiden vs married name | Run two parallel searches | Female ancestor across her lifetime |

## Zero-hit escalation priority

When a search returns 0 hits with reasonable inputs, try in this order:

1. Broaden year range to ±10
2. **If the plan staged a successor jurisdiction for this place, try it — early.** Records may be filed under the jurisdiction in force at the event *or* the place's present-day one, so when `research-plan` (via the locality guide) has flagged a boundary change and staged an alternative jurisdiction in the item `rationale`, try both early — it is a common, silent cause of nil. If no successor was staged and a boundary change is plausible, bounce to research-plan rather than working out the succession here.
3. **Broaden the place — early, before touching names.** Two distinct moves, both cheaper and higher-yield than burning name variants:
   - **Up a jurisdiction level (parish → county → state).** Many parishes are indexed only at the county level (especially Scandinavian parishes: e.g. Ringebu is indexed under its county "Oppland"), so an exact-parish search returns nil even when the record exists.
   - **Sideways to a linked parish/town in the same jurisdiction string.** If `locality-guide` named more than one place level for this locality (e.g. `loc_001`'s operative jurisdiction reads "Sindlingen, Höchst, Hesse-Nassau"), a nil on the narrowest level does not mean try county/state next — try the **other place already named in that string first** (`Höchst`). Small villages routinely have their vital events filed under a linked market-town/deanery parish in the same era, independent of any boundary change, and it is easy to fixate on the narrowest place name and never re-read the jurisdiction string for the broader one sitting right next to it.
4. **Re-anchor on a known relative (spouse / parent / child) — before dropping or wildcarding the subject's name.** If the subject's own record nils but you have a relative's name plus exact dates from another record, search by the relative: fill `q.fatherGivenName`/`q.motherGivenName` (or `q.spouseGivenName`), or search a child as principal with the subject as parent. This is often the *primary* recovery move for emigrant-origin cases, where the subject's own record is indexed under names you can't guess.
5. **If a record already examined gave this person or a relative a different given name than the one in your query, retry with that variant — before wildcarding or dropping the name.** A father recorded as "Friedrich Carl" on one record but "Karl" on another is indexed under two different given names, not a spelling variant; `fatherGivenName: Friedrich` will not find a record that indexes him as `Karl`.
6. Drop given name (surname + place + date)
7. Drop surname (given name + place + date + relationships)
8. Wildcard the surname
9. Wildcard the given name
10. Switch event type to Any
11. Drop place entirely
12. Search by neighbor or FAN-club member

**Still 0 hits across all variations:** the records may be unindexed.
Switch to image browsing, Catalog search, Full-Text Search, or
external indexes.

## "Reasonably exhaustive" exit criteria

A reasonably exhaustive indexed Records search has been performed when:
- Searched under at least one wildcarded surname variant and one
  wildcarded given-name variant
- Searched by at least one parent and one spouse (where applicable)
- Searched the immediate jurisdiction, parent jurisdiction, and one
  neighboring jurisdiction
- Examined results from each collection that returned matching hits
- Checked for image-only collections via the Catalog
- Documented every search attempt including zero-hit searches

## Quick-reference: the `*Exact` qualifiers (usually: don't)

Measured against the live API, with re-measurements where a row says so.
Figures are rounded deliberately: these are live totals that drift between
runs, so the ratios and directions are the finding, not the digits.

**These qualifiers change how many results come back** — on one rare surname
the count fell roughly 800-fold. What they cannot do is surface a record: read
over whole result sets on the surname qualifier, the exact search returned
nothing the fuzzy one had not, so it is a subset that only subtracts. It does
re-shuffle the records it keeps, which is a reason to expect a different order,
not a reason to hope for a new record. So
if a search is not finding the record, an exact qualifier is not the
lever — a different name value, place level, or a relative's name is.

They are written `.exact=on` in the API and **camelCase booleans on the
tool**: `surnameExact`, `givenNameExact`, `birthPlaceExact`,
`marriageYearExact`, and so on for every event and relative family.

| Parameter | In one line |
|---|---|
| `surnameExact` | **Usually wrong** — fuzzy is what bridges an index misspelling, so this can drop the target outright |
| `givenNameExact` | Excludes the variants fuzzy reaches. One real use: an initials search |
| `<event>PlaceExact` | Cuts the count hard; not a finding lever |
| `<event>YearExact` | Only with a firm date — what it does to undated records is not established |
| relative `*Exact` | Requires that relative to be indexed, so it drops the silent records the unqualified term keeps |
| `recordCountry`, `recordSubdivision` | Already strict — no qualifier exists and none is needed |

Each is expanded below. These were single table cells of up to ~290 words, which
is the wrong container for a claim that has to carry its own scope.

### `surnameExact`

Fuzzy reaches spelling variants through the phonetic algorithm, and that is what
bridges an index misspelling. On a record indexed `Neill`, `surname: "Neal"` +
`surnameExact` returned **0** where fuzzy returned the target. Set it only with a
**confirmed** indexed spelling, or to size a pool (see the end of this file).

### `givenNameExact`

Fuzzy reaches abbreviations (`Wm`→`William`) and period diminutives.
Membership-tested: a fuzzy `Elizabeth` search does return `Betty` records, and
likewise `Margaret`→`Peggy` and `Mary`→`Polly`. Only those three pairs were
tested — do **not** read the nickname table in `name-search-mechanics.md` as
measured. That the exact form excludes them is expected, not measured.

**Rank is the constraint, not coverage.** The best-placed diminutive sat in the
mid-300s of a pool of about a thousand, and the rest were never seen inside a
500-deep scan — all far past the default page (20, or 50 with `subjectId`). So
searching the diminutive as its own `givenName` value, or narrowing until the
pool can be read to the end, is the reliable move.

**The one real exception is an initials search** (`givenName: "J W"`). The reason
previously given here was wrong: fuzzy does not, in the main, replace initials
with spelled-out names — a sampled page came back overwhelmingly initials-shaped.
What it does is also return the **transposition** (`W J`), at a substantial share
of results.

Exactness pins the order. On a US census pool read in full both ways, a record
indexed `W J` is returned by a fuzzy `J W` search and absent from the exact one,
while four other records survive it — so the removal is selective, not an empty
result. Confirmed on one enumerated pool; the wider proportions are samples.

But `.exact` keeps only the literal indexed form: in every English marriage pool
read in full it returned nothing, because those records spell given names out. A
nil under it is a fact about the index, not about the person.

### `<event>PlaceExact`

Fuzzy expands upward to parent jurisdictions, so broadly that a **wrong** county
returned a total within about a tenth of a percent of the right county's — a
county scope barely discriminates at all.

Setting it cuts the count hard: on that same query, tens of thousands of hits
down to a couple. Its effect on ordering was never measured beyond one record,
which ranked first either way (checked by record id). Use it when a total has to
be defensible, not to find a record.

### `<event>YearExact`

Fuzz around the range bounds is **weakly** evidenced: the few records seen
outside an unqualified range carried *approximate* dates, and on a pool read to
the end the single out-of-range row survived `.exact` too.

Whether an unqualified range requires an indexed year is **not established** — no
direction was measured, so do not assume a range either keeps or excludes undated
records, and do not quote a share. The `any` family was never tested at all.

Setting it is *meant* to exclude records whose indexed year sits just outside the
range — where seen, that was the age-reported population — but an out-of-range
row was observed surviving it, so the exclusion is not reliably complete. Whether
it also drops records carrying no year, or in-range *approximate* dates, is
**not established**. Use only with a firm date.

### relative `*Exact` (`fatherGivenNameExact`, `spouseSurnameExact`, …)

Unqualified, a relative name keeps records where that relative was **never
indexed**, while still excluding a different one. **How much it narrows depends
on WHICH relative, and the spread is large.** Measured by reading whole result
sets to the end, on two marriage populations and on the **father**, **spouse**,
**mother** and **parent** names: an unmatchable *father* name returned about
70-93% of the baseline, a *mother* name about 70-99%, a *parent* name about
70-93%, an unmatchable *spouse* name 10% in one population and 81% in the other —
in each case matching the share of records silent about that relative.

So a father-anchored nil is weak evidence wherever fathers are thinly indexed,
and a spouse-anchored one is stronger wherever spouses are not. **The difference
is exactly how often that relative is indexed:** an unmatchable name keeps the
records silent about that relative and drops every record naming a different one,
so retention matches the baseline's silent share to within about a point. Nothing
is special about the parameter. `other` names were not enumerated.

Setting `*Exact` requires the relative to be indexed **and** the spelling to
match, so it drops the silent population as well as variant forms the fuzzy
search did reach (both sets read in full). Enumerated on the **father**,
**spouse**, **mother** and **parent** names, across two marriage populations read
to the end: every relative-silent record is absent from the exact set while a
relative-bearing control survives — the one exception being `mother` in England,
whose pool indexes no mother given name to serve as a control, so the presence
requirement is confirmed for `mother` on the Brazil population alone. `other` was
not tested, so do not assume the size of the effect carries across families.
Whether it drops indexed
abbreviations (`Wm` for `William`) specifically is **not** measured — the
enumerated set held none to drop. Set it only with a confirmed indexed spelling
of the relative's name.

### `recordCountry` and `recordSubdivision`

Both are **already strict**: a nonexistent country or subdivision returns 0
rather than being ignored, and a real subdivision cuts a country-wide total to a
small fraction of it. No qualifier exists for either and none is needed.

What is *not* established is how place scopes expand — whether dropping from
county to state level rescues a search that nils is a separate open question, so
do not treat a nil at one level as settling the other.

**The one case that is genuinely about a qualifier: sizing a pool.** If
you are about to record `results_available` or argue a search was
reasonably exhaustive, an unqualified total will not support the claim —
a pool of some fourteen thousand candidates is not a surveyed pool, and the
same search with a qualifier came back in the dozens. (Those figures come from
the original probe session under a query shape the repo's qualifier probe does
not run — the ratio is the point, and the absolute numbers are not reproducible
from the committed probe.) Narrow first, then make the claim.

Full figures and method are repo-side and not readable from here:
`docs/specs/record-search-tool-spec-v2.md`, section "What `.exact=on`
actually does", reproduced by the qualifier probe. The summary above is
the operative version.
