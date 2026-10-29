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

**False match. Resolved from the index alone; no image read was needed.**

The hint record (`ark:/61903/1:1:XZ1Y-W4K`) is an 1871 Kiskunfélegyháza
Catholic baptism of Veronika Tarjányi from "Hungary, Catholic Church Records,
1636-1895." The index names the mother as **Rozalia Bona** — a different
surname from Görög — and the father as Janos Tarjanyi.

Two independent grounds rule this out:

1. **Different surname.** The mother's surname in the record is Bona, not
   Görög. FamilySearch's hint engine matched on the shared town, the common
   father's name, and the mother's given name (Rozália), but the surname
   mismatch identifies a different woman. This alone is sufficient to reject
   the match.

2. **Impossible dates.** Rozália Görög was born about 1860; in 1871 she would
   have been approximately eleven years old — far too young to be a mother.
   The couple's own children begin in 1884. The tree already holds their
   daughter Veronika, born January 1897 (PID PQ6N-SP8), and she is the only
   Veronika in this family.

The 1871 baptism belongs to a different Tarjányi household in the same town —
likely an older relative's — and no substitute record for an earlier Veronika
was sought, because the research question asks about the children of Rozália
Görög and János Tarjányi, and the existing tree already documents their full
family. The hint record's `ark:/61903/1:1:XZ1Y-W4K` is the disproving record;
retrieval was by index only (familysearch.org).
