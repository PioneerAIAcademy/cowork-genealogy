# Mary Crowther — parents and marriage (1854–1883)

**Source PID:** `218N-WSD`
**Mary Crowther is deceased.** (FamilySearch ToS requires all committed
e2e fixtures to be about deceased persons. Born 10 July 1854, died 22
February 1920.)

## Research question

> Who were the parents of Mary Crowther, born 10 July 1854 in Baltimore,
> Maryland, and whom did she marry?

## What was removed from the starting tree

- Removed the `ParentChild` relationships linking Mary Crowther to her
  parents, **John Crowther** (b. 24 Aug 1831, Cockeysville, Baltimore Co.,
  MD; d. 11 Dec 1918, MD) and **Honor Elizabeth Frances Bosley** (b. 24 Nov
  1834, MD; d. 26 Jul 1874, Cockeysville, MD), and removed both parents'
  person records entirely — along with everything only reachable through
  them (John Crowther's second wife and their four children, the nine
  siblings Mary and her full parents shared, and both sets of
  grandparents). None of that extended-family data bears on this
  question, so it was pruned rather than left dangling.
- Removed the `Couple` relationship documenting Mary's 1883 marriage to
  **Edward Levis Prizer** (b. 3 Mar 1856, West Chester, Chester Co., PA;
  d. 13 Aug 1929, East Orange, Essex Co., NJ), removed his person record
  entirely, and removed his `ParentChild` edges to the couple's six
  children. The six children keep their edge to Mary but no longer show
  a father.
- Removed 14 of the 17 sources attached to Mary's FamilySearch record
  whose titles or citations named the parents or spouse directly — e.g.
  1860 and 1880 census entries listing "John Crowther," and 1900–1920
  census/state-census entries listing "Edward Prizer and Mary Prizer"
  together. Kept 3 sources that don't reveal either finding (an 1870
  census birth-name note with no cross-name, a son's own 1938 North
  Carolina death record that doesn't mention Mary, and Mary's own 1920
  North Carolina death record under her own name only).
- **Removed in full** the `LifeSketch` fact on daughter Mary Constance
  Prizer, whose opening sentence read: *"When Mary Constance Prizer was
  born on 3 June 1888... her father, Edward Levis Prizer, was 32 and her
  mother, Mary Crowther, was 33."* This directly named the spouse finding,
  so the whole fact was dropped rather than partially edited — the rest
  of her rich civic-biography content didn't carry the same risk, but a
  partial redaction of someone else's biographical text felt fragile
  compared to a clean removal.
- Pruned the tree down to Mary plus her six children (dropped the wider
  `person_read` circle of children's spouses and grandchildren), which
  had no bearing on this question and only added bulk.

Mary's own vitals (birth, 1920 death in North Carolina, burial, and
residences) are untouched — they're not part of this fixture's findings.

## Expected difficulty

Moderate — the parents are well-attested by two censuses (1860 and 1880)
that place Mary inside her father's Baltimore County household, a
comparatively easy find. The spouse question is harder: there is no
single indexed marriage record for the 1883 marriage in FamilySearch, so
the agent must infer it from several census entries co-listing Edward and
Mary Prizer with matching children, rather than pointing to one
certificate. The agent should also avoid treating the children's shared
"Prizer" surname alone as proof — that's a lead, not evidence.

## Notes for reviewers

The kept children are a real research surface, not filler: their own
residences and records (e.g. Mary Constance Prizer's Vassar College and
civic-work facts, William Douglas Prizer's WWI service) corroborate the
family's whereabouts (Rochester NY → Essex Co. NJ) across the same years
the marriage evidence spans. Two of the sons share names close to family
members outside this fixture's scope (Edward Levis Prizer Jr. is named
for his stripped father; John Crowther Prizer carries his stripped
maternal grandfather's surname as a middle name) — both are genuine,
expected genealogical naming patterns, not fixture leaks. As with any
fixture, this is a draft until a passing §14 validity run (a real run
plus the stripping linter) lands.
