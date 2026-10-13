# Nancy Davis — marriage in May 1868, Newton County, Missouri

**Source PID:** `LJK2-JBH`
**Nancy Davis is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1837 in Bradley County, Tennessee; the tree carries an undated Death fact. Living in Neosho, Newton County, Missouri in 1850. The tree gives her a husband, William James Brewer (born 1 January 1844, Waynesboro, Tennessee; died 3 March 1925, Dallas, Texas), with no marriage fact, and two daughters, Mary (1858) and Sarah (1860) Moreland, both born in Tennessee.

## Research question

> When and where did Nancy Davis, born about 1837 in Bradley County, Tennessee, and living in Neosho, Newton County, Missouri in 1850, marry William James Brewer?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `LJK2-JBH` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 27, `hint-samples.csv` row 896,
flag `adds_marriage`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Missouri, Marriages, 1750-1920", a marriage entry for William Bremer and Nancy Angeline Davis on 12 May 1868 in Newton County, Missouri.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the May 1868 Newton County marriage, plus a `required` finding that the report documents
the rejection.

A true match to the husband, and a conflict over which Nancy the tree person is. "Bremer" is a misreading of Brewer, and the tree's William James Brewer already cites two indexes of this same 1868 marriage: the groom's persona in "Missouri, Marriages, 1750-1920" (`ark:/61903/1:1:V28T-J7R`) and an entry in "Missouri, County Marriage, Naturalization, and Court Records, 1800-1991" (`ark:/61903/1:1:6XNV-J1Z3`). His 1870 census (`ark:/61903/1:1:MXLB-P95`, Hood, Cooke County, Texas) and 1900 census (`ark:/61903/1:1:M3L5-BTV`, Eastland County, Texas, married 32 years) both show a wife Nancy A., so the bride Nancy Angeline Davis is certainly Brewer's wife. Nancy herself cites none of this; the couple carries no marriage fact.

The problem is that the tree's Nancy looks like two women. Her only own source is the 1850 census (`ark:/61903/1:1:MDZF-Q7C`, household of Thomas J. and Elizabeth Davis at Neosho, Newton County), which gives a Nancy born about 1837 in Tennessee, and that is where the tree's 1837 Bradley County birth comes from. Brewer's wife Nancy A. is born about 1853 in Missouri in 1870 and May 1853 in Missouri in 1900, so she could not be in that 1850 household. The Moreland daughters born in Tennessee in 1858 and 1860 fit neither a bride of 1868 born in 1853 nor the Brewer household. The marriage in Newton County, where the 1837 Nancy lived, is the only thing tying the two together. Accepting the hint is right if LJK2-JBH is Brewer's wife; it is wrong for the 1837 daughter of Thomas J. Davis. The discriminating check is the bride's age or parents on the 1868 Newton County marriage register page: a bride of about 15 belongs with Brewer and means the 1850 census and the Tennessee birth should come off this person, while a bride of about 31 would make her the 1837 Nancy and leave the census birthplaces unexplained.
