# Scenario: sussex-tennessee-unexplained-move

Built for the person-evidence **geographic-plausibility** rule (issue #2537): a candidate
record outside the subject's attested residence cluster, with nothing on file and nothing on
the destination's wiki page that bridges the move. Mirror of
`bedfordshire-utah-corridor-move`, which differs only in that a corridor does explain it.

## State

- **Subject:** William Weller (`I1`), b. ~1825 Horsham, Sussex, England; wife Mary (`I2`,
  b. ~1828); children James (`I3`, ~1852), Ellen (`I4`, ~1855), George (`I5`, ~1859), all
  born Horsham. The tree attests the couple's residence at Horsham in the 1851 and 1861
  England censuses (Residence facts F1R1851/F1R1861, F2R1851/F2R1861).
- **Candidate records:** the 1870 U.S. census (`src_001`, personas `CP1`-`CP5`) and the 1880
  U.S. census (`src_002`, personas `DP1`-`DP3`), Maury County, Tennessee. Both households
  are headed by William Weller, born England, with a wife Mary and children whose names and
  ages agree with the tree (1870: William 45, Mary 42, James 18, Ellen 15, George 11;
  1880: William 55, wife Mary 52, son George 21).
- **No bridge in the project:** no passenger list, naturalization, letter, land record or
  relative documented in the United States. No `person_evidence` links yet.

## What it exercises

Name, age, spouse, and children all agree across two independent censuses, so on ordinary
correlation this is a Strong match. The only thing holding it back is geography: Horsham,
Sussex to Maury County, Tennessee (~6,800 km) is a transatlantic move that no record in
the project accounts for. `Tennessee_Emigration_and_Immigration` describes pre-statehood
settlers "of English and Ulster Scottish origin" who came overland from Virginia and the
Carolinas. That is descent, not a corridor from Sussex in the 1860s, and it does not
explain this move.

Expected under the decided cap (lead, 2026-09-18): the link to `I1` is **`probable` at
most, never `confident`**. The rationale names the geographic gap (both places, the
measured distance, and that no passenger list or naturalization bridges it). It is not a
`core_identifier_conflict` and not `speculative`. Linking at `probable`, or presenting the
evidence and asking before linking, are both correct.
