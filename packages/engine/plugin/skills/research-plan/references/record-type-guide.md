# Record Type Selection Guide

Use this reference when identifying which record sets to include in a
research plan. Match the research goal to record types, then check the
contextual factors that affect availability.

---

## Record types by research goal

| Goal | Primary record types | Secondary/fallback |
|------|---------------------|-------------------|
| Identify parents | Census (household), marriage (parents' marriage record), vital records (death/birth cert), probate (will), church (baptism), conscription/levy rolls (sons in conscription countries — e.g. Danish lægdsruller) | Military pension, immigration, land deeds (witnesses) |
| Confirm identity | Census (name/age/place across decades), vital records, church records | Newspaper, tax records, city directories |
| Find birth date/place | Vital records (birth cert), census (age), church (baptism), death cert (secondary) | Military records, immigration, delayed birth cert |
| Find death date/place | Vital records (death cert), cemetery/FindAGrave, obituary, probate | Church burial, pension file, Social Security |
| Find marriage | Vital records (marriage cert), church (marriage register), newspaper (announcement) | Census (married status), county bonds/licenses |
| Track migration | Census (residence across decades), land records, tax records | Church transfers, newspaper, city directories |
| FAN research | Land deeds (witnesses), census (neighbors), probate (witnesses), church (godparents) | Business records, court records, military unit records |

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

**Identifying parents — sons in conscription countries: plan the levy
rolls.** Where a national conscription system enrolled boys from birth
or early childhood (Denmark and Norway's *lægdsruller* from 1789;
similar muster systems elsewhere in continental Europe), the levy roll
is **direct parentage evidence for a son**: each boy is entered under
his father's name (in the Danish rolls the father's name is written
directly above the son's), and session notations track the father's
death (*gl. M. S.* "old man's son", *GBES* "widow's son") and the
son's residence and occupation year by year. For a male subject in
such a jurisdiction and era, add a dedicated conscription-roll plan
item (`record_type: military`) alongside the baptism and the parents'
marriage — not as an afterthought or fallback. Access caveat for the
rationale: many roll collections are browse-only image series, and in
large indexed roll collections the place fields may rank rather than
filter results — pair the item with a `volume_search`/browse fallback
when the indexed search underdelivers.

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
a compound (Iberian / Latin-American) surname `Given Paterno Materno`,
the two surnames are the father's and the mother's — so the co-occurrence
`+Paterno +Materno` lands the parents' own acts (the child's baptism, a
parent's burial or marriage). Do **not** plan this as a phrase search of
the child's compound name, and do **not** scope it to a record
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
- [ ] **Record destruction:** Known courthouse fires, floods, or
  wartime losses? Plan substitute sources (tax lists for census,
  church records for vital records, state copies of county records).
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
