# Thomas Young & Elizabeth Martin — marriage and maiden name (1828)

**Source PID:** `PID-TODO`
**Elizabeth Young (née Martin) is deceased.** (FamilySearch ToS requires all committed e2e fixtures to be about deceased persons.)

## Research question

> What was Elizabeth Young's maiden name, and where and when did she marry Thomas Young?

## What was removed from the starting tree

- The marriage fact (16 November 1828, Bristol St. James, Gloucestershire) is entirely absent from the starting tree — the Couple relationship between Thomas and Elizabeth has an empty `facts` array.
- Elizabeth's maiden name "Martin" does not appear anywhere in the starting tree; she is listed only as "Elizabeth Young."
- The christening of Betty Martin (1 November 1812, Bitton, Gloucestershire, daughter of Thomas & Sophia Martin) is not represented — no person record for Betty/Elizabeth Martin or her parents Thomas and Sophia Martin was included.

The starting tree retains: both spouses with birth estimates and residences (Bitton → Bath → Liverpool), deaths and burials for Thomas (Jan 1892, Everton/Anfield) and Elizabeth (Sep 1893, Anfield), and all 13 children with their christening and birth dates — giving the agent a strong anchor for searching Bristol-area marriage registers circa 1828–1830.

## Expected difficulty

moderate — The marriage is indexed on FamilySearch but requires the agent to reason about the Bristol/Bitton geography and rule out a same-name carpenter couple; confirming the maiden name further requires cross-referencing GRO civil registration birth indexes (Ancestry/Findmypast) for children's mother's maiden names, which are non-FamilySearch sources the judge must allow credit for.

## Notes for reviewers

Three required findings: (f1) the marriage event itself at Bristol St. James on 16 November 1828, (f2) Elizabeth's maiden name as Martin confirmed by multiple sources, and (f3) the Betty Martin christening in Bitton 1 November 1812 as a candidate for Elizabeth's own christening record. The document notes a date discrepancy — one narrative passage suggests 1829 but the authoritative Research Summary states 16 November 1828; use 1828. The GRO birth-index entries (Martha and Robert Young, mother's maiden name Martin) are on Ancestry and the GRO website, not natively on FamilySearch — the agent may or may not be able to reach them; grade on whether the marriage register finding and maiden name are recovered, regardless of which source path was used.

**Authoring note (PID-less / Path 3):** Built from the bundled research document(s) (KoriRobbins/Research Report.pdf) with no FamilySearch access, so the starting tree was *constructed* from the document rather than captured from a live `person_read` snapshot — sanity-check its fidelity before relying on it. `source_pid` is an unused placeholder (`PID-TODO`): §6.1 blocks every person-keyed tool, so neither the benchmark run nor the judge ever reads the PID — it is provenance only, and may optionally be filled in later if a re-snapshot or provenance link is wanted. The landing gate is the same as for every fixture (Path 1 included): a committed §14 validity run that passes (`uv run python -m e2e.validate_fixture young-marriage-1828`). Recoverability from FamilySearch records is flagged in the reviewer notes above.
