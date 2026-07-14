# Search Strategy Levers — FamilySearch Records API

When a search returns too many, too few, or zero results, iterate
through these levers. All levers are expressed as API parameter
manipulations.

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
   name; consider `.exact=on` on place.
3. **10–100 hits** → Evaluate the top results directly.
4. **0 hits** → Apply levers in priority order (see below).

## Name levers

| Lever | API change | When to try |
|---|---|---|
| Drop surname | Clear `q.surname`; keep `q.givenName` + place + date | Surname heavily corrupted, foreign, or transliterated |
| Drop given name | Clear `q.givenName`; keep `q.surname` + place + date | Given name indexed as initials, nickname, "Infant," or in another language |
| Drop both names | Use only place + date + `q.sex` + relationship params | Both names corrupted; only structural clues stable |
| Search by spouse | Swap principal and spouse: put spouse in `q.givenName/surname`, subject in `q.spouseGivenName/spouseSurname` | Subject's name is common; spouse's is unique |
| Search by parent | Clear principal name; fill `q.fatherGivenName/Surname` and/or `q.motherGivenName/Surname` | Looking for sibling sets; principal may have been "Baby" or stillborn |
| Search by child | Search child as principal with parent name set to subject | Subject's own records scarce; child's are abundant |
| Wildcard surname | `q.surname=Sm*th` or `q.surname=*tnam` | Foreign transliteration, indexing errors, married-name variants |
| Wildcard given name | `q.givenName=Joh*` or `q.givenName=Eli?abeth` | Diminutives, abbreviations, ambiguous handwriting |
| Use initials only | `q.givenName=J W` with `.exact=on` | Census/directory records abbreviated as initials |
| Replace name with structural params | Fill `q.sex`, residence date+place, parent name; clear principal name | Name unrecoverable (e.g., "Negro woman aged 30") |

## Place levers

| Lever | API change | When to try |
|---|---|---|
| Broaden place (county→state→country) | Drop smaller jurisdiction levels from place string | No hits in expected county; boundary changes; ancestor crossed county lines |
| **Boundary changed since the event** | Search the jurisdiction that existed **at the event date** first (the historical boundary); if that returns nil, retry under the place's **present-day** jurisdiction (`recordCountry` + place string). `place_search_all` lists every jurisdiction the place has belonged to over time — try the historical one first, the most-recent one next. | Any place whose city / county / state / country / parish was renamed, split, merged, or reassigned since the event — a county that split, a parish reorganized, or an empire that dissolved into successor states (Austria-Hungary → Slovakia / Czechia / Hungary / Croatia / Poland / Ukraine…, Prussia → Poland, Ottoman → Balkan states). See the note below. |
| Narrow place (state→county→town) | Add smaller levels to place string | Too many hits; subject's town is known |
| Drop place | Clear all place parameters | Subject migrated unexpectedly |
| Switch event-place | Move place from `birthLikePlace` → `residencePlace` → `marriageLikePlace` → `anyPlace` | Each event occurred in a different place |
| Follow a rediscovered residence | When broadening (dropping place, or widening years) surfaces the family in a jurisdiction you didn't expect, make that new jurisdiction the primary target for other still-pending record types on the same people — especially a marriage record — before continuing to search wherever you originally assumed | A broadened search for one record type (e.g. a census) reveals the family in an earlier or different place than the subject's known birthplace or later residence implied |

**A rediscovered residence changes where to look next, not just what you now know.** If a place-dropped or year-widened search for one record turns up the family living somewhere you hadn't planned to search, don't just log it as a bonus fact and continue the searches you already had planned in the originally-assumed jurisdiction. Marriage in particular usually **precedes** migration — a couple who married in place A and later moved to place B will have their marriage filed under A, not B. So if a census (or any record) unexpectedly places the family in A at a date before their known residence in B, retarget the marriage-record search to A first. Searching for the marriage only in the state where the subject was later known to live, or where a compiled tree assumes the family originated, misses exactly this case.

**Boundary changes: search the historical jurisdiction first — but watch for the modern-country exception.** The general rule when a place's boundaries have changed (city, county, state, country, or parish renamed, split, merged, or reassigned) is to search the boundary that governed it *at the time of the event*: the record was created under the jurisdiction then in force, so that historical boundary is usually where it is filed. **The exception is FamilySearch's own indexing:** it sometimes files a collection under the place's **present-day** country instead of the historical one. The worked example — a birth in 1893 Šútovo, then Suttó, Turócz County, Kingdom of Hungary — is indexed under **Slovakia** ("Slovakia, Church and Synagogue Books"), because Šútovo is in modern Slovakia. Searching `recordCountry: "Hungary"` (or the historical county "Turócz") returns nil no matter how many name variants you try, because the record isn't filed under Hungary. So search the historical jurisdiction first; when it returns nil, switch `recordCountry` to the present-day country and retry — that is where FamilySearch put the collection. And don't assume the historical empire's religion either (a 1893 Turócz parish is Slovak **Lutheran**, not Catholic) — let the collection, not the assumption, decide.

## Date levers

| Lever | API change | When to try |
|---|---|---|
| Broaden range | Widen `.from`/`.to` to ±5 or ±10 years | Census age inflation/deflation; estimated dates |
| Drop date | Clear all date parameters | Date is uncertain; pre-1850 ancestors |
| Switch event type | Move date from `birthLikeDate` → `residenceDate` → `deathLikeDate` | Original event date was wrong type |
| Use Any event | Switch to `q.anyDate` + `q.anyPlace` | Date known but event type unknown (e.g., immigration year) |

## Filter levers

| Lever | API change | When to try |
|---|---|---|
| Restrict to collection | Add `f.collectionId={id}` | Strong match expected in one collection |
| Drop all filters, single identifier | Search uncommon spouse name only, or `q.batchNumber` only | Brick wall; brute-force exhaustive |

## Cluster / FAN club levers

| Lever | How | When to try |
|---|---|---|
| Search by neighbor | Search the adjacent census household | Subject missed by indexer or indexed badly |
| Search collateral relatives | Use uncommon brother/cousin/in-law surname | Subject's surname too common |
| Maiden vs married name | Run two parallel searches | Female ancestor across her lifetime |

## Zero-hit escalation priority

When a search returns 0 hits with reasonable inputs, try in this order:

1. Broaden year range to ±10
2. **If the place's boundaries changed since the event, search the historical jurisdiction first, then the present-day one.** Records are usually filed under the boundary that governed the place at the event date — but FamilySearch sometimes indexes the collection under the modern country instead (e.g. Hungary→Slovakia), so retry `recordCountry` as the present-day country when the historical one returns nil. Try both early; it is a common, silent cause of nil on Central/Eastern-European searches.
3. Drop given name (surname + place + date)
4. Drop surname (given name + place + date + relationships)
5. Wildcard the surname
6. Wildcard the given name
7. Switch event type to Any
8. Broaden place by one jurisdiction level
9. Drop place entirely
10. Switch from principal to spouse / parent / child
11. Search by neighbor or FAN-club member

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

## Quick-reference: when to use `.exact=on`

| Parameter type | Default fuzzy expands to… | Use `.exact=on` when… |
|---|---|---|
| Given name | Nicknames, abbreviations, diacritic variants | Name is a verbatim match; rare formal name |
| Surname | Spelling variants via phonetic algorithm | Name is unusual; result list too noisy |
| Place | Up to 3 jurisdiction levels above | Exclude parent-jurisdiction matches (children still included) |
| Year | ±~2 years (undocumented, varies) | You have a verified date from a vital record |
