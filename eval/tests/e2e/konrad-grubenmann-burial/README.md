# Konrad Grubenmann — burial in March 1787, Teufen, Appenzell Ausserrhoden, Switzerland

**Source PID:** `KP47-72Q`
**Konrad Grubenmann is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 21 August 1698 in Teufen, Appenzell; the tree carries a Death fact of 17 March 1787 with no place and no source. Married Barbara Oberteufer on 19 April 1724; she died 18 February 1742. Their children were born 1727–1740 in Stein, Appenzell, and baptized at Hundwil.

## Research question

> When and where was Konrad Grubenmann, born 21 August 1698 in Teufen, Appenzell, who married Barbara Oberteufer in 1724, buried?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `KP47-72Q` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 26, `hint-samples.csv` row 882,
flags `adds_spouse,adds_burial`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Schweiz, Katholische und Reformiert Kirchenbücher, 1418-1996", a burial entry for Conrad Grubenmann (born 1699) buried 17 March 1787 in Teufen, Appenzell Ausserrhoden, with Anna Reff as his wife; the register image is the Teufen death register, 1782–1829.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the March 1787 Teufen burial, plus a `required` finding that the report documents
the rejection.

A strong candidate on the date, weaker on the family. The burial date is exactly the tree's unsourced death date, 17 March 1787, and Appenzell Reformed registers of this period often record the burial rather than the death, so the tree's date was probably taken from this register, if not from this entry. The indexed birth year 1699 is an age-derived estimate and fits a man born August 1698 who died aged 88, and Teufen is the tree's birthplace. The tree's own sources for Konrad are two of his children's baptisms (Jacob 1728, `ark:/61903/1:1:66JR-3LFG`; Ulrich 1734, `ark:/61903/1:1:66V4-B623`); neither is a re-index of this burial.

What is thin is the wife. The tree knows only Barbara Oberteufer, who died in 1742, and the family lived in Stein, not Teufen, while the children were born. Anna Reff would have to be a second wife married after 1742, which the tree does not record; the `adds_spouse` flag is a real claim, not an indexing artefact, and Grubenmann is a dense Teufen surname, so a second Conrad of similar age cannot be ruled out from the index alone. The discriminating check is the register image linked from the hint record: Ausserrhoden burial entries of the 1780s often give the exact birth date or the age in years, months and days, and a birth date of 21 August 1698 (an age of 88 years 6–7 months) would settle it; a different birth date would make this another Conrad.
