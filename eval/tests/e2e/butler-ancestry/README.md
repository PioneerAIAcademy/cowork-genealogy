# Mary Kate Butler — parents (1908, Ireland)

**Source PID:** `PID-TODO`
**Mary Catherine Butler is deceased.** (Born 20 March 1908; her generation and Irish 19th/20th-century context place her death well before the present. The research report documents her death indirectly via her husband's 1980 death and her 1931 marriage, placing her firmly in a deceased era.)

## Research question

> Who were the parents of Mary Catherine Butler, born 20 March 1908 in Waterford, Ireland?

## What was constructed for the starting tree

This is a Path 3 (PID-less) fixture built from the research document rather than a live `person_read`. The starting tree was constructed from the **known starting context** in the report:

- Mary Catherine Butler herself, with her birth (20 March 1908, Waterford, Ireland) and her 1931 marriage to Michael Thomas Kelly — information treated as already-known going into the research.
- Her husband Michael Thomas Kelly (born circa 1905, Waterford; died 16 October 1980, Waterford), with the couple relationship.
- Two documentary sources anchoring the starting context: her birth registration and the 1911 census.

**Withheld (the answer the agent must recover):**

- Her father: John Butler, born 15 April 1881, Kilkenny, Kilkenny, Ireland (son of John Butler and Mary Knight).
- Her mother: Catherine Canty (also called Kate Canty), born circa 1884, Waterford, Ireland.
- The 1906 marriage of John Butler and Catherine Canty in Waterford.

The father's identity is established through her civil birth registration (listing John J. Butler as father), supported by the 1906 marriage record and the 1911 census. Note: a discrepancy exists between John Butler's civil birth registration (listing "Mary Muldowney" as his mother) and his baptism record (listing "Mary Knight"); the report resolves this in favor of Mary Knight via sibling birth records, but the agent need only identify John Butler as the father and Catherine Canty as the mother to satisfy the required findings.

## Expected difficulty

hard — 19th-early-20th-century Irish research with limited online record coverage. The Ballybricken parish registers are only available as indexes (not images) via RootsIreland; original records were not microfilmed past 1880. Civil registration for Ireland is accessible on IrishGenealogy.ie (and partially indexed on FamilySearch), but the record linkages require cross-referencing civil registrations, parish baptism indexes, and census records across two counties (Waterford and Kilkenny). The father's birth record contains a name discrepancy that requires reconciliation.

## Notes for reviewers

The two required findings are: (1) the father is John Butler (born 1881, Kilkenny) and (2) the mother is Catherine Canty. The optional third finding (John Butler's birth date and place) adds precision but is not required to pass. The agent may cite different source paths than those listed in `expected-findings.json` — grade on the recovered facts, not on which specific record was cited. Non-FamilySearch sources consulted in the original research include the British Newspaper Archive (Waterford Standard obituary) and Ireland Genealogy Projects Archive (gravestone transcription); these are supplementary and do not bear on the required parentage findings.

**Authoring note (PID-less / Path 3):** Built from the bundled research document(s) (SeniaFosterKirk/Four Generations of Mary Kate Butler.pdf) with no FamilySearch access, so the starting tree was *constructed* from the document rather than captured from a live `person_read` snapshot — sanity-check its fidelity before relying on it. `source_pid` is an unused placeholder (`PID-TODO`): §6.1 blocks every person-keyed tool, so neither the benchmark run nor the judge ever reads the PID — it is provenance only, and may optionally be filled in later if a re-snapshot or provenance link is wanted. The landing gate is the same as for every fixture (Path 1 included): a committed §14 validity run that passes (`uv run python -m e2e.validate_fixture butler-ancestry`). Recoverability from FamilySearch records is flagged in the reviewer notes above.
