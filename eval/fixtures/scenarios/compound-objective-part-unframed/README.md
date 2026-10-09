# compound-objective-part-unframed

A project whose objective asks **two independent things**: where Elizabeth
Mariah (Turnbow) Barker (b. ~1823) was born, *and* whether she was the daughter
of Robert Franklin Turnbow and Sarah Canterberry. Only the first was ever framed
as a question. `q_001` (birthplace) is `resolved` at `probable` (Alabama), its
proof summary `ps_001` carries a `proof-critique` verdict, and the Alabama birth
is already in the tree. No question covers parentage, and `project.status` is
still `active`.

The bug: `/research` treated "all questions are `resolved`" as "the objective is
answered" and headed to completion. The parentage half was never handed to
question-selection, although `q_001`'s own rationale says the birthplace had to
be settled *before* her parentage could be researched, and `ps_001` says
parentage "needs its own research question". The tree's imported (unproven)
Robert/Sarah → Elizabeth ParentChild links make it easy to read parentage as
already done.

## Source and carve

Mined from a genealogist's Cowork project (`puzzle3-mhgk`, 2026-10-09), run on an
engine older than `main`. **This carve is a best guess at the state the router saw
at the decision point. Verify it before committing.** Changes from the project as
found:

- **Added** `ev_001` and its sidecar under `evaluations/`, a `looks_solid`
  `proof-critique` on `ps_001`. The real run never recorded one. Without it the
  mentor gate fires first and the test could not tell the two failures apart.
- **Dropped** `log_005` and `log_007`, positive reads that had no assertions, and
  `log_010` with its four FAN assertions (`a_017`–`a_020`, unlinked Turnbow men
  with no tree person). Each would trip an earlier routing row (record-extraction
  or person-evidence) before the decision under test.
- **Migrated** to the current schema: the retired pre-#2524 field, `"direct"` on
  every assertion, → `record_basis: "stated"`, and `ps_001.shortfall: "gap"`, because the proof lists reachable
  original census images it did not search.
- **Trimmed** each `results/` sidecar to the records the kept assertions cite.
  `log_011`, a nil search, keeps its first three results.

**PII:** names, dates and places are kept as they appear. Every subject was born
before 1850, is long deceased and is public on FamilySearch, and the routing
decision turns on the objective's own wording. Still review this before
committing.
