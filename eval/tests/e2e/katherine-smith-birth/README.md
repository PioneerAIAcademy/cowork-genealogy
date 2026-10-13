# Katherine Ganden Smith — birth in July 1831, Bermondsey, Surrey, England

**Source PID:** `GLPD-4GL`
**Katherine Ganden Smith is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries no birth, no parents and an undated Death fact. Wife of Richard Henry Cullen (christened 1828 at St Mary Magdalene, Bermondsey); children Kate Kingsnorth Cullen (born 17 April 1852) and Richard Alma Cullen (born 1854), both in Camberwell.

## Research question

> When and where was Katherine Ganden Smith, wife of Richard Henry Cullen and mother of Kate Kingsnorth Cullen (born 1852 in Camberwell, London), born, and who were her parents?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GLPD-4GL` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 9, `hint-samples.csv` row 345,
flags `adds_father,adds_mother,adds_birth,adds_christening`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "England, Births and Christenings, 1538-1975", a birth entry for Katharine Ganden Smith born 12 July 1831 at New Church Street, Bermondsey, Surrey, daughter of James Smith and Mary Ann Hunt, with Mary Ann's father indexed as Philip Hunt.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the July 1831 birth and the parents James Smith and Mary Ann Hunt, plus a `required` finding that the report documents
the rejection.

A strong candidate on the name alone. "Ganden" is a rare middle name, and the tree's only source for her, the 1851 marriage index entry (`ark:/61903/1:1:2D3B-P9Q`), spells her exactly as this entry does, Katharine Ganden Smith; a July 1831 birth makes her about 20 at that marriage and 20 at Kate's birth in April 1852. The place fits too: her husband was christened in Bermondsey in 1828 and their children were born next door in Camberwell. That marriage index is the only record the tree cites for her, so nothing here is a re-index of this birth.

What is thin is the parentage: James Smith and Mary Ann Hunt are common names, and the tree has no parents to test them against. The `adds_christening` flag is a template artefact: the index carries a Christening fact with no date and only "England" as its place, so nobody should add a christening from it; the "0891" before the street in the indexed birthplace looks like an entry or house number, not a place. A street address, a birth date and the mother's father named is the shape of a nonconformist birth registry (Dr Williams's Library style), which is worth confirming on the image. The discriminating check is the 1851 marriage certificate behind the tree's index entry: it names the bride's father. James Smith would settle the parentage; a different father would leave the birth plausible on the name but break the parents.
