# William W Sloan — a wife named Maria on an 1891 Toronto marriage of a son Thomas John Sloane

**Source PID:** `LHG6-L26`
**William W Sloan is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 22 July 1832 in Ontario, son of Thomas Sloan and Margaret Williamson, who came from Scotland; died 25 December 1921 in Toronto and buried at Blyth Union Cemetery, Huron County. The tree carries a Deceased Physician File (AMA) source. His wife in the tree is Agnes McCaa (born 1839). Their children include a Thomas (born 1859, died 1861), Andrew McCaa (1860), Thomas (1865), Alice Grace (1865), William W (1869) and Henry Cole (1876), all born in Huron County.

## Research question

> Besides Agnes McCaa, did William W Sloan (born 22 July 1832 in Ontario, died 25 December 1921 in Toronto, buried at Blyth, Huron County) have another wife, and if so, who was she?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `LHG6-L26` with relatives). Nothing was
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
(`filtered-list-samples-4.csv` row 4, `hint-samples.csv` row 129,
flags `adds_spouse`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Canada, Ontario, Marriages, 1869-1927", the 4 February 1891 Toronto marriage of Thomas John Sloane, aged 30, to Maggie A Mahaffey. It names the groom's parents as William and Maria Sloane. The hint offers Maria as the subject's spouse; the index gives no residence or birthplace for anyone.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Maria as William W Sloan's wife, plus a `required` finding that the report documents
the rejection.

A weak candidate that matches on names only. The tree's wife is Agnes McCaa, not Maria. Her children run from 1859 to 1876 with no gap that would leave room for another wife. The tree's two sons named Thomas were born in 1859 (died 1861) and 1865, neither of them about 1861, and none has the middle name John. William Sloan is a common Ontario name. The CSV's country, "British North America", is just how the tree person's 1832 birth is labelled; the record itself is from Ontario.

The tree's own "Canada, Ontario County Marriage Registers, 1858-1869" source is William Sloan's marriage to "Agnes McAn" on 4 March 1859. So Agnes was his wife from 1859, and a son born about 1861 to a Maria would need a second household running alongside the first. The settling check is the 1891 marriage register image: it gives the groom's birthplace, and a birthplace outside Huron County makes the hint another William Sloane's son.
