# mills-parentage-first-plan

First research plan for a parentage question whose Family Tree parents are already
contradicted by dated evidence in the project's own tree. Mined for issue #4696 Part A.

## Source

Carved from alpha feedback #4642 (hosted web, build d3c9bc791, bundle
`feedback-2026-11-17T21-08-59-851488Z.zip`), the state just before the first research-plan
spawn of that session (17:08Z, subagent `agent-a1f83923a…`).

- `research.json`: `project`, `q_001`, `researcher_profile` and the two `localities` entries
  that existed then (loc_001 Stamford, Fairfield County, Connecticut 1740-1780; loc_002
  Shelburne, Chittenden County, Vermont 1790-1820), copied verbatim. Every other section is
  empty: every log entry, source, assertion, person_evidence row, namesake and plan in the
  bundle was written after that spawn.
- `tree.gedcomx.json`: the bundle's `starting-tree.gedcomx.json`, verbatim. It is the tree the
  planner read (its `tree_query` returned the same 13 persons).

The test's delegation is the real one, with `/project` replaced by `<workspace>`.

## What the original run did

The planner's own summary said the tree's parentage looked doubtful: George Mills (I5, b.
1740) and Abigail Weed (I7) married 12 Aug 1760 (R2), after the subject Alexander (I1)
married Mary Millet on 22 Mar 1759 (R1), and the couple's son Alexander (I10) was born 1761
in Stamford and died there in 1822. Its plan still opened with a Stamford church item
(sequence 2) and closed with George and Abigail's Stamford probate (sequence 10). No item
sought the subject's own birth, age or birthplace before those. The Worcester marriage item
(1755-1762) planned an indexed search only; the 1759 marriage was later found by full-text,
in the 1846 Worcester vital-records compilation.

## Notes for the author

- `loc_003` (Worcester, Worcester County, Massachusetts, 1735-1765) was added on 2026-11-23;
  no Worcester entry existed in the session. Without it, today's planner leaves Massachusetts
  out of a first plan and asks for a locality survey (7 of 8 plans in the first 9 scratch
  runs), so the full-text rule could not be measured. The entry is hand-built and neutral:
  record keepers only, no `volume_summary`, no collections, nothing on indexing. With no
  `fulltext_only` count, the pre-1850 New England fallback is what applies.
- The question text itself asks whether records confirm or refute the Stamford parents, and
  the delegation invites testing the tree's claims. Both are kept as they were.
- PII: the people are 18th century and on the public Family Tree; no tester or contributor
  data is in either file. Real names are kept because the validators key on them.
