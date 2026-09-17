# Robert Lord — children James and Betsy in the 1911 Rochdale census

**Source PID:** `GSPY-NFZ`
**Robert Lord is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1858, Lancashire; resident at Rochdale St Chad and Spotland in 1891; death not recorded in the tree.

## Research question

> Is the Robert Brierley enumerated at Rochdale in 1911 with wife Ellen and children James and Betsy the same man as Robert Lord (b. 1858, son of Abel Brierley), and did he have those two children?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `GSPY-NFZ` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Adjudicated 2026-09-16: false match.** The hint record (`ark:/61903/1:1:X4M4-HG9`) — the 1911 Rochdale census household of Robert Brierley (b. 1866) and Ellen Brierley née Mayo with children James and Betsy — is a different family from tree person Robert Lord (GSPY-NFZ, b. 1858). Four independent lines of evidence converge:

1. **Birth year gap.** The hint's Robert Brierley was born 1866; Robert Lord was born 1858. An eight-year discrepancy is irreconcilable with census age variation (which typically runs 1–3 years).

2. **Different fathers.** The 1893 marriage record (`ark:/61903/1:1:NKKY-C2T`, Robert Brierley + Ellen Mayo, Rochdale) names the groom's father as Robert Brierley. The tree's Robert Lord has Abel Brierley as his father — confirmed by the 1891 census LifeSketch attached to the tree.

3. **Robert Lord found separately in 1901.** The 1901 England and Wales Census (`ark:/61903/1:1:X9LD-V5K`) places Robert Lord (b. 1858, Single, Quarry Banksman) at Bacup, Lancashire, in the James Henry Brierley household — a definitively separate location and household from the 1911 Rochdale family. He is still recorded as Single, confirming no marriage had occurred by that date.

4. **Wife's maiden name.** Ellen Brierley in 1911 was born Ellen Mayo, married Robert Brierley in 1893. No marriage of a Robert Lord to any Ellen was found in the Rochdale area.

The earlier draft's apparent match on the wife's name was spurious: the tree's GSPY-LH7 (Ellen Lord, b. 1870, Single, Cotton Weaver) appears in the 1891 census in the same household as Robert Lord and his brother James — almost certainly Robert's sister, not his wife. The couple link R1 in the starting tree is a tree error.

**Searched empty:** England and Wales, Marriage Registration Index, 1837-2005 — no marriage of Robert Lord or Robert Brierley to an Ellen with maiden name Lord or Brierley in Rochdale, 1890–1896.

This is a clean restraint test: attaching two children to the wrong Lancashire mill-town Robert is precisely the error the benchmark is meant to catch.

## Run history

**2026-09-16 — Cowork live debug (Step 4): passed.** The agent correctly disproved the match. It found the simultaneous 2 April 1911 census entries — Robert Lord as Single at Bacup in the James Henry Brierley household (`ark:/61903/1:1:X4M8-5JM`) while the Rochdale Robert Brierley was at home with wife Ellen and children — and documented a negative conclusion. The fixture is solvable from live FamilySearch.

**2026-09-16 — first headless run (`run-2026-09-16_14-15-30`): agent over-claimed (failure).** Stop reason `cost_cap` ($15.87, 354 tool calls, ~105 min). The agent found the Rochdale Robert Brierley's coherent paper trail across four census years (1881, 1891, 1901, 1911) plus the 1893 marriage register and GRO birth index, concluded the tree's 1858 birth year was an error, and asserted GSPY-NFZ as father of I3 (James) and I4 (Betsy) via R6/R7. It never found the disproving 1911 record (`ark:/61903/1:1:X4M8-5JM`, Robert Lord Single at Bacup on the same census night) — the one record that makes simultaneous identity impossible. The 1891 source it found was the Ellen Brierley widowed household (the hint person's mother's household), not the James Henry Brierley household where Robert Lord actually appears. Compliance failed: `same_person` not called for I5, I6, I9.

**2026-09-16 — second headless run (`run-2026-09-16_16-55-35`): agent restrained but f2 incomplete (failure).** Stop reason `completed` ($11.12, 166 turns). The agent correctly concluded `disproved`: it identified the 8-year birth year gap (four independent sources all placing Robert Brierley at ~1866), found the Griffith Brierley + Ellen marriage index entry (1859, Rochdale) establishing that Ellen's husband was Griffith not Abel, and ran five negative searches for any Robert with father Abel. It did NOT add wrong parent-child relationships — James (I1) and Betsy (I2) exist as stubs with no link to GSPY-NFZ. The 1911 Robert Lord at Bacup record (`ark:/61903/1:1:X4M8-5JM`) was not found again. The specific negative marriage-index search for Robert Lord or Robert Brierley + Ellen in Rochdale 1890–1896 (the f2 evidence path) was not performed; the agent reached the negative conclusion via a different route. Compliance failed: `same_person` not called for I1, I2; `conflict-resolution` skipped despite a resolved conflict in research.json.
