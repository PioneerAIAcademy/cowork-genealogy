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


**Resolved 2026-10-21 (issue #3621): the hint is a false match, and no
substitute record answers it.** The hint persona Dorothea Dobrotić
(`ark:/61903/1:1:QKMG-HJF5`) is **not** the tree's Dora Dobrotić
(`fixture.json` `hint.identity: "different"`).

**What the index says.** "Croatia, Church Books, 1516-1994" indexes an entry
for Jacobus Korota, Roman Catholic, baptised 3 April 1871 at Križovljan
Radovečki, son of Franciscus Korota and Dorothea Dobrotić
(`ark:/61903/1:1:QKMG-HJFG`). On names alone it looks strong: same parish as
the couple's sons of 1863 and 1865, a father's name that matches Franjo, and
the right age for Dora.

**What the register says.** The genealogist read the page image
(`ark:/61903/3:1:3QS7-L99C-YW38`) by hand on familysearch.org. Entry #22 is
**Georgius, son of Josephus Horvat vel Korotaj and Theresia, of Virje N. 8.**
That is a different Korotaj household: a different father (Josephus, not
Franjo), a different mother (Theresia, not Dora) and a different house. It has
no link to Dora Dobrotić of Veliki Lovrečan. The index's "Franciscus Korota"
and "Dorothea Dobrotić" are not what the entry says. The image settled the
call, so `image_basis` is `true`.

**Calibration.** Before reading the target entry, the genealogist checked two
other entries on the same page against the index:

- Philippus Daljevec, baptised 2 April 1871, parents Paulus Daljevec and Anna
  Bogadi (`ark:/61903/1:1:QKMG-HJFN`)
- Maria Premužić, baptised 3 April 1871, parents Simon Premužić and Anna
  Veselić (`ark:/61903/1:1:QKMG-HJFK`)

Both matched their index, so the reading is licensed for the child's name,
parents and date. It is not licensed for anything else; the house number is
quoted only to show the household differs.

**The "Kotoriba death register" oddity.** The draft flagged that the image's
catalogue metadata describes a Kotoriba (Međimurje) death register for
1890-1917. Ten indexed entries point at this same image, and every one is a
1871 Križovljan Radovečki baptism. The page is a baptism register, and the
Kotoriba label is film-level metadata, not the record type.

**What was searched and came up empty.** Only the 1871 Križovljan Radovečki
baptism register around entry #22 was examined. No entry there names Franjo
Korotaj and Dora Dobrotić as parents. No wider search for a later child of
the couple was made, so the required negative finding is scoped to that
register only.

**Findings.** `f1` is an `avoid` guard: the agent must not add an 1871 son
(Jacobus or Georgius) to Dora and Franjo. `f2` requires the report to document
the rejection and leave the couple's children as the tree already has them:
Franja, 1855; Philippus, 1863; Antonius, 1865.

**Retrieval.** Index records were read with the `record_read` tool. The page
image and the calibration were read by hand on familysearch.org. The identity
judgement is the genealogist's.
