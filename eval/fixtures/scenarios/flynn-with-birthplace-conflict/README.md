# flynn-with-birthplace-conflict

Patrick Flynn parentage research. Same as mid-research-flynn but the
birthplace conflict (Ireland vs Pennsylvania) has NOT been resolved yet.

- **Conflicts:** c_001 exists with `status: "unresolved"`, no `preferred_assertion_id`,
  no `resolution_rationale`, no `independence_analysis`, no `weighing_analysis`
- **Assertions:** a_002 (1850 census: Ireland), a_009 (1860 census: Ireland),
  a_012 (death cert: Pennsylvania) — the three competing assertions
- **Everything else:** Same as mid-research-flynn
- **`ps_001.resolved_conflict_ids` is `[]`,** not `["c_001"]` as the parent has it: `c_001` is unresolved here, and a proof summary may only cite a conflict that is `resolved` or `moot` (issue #1972 V5, enforced by `validator.ts`).


Use this scenario for conflict-resolution tests where the skill should
identify and resolve the birthplace discrepancy.
