# Wendel Weichel — mother Josefine, in the 1926 Saskatchewan census household

**Source PID:** `G8Q5-BJ1`
**Wendel Weichel is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1912; died 1980, buried at Odessa, Saskatchewan.

## Research question

> Who were the parents of Wendel Weichel (b. 1912, d. 1980, Odessa, Saskatchewan) — in particular his mother, whom the tree does not name?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `G8Q5-BJ1` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 4, `hint-samples.csv` row 155,
flag `adds_mother`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Canada, Prairie Provinces, Census, 1926", the Weyburn No. 67, Saskatchewan household of Jacob Weishel (b. 1890, Russia) and Josefine Weishel (b. 1892, Russia), immigrated 1924, whose children include Windelin Weichel (b. 1913, Russia), Peter (1919, Russia), Augina (1922, Germany), Katherina (1923, Germany) and Barbara (1925, Saskatchewan).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Josefine Weishel as his mother, plus a `required` finding that the report documents
the rejection.

Strong, and corroborated from inside the tree. The census household is Russian-born, German-surnamed and immigrated in 1924 — the same profile as the subject, whose own obituary source is the Germans-from-Russia (AHSGR) collection. "Windelin" is the full form of "Wendel", and the census's 1913 against the tree's 1912 is ordinary census slop. The decisive detail is on the tree side: it already records his wife **Rosa K Deis** with a 1926 residence in **Weyburn No. 67**, the identical census subdistrict as the hinted household.

Two things for the reviewer to settle. The tree names a father only as an unnamed placeholder "Weichel" (GX6M-5HT), so decide whether the census's Jacob fills that placeholder or competes with it. And the index spells the parents Weishel while spelling every child Weichel inside the one household — check the enumerator's hand on the image rather than accepting the split as real.
