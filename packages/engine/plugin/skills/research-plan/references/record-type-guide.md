# Record Type Selection Guide

Use this reference when identifying which record sets to include in a
research plan. Match the research goal to record types, then check the
contextual factors that affect availability.

---

## Record types by research goal

| Goal | Primary record types | Secondary/fallback |
|------|---------------------|-------------------|
| Identify parents | Census (household), marriage (parents' marriage record), vital records (death/birth cert), probate (will), church (baptism), levy rolls (sons enrolled under their father, where the jurisdiction kept them) | Military pension, immigration, land deeds (witnesses) |
| Confirm identity | Census (name/age/place across decades), vital records, church records | Newspaper, tax records, city directories |
| Find birth date/place | Vital records (birth cert), census (age), church (baptism), death cert (secondary); the subject's own death, burial or marriage entry when the birth predates the register or the birth parish is unknown | Military records, immigration, delayed birth cert |
| Find death date/place | Vital records (death cert), cemetery/FindAGrave, obituary, probate | Church burial, pension file, Social Security |
| Find marriage | Vital records (marriage cert), church (marriage register), newspaper (announcement) | Census (married status), county bonds/licenses |
| Track migration | Census (residence across decades), land records, tax records, county/state histories (biographical sketches often name the origin place — a lead to verify, not evidence), migration-corridor databases where one applies (e.g. Utah, Mormon Pioneer Overland Travel Database, 1847-1868; Saints by Sea for the ocean leg) | Church transfers, newspaper, city directories |
| FAN research | Land deeds (others mentioned), census (neighbors), probate (others mentioned), church (godparents) | Business records, court records, military unit records |

**FAN research — "others mentioned" is deliberate, and it widens rather than
replaces.** Witnesses still count in both record types; they are simply not the
whole set. In a deed the FAN names are not only the witnesses: the boundary
recital names the adjoining landowners ("bounded on the north by John Smith's
property"), who are neighbours by definition and frequently kin. In a probate
file the attesting witnesses to the will remain a FAN source, and so are the
creditors listed among the debts, the purchasers at the estate sale, the
appraisers, the bondsmen and the guardians — and the people named in a will
are often not immediate family but still supply FAN names. Planning only for
"witnesses" tells `search-records` to ignore all of that.

**Identifying parents — plan a dedicated search for the parents'
marriage record.** For a parentage question, add a **separate plan
item** targeting the *parents'* marriage — civil marriage registers,
county marriage bonds/licenses, or a church marriage register — kept
**distinct** from any item about the child's own baptism or marriage,
and do not fold it into a generic "church records" item. Its rationale
must state that the marriage: (a) confirms the couple as a unit; (b)
supplies the **mother's maiden name**, which census and death records
usually omit; and (c) by its date relative to the child's birth,
**corroborates** a father otherwise named only by indirect or derivative
evidence (e.g., a death certificate or a single census co-residence).
**Note the limit:** the couple's marriage proves *they* married and dates
their union — it is **not**, by itself, evidence that *this* child is
theirs. A parentage conclusion still needs a record that places the child
*with* the parents (the child's own christening/birth, a census household,
or a probate naming the child); the marriage record strengthens that case
but cannot stand as its sole basis. This item belongs in essentially every
parentage plan, even when a parent already appears in the tree from
indirect evidence.

**Identifying parents — sons enrolled under their father: plan the levy
rolls.** Where the fetched `{Country}_Military_Records` page or the
`localities` entry shows that a levy or conscription system enrolled boys
under their father's name, the roll is **direct parentage evidence for a
son**, and later sessions can track the father's death and the son's
moves year by year. Which countries kept such rolls, from which year, and
how they are reached come from the page, not from this file. For a male
subject in such a jurisdiction and era, add a dedicated levy-roll plan
item (`record_type: military`) alongside the baptism and the parents'
marriage — not as an afterthought or fallback. Access caveat for the
rationale: in large indexed roll collections the place fields may rank
rather than filter results — pair the item with a `volume_search`/browse
fallback when the indexed search underdelivers.

**Identifying parents or a birthplace — when no baptism can be expected,
work back from the end of the life.** Where the birth predates the
register of the parish the subject was born in or first appears in, or the
birth parish is itself the unknown, the subject's own death or burial
entry and each marriage entry are the records most likely to state an age,
a home parish or a birthplace. Plan each as its own item, dated to the
years the subject was alive there, not folded into a baptism search.

**Emigrant origin or an unindexed parish register — plan a full-text
co-occurrence search, routed to the search-full-text skill.** When the
subject emigrated and the destination records only say "native of
[country]" (never the town), or the origin-country baptism is not
name-indexed, indexed `record_search` on the surname will fail no matter
how many variants you try — the answer lives in the AI-transcribed page
text. Add a plan item whose `record_type` is `church` and whose rationale
names the tactic explicitly: a **full-text search on the surnames as a
co-occurrence** (both required as separate terms), run **unscoped**
across the whole corpus, executed via the **search-full-text** skill. For
a compound surname, which word is the father's and which the mother's,
and in what order, comes from the fetched `{Country}_Naming_Customs` page;
the co-occurrence of the two lands the parents' own acts (the child's
baptism, a parent's burial or marriage). Priests, clerks and later
transcribers do reverse or conflate the two surnames, so treat which one
is the father's as unsettled until a record names the parents separately
— that widens the candidate set, it does not license a match. Do **not** plan this as a phrase
search of the child's compound name, and do **not** scope it to a record
collection id. This is the highest-yield item for "where was X from / who
were X's parents" once indexed search has stalled.

---

## Less-consulted record types to consider

Do not stop at census, vital records, and church records. Plans that
omit these categories risk falling short of the GPS exhaustiveness
standard:

- **Occupation-specific:** railway employment records, mine inspectors'
  reports, merchant guild records, professional license registers
- **Institutional:** hospital, asylum, prison, poorhouse/almshouse
- **Local histories:** county histories with biographical sketches,
  anniversary publications, commemorative volumes
- **Organizational:** fraternal orders, labor unions, professional
  societies, benevolent associations
- **Legal/court:** civil suits, criminal cases, guardianship,
  apprenticeship indentures, name changes

---

## Contextual factors checklist

Before finalizing record selection, verify these factors:

- [ ] **Boundary changes:** Did county/state boundaries change during
  the period? Use `place_search` to check. Records stay with the
  creating jurisdiction.
- [ ] **Record availability dates:** When did civil registration begin
  in this jurisdiction? Earlier events require church or other records.
- [ ] **Record destruction:** Does the `localities` entry record a
  courthouse fire, flood, or wartime loss? Plan the substitute sources
  it names for the lost series.
- [ ] **Wars and military service:** Was the subject of service age
  during a conflict? Check military service, pension, and draft records.
- [ ] **Migration:** Evidence of relocation? Check records along the
  route and in both origin and destination jurisdictions.
- [ ] **Ethnic/religious community:** Specific denominations or ethnic
  groups may have their own record-keeping (church archives, synagogue
  records, ethnic newspapers, community organizations).
- [ ] **Legal changes:** New laws (vital registration mandates,
  inheritance statutes, naturalization requirements) affect what
  records were created and their content.
