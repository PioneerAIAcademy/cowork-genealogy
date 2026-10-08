# Search Strategy Levers — FamilySearch Records API

When a search returns too many, too few, or zero results, iterate
through these levers. Parameters are `record_search`'s own camelCase
names; a few upstream constructs named below have no `record_search`
parameter and are marked *(not reachable through `record_search`)*.

## Default strategy: broad-to-narrow

Start with surname + place (state-level) + wide year range. Use
`collectionId` to narrow to specific collections that return hits.
Then add filters (narrower place, narrower date, sex, relationships).

Use **narrow-to-broad** only for known-record retrieval: when you
have high-confidence facts (full name, exact birth date, exact place)
and expect a specific record.

## Decision rules by hit count

1. **>5,000 hits** → Narrow by `collectionId` first, then place
   jurisdiction, then add spouse/parent names.
2. **100–5,000 hits** → Add `collectionId` and `sex`; add parent
   name. (A place qualifier will cut the count sharply, but no measurement shows
   it surfacing a record the unqualified search buried, so do not reach for it
   as a finding lever — see `record_search`'s own `*Exact` parameter descriptions.)
3. **10–100 hits** → Evaluate the top results directly.
4. **0 hits** → Apply levers in priority order (see below).

**A drop should be paired with a compensating tighten, not left on its own.**
Index entries are mistranscribed roughly 5-15% of the time, so after
exhausting correctly-indexed spellings, dropping a different criterion
(surname, given name, a relative's name) is itself a lever — it treats the
possibility that criterion, not the one you have been varying, is the
mistranscribed one. But dropping widens the pool, so pair the drop with a
tighten elsewhere (a narrower place, a narrower date range, an added
relative's name) and read further down the resulting pool (paging past the
default cap, per SKILL.md Step 4) rather than reading only the top handful of
a now-broader search. Balance name specificity against place specificity:
loosening one is easier to read to the end when the other tightens to
compensate.

## Name levers

**Anchor reminder before using any lever below.** `record_search` rejects a
query carrying none of `surname`, `recordCountry`, or `batchNumber`
(SKILL.md's Anchor rule). Any lever here that clears `surname` — Drop
surname, Drop both names, Search by parent, Replace name with structural
params below — must set `recordCountry` or `batchNumber` in its place, or
the call fails validation before it ever reaches FamilySearch. A
`collectionId` does **not** anchor a call on its own, so scoping to a
collection does not exempt a lever from this requirement.

| Lever | API change | When to try |
|---|---|---|
| Drop surname | Clear `surname`; keep `givenName` + place + date, and set `recordCountry` or `batchNumber` as the anchor | Surname heavily corrupted, foreign, or transliterated; or the given name is itself unusual enough to anchor the search alone |
| Drop given name | Clear `givenName`; keep `surname` + place + date | Given name indexed as initials, nickname, "Infant," or in another language |
| Truncate a multi-part given name to one of its parts | `givenName="Anna Maria Eva"` → `givenName="Anna"`, `"Maria"`, or `"Eva"` — try each in turn, not just the first | **Only after the full given name has nilled** — a full given name is usually *more* discriminating (see SKILL.md's `givenName` guidance), so truncating it first turns a distinctive search into a generic one. Records commonly index by the second or third given name rather than the first, so a single truncation to the first name is not exhaustive. |
| Drop both names | Use only place + date + `sex` + relationship params, anchored on `recordCountry` or `batchNumber` | Both names corrupted; only structural clues stable |
| Search by spouse | Swap principal and spouse: put spouse in `givenName/surname`, subject in `spouseGivenName/spouseSurname` | Subject's name is common; spouse's is unique |
| Search by parent | Clear principal name; fill `fatherGivenName/Surname` and/or `motherGivenName/Surname`, and set `recordCountry` or `batchNumber` as the anchor — `collectionId` does not anchor a call on its own, so scoping to a collection does not remove this requirement | Looking for sibling sets; principal may have been "Baby" or stillborn; **or the subject's own vital record nils by name — re-anchor on the parent's given name + exact dates before pivoting to indirect evidence** |
| **Retry under an already-discovered name variant** | Re-run the same search with the variant **in place of** (not alongside) the name you had. A father recorded as "Friedrich Carl" on one record but "Karl" on another is indexed under two different given names, not a spelling variant a fuzzy match will bridge: `fatherGivenName: Friedrich` will not find a child's record that indexes him as `Karl`. Where the variant you hold is a multi-word given name ("Friedrich Karl"), each word alone is a candidate. | A search using the name you have **nils**, and a record already examined indexed this person or a close relative under a different given name — a call name, a dropped middle name, a translated form. Try before wildcarding or dropping the name — a known variant is a stronger lead than a guess. |
| Search by child | Search child as principal with parent name set to subject | Subject's own records scarce; child's are abundant |
| Wildcard surname | `surname=Sm*th` or `surname=*tnam` | Foreign transliteration, indexing errors, married-name variants |
| Wildcard given name | `givenName=Joh*` or `givenName=Eli?abeth` | Diminutives, abbreviations, ambiguous handwriting |
| Use initials only | `givenName=J W`. Fuzzy returns records indexed `W J` too — usually the same person, so do not discard on order. `Exact: true` keeps only the literal initials form: it cut a US-wide pool roughly 120-fold, and returned nothing at all in every English marriage pool read in full, because those records spell given names out | Census/directory records abbreviated as initials |
| Replace name with structural params | Fill `sex`, residence date+place, parent name; clear principal name, and set `recordCountry` or `batchNumber` as the anchor | Name unrecoverable (e.g., "Negro woman aged 30") |

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
| Use Any event | Switch to `anyYearFrom`/`anyYearTo` + `anyPlace` | Date known but event type unknown (e.g., immigration year) |

## Filter levers

| Lever | API change | When to try |
|---|---|---|
| Restrict to collection | Add `collectionId={id}` | Strong match expected in one collection |
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
4. **Re-anchor on a known relative (spouse / parent / child) — before dropping or wildcarding the subject's name.** If the subject's own record nils but you have a relative's name plus exact dates from another record, search by the relative: fill `fatherGivenName`/`motherGivenName` (or `spouseGivenName`), or search a child as principal with the subject as parent. This is often the *primary* recovery move for emigrant-origin cases, where the subject's own record is indexed under names you can't guess.
5. **If a record already examined gave this person or a relative a different given name than the one in your query, retry with that variant — before wildcarding or dropping the name.** A father recorded as "Friedrich Carl" on one record but "Karl" on another is indexed under two different given names, not a spelling variant; `fatherGivenName: Friedrich` will not find a record that indexes him as `Karl`.
6. Drop given name (surname + place + date)
7. Drop surname (given name + place + date + relationships) — add `recordCountry` or `batchNumber` as the anchor when you do; the tool rejects a query carrying none of the three
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
