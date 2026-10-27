# barker-parents-concluded-unlinked

Jonathan Barker (FamilySearch MHGK-WT7), born about 1819 in England, of Jasper
and Smith counties, Mississippi. `q_001` asks where in England he was born. The
search is declared stopped (`question_answered`); conflicts `c_001` (London vs
Whitehaven) and `c_002` (birth year) are resolved. An 1884 LDS Mississippi
District baptism register and a 15 May 1818 Whitehaven christening name his
parents as William Barker and Martha Edwards, but every parent-role assertion
(`a_117`, `a_119`, `a_135`, `a_136`) is unlinked: `person_evidence` links only I1
and I2, and the tree has no person for either parent.

The bug: proof-conclusion wrote a `probable` conclusion naming both parents and
encoded them in the tree (new persons with ParentChild relationships to I1),
although its own preconditions gate stops when a candidate parent the
conclusion depends on has no linked identity assertion.

Source: Cowork project `barker-research-2`, run 2026-10-20 for issue #3177.
This is the state just before proof-conclusion ran: `ps_001` is removed, `q_001`
is set back to `exhaustive_declared` and unresolved, and the tree writes the
proof made are removed (the two parent persons, their ParentChild and Couple
relationships, and I1's christening, death and religion facts). I1's birth is
restored to the Family Tree import (1819, London). Everything else is as the run
left it.

Caveats, review before committing:

- **The carve is a best guess.** Which tree writes came from proof-conclusion was
  inferred from their sources, not read from a trace.
- **The delegation is RECONSTRUCTED.** The Cowork trace was not captured; the
  text follows the suite's other direct-arm tests.
- **The source run was partly on a stale engine.** `q_001` carried the question-level
  stop field #2539 retired on 2026-10-07, marked declared exhaustive; it is
  converted here to `search_stop`. The
  assertions carry the current `record_basis`.
- **One volunteered note was moved out.** The run recorded the researcher's
  statement "There's a Jonathan Barker who died earlier with the same name; he
  isn't mine" — confirmed 20 Oct 2026 as the Jonathan Barker d. 28 Mar 1863,
  buried Vicksburg, Warren Co., MS (Find a Grave index QVG2-WD9K, memorial
  128559372) — in a section issue #2069 later deleted. It is kept here, not in
  `research.json`.
- **Names are real.** Everyone named is deceased and public in the Family Tree,
  as in the other MHGK-WT7 scenarios.
- `results/` holds every sidecar the log references, because the validator
  requires them, each trimmed to the result entries an assertion or source
  cites (`returned_count` adjusted to match).
