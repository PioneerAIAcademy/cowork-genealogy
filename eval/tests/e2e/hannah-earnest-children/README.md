# Hannah Earnest & Edwin Grice — sixth child, daughter Lydia Grice (1878)

**Source PID:** `9DJ7-219`
**Hannah Earnest is deceased.** (FamilySearch ToS requires all committed
e2e fixtures to be about deceased persons.)

## Research question

> Besides their children John, Hannah Grace, Edwin, William, and James, did
> Hannah Earnest and Edwin Grice have any other children? Identify each
> additional child and their birth details.

## What was removed from the starting tree

- Removed the person Lydia Grice (PID `LZP9-WWP`), born 10 July 1878 in West
  Bromwich, Staffordshire, England, christened 8 August 1878.
- Removed both parent-child relationships linking Lydia to Hannah Earnest and
  to Edwin Grice.
- Removed Lydia's 1915 marriage relationship (to Albert Arthur Harding,
  `KKR2-DS9`) since she is no longer present in the starting tree.
- Removed the attached source that attests Lydia directly: "England,
  Staffordshire, Church Records, 1538-1944" — christening entry for Lydia
  Grice, 8 Aug 1878, West Bromwich (source id `7BL6-KZN`).
- The other five children (John, Hannah Grace, Edwin, William, James) and all
  of their relationships/sources are left intact in the starting tree, so the
  agent already knows about them and must discover only the missing sixth
  child.

## Expected difficulty

moderate — the recovery record (a 1878 Staffordshire church christening
entry) is a standard, FamilySearch-searchable record type, but the fixture
person's own sourcing is thinner than ideal (see notes below), so there is
less surrounding context to anchor the search than a typical fixture.

## Notes for reviewers

Hannah Earnest's own FamilySearch record falls short of this benchmark's
usual "well-researched" bar: only 7 attached sources total across the whole
family, covering just two record types (census entries and church/baptism
records) — no marriage record and no death record are attached to Hannah
herself, and her marriage to Edwin Grice has no recorded date or place at
all on FamilySearch. This was confirmed by manually reviewing both Hannah's
and Lydia's live FamilySearch pages, not just the `person_read` API output.
Given the task specifically named this person, we proceeded anyway with the
best-evidenced fact available — the sixth child, Lydia — rather than
picking a different, better-documented person. If this fixture proves hard
to validate (the recovery record isn't findable via record search alone),
that is itself useful signal about the limits of thinly-sourced FamilySearch
persons as fixture subjects.

**Birth-date precision caveat:** `expected-findings.json` states Lydia's
birth as "10 July 1878," taken from the live FamilySearch Birth fact — but
that fact carries **no attached source**. None of Lydia's three attached
sources (the 1881 census, the church christening record, the 1891 census)
attest that specific day; the christening record only gives 8 Aug 1878, and
the censuses give ages only. A correctly-behaving agent has no source from
which to recover the exact birth day and should record only the year
(1878, sourced to the christening entry) rather than assert the unsourced
day. Grading should treat that as full recovery, not a precision miss —
see the grading note below.
