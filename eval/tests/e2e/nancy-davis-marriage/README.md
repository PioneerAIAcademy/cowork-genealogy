# Nancy Davis — marriage to William Brewer (Newton County, Missouri, 1868)

**Source PID:** `LJK2-JBH`
**Nancy Davis is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1837,
Bradley, Tennessee; the tree carries an (undated) Death fact.

## Research question

> When and where did Nancy Davis (born 1837 in Tennessee, of Newton
> County, Missouri) marry her husband William James Brewer?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-10, PID `LJK2-JBH` with relatives). The couple
relationship Nancy ↔ William James Brewer (`R1`) exists in the tree
**without any Marriage fact** — the agent must recover the marriage
event from records. Because nothing was stripped, no
`unstripped-tree.gedcomx.json` is committed (the validator's
presence-mirror check assumes a strip-based fixture);
`starting-tree.gedcomx.json` *is* the unmodified snapshot.

## Expected difficulty

medium — The couple relationship is already in the tree, so the agent
knows whom Nancy married; the task is finding the marriage event. The
candidate record is indexed under the surname **Bremer** (tree:
**Brewer**) in the county matching Nancy's 1850 residence (Neosho,
Newton, Missouri), reachable by record search — the surname variant and
the unverified match are the risk.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples.csv` row 1, flag `adds_marriage`, confidence 3)
in which roughly half the hint records are **false matches**, and the
authors do not know which. `expected-findings.json` was transcribed
from the hint record — Missouri, Marriages, 1750-1920: William Bremer
married Nancy Angeline Davis, 12 May 1868, Newton County. The
genealogist + developer teams must decide:

- **(a) true match** — keep the findings as written;
- **(b) different answer** — the marriage is documented by some other
  record (possibly a different date/spouse): edit
  `expected-findings.json` accordingly;
- **(c) no findable answer** — the hint record belongs to a different
  Nancy Davis and no marriage record for this couple is findable: the
  fixture's expectation becomes "the agent declares the marriage
  undetermined rather than asserting the false record."

Evidence a reviewer will want: the tree's William James Brewer
(`LJK2-81K`) was born 1 Jan 1844 (he would be 24 in 1868 — plausible;
Nancy would be ~31), but the tree also gives the couple daughters
"Mary Moreland" (b. 1858) and "Sarah Moreland" (b. 1860), who predate
the 1868 marriage date and carry a third surname — the tree itself is
internally inconsistent here (possible prior marriage, or existing tree
errors). Bremer/Brewer is a routine indexing variant.
