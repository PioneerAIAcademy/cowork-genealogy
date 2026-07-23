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
| Search by parent | Clear principal name; fill `q.fatherGivenName/Surname` and/or `q.motherGivenName/Surname` | Looking for sibling sets; principal may have been "Baby" or stillborn; **or the subject's own vital record nils by name — re-anchor on the parent's given name + exact dates before pivoting to indirect evidence** |
| Search by child | Search child as principal with parent name set to subject | Subject's own records scarce; child's are abundant |
| Wildcard surname | `q.surname=Sm*th` or `q.surname=*tnam` | Foreign transliteration, indexing errors, married-name variants |
| Wildcard given name | `q.givenName=Joh*` or `q.givenName=Eli?abeth` | Diminutives, abbreviations, ambiguous handwriting |
| Use initials only | `q.givenName=J W` with `.exact=on` | Census/directory records abbreviated as initials |
| Replace name with structural params | Fill `q.sex`, residence date+place, parent name; clear principal name | Name unrecoverable (e.g., "Negro woman aged 30") |

## Place levers

| Lever | API change | When to try |
|---|---|---|
| Broaden place (county→state→country) | Drop smaller jurisdiction levels from place string | No hits in expected county; boundary changes; ancestor crossed county lines |
| **Boundary changed since the event** | Try the jurisdiction the plan gives you; if it nils and the plan lists a **successor jurisdiction** (research-plan stages historical + present-day from the locality guide — see the item's `rationale`), try that. If none is offered and the nil persists, **bounce to research-plan** — don't look up place history here. | Any place renamed, split, merged, or reassigned since the event. See the note below. |
| Narrow place (state→county→town) | Add smaller levels to place string | Too many hits; subject's town is known |
| Drop place | Clear all place parameters | Subject migrated unexpectedly |
| Switch event-place | Move place from `birthLikePlace` → `residencePlace` → `marriageLikePlace` → `anyPlace` | Each event occurred in a different place |

**Boundary changes are a research-plan concern, not a search-records one.** A place's records may be filed under the jurisdiction in force at the event *or* under its present-day jurisdiction — FamilySearch sometimes indexes a collection under the modern country rather than the historical one. Working out that succession (and the right jurisdictions to search, plus any indexing quirks) is `locality-guide`/`research-plan`'s job: they stage the alternatives into the plan, so a plan item may carry a fallback jurisdiction in its `rationale`. Here in search-records the reflex is general: **try the jurisdiction the plan gives you; if a boundary-related nil persists and the plan staged a successor jurisdiction, try it; otherwise bounce back to `research-plan`** rather than guessing per-country rules or looking up place history yourself.

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
2. **If the plan staged a successor jurisdiction for this place, try it — early.** Records may be filed under the jurisdiction in force at the event *or* the place's present-day one, so when `research-plan` (via the locality guide) has flagged a boundary change and staged an alternative jurisdiction in the item `rationale`, try both early — it is a common, silent cause of nil. If no successor was staged and a boundary change is plausible, bounce to research-plan rather than working out the succession here.
3. **Broaden the place by one jurisdiction level (parish → county → state) — early, before touching names.** Many parishes are indexed only at the county level (especially Scandinavian parishes: e.g. Ringebu is indexed under its county "Oppland"), so an exact-parish search returns nil even when the record exists. Broadening the place is cheaper and higher-yield than burning name variants.
4. **Re-anchor on a known relative (spouse / parent / child) — before dropping or wildcarding the subject's name.** If the subject's own record nils but you have a relative's name plus exact dates from another record, search by the relative: fill `q.fatherGivenName`/`q.motherGivenName` (or `q.spouseGivenName`), or search a child as principal with the subject as parent. This is often the *primary* recovery move for emigrant-origin cases, where the subject's own record is indexed under names you can't guess.
5. Drop given name (surname + place + date)
6. Drop surname (given name + place + date + relationships)
7. Wildcard the surname
8. Wildcard the given name
9. Switch event type to Any
10. Drop place entirely
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
