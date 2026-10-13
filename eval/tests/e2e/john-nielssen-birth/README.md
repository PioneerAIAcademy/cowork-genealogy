# John Nielssen — birth about 1846, Norway

**Source PID:** `KHKC-867`
**John Nielssen is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries only an undated Death fact for him — no birth. Wife Anne Thorgjusdr (Torjusdatter, undated); children Ingeborg, baptized October 1870 in Bygland, Aust-Agder (entered twice, 16 and 18 October), and Nils, baptized 6 October 1872 in Bygland. The couple has no marriage fact.

## Research question

> When and where was John Nielssen born, the husband of Anne Torjusdatter whose children Ingeborg (1870) and Nils (1872) were baptized in Bygland, Aust-Agder, Norway?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `KHKC-867` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 18, `hint-samples.csv` row 616,
flags `adds_birth`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Norway, Church Books, 1797-1958", the Bygland baptism on 17 October 1877 of Torjus (born 24 May), son of Jon Nilson, born 1846, and Anne Torjusdatter, born 1852, of Klep. The entry gives the father no birthplace, so the finding is a birth year only. The hinted person is the father, not the baptized child; the record would also add a son, Torjus, whom the tree lacks.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the 1846 birth year, plus a `required` finding that the report documents
the rejection.

A strong candidate on family context. Same parish as the tree's two baptisms, and the mother's name matches the tree's wife exactly (Anne Torjusdatter; the tree's sources spell it Thorgjusdr, Thorjusdr and Torjusdr). The naming pattern fits too: a son Nils in 1872 for a father who is Nils's son, then a son Torjus in 1877 for the mother's father Torjus. The tree's sources are the 1870 and 1872 baptisms (`ark:/61903/1:1:NCWK-B8T`, `ark:/61903/1:1:NHF2-9RV` and their re-indexes); none is a re-index of this 1877 entry, which comes from the later church-book index that records parents' birth years.

What is thin is the fact itself, not the identity: the 1846 year is a single stated age in a baptism register, with no birthplace, and nothing in the tree gives John any age to compare it with. The mother's 1852 makes her about 18 at Ingeborg's baptism, young but not implausible. The discriminating check is the 1875 Norwegian census for Bygland: a household of Jon Nilsen and Anne Torjusdatter with Ingeborg and Nils would confirm the family and give his birth year and birth parish; a census year well away from 1846 would make the baptism's figure the weaker witness.
