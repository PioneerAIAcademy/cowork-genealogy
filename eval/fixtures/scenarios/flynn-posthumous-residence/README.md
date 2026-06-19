# flynn-posthumous-residence

A check-warnings scenario for the **posthumous-mention** case. Copied from
`mid-research-flynn`, with one addition: Patrick Flynn (I1, d. 1908) has a
post-death **Residence** fact `F3` dated 1925, citing source `S5` — the
obituary of his daughter Mary (Flynn) Brennan, which names Patrick as her
late father and was auto-attached to Patrick's profile as a Residence-style
fact.

This reproduces the pattern FamilySearch commonly produces: probate, estate,
and obituaries of relatives that mention a deceased person get tagged as a
"Residence" on that person's profile, triggering `hasEventAfterDeath1`. The
correct reading is a posthumous mention (unlink and treat as a reference),
**not** identity confusion / a same-name merge.

Used by `ut_check_warnings_013` (`detect-posthumous-residence.json`) with the
`person-warnings-posthumous-residence` MCP fixture.
