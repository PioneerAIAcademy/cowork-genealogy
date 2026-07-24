# Alvro Bair Taylor

**Source PID:** `KWJZ-ZNT`
**Alvro Bair Taylor is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.)

## Research question

> Whom did Alvro Bair Taylor marry, and when and where did the marriage take place?

## What was removed from the starting tree

- Removed person LFK9-HG4: Mildred Martha Misner
- Removed relationship R1 (Couple KWJZ-ZNT/LFK9-HG4): cascaded from a removed person

The starting tree therefore holds the subject plus both of his parents
(Silvester Jay Taylor and Autossie Ann Bair); the spouse and the couple
relationship — which carried the Marriage fact (25 Apr 1931, Tillamook) and
the CoupleNeverHadChildren fact — are gone.

## Expected difficulty

medium — The subject's own retained sources (the 1940 U.S. Census, the two
1940 newspaper obituaries, Find A Grave, and the Oregon death records) point
to a surviving widow, so discovering *that he had a wife* and her identity
(Mildred Martha Misner) is well supported. The harder step is recovering the
marriage *event* itself — the exact date (25 April 1931) and place
(Tillamook, Tillamook County, Oregon) — which is not in any retained source
and must be found in an Oregon county marriage record/index.

## Notes for reviewers

- Two required findings: the spouse identity (Mildred Martha Misner) and the
  marriage event (25 Apr 1931, Tillamook, Oregon). A run that adds the wife
  but never pins the marriage date/place recovers only the first.
- **Duplicate fact id in the snapshot (harmless, but worth noting).** The
  upstream/normalized snapshot carries a Birth fact id
  (`248eaba5-…`) shared across the subject and both parents, and a Death fact
  id (`9381f219-…`) shared by the subject and his father. These are distinct
  facts with different dates that happen to share an id across persons. They
  survive into `starting-tree.gedcomx.json` (the parents are retained). This
  is *per-holder* unique, so `strip` and `validate` both accept it and the
  run is unaffected — but it looks like a snapshot-normalizer quirk and may
  be worth investigating separately.
