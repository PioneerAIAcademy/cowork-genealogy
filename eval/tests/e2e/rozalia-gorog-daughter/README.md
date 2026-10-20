# Rozália Görög — a daughter Veronika baptised 1871 at Kiskunfélegyháza

**Source PID:** `L7KC-KQT`
**Rozália Görög is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born about 1860; died 30 October 1916 at Kecskemét. Wife of János Tarjányi (born 1861, died 1940 at Kecskemét). The tree gives them seven children, all born at Kiskunfélegyháza between 1884 and 1897: János (1884), Rozália (1887), Mária (1889), Mária (1890), János (1893), Anna (1894) and Veronika (1897).

## Research question

> Who were the children of Rozália Görög (born about 1860, died 30 October 1916 at Kecskemét) and her husband János Tarjányi of Kiskunfélegyháza, Pest-Pilis-Solt-Kiskun, Hungary?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `L7KC-KQT` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

easy — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-4.csv` row 16, `hint-samples.csv` row 471,
flags `adds_daughter`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Hungary, Catholic Church Records, 1636-1895", the 1871 Kiskunfélegyháza baptism of Veronika Tarjanyi, daughter of Janos Tarjanyi and **Rozalia Bona**. The index gives no ages or residence for the parents.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the 1871 Veronika as her daughter, plus a `required` finding that the report documents
the rejection.

Very likely a false match. The hint shares only the town, the father's common name and the mother's given name. The mother's surname is Bona, not Görög. And the subject, born about 1860, would have been about eleven in 1871; her own children start in 1884. The couple did have a daughter Veronika, but she was born in January 1897 and is already in the tree. The 1871 baptism is most likely another János Tarjányi's household in the same town, perhaps an older relative's. The settling check is the subject's own marriage entry, which the tree's Catholic sources should hold: a marriage after 1871, or an age that puts her birth near 1860, rules the hint out on dates alone.
