# flynn-skipped-death-cert

Fork of `flynn-exhaustive-ready` with four plan-item changes:

- **pli_005** (death certificate): `completed` -> `skipped` -- records
  destroyed in a 1920 courthouse fire, no duplicates available.
- **pli_006** (probate): outcome changed from negative to **positive** --
  Thomas Flynn's 1881 will names "my eldest son Patrick Flynn" as heir,
  providing direct primary evidence of parentage (replaces the death
  certificate as the direct evidence source).
- **pli_007** (later censuses 1870-1900): `skipped` -> `completed` --
  1870 census confirms continued co-residence; 1880/1900 show Patrick
  in own household.
- **pli_008** (church records): `skipped` -> `completed` (#2269) -- the
  St. John the Baptist (Pottsville) baptismal register read for
  1845-1850, `log_008`, negative. It had been skipped on the claim that
  Schuylkill County's pre-1850 Irish Catholic registers are "fragmentary
  and largely unavailable", which is an assumption no search tested and
  is wrong for a parish established 1827.

Evidence cascade:
- Death cert source (src_004), assertions (a_011-a_013), and
  person_evidence (pe_005) removed.
- Will source (src_005), assertion (a_014), and person_evidence (pe_007)
  added.
- Birthplace conflict (c_001) removed -- without the death cert there
  is no competing "Pennsylvania" claim.

Result: 4 completed + 1 skipped (death cert) + 1 other skipped
(naturalization), with three independent evidence sources (1850 census,
1860 census, will).

**Why pli_008 had to move.** `_012` grades exactly one distinction --
whether a skipped record type's non-existence is *confirmed* or merely
*assumed* (its `judge_context`: "if it's confirmed (records destroyed,
never created for this county), overturn risk is low; if it's just 'hard
to find,' that is different"). The 1920 courthouse fire on `pli_005` is
the confirmed case this scenario exists to test. Leaving `pli_008`
skipped on an assumed-unavailability rationale put the *other* side of
that same line in the same fixture, against a test that expects a
declaration. Searching it removes the ambiguity and leaves `pli_005` as
the sole non-existence claim -- which is the one `_012` is about.

Used by: ut_research_exhaustiveness_012 (skipped plan item allows declaration).
