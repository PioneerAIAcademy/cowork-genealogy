# Jens Nielsen

**Source PID:** `KWVQ-475`
**Jens Nielsen is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.)

## Research question

> Jens Nielsen emigrated from Denmark and settled in Ephraim, Sanpete
> County, Utah, where in 1858 he married Ane Kjerstine Sorensdatter.
> Family tradition (recorded by a daughter) holds that he had married
> earlier in Denmark and that his first wife died there before he
> emigrated. Identify Jens's first wife and their marriage (date and
> place).

## What was removed from the starting tree

- Removed person K18B-KT8: Dorthe Kirstine Jensen
- Removed relationship R1 (Couple KWVQ-475/K18B-KT8): cascaded from a removed person
- Removed relationship R8 (ParentChild K18B-KT8/K1D9-K4F): cascaded from a removed person
- Removed relationship R10 (ParentChild K18B-KT8/K1D9-KK3): cascaded from a removed person

The stripped answer is the first wife (Dorthe Kirstine Jensen) and the
5 January 1849 marriage at Lyngs, which lived on the removed Couple
relationship R1. Both of the couple's Danish-born children are **left
in place** as legitimate research anchors — after the strip they are
linked only to their father Jens:

- K1D9-K4F Karen Marie Jensen (b. 1 Sep 1846, Lyngs — an infant who died
  the same month)
- K1D9-KK3 Ane Cathrine Jensen (b. 29 Nov 1850, Lyngs)

Neither child record, nor Jens's own retained "1850 Census / Lyngs"
residence, nor the daughter's LifeSketch, names the first wife or gives
the marriage date — they only point the researcher toward Lyngs and
toward the existence of an earlier Danish family.

## Expected difficulty

hard — The answer lives entirely on the pre-emigration **Danish** side.
The first wife died in Denmark in 1852 and never emigrated, so she is
absent from every US record (1880 census, Utah death certificates, Find
A Grave, Ephraim cemetery, LDS membership) that dominates this heavily
documented Utah pioneer's sources. Recovering her requires Danish-
language parish and census records for Lyngs, Thisted, and navigating
patronymic naming — Jens's Danish children are surnamed *Jensen* while
his Utah children are *Nielson/Nielsen*.

## Notes for reviewers

- **Chronology tension to expect.** The retained anchor child Karen
  Marie Jensen was born (and died) in 1846, *before* the recovered
  5 Jan 1849 marriage; the FamilySearch tree links her to both Jens and
  Dorthe regardless. The cleanly post-marriage child (Ane Cathrine, b.
  1850) is used in the bonus finding f3. A run that flags or reasons
  about the 1846-vs-1849 tension is behaving correctly, not failing.
- **LifeSketch is a soft, partly-garbled clue.** Jens's retained
  LifeSketch (written by daughter Ane Kjerstine in 1945) says he "was
  married and his wife died when his baby son was born" and that the
  baby died at sea — details that do not match the tree (the first
  wife's children were daughters, and she died in 1852). Treat it as
  authentic starting context that motivates the search, not as evidence
  of the answer.
- **Findings.** f1 (first wife = Dorthe Kirstine Jensen) and f2
  (marriage 5 Jan 1849, Lyngs) are required; f3 (Dorthe as mother of the
  retained daughter Ane Cathrine) is a bonus corroboration finding.
- **Authoring note (data fix).** Two lowercase LDS custom fact types
  (`baptism`/`blessing`) in the raw snapshot were capitalized to
  `Baptism`/`Blessing` so the tree passes the `^[A-Z]` schema pattern;
  they are not in the harness's recommended-types map, so the normalizer
  passed them through unchanged. No other tree content was altered. The
  cross-holder duplicate fact-id warnings the snapshot printed are
  benign — `strip` only refuses *within-holder* duplicates, of which
  there are none.
