# compound-objective-fully-covered

The twin of `compound-objective-part-unframed`, for the other direction. Every
file is identical to that scenario except `project.objective` and
`project.title` in `research.json`.

Here the objective asks two things, and `q_001` answers both: where Elizabeth
Mariah (Turnbow) Barker (b. ~1823) was born, *and* why the 1850 census index
says England while the 1860-1880 censuses say Alabama. `q_001` (birthplace) is
`resolved` at `probable` (Alabama). Its proof summary `ps_001` resolves conflict
`c_001` by tracing "England" to a one-row shift in the 1850 index, and it
carries a `looks_solid` `proof-critique` verdict (`ev_001`). The Alabama birth
is in the tree, and `project.status` is still `active`. So every part of the
objective has a resolved question with its proof critique on record, and the
correct next step is the completion write through `proof-conclusion`.

Parentage is **not** in this objective. The project still mentions it: `q_001`'s
rationale says the birthplace had to be settled before her parentage could be
researched, `ps_001` says parentage "needs its own research question", and the
tree holds imported Robert/Sarah → Elizabeth ParentChild links. Those are the
bait. A router that sends the project back to question-selection for parentage
is checking the project's prose instead of the objective.

## Source and carve

Derived from `compound-objective-part-unframed` (see its README for how that
was carved from the patron project `puzzle3-mhgk`, 2026-10-09). The only
changes are the objective, which drops the parentage clause and asks for the
England/Alabama discrepancy to be explained, and the title, from "origins" to
"birthplace".

**PII:** as in the source scenario. Every subject was born no later than 1850,
is long deceased and is public on FamilySearch.

## Used by

- `ut_research_s59` (`routes-to:proof-conclusion`). It pairs with
  `ut_research_utf` on the source scenario, so the objective check is pinned
  both ways.
