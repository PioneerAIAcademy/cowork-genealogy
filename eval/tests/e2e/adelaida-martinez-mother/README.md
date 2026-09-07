# Adelaida Martinez — a mother named Dolores Bilares

**Source PID:** `GRS9-MCH`
**Adelaida Martinez is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 25 December 1871 and christened 11 February 1872 at Dolores, Soriano, Uruguay; death not recorded in the tree.

## Research question

> Was Adelaida (Adela) Martínez, wife of Rufino Moreira of Dolores, Soriano, the daughter of Juan Martínez and Dolores Bilares, or of Juan Martínez and Josefa Segovia as the tree records?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `GRS9-MCH` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-2.csv` row 29, `hint-samples.csv` row 938,
flag `adds_mother`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Uruguay, registro civil, 1879-2020", an entry dated 17 June 1879 for Rufino Moreira and Adela Martínez, naming his parents as Fortunato Morera and Francisca Cuez and hers as Juan Martínez and Dolores Bilares.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Dolores Bilares as her mother, plus a `required` finding that the report documents
the rejection.

Start with the date, because it does not work. The entry is dated **17 June 1879**, but the subject was born on 25 December 1871 and married Rufino Moreira Cruz on **9 April 1896**. She was seven years old in 1879. So whatever this record is, it is not the marriage of this couple, and a reviewer who treats it as one will get the parentage question wrong for the right-sounding reason. Read the register page and establish the record type first — a civil-registration entry naming a couple and both sets of parents can be a marriage, a legitimation, or a birth registration of a child, and the date belongs to the event, not to the couple.

The parentage question sits behind that. The father agrees — **Juan Martínez** on both sides — while the mother does not: the tree says **Josefa Segovia**, married to Juan Martínez on 26 December 1866 at Dolores, and the hint says **Dolores Bilares**. If the record turns out to concern a different Adela Martínez, that disagreement evaporates.

The tree is a strong document here, which is what makes the fixture worth running: **19 sources** across Uruguayan civil registration, parish registers and Argentine records, including "Adela Martinez in entry for Rufino Moreyra, Uruguay, Marriages, 1840-1900" — quite possibly this very record under another index. Check that first. Note also that the subject appears throughout as both Adelaida and Adela Natividad, so name-form variance is normal for her and is not evidence either way.
