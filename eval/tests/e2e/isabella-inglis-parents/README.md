# Isabella Inglis — parents Thomas Inglis and Jane Borthwick, and an 1867 Edinburgh marriage

**Source PID:** `KHL9-LKF`
**Isabella Inglis is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; wife of David Young, with two daughters born at Edinburgh in 1868 and 1870.

## Research question

> Who were the parents of Isabella Inglis, wife of David Young of Edinburgh, and when did the couple marry?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `KHL9-LKF` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 26, `hint-samples.csv` row 782,
flag `adds_father,adds_mother,adds_birth,adds_marriage`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Scotland, Civil Registration, 1855-1875, 1881, 1891", a marriage entry of 25 December 1867 for David Young (b. 1842, son of William Young and Agnes Inglis) and Isabella Inglis (b. 1844, daughter of Thomas Inglis and Jane Borthwick Inglis).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Thomas Inglis and Jane Borthwick as her parents, plus a `required` finding that the report documents
the rejection.

The strongest parents candidate in the batch, and the corroboration comes from inside the tree rather than from the hint. The couple's two daughters are **Jane Inglis Young** (b. 19 October 1868) and **Agnes Young** (b. 6 September 1870). The hint names the bride's mother as **Jane Borthwick Inglis** and the groom's mother as **Agnes Inglis**. Under the Scottish naming pattern the first daughter takes the maternal grandmother's name and the second the paternal grandmother's — which is exactly what the tree shows, in exactly that order, and the tree's daughters were entered from their own baptismal records without anyone knowing the grandmothers' names.

The chronology agrees too: a marriage on 25 December 1867 — Christmas Day weddings being ordinary in Scotland, where the day was a working one — puts the first birth just under ten months later.

One thing to note rather than resolve: both mothers are Inglises (the groom's mother Agnes Inglis, the bride Isabella Inglis), so bride and groom may have been cousins. That is common enough in Edinburgh parish society to be unremarkable, but it does mean surname matching alone proves less here than usual, and the statutory register entry itself — with ages, addresses and fathers' occupations — is what settles it.
