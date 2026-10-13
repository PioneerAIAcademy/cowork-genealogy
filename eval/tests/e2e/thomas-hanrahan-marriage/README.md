# Thomas Hanrahan — marriage in February 1868, Tipperary, Ireland

**Source PID:** `KHGX-XWG`
**Thomas Hanrahan is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1840 in Ireland; the tree carries an undated Death fact and an 1880 residence in Saratoga, New York. Wife Johanna Ryan (born 1845, Ireland); children Elizabeth (1869) and Thomas (1870), both given as born in New York, Mary (17 February 1871, Ireland) and John (28 November 1872, Ardfinnan, Tipperary). The couple has no marriage fact.

## Research question

> When and where did Thomas Hanrahan, born about 1840 in Ireland and living in Saratoga, New York, in 1880, marry Johanna Ryan?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `KHGX-XWG` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 14, `hint-samples.csv` row 495,
flags `adds_marriage`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Ireland, Catholic Parish Registers, 1740-1900", a marriage entry for Thomam Hanrahan and Johan Ryan on 1 February 1868, indexed to the Ballylooby (Tubbrid) marriage register, County Tipperary, which runs May 1828–July 1880.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the February 1868 Ballylooby marriage, plus a `required` finding that the report documents
the rejection.

A plausible candidate on place and timing, thin on identifiers. "Thomam" and "Johan" are the Latin register forms (accusative *Thomam*, a clipped *Joannam*) read as names, so the names match the tree's Thomas Hanrahan and Johanna Ryan exactly. The tree's own baptism sources put this couple in south Tipperary right after the marriage date: Mary in 1871 (`ark:/61903/1:1:F5GR-QBN`) and John on 28 November 1872 at Ardfinnan (`ark:/61903/1:1:F5YK-84C`), and Ardfinnan is about 5 miles from Ballylooby. A February 1868 marriage fits a first child in 1869. Neither baptism is a re-index of this entry; the tree holds no marriage source at all.

What is thin: the index carries no ages, parents, residences or witnesses, and Hanrahan and Ryan are both very common surnames in that corner of Tipperary, so a second Thomas-and-Johanna couple is a real possibility. The tree also contradicts itself — the 1880 census gives Elizabeth (1869) and Thomas (1870) as born in New York, which does not sit with a family baptising children in Tipperary in 1871 and 1872 — but that strains the census, not this marriage. The discriminating check is the matching civil marriage registration for 1 February 1868 (Catholic marriages were civilly registered from 1864): it gives both parties' ages, residences and fathers' names. Ages near 28 and 23 and a residence in the Ardfinnan–Ballylooby area would settle it; ages that miss the tree's 1840 and 1845 by a decade would make this a different couple.
