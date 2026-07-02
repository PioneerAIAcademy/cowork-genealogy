# christian-hole-quality

A scenario for exercising `check-warnings`' FamilySearch **quality-score**
integration (`person_quality`), alongside the offline `person_warnings` check.

**Synthetic test data.** These persons are fabricated fixtures, like the Flynn
scenarios — *not* real FamilySearch profiles. The person IDs use the real
`KD96-TV*` shape so the skill's "is this a FamilySearch ID?" gate fires and it
attempts `person_quality`. All tool responses are mocked from
`eval/fixtures/mcp/`; nothing hits FamilySearch. (The `KD96-TV2` quality fixture
mirrors a real captured response for authenticity — Polk County, Minnesota
Norwegian-immigrant data — but the tree facts here are authored, not pulled.)

- **Objective:** review data quality for Christian P. Hole and family.
- **GedcomX persons (all with FamilySearch-style IDs):**
  - `KD96-TV2` — **Christian P. Hole** (subject). Completeness/sourcing gaps but
    no impossibilities: burial has a place (Fairview Cemetery) but **no date**,
    a marriage place missing its city, two untagged residences. Quality fixture:
    7 issues, overall 0.97.
  - `KD96-TV3` — **Inger Hole** (wife). Fully sourced, clean. Quality fixture:
    0 issues.
  - `KD96-TV4` — **Ole C. Hole** (son). Carries a real impossibility — a
    Residence in 1975, **after his 1960 death** — plus quality gaps. Warnings
    fixture fires `hasEventAfterDeath1`; quality fixture: 2 issues.
  - `KD96-TV5` — a **duplicate** of the son that was **deleted** on FamilySearch
    after this project last synced. Still present in the local tree as a stub;
    its `person_quality` fixture returns `TOMBSTONED`.
- **GedcomX relationships:** rt1 (Couple TV2×TV3), r1/r2 (ParentChild → TV4).
- **research.json:** minimal active project; no questions/plans/assertions yet
  (this scenario is about the two review tools, not the research record).

Used by the `person_quality` integration tests in
`eval/tests/unit/check-warnings/` (quality-reported-with-issues,
quality-and-warnings-both-fire, quality-clean, quality-tombstoned). The
synthetic-id **skip** case is covered separately against the Flynn scenario.
