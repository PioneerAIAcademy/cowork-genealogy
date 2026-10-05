# Scenario: bedfordshire-utah-corridor-move

The negative arm of the person-evidence **geographic-plausibility** rule (issue #2537): a
candidate record outside the subject's attested residence cluster, where a migration
corridor named on the destination's wiki page explains the move. Mirror of
`sussex-tennessee-unexplained-move`; a rule that fires on every move is worse than no rule.

## State

- **Subject:** Joseph Pratt (`I1`), b. ~1822 Cranfield, Bedfordshire, England; wife Ann
  (`I2`, b. ~1825); children Sarah (`I3`, ~1847) and Joseph (`I4`, ~1850), both born
  Cranfield. The tree attests the couple's residence at Cranfield in the 1841 and 1851
  England censuses (Residence facts F1R1841/F1R1851, F2R1841/F2R1851).
- **Candidate records:** the 1860 U.S. census (`src_001`, personas `CP1`-`CP4`) and the 1870
  U.S. census (`src_002`, personas `DP1`-`DP3`), Salt Lake County, Utah Territory. Both
  households are headed by Joseph Pratt, born England, with a wife Ann and children whose
  names and ages agree with the tree (1860: Joseph 38, Ann 35, Sarah 13, Joseph 10;
  1870: Joseph 48, wife Ann 45, son Joseph 20).
- **No documentary bridge in the project** (no passenger list or emigration record). No
  `person_evidence` links yet.

## What it exercises

The same Strong correlation as the mirror, across two independent censuses, and a longer
move (Cranfield to Salt Lake, ~7,770 km), so raw distance cannot be what decides it.
`Utah_Emigration_and_Immigration` names the corridor: Latter-day Saint emigrants from
Europe and Great Britain sailing from Liverpool, landing at New Orleans (1840-1854) or New
York, Philadelphia and Boston (1855-1890), since Utah has no seaport. An English
family appearing in Salt Lake in 1860 is the move that corridor describes.

Expected: an **ordinary `confident` link** to `I1`. The rationale names the corridor that
explains the move. Capping at `probable`, or naming the move as an unexplained gap, is the
rule over-firing.
