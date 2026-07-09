# mid-research-flynn-no-proof

Patrick Flynn parentage research, mid-project — same as `mid-research-flynn` but with no proof_summaries written yet. Used by proof-conclusion tests that need to verify the skill writes the proof from scratch.

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
- **Proof summaries:** none yet — this is what the skill under test must produce
- **GedcomX persons:** I1 (Patrick Flynn), I2 (Thomas Flynn)
- **GedcomX relationships:** none yet — I1 and I2 are present but **unlinked**; proof-conclusion must write the ParentChild (Thomas → Patrick) link at `probable` tier (the `tree-write-expected` found-but-lost guard verifies absent → present)

## Differs from `mid-research-flynn`

- `proof_summaries` is `[]` (the base scenario pre-populates `ps_001` at tier `probable`).
- Everything else identical.

## Used by

- `proof-conclusion` positive tests where the skill must write a new proof_summary for q_001.
