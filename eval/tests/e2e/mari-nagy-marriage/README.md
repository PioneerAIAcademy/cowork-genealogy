# Mári Nagy — marriage in January 1875, Egyházasrádóc, Vas, Hungary

**Source PID:** `G549-JNM`
**Mári Nagy is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries an undated Death fact and no birth. Wife of János Szőke (no dates); mother of István (1881), Terézia (1884), Julianna (1886), Ferenc (1889) and Anna (1891) Szőke, plus Szidonía and a second Anna with no dates. The tree records no places and cites no sources for anyone in the family.

## Research question

> When and where did Mári Nagy marry János Szőke, the father of her children István (born 1881), Terézia (1884), Julianna (1886), Ferenc (1889) and Anna (1891) Szőke?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `G549-JNM` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-3.csv` row 28, `hint-samples.csv` row 922,
flags `adds_birth,adds_marriage`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Hungary, Church Books, 1624-1950", a marriage entry for Szöke János (born 1847) and Nagy Mária (born 1858) on 17 January 1875 in Egyházasrádóc, Vas County, Hungary; the register image is the Egyházasrádóc marriage register, 1850–1895.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the January 1875 Egyházasrádóc marriage, plus a `required` finding that the report documents
the rejection.

The batch CSV lists this row's country as "Unknown" because the tree records no places at all; the hint record's jurisdiction is Egyházasrádóc, Vas County, Hungary, and the fixture is tagged `HU` to that.

A weak candidate: the names agree and nothing else can be compared. Mári is the diminutive of Mária and Szöke is Szőke without the double acute, so the couple's names match the tree exactly, and a 17-year-old bride in 1875 could be the mother of children born 1881–1891 (the six-year gap before István would be filled by the undated Szidonía or Anna, or by children the tree lacks). The `adds_birth` year 1858 is an age-derived estimate, not a birth record. But Nagy is the commonest surname in Hungary and Szőke is common too, so a János Szőke–Mária Nagy marriage could turn up in many parishes; the tree gives no place, no dates for the parents and no sources, so nothing in it ties the family to Vas County or rules out another couple. No tree source can be a re-index of this entry, because the tree has none.

The discriminating check is a baptism of one of the dated children, István (1881) or Terézia (1884), in the Egyházasrádóc registers or a neighbouring Vas parish, naming parents Szőke János and Nagy Mária. That would place the tree's family in the parish where this marriage was recorded; a baptism elsewhere, with other parents' details, would make this a different couple.
