# Pauline 'Polly' Wilkins Shaver — death (1935)

**Fixture ID:** `pauline-shaver-death-burial`
**Subject PID:** 27HB-Z94
**Research question:** When did Pauline 'Polly' Wilkins Shaver die?

## What the fixture tests

The agent must find the death date for Pauline "Polly" Wilkins Shaver
(born 9 June 1848, Muhlenberg, Kentucky). Both the death fact and burial fact have been
stripped from the starting tree. The agent must recover the death by searching records;
recovering the burial too earns bonus credit.

## Expected findings

| ID | Required | Finding |
|----|----------|---------|
| f1 | yes | Death: 30 November 1935, Muhlenberg, Kentucky |
| f2 | no (bonus) | Burial: Shavers Cemetery, Lynn City, Muhlenberg, Kentucky |

## Key sources the agent should find

- **Kentucky Death Records, 1911–1963** (`9GP3-SD7`) — Polly Shover, died 30 Nov 1935,
  Muhlenberg, KY; father listed as Eligah [Elijah] Wilkins
- **Kentucky, Vital Record Indexes, 1911–1999** (`QJK5-W2P`) — Polly Shower, 30 Nov 1935
- **Find a Grave Index** (`QJK5-S9D`) — Polly Wilkins Shaver, 1935; burial at Shavers Cemetery

## Starting tree

The starting tree includes Pauline with birth (9 Jun 1848) and census residences
(1850–1920) but **no death or burial**. It also includes:

- **Husband:** Williams Timmons Shaver (27HB-Z7R) — married 8 Jun 1873, Muhlenberg, KY;
  died 12 Jul 1922, buried at Shavers Cemetery (the same cemetery as Pauline — a clue)
- **Father:** Elijah Wilkins (97YZ-J3D) — born 1814, died 30 Nov 1875, Muhlenberg, KY
- **Mother:** Sally Wilkins (K2BS-YMD) — born abt 1818, Muhlenberg, KY

## Difficulty

Easy. The subject has a clear FamilySearch PID, consistent surname (Shaver), and multiple
census records anchoring her to Muhlenberg County, Kentucky throughout her life. The
Kentucky death record names her father (Elijah Wilkins), directly confirming identity.
The cemetery (Shavers Cemetery) shares the family surname, making it memorable and
distinctive.

## Notes for reviewers

**2026-11-04 — re-scoped for step mode (issue #4144).** The old question asked
two independent facts (death, and burial): "When did Pauline 'Polly' Wilkins
Shaver die, and where is she buried?" Reworded `researcher_question` to the
death only; demoted `f2` (burial) to `required: false`, so a run that
recovers it anyway still gets credit. No finding wording changed, and this
fixture has no committed runs to re-grade. This is this fixture's first
"Notes for reviewers" section.
