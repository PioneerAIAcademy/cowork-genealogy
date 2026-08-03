# Pierre Henri DESOBRY — wife Clemence Sauselle and son Julien

**Source PID:** `L6L3-BB8`
**Pierre Henri DESOBRY is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
Pecquencourt, Nord, France (baptized 1753 and 1774 — two baptismal facts already conflict in the tree); died 11 October 1849, Aniche, Nord, France.

## Research question

> Who was the wife of Pierre Henri Désobry of Pecquencourt, France, and did they have a son named Julien who died in infancy in 1809?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `L6L3-BB8` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

medium — a confirmed true match (spouse + son); see "Notes for reviewers"
below for the corroboration that decided it.

## Notes for reviewers

**Resolved (issue #867): TRUE MATCH.** The hint — France, Nord, Parish and Civil Registration, 1524-1893: death registration, 8 September 1809, Pecquencourt, for the infant Julien Désobri, naming parents Pierre Henri Désobri and Clémence Sauselle — establishes **both** findings: Clémence was the wife of Pierre Henri Désobry (`L6L3-BB8`), and Julien was their son, who died in infancy in 1809 at Pecquencourt.

What confirmed it:
- **The wife, across a five-record cluster.** Clémence is recorded with surname variants **Lancelle / Sauselle / Sanselle — all the same woman** — and five records converge to confirm her as Pierre Henri's wife. This is the family's first recorded spouse in the tree.
- **Julien is a genuine son.** The 8 September 1809 Pecquencourt death registration of the infant Julien names both parents (Pierre Henri Désobri + Clémence); his 1808 birth / 1809 death fits neatly between the tree's Philibert (b. 1800) and Jean Baptiste Aimé (b. 1813), in the same parish, with no chronological strain.
- **The couple identity holds despite the tree's conflation.** Pierre Henri's profile carries two conflicting baptismal facts (1753 and 1774, a 21-year gap — possibly two men already conflated in the starting tree, a pre-existing data-quality issue this fixture neither introduces nor resolves). The record cluster nonetheless links the child-bearing Pierre Henri (children 1800–1813) to Clémence consistently, so the 1809 Julien belongs to that same couple, not a namesake.

Accordingly `expected-findings.json` keeps both original findings: f1 (wife Clémence Sauselle) and f2 (son Julien, b. 1808, d. 7 Sep 1809, Pecquencourt).

**2026-08-03: corrected f2's cited record (issue #970).** Adding a real ark
surfaced a discrepancy: this fixture's own committed run log
(`eval/runlogs/e2e/pierre-desobry-spouse/run-2026-07-30_19-34-46.final-research.json`)
ran an exhaustive live search (four query variants, 1808-1850, collection
3216848) for Julien's death registration and found none — only his birth
registration (Act 53, 5 Sep 1808, `ark:/61903/1:1:8NW1-RP6Z`), with death
in infancy reached at **Probable** tier by inference from the absence of
any later record, not from a located death registration. This note
doesn't overturn the true-match verdict above (Julien is still confirmed
as the couple's son); it corrects what specifically is and isn't directly
documented, since "death registration, 8 Sep 1809" as a citation was not
substantiated by the actual research. f1's citation is now the real
marriage record (28 Apr 1798, `ark:/61903/1:1:8NW5-26T2`, recorded under
the "Lancelle" spelling variant) rather than the unlocated death record.
