# christian-hole-quality

A scenario for exercising FamilySearch's **quality score** (`person_quality`),
today through `source-evaluation`. It was built for check-warnings' quality tests,
which were deleted when check-warnings dropped the tool (issue #2118).

**Synthetic test data.** These persons are fabricated fixtures, like the Flynn
scenarios — *not* real FamilySearch profiles. The person IDs use the real
`KD96-TV*` shape, so `person_quality` treats them as FamilySearch tree persons. All tool responses are mocked from
`eval/fixtures/mcp/`; nothing hits FamilySearch. (The `KD96-TV2` quality fixture
mirrors a real captured response for authenticity — Polk County, Minnesota
Norwegian-immigrant data — but the tree facts here are authored, not pulled.)

- **Objective:** review data quality for Christian P. Hole and family.
- **GedcomX persons (all with FamilySearch-style IDs):**
  - `KD96-TV2` — **Christian P. Hole** (subject). Completeness/sourcing gaps but
    no impossibilities: burial has a place (Fairview Cemetery) but **no date**,
    a marriage place missing its city, five untagged residences. Quality fixture:
    7 issues, overall 0.97.

    **The captured body and `source-evaluation`'s fixture do not match by
    design.** The captured `person-quality-hole-christian` (7 issues, the real
    KD96-TV2 body) is kept for the harness's mock tests. `source-evaluation` uses a reduced `person_read`
    (`person-read-hole-attached-sources`: four facts — Birth 1875,
    Marriage 1898, **one** Residence 1900, Death 1945, and no burial) with its
    own `person-quality-hole-detail` (2 issues, constructed to match those four
    facts). Grade a `source-evaluation` reply against the four-fact profile and
    its 2-issue checklist, not against the 7 above.
  - `KD96-TV3` — **Inger Hole** (wife). Fully sourced, clean.
  - `KD96-TV4` — **Ole C. Hole** (son). Carries a real impossibility — a
    Residence in 1975, **after his 1960 death** — plus quality gaps. Warnings
    fixture `person-warnings-hole-son-event-after-death` fires `hasEventAfterDeath1`.
  - `KD96-TV5` — a **duplicate** of the son that was **deleted** on FamilySearch
    after this project last synced. Still present in the local tree as a stub.
- **GedcomX relationships:** rt1 (Couple TV2×TV3), r1/r2 (ParentChild → TV4).
- **research.json:** minimal active project; no questions/plans/assertions yet
  (this scenario is about the two review tools, not the research record).

Used by the `source-evaluation` suite.
