# flynn-naming-pattern-parentage

Patrick Flynn parentage research: `flynn-split-parentage-tiers` plus one more source, the baptisms of Patrick's first son Thomas (1870) and first daughter Bridget (1872). Built for issue #3251, where a proof summary called a naming pattern "strong circumstantial support" for a parentage and put a grandmother on the wrong side.

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Questions:** q_001 (parentage, in_progress), q_002 (1850 census placement, resolved)
- **Plans:** pl_001 (completed), pl_002 (active, adds pli_008 church records, completed)
- **Log:** 7 entries. log_007 is the baptism search.
- **Sources:** 6 sources. src_006 is the St. Patrick's baptismal register.
- **Assertions:** 17 assertions across 6 sources. a_016 and a_017 are the two baptisms, both naming Patrick Flynn and Mary Doyle as parents.
- **Person evidence:** 9 links (Patrick → I1, Thomas → I2, Bridget → I3)
- **Conflicts:** 1 resolved (birthplace), unrelated to parentage
- **Hypotheses:** h_001 (Thomas is Patrick's father, supported), h_002 (Bridget is Patrick's mother, active)
- **Timelines:** t_001 (Patrick, 4 events, 1 gap)
- **Proof summaries:** none yet
- **GedcomX persons:** I1 (Patrick), I2 (Thomas), I3 (Bridget), all unlinked

## What is planted

`h_002`'s notes carry the two mistakes from the issue:

- **Weight.** The note calls the children's names "strong circumstantial support" for Thomas and Bridget as Patrick's parents. A naming custom is a tendency some families followed. It can be consistent with a parentage, but it is not evidence that establishes one.
- **Side.** The note calls Bridget (I3) the "maternal grandmother" of Patrick's daughter. As Patrick's mother she would be the *paternal* grandmother. The custom the note itself quotes names a first daughter for the *mother's* mother, Mary Doyle's mother, so it does not point at Patrick's mother at all.

Maternity otherwise rests where it did in the parent scenario: one 1870 widow, `pe_007` at 0.0002, no record naming Bridget as Patrick's mother.

## What a correct run does

Tiers paternity `probable` and maternity `possible` (or weaker), writes only the paternal `ParentChild` (I2 → I1), and leaves naming customs out of the narrative and the reply: it neither weighs `h_002`'s naming argument nor restates it to dismiss it. A bare "naming patterns are not evidence" is fine.

## Used by

- `eval/tests/unit/proof-conclusion/naming-pattern-not-evidence.json`. Tag `per-claim-tier-split`: `test_per_claim_tree_encoding` checks the tiers and the tree write. Tag `naming-not-evidence`: `test_naming_custom_not_cited` checks the narrative and reply leave naming customs out. That point is a validator, not the judge, because the judge reads h_002 in the before-state and quoted it as the run's own narrative in six of six graded runs.
