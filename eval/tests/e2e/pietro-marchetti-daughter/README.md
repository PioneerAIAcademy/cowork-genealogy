# Pietro Marchetti — a daughter, Giuseppa, born 1884 at Maglianello, who died in 1913 at Rieti, Italy

**Source PID:** `G9WN-C79`
**Pietro Marchetti is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1848 at Rieti and died there on 10 July 1923. He was the son of Francesco Marchetti and Marianna Rosati. He married Maria Aquilini (born 1851, died at Rieti on 20 January 1929) at Rieti in 1876. The tree gives them one child, Domenica, born 1878, whose 1902 Rieti marriage register page is attached.

## Research question

> What children did Pietro Marchetti (born 1848) and Maria Aquilini of Rieti, Lazio, Italy, married in 1876, have besides their daughter Domenica (born 1878)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `G9WN-C79` with relatives). Nothing was
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
(`filtered-list-samples-4.csv` row 18, `hint-samples.csv` row 525,
flags `adds_daughter`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Italy, Rieti, Civil Registration (State Archive), 1840-1945". It is the 1913 death registration of Giuseppa Marchetti, who died at Rieti on 15 June 1913 and was born in 1884 at Maglianello. It names her father only as "Pietro", with no surname, and her mother as Maria Aquilini. Retrieval was tool-assisted (`dev/try-record-read.ts`).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Giuseppa as his daughter, plus a `required` finding that the report documents
the rejection.

A strong candidate. Both parents' given names and the mother's maiden surname match exactly, and the city matches: Maglianello is a frazione of Rieti. A daughter born in 1884 fits a couple married in 1876 whose first child came in 1878. The tree's own sources are the couple's deaths (1923 and 1929) and Domenica's 1902 marriage. None is a 1913 death or names a Giuseppa, so this is not a re-index of anything already attached.

The gap is that the index gives the father no surname. "Pietro" with a wife named Maria Aquilini is a narrow pair, but Rieti is a city, and a second Pietro married to a second Maria Aquilini cannot be excluded from the index. The discriminating check is Giuseppa's 1884 birth registration at Rieti, which the death entry's birth year points to. If it names the father as Pietro Marchetti, son of Francesco, the match is settled. A different paternal grandfather, or no birth registration in Rieti at all, would point to another family.
