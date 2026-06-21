# mid-research-flynn

Patrick Flynn parentage research, mid-project.

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Questions:** q_001 (parentage, in_progress), q_002 (1850 census placement, resolved)
- **Plans:** pl_001 (1850 census search, completed), pl_002 (parentage evidence, active)
- **Log:** 5 entries — 1850 census on FamilySearch/Ancestry/MyHeritage, 1860 census, death cert
- **Sources:** 4 sources (1850 census FS, 1850 census Ancestry, 1860 census, death cert)
- **Assertions:** 13 assertions across 4 sources
- **Person evidence:** 6 links (Patrick → I1, Thomas → I2)
- **Conflicts:** 1 resolved (birthplace: Ireland vs Pennsylvania)
- **Hypotheses:** h_001 (Thomas is Patrick's father, supported)
- **Timelines:** t_001 (Patrick, 4 events, 1 gap)
- **Proof summaries:** ps_001 (parentage, probable)
- **GedcomX persons:** I1 (Patrick Flynn), I2 (Thomas Flynn), I3 (Mary Flynn, sister), I4 (James Flynn, brother)
- **GedcomX relationships:** R1 (Thomas → Patrick), R2 (Thomas → Mary), R3 (Thomas → James) — all ParentChild
- **Note on siblings:** Mary and James are stub entries (preferred name + gender only, no facts).
  They represent the canonical shape Dallan called for: when researching Patrick on a household
  census, the siblings should exist as persons in `tree.gedcomx.json` so warnings like
  `relativesChildBirthRange40` and skills like `person-evidence` can reach them. Their detailed
  facts would land later via record-extraction + person-evidence as the user works through the
  1850 census record.
