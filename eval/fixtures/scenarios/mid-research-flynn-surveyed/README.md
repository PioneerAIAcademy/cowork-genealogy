# mid-research-flynn-surveyed

`mid-research-flynn` with the Schuylkill County `localities` entry added, and
nothing else changed: `tree.gedcomx.json` is a byte copy, and `research.json`
is identical apart from the new `localities` section.

- **`localities[loc_001]`:** the Pennsylvania / Schuylkill County entry from
  `flynn-census-exhausted-surveyed`, copied verbatim (time period 1845-1908).

## Why it exists

The research-plan agent stops and returns to its caller when the jurisdiction it
must plan has no `localities` entry (its Step 2), and `mid-research-flynn`
carries none. A test that requires a plan on that scenario contradicts the
agent's own rule; every logged run of `ut_research_plan_010` planned past the
missing entry anyway, but a cold-started agent may not. This twin makes the
plan legitimate without touching `mid-research-flynn`, which 111 unit tests
across 22 suites share.

## Used by

- `research-plan` `ut_research_plan_010` (supersede mode: new information moves
  the date window of the active plan pl_002).
