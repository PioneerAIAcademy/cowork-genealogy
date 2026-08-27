# first-plan-fan-already-sourced

Reuses `first-plan-migration-hypothesis`'s Michael Sheahan / Schuylkill
County setup verbatim (same place, same `localities` entry, same q_001
hypothesis and log entries) and adds one thing: a sibling, Patrick
Sheahan (I2), who already has a **sourced** fact — a land purchase in
Schuylkill County dated 1875, seven years before Michael's earliest
confirmed presence there (1882) — sitting in the tree, already cited to
a real source description.

- **Objective / Questions / Hypotheses / Log:** identical to
  `first-plan-migration-hypothesis` (see that scenario's README).
- **Plans:** none — `plans: []`. This is the FIRST plan for the question.
- **GedcomX persons:** I1 (Michael Sheahan, subject), I2 (Patrick
  Sheahan, brother, FAN-cluster), I3 (their father, unnamed stub, only
  to establish the sibling relationship via two `ParentChild` links —
  carries no facts).
- **Sources:** `S1`, a deed/land record for Patrick's 1875 purchase,
  `quality: 3` (a real, cited record — not an unverified tree import).

## Source and scrub note

Carved (from-scratch reconstruction, not an edited copy) from a real
alpha feedback case (`feedback-2026-08-26T20-24-40-770Z.zip`, issue
#1948, PID redacted): a tester researching an interstate family move
asked "why isn't plan item 1 checking sources already attached to tree
people?" — the agent's own answer named the exact gap: `research-plan`'s
"verify the starting point" step checks *assumptions*, not what's
*already attached* to in-scope persons. The tester separately noted
that the subject's siblings had already moved to the destination
county years before the subject's own move (as early as ~10 years
prior in the real case), which would have been a relevant clue the
agent didn't surface until directly prompted.

This scenario re-derives that shape with entirely invented names, no
real FamilySearch identifiers, and decade-level dates — the real case
involved a private individual's actual family history and real
FamilySearch person IDs, which do not belong in a committed test. It
deliberately reuses `first-plan-migration-hypothesis`'s place and
`localities` entry so the only new variable under test is the
already-sourced sibling fact, not the place infrastructure.

**First-cut caveat — verify before committing:** confirm Patrick's 1875
land purchase is unambiguous FAN-cluster evidence a plan should surface
(not so subtle the test is unfair, not so on-the-nose it grades itself).

## Used by

- `research-plan` tests asserting that a FIRST plan surveys what's
  already attached to in-scope FAN-cluster persons (siblings, not just
  the subject) before planning new searches — issue #1948.
