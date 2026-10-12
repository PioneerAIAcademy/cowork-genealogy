# Jantje Willems — baptism in November 1748, Groningen, Netherlands

**Source PID:** `K8C9-ZZC`
**Jantje Willems is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries only an undated Death fact for her — no birth, baptism or parents. Husband Jacob Jeltes (undated); daughters Trijntje, baptized 23 October 1774 in the city of Groningen (entered twice, as Tryntje and as Trijntje Jacobsen of the Aakerk), and Willemke, baptized 2 July 1777 at the Noorder- or Nieuwe Kerk, Groningen. The couple has no marriage fact.

## Research question

> When and where was Jantje Willems, wife of Jacob Jeltes and mother of Trijntje (baptized 1774) and Willemke (baptized 1777) in the city of Groningen, baptized, and who were her parents?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `K8C9-ZZC` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 17, `hint-samples.csv` row 591,
flags `adds_father,adds_mother,adds_christening`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Netherlands, Births and Baptisms, 1564-1910", a baptism entry for Jantjen Willemsen on 10 November 1748 in the city of Groningen, daughter of Willem Jans and Ikjen Jans; the index names no church and links no image.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the 1748 Groningen baptism and the parents Willem Jans and Ikjen Jans, plus a `required` finding that the report documents
the rejection.

A plausible candidate that rests almost entirely on the patronymic. "Willemsen" is the full form of the tree's "Willems", so a father named Willem is exactly what the name predicts, and the place is the same city where the tree's daughters were baptized. The ages fit: baptized 1748, she would be 26 at Trijntje's baptism in 1774 and 29 at Willemke's in 1777, and naming the second daughter Willemke after a maternal grandfather Willem follows the usual Groningen pattern. The tree's three sources for her are the daughters' baptisms (`ark:/61903/1:1:X1D6-VBS`, `ark:/61903/1:1:X1F6-9D3`, `ark:/61903/1:1:X1F7-QF4`); none is a re-index of this entry.

What is thin: Groningen was a city of some 20,000 people with several Reformed churches, and Jantje Willems and Willem Jans are among the commonest patronymic names in the province, so more than one Jantje Willems baptized in the 1740s is likely, and the index gives no church to narrow it. Nothing in the tree contradicts the record, but nothing beyond the patronymic and the city ties them either. The discriminating check is the Groningen marriage banns (ondertrouw) of Jacob Jeltes and Jantje Willems, about 1773–1774: city banns commonly state where the bride came from and name the parent who assisted her; a bride assisted by her father Willem Jans, or her mother Ikjen, settles it, and a different father rules this baptism out.
