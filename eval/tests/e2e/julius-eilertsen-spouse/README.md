# Julius Edlund Eilertsen — a 1910 union with Anne Kathrine Edvardsen

**Source PID:** `GDCS-WYY`
**Julius Edlund Eilertsen is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 24 February 1889, baptised 7 March 1889 at Steigen, Nordland; resident at Ledingen in 1900; death not recorded in the tree.

## Research question

> Did Julius Edlund Eilertsen of Leines, Steigen marry Anne Kathrine Edvardsen on 15 August 1910 — a year before the 1911 marriage to Petrine Elisabeth Edisdatter the tree records?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `GDCS-WYY` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 20, `hint-samples.csv` row 611,
flag `adds_spouse`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Norway, Church Books, 1797-1958", a 15 August 1910 entry for Julius Edmund Eilertsen (b. 1889, Leines) and Anne Kathrine Edvardsen (b. 1893, Steigen, of Leines), naming his father Eilert Johan Jensen and her father Edvard Johannessen.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Anne Kathrine Edvardsen as his wife, plus a `required` finding that the report documents
the rejection.

The identification of the man is not in doubt and the marriage is. The record's Julius Edmund Eilertsen was born 1889 at Leines with a father named Eilert Johan Jensen; the tree's Julius Edlund Eilertsen was born 24 February 1889 and baptised at Steigen, father Eilert Johan Jensen, resident in the same district. Edlund/Edmund is one letter and the rest is exact.

The conflict is the woman. The tree gives him a marriage in **1911** to **Petrine Elisabeth Edisdatter** (b. 1877) — twelve years his senior — while the hint gives a **15 August 1910** union with **Anne Kathrine Edvardsen** (b. 1893), four years his junior and living at Leines. Both cannot be first marriages a year apart unless the first ended almost immediately. The likelier readings are that the 1910 entry is the betrothal or banns for a marriage the tree has mis-recorded, or that the tree's 1911/Petrine pairing is itself wrong.

The tree is not a reliable check here: it attaches a son, Emil Knutsen born 4 July 1898, to a father born in 1889, which is impossible and shows the parent links in this cluster have not been vetted. Norwegian church books distinguish `forlovelse`, `lysning` and `vielse`, so the reviewer should read the register page and see which of the three the 1910 entry actually is before deciding.
