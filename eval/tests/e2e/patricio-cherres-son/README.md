# Hermenejildo Patricio Cherres — a son, Julio César, who died in 1908 at San Pedro, Guanujo, Ecuador

**Source PID:** `KZ39-T1R`
**Hermenejildo Patricio Cherres is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries an undated Death fact and no birth. Husband of Nicolasa Gavilanes (also indexed Gabilanes; christened 6 December 1865 at San Pedro, Guanujo). Three daughters in the tree: Manuela (born 25 June 1889, christened at San Pedro, Guanujo), Zoila Rosa (born 5 June 1901, christened at Guanujo) and Rosario (born at Guaranda, undated). No son is attached.

## Research question

> What children did Hermenejildo Patricio Cherres and his wife Nicolasa Gavilanes, of San Pedro, Guanujo, Bolívar, Ecuador, have besides their daughters Manuela (born 1889), Zoila Rosa (born 1901) and Rosario?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `KZ39-T1R` with relatives). Nothing was
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

**Resolved: true match.** Patricio Cherres and Nicolasa Gavilanes did have a
son, Julio César Cherres, who died in infancy on 17 May 1908 and was buried
at San Pedro de Guanujo. Retrieval was by hand on familysearch.org (the index
page, then the original register image); the identity judgement is the
genealogist's.

The index auto-standardizes the event place to San Pedro, Córdoba, Bolívar,
**Colombia** — wrong, a place-matching error (Colombia's Bolívar department
also contains a Córdoba municipality, so the algorithm matched a real but
unrelated place). The original register image settles it: entry 63 reads
"Julio Cesar... hijo legítimo de Patricio Cherres y Nicolaza Gavilanes,"
naming the parish as **San Pedro de Guanujo** directly, in the priest's own
hand. Every other record already attached to this family (Nicolasa's own
1865 christening, Manuela's 1889 christening, Zoila Rosa's 1901 christening,
Rosario's children's 1909–1917 records, Zoila Rosa's 1925 marriage) places
the family continuously in Guanujo/Guaranda, Ecuador across six decades with
no gap — there is no plausible scenario where this family traveled to
coastal Colombia, a different country roughly 1,000 km away, for one birth.

This image reading is licensed: two other entries on the same page were
checked against FamilySearch's own index for them. Entry 54 (Andrés
Calunia/Caluña) matched the index's death date (30 Apr 1908) exactly, and
entry 55 (Jasinto Carabajal/Carvajal) matched the index on mother (Teodora)
and date (30 Apr 1908) exactly. A third entry, 56 (José Salazar), matched
the index's mother and age but not the month (index: 5 Mar 1908; page: 5 May
1908) — a plausible index transcription error (Mayo/Marzo), since 5 May fits
the register's own chronological order between entries 54 and 63 while 5
March would not.

The same page also holds entry 61 (13 May 1908): "Maria Victoria, hija
lejitima de Patricio Cherres y Nicolasa Gavilanes," died at seven months,
also from Caspino — Julio César's own sister, buried four days before him,
not a different family. The index (ark:/61903/1:1:8HQ2-1DW2) mis-records
her mother as "Victoria Gavilanes," an indexing error that copied the
child's own given name into the mother field rather than naming a second
wife. Her baptism on 5 Oct 1907 at Guaranda names the same parents
(ark:/61903/1:1:D4KR-P1PZ); a death at seven months fits an October 1907
birth.
Two children of the same couple, from the same hamlet, buried within four
days of each other on the same register page strengthens the
identification rather than threatening it.

Father's and mother's names both match (the usual b/v spelling drift:
Gavianes/Gavilanes/Gabilanes), and the age at death (2 years) is consistent
with the index's estimated 1906 birth year, fitting chronologically after
Zoila Rosa (1901).

One incidental note: the father's FamilySearch PID appears to have changed
since this fixture was captured — `fixture.json`'s `source_pid` (`KZ39-T1R`)
and the live tree now show the same family (same wife and four children)
under father PID `L563-PYG`, almost certainly a tree merge of duplicate
profiles. This doesn't affect the research conclusion.

The couple's-generation gap that would have left this borderline — a son
named Patricio who also married a Gavilanes woman could produce an
identical index line — is closed by the primary record, not left open:
entry 63 itself names the mother as Nicolaza/Nicolasa Gavilanes, the
subject's actual wife, and entry 61's María Victoria, baptized 5 Oct 1907
as the couple's daughter (ark:/61903/1:1:D4KR-P1PZ), appears on the same
page four days apart, placing both entries squarely within this specific
couple's family rather than a hypothetical namesake generation.
