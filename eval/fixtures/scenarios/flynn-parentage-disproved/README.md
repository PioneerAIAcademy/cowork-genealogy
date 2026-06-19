# flynn-parentage-disproved

Patrick Flynn parentage research in which a proposed father is **affirmatively
refuted** by a chronological impossibility. Built for the proof-conclusion test
that exercises the **`disproved`** tier and the "do not write the tree below
`probable`" invariant.

The question is narrowed to a single proposed claim: an **unsourced online
FamilySearch tree** names **Thomas Flynn of Ballingarry, County Tipperary**
(b. ~1800) as Patrick's father.

- **The refutation:** the Ballingarry Catholic parish **burial register shows
  Thomas Flynn of Ballingarry was buried on 14 November 1842** — identifiers
  (townland, age, wife Bridget) match the man the tree names. Patrick was born
  **~1845** (1850 census age 5; corroborated by the 1908 death certificate,
  age ~63). A man who died in 1842 cannot have fathered a child born ~1845.

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Questions:** q_001 ("Was Thomas Flynn of Ballingarry the father?", in_progress)
- **Plans:** pl_001 (completed — 1850 census, Ballingarry burial register, death cert)
- **Log:** 3 entries
- **Sources:** 3 (1850 census, Ballingarry burial register, 1908 death cert)
- **Assertions:** 6 (a_003 is the decisive death-in-1842 fact)
- **Conflicts:** none — the chronology refutes outright; no weighing required
- **Hypotheses:** h_001 (Thomas is the father) — **`ruled_out`**, contradicted by a_003
- **Proof summaries:** none yet — this is what the skill under test must produce
- **GedcomX persons:** I1 (Patrick), I2 (Thomas — with his 1842 death fact)
- **GedcomX relationships:** **none** — and none should be added

## Why this should be `disproved`

`disproved` is for evidence that *affirmatively refutes* the hypothesis, as
opposed to merely failing to support it. A father's death three years before
his supposed child's birth is the most airtight kind of refutation — a pure
chronological impossibility, no weighing or judgment call required.

## Scope note

The conclusion **disproves Thomas**; it does not identify the real father —
that would be a separate, future research question. So the skill should write
the `disproved` proof and **add nothing to the tree** (no `ParentChild`
relationship, and no alternative father). Thomas remains in the tree as an
investigated person whose 1842 death fact is already recorded; a correct run
leaves `tree.gedcomx.json` byte-for-byte identical.

## Used by

- proof-conclusion positive test: write a `disproved`-tier conclusion **and
  leave `tree.gedcomx.json` unchanged**.
