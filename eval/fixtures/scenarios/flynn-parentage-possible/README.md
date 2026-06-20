# flynn-parentage-possible

Patrick Flynn parentage research, **very early stage** — a single thin lead.
Built for the proof-conclusion test that exercises the **`possible`** tier
and the "do not write the tree below `probable`" invariant.

Only one record has been found: the **1850 census** showing Patrick (age 5)
in a Thomas Flynn household (dwelling 84, Schuylkill Co.). The parent-child
relationship is *inferred* from household position — the 1850 census has no
"relationship to head" column. There is no corroboration: the 1860 census and
the 1908 death certificate are planned but not yet searched.

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Questions:** q_001 (parentage, in_progress), q_002 (1850 placement, resolved)
- **Plans:** pl_001 (1850 census, completed), pl_002 (parentage evidence, active — both items still `planned`)
- **Log:** 1 entry — the 1850 census search only
- **Sources:** 1 (1850 census, FamilySearch)
- **Assertions:** 5, all from the 1850 census (a_004 is the lone inferred parentage line)
- **Conflicts:** none (a single source can't conflict with anything)
- **Hypotheses:** h_001 (Thomas is the father) — status `active` (under investigation, thinly supported)
- **Proof summaries:** none yet — this is what the skill under test must produce
- **GedcomX persons:** I1 (Patrick), I2 (Thomas)
- **GedcomX relationships:** **none** — no `ParentChild` has been concluded

## Why this should be `possible`

A young child living in a same-surname household headed by an adult man of
plausible age is a *credible* parentage lead — the evidence leans toward
"yes." But a single uncorroborated, indirect co-residence could equally be a
nephew, grandchild, or boarder. That is the definition of **possible**:
viable, worth pursuing, but well short of a preponderance. (Contrast
`mid-research-flynn-no-proof`, which has three converging sources and supports
`probable`.)

## Used by

- proof-conclusion positive test: write a `possible`-tier conclusion **and
  leave `tree.gedcomx.json` unchanged** (the tree write-back lower bound — the
  pre-state deliberately has no `ParentChild` relationship, so a correct run
  leaves the tree byte-for-byte identical).
