# Pierre Albert Tullier — additional son Pierre Jacques Dominique (b. 1799)

**Source PID:** `GPX7-28P`
**Pierre Albert Tullier is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
4 March 1777, Stavele, Alveringem, West Flanders, Belgium; died 11 March 1846, Bambecque, Nord, France.

## Research question

> Did Pierre Albert Tullier and his wife Constance Dorothé Leys have a son, Pierre Jacques Dominique, born about 1799, in addition to the children recorded to them in Bambecque from 1801 onward?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `GPX7-28P` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

hard: the hint's index gives the wrong birth year (1796), so the agent has
to read past it to the 1799 Houtkerque birth and tie that to the couple.
See "Notes for reviewers" below.

## Notes for reviewers

**Resolved (issue #4445): TRUE MATCH, corrected birth year.** This replaces
the issue #856 "FALSE MATCH" verdict. The hint is the 21 June 1825 Bambecque
marriage of Pierre Jacques Dominique Tuilier and Anne Constance Victoire
Depuydt (France, Nord, Parish and Civil Registration, 1524-1893). The hint
persona `ark:/61903/1:1:8NJR-PD3Z` is the groom's **father**, "Pierre
Tuilier", and he is the subject: the groom is a son of Pierre Albert Tullier
and Constance Dorothé Leys, born 1 Nov 1799, registered 2 Nov, at Houtkerque. The index's
"b. 1796" for the groom is wrong.

What decided it:
- **The 1796 is an index error.** The index derives the groom's birth from an
  age, giving 1795-1796. The act (image `ark:/61903/3:1:3Q9M-C3WK-635R-H`)
  reads "agé de vingt cinq ans né à houtkercke le dix brumaire an huit"
  (1 Nov 1799) for the groom. The bride is "agée de vingt neuf ans", born
  19 Germinal an IV (1796), so the indexer gave the groom the bride's age. The
  same reading came back on two separate OCR passes. Independently of the
  image, the groom's own death at Bambecque on 8 Sep 1877
  (`ark:/61903/1:1:8NJL-KK3Z`, spouse Constance Victoire Depuydt, parents
  Pierre Tuilier and Constance Ley) gives an age-derived birth of 1798-1799.
  #856's "predates their marriage by four years" argument rested on the
  1796, so it falls with it.
- **The 1799 Houtkerque birth fits.** Pierre Jacques Dominique Tuiller was born
  1 Nov 1799, registered 2 Nov, at Houtkerque, son of Pierre Tuiller (`ark:/61903/1:1:DPJ5-4QW2`;
  mother indexed "Constance Coley"). The given names match the 1825 groom
  exactly, and so do the place and the date. The
  index's 2 Nov is the registration date (11 Brumaire an VIII), not the birth.
- **Only one Pierre Tuilier × Constance Ley couple exists.** Searches of the
  Nord collection (3216848) on Tuilier with a Constance and Ley spouse or
  mother, 1795-1805 and later, return one couple: Pierre Albert Tuilier and
  Constance Dorothé Ley. They married at Bambecque in the parish on
  12 Mar 1800 (`ark:/61903/1:1:8NJ5-TT2M`) and had children there from 1801.
  In 1825 the groom's parents were both "encore vivant(s)", which fits:
  Constance Dorothé died in 1831 and Pierre Albert in 1846. The "bare names"
  argument from #856 does not hold either. Her own children's records index
  her as Constance Dorothé, Constance Reine and Reine Constance, so the
  wording varies within this one couple.
- **The couple lived at Houtkerque at the time.** The 12 Mar 1800 parish
  marriage (image `ark:/61903/3:1:3Q9M-C3WK-8S3W-Y`) reads "pierre albert
  tulier ... natif de staetel" and "Custance Dorothée Ley ... native de
  bambeque", "tous deux domiciliés sur la paroisse d'Houtkerke". That is four
  months after the Houtkerque birth.

The four questions issue #4445 posed:
1. *Where does the groom's 1796 come from?* The index took the bride's age;
   see above.
2. *Is there another Pierre Tuilier native of Stavele with a Constance
   Ley(s)?* None was found in collection 3216848.
3. *Does the 24 Sep 1800 civil marriage legitimate a child?* No. The act is
   in browse-only film 008004587, sub-volume `008004587_005_M9M1-RBK`, images
   `008004587_00946`-`00947` (2 Vendémiaire an IX). It names Pierre Albert
   Tuilier, born at Stavele, son of the late Jacques and Anne Thérèse de Vloo,
   and Constance Dorothée Ley, born at Bambecque, and carries no legitimation
   or recognition clause. The 12 Mar 1800 parish marriage has none either. The
   1799 birth act already calls the child "du légitime mariage", so its
   parents declared themselves married before either act on file.
4. *Is Marguerite Leys a documented sister?* No. The indexed daughters of
   Jacques Ignace Ley and Rosalie Joseph Lejeune are Constance Dorothée,
   Isabelle Thérèse Cornille, Rose Reine and Jeanne Rosalie (died at
   Houtkerque in 1836). A fresh transcription of the 1799 page reads the
   witness as "Regina Ley ... propre tante a matre", not Marguerite, which
   would fit Rose Reine. That reading failed the licence check below, so it is
   not relied on. The call does not depend on question 4.

**Image readings and the licence check.** All the image readings were made
with `image_transcribe`, and none is licensed:
- **1825 marriage page.** The only other entry is the Barbe Constance Verriele
  birth of 22 Jun 1825 (`ark:/61903/1:1:8NJ1-JB6Z`). It matches the index on
  child, father, mother and date, but it is fewer than the two entries the
  check needs.
- **12 Mar 1800 parish page.** The only other entry is the Dervo-Salomé
  marriage of 6 Apr 1800 (`ark:/61903/1:1:8NJ5-2Z3Z`). It matches, but again
  it is one entry.
- **1799 Houtkerque page.** The Pinte birth (`ark:/61903/1:1:DPJ5-4QN2`)
  differs from the index on the mother's surname: transcribed "baeye",
  indexed "Breye". So that transcription is discarded, including the earlier
  run's "Marguerite Leys" and "Constance ley".
- **Civil-marriage film.** It is unindexed, so nothing on it can be checked.

The finding therefore stands on the index alone. The index has the groom's
death-age birth year of 1798-1799, the 1 Nov 1799 Houtkerque birth (registered 2 Nov) with
matching given names, and one candidate couple. The images agree with that
index case. `image_basis` is set because the image arks are cited and the
readings were used, not because they were needed.

**How this was done.** Retrieval was tool-assisted: `record_read`,
`record_search`, `volume_search`/`volume_bisect`/`image_search` and
`image_transcribe`, run on 2026-11-12. Isaac (Paaboat) read the evidence and
made the identity call. Issue #4445 asks for a second genealogist's opinion
before this is relied on. EdmondOware reviewed this on 2026-11-13, re-read the
records live, and confirmed the call.

`expected-findings.json` is one required finding: the couple had a son Pierre
Jacques Dominique, born 1 Nov 1799, registered 2 Nov, at Houtkerque. The #856 avoid guard and
its documented-negative finding were removed, because they penalised the
correct answer.
