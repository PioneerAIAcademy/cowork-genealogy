# namesake-planted-bounded-death

A copy of `wilkins-bounded-death` (read its notes below) made for issue #3363 PR 2, so the planted-row test never touches the shared scenario. Two changes: a namesake row on I1 (`ns_001`, a second Elijah Wilkins of Muhlenberg County, born about 1822), and `pe_001`, the estate record's death assertion to I1, lowered to `speculative` with a rationale naming him, as person-evidence leaves a link the namesake cap refuses. `tree_edit` now refuses a fact on I1 citing S1: no link from that record to I1 is one the cap allows.

---

# Scenario: wilkins-bounded-death

proof-conclusion is ready to conclude a **death** question where the exact date is
unrecoverable but a **bounded / documented-negative** conclusion is well-supported:

- Subject Elijah Wilkins (`I1`), b. c.1814, alive at the 1870 census (tree fact `F2`).
- No Kentucky death certificate exists (statewide registration began 1911; documented
  negative, `log_001`).
- The Muhlenberg County estate administration (`a_001`/`a_003`, `src_001`) shows him
  deceased by 1885, with his son Jesse as administrator anchoring identity.

The correct conclusion is a **bounded death** — 'after 1870, before 1885, Muhlenberg
County; no KY certificate exists' — tiered at the level its evidence supports (probable)
and ENCODED as a Death fact on `I1`. Collapsing to not_proved and leaving the tree silent
on death is the failure this scenario guards (proof-conclusion agent body §2/§6, issue #657).
