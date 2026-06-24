# Richard A. Crowder — grandparents (1780s–1799)

**Source PID:** `PID-TODO`
**Richard A. Crowder is deceased.** (FamilySearch ToS requires all committed e2e fixtures to be about deceased persons. Born about 1807; died before October 1877.)

## Research question

> Who were the grandparents of Richard A. Crowder, born about 1807 in Wake County, North Carolina?

## What was constructed for the starting tree

This is a PID-less / Path 3 fixture — constructed from a research document, not stripped from a live FamilySearch person_read snapshot.

The starting tree contains:

- **Richard A. Crowder** (subject) — birth ~1807 Wake County, NC; death before Oct 1877 Dallas County, AR
- **Thomas Crowder** (father) — birth ~1760 Virginia; death ~1836 Wake County, NC; will dated 1 September 1836
- **Fanny Rhodes Crowder** (mother) — birth ~1765 Virginia; married Thomas Crowder 29 March 1785 Mecklenburg County, VA
- ParentChild relationships linking Thomas and Fanny to Richard
- Couple relationship between Thomas and Fanny

The parentage of Thomas and Fanny was established in prior research (Thomas's will named Richard as his son and Fanny as his wife). The maiden surname Rhodes for Fanny was a starting hypothesis drawn from a subscription-database marriage record.

## What was withheld (the answer)

The grandparents of Richard A. Crowder — i.e., the parents of Thomas Crowder and the parents of Fanny Rhodes. The report establishes:

**Firmly proven:**
- John Rhodes (died 1799, Wake County, NC) and his wife Frances were the parents of Fanny Rhodes, making them Richard's maternal grandparents. Proven via a 1814 Wake County deed in which Thomas Crowder purchased land from the heirs of John Rhodes, with Fanny explicitly named as one of those heirs, and confirmed by John Rhodes's 1799 will which named daughter "Fanny."

**Probable but not conclusive:**
- George Crowder of Mecklenburg County, Virginia was the father of Thomas Crowder (Richard's paternal grandfather). Supported by Mecklenburg County tax lists showing Dorcas Crowder paying tithe for Thomas and John Crowder in 1782–1783, and George Crowder's will naming sons Richard, Thomas, and George as executors — but the report explicitly states "this conclusion requires more evidence."

## Expected difficulty

Hard — the proof rests on early North Carolina deed books and wills on FHL microfilm, plus 18th-century Virginia tax lists and probate records. The records predate standard vital registration and most national indexes. The paternal grandfather finding is intentionally `required: false` because the report itself stops short of claiming proof.

## Notes for reviewers

The two required findings (f1 and f2) are both about the maternal grandparents John and Frances Rhodes. Finding f3 (George Crowder as paternal grandfather) is `required: false` — the report explicitly calls it probable but inconclusive, so a run that recovers only the Rhodes grandparents may still pass. Grade on recovered facts and relationship identifications, not on the specific microfilm citations (a FamilySearch search that surfaces the same deeds or wills via a different index path is equally valid).

**Authoring note (PID-less / Path 3):** Built from the bundled research document(s) (DebbieGurtler/Final Research Report - Crowder-Rhodes.pdf) with no FamilySearch access, so the starting tree was *constructed* from the document rather than captured from a live `person_read` snapshot — sanity-check its fidelity before relying on it. `source_pid` is an unused placeholder (`PID-TODO`): §6.1 blocks every person-keyed tool, so neither the benchmark run nor the judge ever reads the PID — it is provenance only, and may optionally be filled in later if a re-snapshot or provenance link is wanted. The landing gate is the same as for every fixture (Path 1 included): a committed §14 validity run that passes (`uv run python -m e2e.validate_fixture crowder-grandparents`). Recoverability from FamilySearch records is flagged in the reviewer notes above.
