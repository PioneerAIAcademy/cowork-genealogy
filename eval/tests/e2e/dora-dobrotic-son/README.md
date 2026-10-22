# Dora Dobrotić — a son Jacobus baptised in 1871, Križovljan Radovečki, Croatia

**Source PID:** `K48B-4CP`
**Dora Dobrotić is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born about 1841 at Veliki Lovrečan, Varaždin; the tree carries an undated Death fact. Wife of Franjo Korotaj (born about 1837); mother of Franja (christened 5 March 1855), Philippus (born 10 April 1863, christened at Križovljan Radovečki) and Antonius (born 1865, christened at Križovljan Radovečki).

## Research question

> Which children were born to Dora (Dorothea) Dobrotić, born about 1841 at Veliki Lovrečan, Varaždin, Croatia, and her husband Franjo Korotaj?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `K48B-4CP` with relatives). Nothing was
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

**Resolved 2026-10-22 (issue #3621): the hint is a true match.** The hint
persona Dorothea Dobrotić (`ark:/61903/1:1:QKMG-HJF5`) is the tree's Dora
Dobrotić (`fixture.json` `hint.identity: "same"`), and Jacobus, born 3 April
1871, is a third son of hers and Franjo Korotaj's.

**This corrects an earlier resolution.** On 2026-10-21 this fixture was
resolved as a false match. That verdict read **entry 22** of the page image,
Georgius, son of Josephus Horvath and Theresia of Virje No. 8, which is not
the hinted entry. The hint is **entry 28** of the same image. Review on PR
#3726 caught it.

**What the index says.** "Croatia, Church Books, 1516-1994" indexes Jacobus
Korota, Roman Catholic, baptised 3 April 1871 at Križovljan Radovečki, son of
Franciscus Korota and Dorothea Dobrotić (`ark:/61903/1:1:QKMG-HJFG`).

**What the register says.** The genealogist read the page image
(`ark:/61903/3:1:3QS7-L99C-YW38`) by hand on familysearch.org. Entry 28 reads:
*Jacobus, filius legitimus, Franciscus Korotaj, et Dorothea Dobrotić conj.
pleb., Lovrečan No. 4*, born 3 April 1871. Child, father, mother and birth
date all match the index; the surname on the register is Korotaj, the tree's
spelling, not the index's "Korota". `f1` grades the baptism date as the
index gives it, 3 April 1871 (one reading of the register's baptism column
gave 4 April, another 3 April). The image
settled the call, so `image_basis` is `true`.

**Calibration.** Before reading entry 28, the genealogist checked the two
entries above it against the index:

- Entry 26, Philippus, 2 April 1871, father Paulus Daljevec
  (`ark:/61903/1:1:QKMG-HJFN`)
- Entry 27, Maria, 3 April 1871, father Simon Premužić
  (`ark:/61903/1:1:QKMG-HJFK`)

Both matched, so the reading is licensed for child, parents and date. It is
not licensed for residence: "Lovrečan No. 4" is quoted as corroboration only.
It fits the tree, which places the couple at Veliki Lovrečan and their son
Philippus's 1863 birth at Lovrečan.

**Why it is the same couple.** Both parents' names match the tree couple
(Franciscus = Franjo). The parish is the one where the couple's sons
Philippus (1863) and Antonius (1865) were christened. Dora would have been
about 30. The tree does not cite this entry, and none of its sources is dated
after 1865, so it is not a re-index of an attached source.

**The "Kotoriba death register" oddity.** The draft flagged that the image's
catalogue metadata describes a Kotoriba (Međimurje) death register for
1890-1917. Every indexed entry pointing at this image is an 1871 Križovljan
Radovečki baptism. The page is a baptism register; the Kotoriba label is
film-level metadata, not the record type.

**Findings.** `f1` (required): the agent should add Jacobus Korotaj,
baptised 3 April 1871 at Križovljan Radovečki, as a son of Dora and Franjo.
There is no avoid guard.

**Retrieval.** Index records were read with the `record_read` tool. The page
image and the calibration were read by hand on familysearch.org. The identity
judgement is the genealogist's.
