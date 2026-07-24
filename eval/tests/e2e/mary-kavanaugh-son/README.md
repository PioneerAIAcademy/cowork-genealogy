# Mary E. Kavanaugh — additional son James (b. 1872, Cohasset)

**Source PID:** `G95C-GFP`
**Mary E. Kavanaugh is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
1843, Manchester, England; died 10 December 1904, Whitman, Plymouth, Massachusetts.

## Research question

> Did Mary E. Kavanaugh and her husband Charles H. Williston of Cohasset, Massachusetts have a son born before their four known children (1877-1880), in addition to the four already in the tree?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `G95C-GFP` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 2, flag `adds_son`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Massachusetts, State Vital Records, 1638-1927: death entry for James A. Welliston, born 1872, died 1876, Cohasset, Massachusetts, parents Charles H. Welliston and Mary Kavanagh. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming the 1872-1876 James A. Welliston claim, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: the tree already has a son **James B. Williston, b./d. 1880** — if this hint is a true match the family named two sons James (a common necronym pattern after an infant death, as in the committed `heinrich-dewus-children-death` fixture's 'Walter'), which is plausible but not confirmed. The spelling **Welliston** vs. the tree's **Williston** is a routine period variant. The place (Cohasset, Norfolk, Massachusetts) matches the tree family's residence and the birthplace of the 1880 twins exactly. Against the match: 1872 predates the earliest tree-recorded child's birthplace evidence only by five years with no gap issue, but the mother's maiden name is recorded as **Kavanagh** in the hint vs. **Kavanaugh** in the tree — another routine variant, not by itself disqualifying.
