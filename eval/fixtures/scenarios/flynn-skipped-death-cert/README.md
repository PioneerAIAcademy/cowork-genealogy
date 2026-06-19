# flynn-skipped-death-cert

Fork of `flynn-exhaustive-ready` with three plan-item changes:

- **pli_005** (death certificate): `completed` -> `skipped` -- records
  destroyed in a 1920 courthouse fire, no duplicates available.
- **pli_006** (probate): outcome changed from negative to **positive** --
  Thomas Flynn's 1881 will names "my eldest son Patrick Flynn" as heir,
  providing direct primary evidence of parentage (replaces the death
  certificate as the direct evidence source).
- **pli_007** (later censuses 1870-1900): `skipped` -> `completed` --
  1870 census confirms continued co-residence; 1880/1900 show Patrick
  in own household.

Evidence cascade:
- Death cert source (src_004), assertions (a_011-a_013), and
  person_evidence (pe_005) removed.
- Will source (src_005), assertion (a_014), and person_evidence (pe_007)
  added.
- Birthplace conflict (c_001) removed -- without the death cert there
  is no competing "Pennsylvania" claim.

Result: 3 completed + 1 skipped (death cert) + 2 other skipped, with
three independent evidence sources (1850 census, 1860 census, will).

Used by: ut_research_exhaustiveness_012 (skipped plan item allows declaration).
