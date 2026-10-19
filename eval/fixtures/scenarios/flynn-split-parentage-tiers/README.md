# flynn-split-parentage-tiers

Patrick Flynn parentage research — same base project as `mid-research-flynn-no-proof`, plus a second, much weaker candidate parent. Built for #1711: a parentage question where paternity and maternity warrant different confidence tiers, so the skill must write a per-claim `claims[]` breakdown on the proof summary rather than letting one scalar `tier` speak for both.

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Questions:** q_001 (parentage, in_progress), q_002 (1850 census placement, resolved)
- **Plans:** pl_001 (1850 census search, completed), pl_002 (parentage evidence, active — now includes a completed 1870-census item, pli_007)
- **Log:** 6 entries — 1850 census on FamilySearch/Ancestry/MyHeritage, 1860 census, death cert, 1870 census
- **Sources:** 5 sources (1850 census FS, 1850 census Ancestry, 1860 census, death cert, 1870 census)
- **Assertions:** 15 assertions across 5 sources
- **Person evidence:** 7 links (Patrick → I1, Thomas → I2, Bridget → I3)
- **Conflicts:** 1 resolved (birthplace: Ireland vs Pennsylvania) — unrelated to the parentage split
- **Hypotheses:** h_001 (Thomas is Patrick's father, supported), h_002 (Bridget is Patrick's mother, active — deliberately thin)
- **Timelines:** t_001 (Patrick, 4 events, 1 gap)
- **Proof summaries:** none yet — this is what the skill under test must produce
- **GedcomX persons:** I1 (Patrick Flynn), I2 (Thomas Flynn), I3 (Bridget Flynn)
- **GedcomX relationships:** none yet — I1, I2, and I3 are all present but **unlinked**. Both candidate-parent links (I2→I1 paternity, I3→I1 maternity) are undecided pre-state; the run must decide each independently.

## The evidence split

**Paternity (Thomas Flynn, I2) — strong.** Identical to `mid-research-flynn-no-proof`: 1850 census co-residence (indirect), 1860 census co-residence (indirect), and the 1908 death certificate naming Thomas as father (direct, secondary informant). Three independent original sources converge. This alone supports `probable`.

**Maternity (Bridget Flynn, I3) — weak.** A single 1870 census record shows a widowed Bridget Flynn, common surname, in the same county — but:
- No record names a wife for Thomas Flynn (I2) at all, living or dead.
- Nothing ties this specific Bridget to Thomas beyond a shared, common surname and her being a widow of roughly the right era.
- No record names Bridget as Patrick's mother, or as anyone's mother.
- `pe_007`'s `match_score` is `0.0002` — the same order of magnitude as the real-world case that raised #1711 (`ev_001`, a maternal link written to the tree at `probable` on a 0.0002-scored `same_person` match plus the BCG-unsound "the widow was the mother of his children" assumption, named explicitly in `a_015`'s `informant_bias_notes`).

This supports at most `possible` — "credible hypothesis, some supporting evidence, significant gaps" (§2 of the `proof-conclusion` agent).

## What a correct run does

Writes a `claims[]` breakdown on the `proof_summaries` entry for q_001: a `paternity` claim at `probable` (relationship `{ type: "ParentChild", parent: "I2", child: "I1" }`) and a `maternity` claim at `possible` (relationship `{ type: "ParentChild", parent: "I3", child: "I1" }`). The scalar `tier` carries the stronger claim (`probable`). In the tree, only the paternal `ParentChild` (I2→I1) is written; the maternal one (I3→I1) stays absent — a `possible` claim never rides into the tree on the coattails of the scalar.

**What a pre-#1711 run would incorrectly do:** write a single scalar `tier: "probable"` (justified by the paternal evidence) with no breakdown, then encode **both** `ParentChild` relationships because the tree-encoding gate only checked the scalar — silently promoting the 0.0002-scored maternal guess to the same confidence as the well-evidenced paternal link. That is the exact defect this fixture exercises.

## Used by

- `proof-conclusion` positive tests where the skill must write a per-claim tier breakdown and encode only the claim(s) that individually clear the `probable` threshold. See `eval/tests/unit/proof-conclusion/split-parentage-per-claim-tier.json` (tag `per-claim-tier-split`) and `eval/harness/validators/test_proof_conclusion.py::test_per_claim_tree_encoding`.
