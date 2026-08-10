# Heinrich Dewus — death date and additional children (Milwaukee, 1936)

**Source PID:** `9VX4-1C3`
**Heinrich Dewus is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born in
Pommerania, Preussen, Germany (undated in the tree; the obituary says
about 1850); the tree carries an undated Death fact.

## Research question

> When did Heinrich Dewus of Milwaukee, Wisconsin (born about 1850 in
> Pommerania, Germany) die, and did he and his wife Augusta have
> children besides the four already in the tree?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture (`"genre": "record-hint"`
in `fixture.json`, spec §3.6): the expected answers never appeared in
the FamilySearch tree. `starting-tree.gedcomx.json` is the live
snapshot as-is (captured 2026-07-10, PID `9VX4-1C3` with relatives,
written by `strip --none`), and `unstripped-tree.gedcomx.json` is
committed identical to it so `snapshot --check` can audit upstream
drift. The starting tree has Heinrich, his wife Augusta Arndt, and four
children — Alma (b. 1882), Adela (b. 1883), Hedwig (b. 1885), and
Heinrich Charles (b. 1889), all Milwaukee — with an **undated** Death
fact on Heinrich and no Walter, Ida, or Eleanor.

**Known advisory WARNs:** the stripping linter flags finding `f1`
twice. Against the subject `9VX4-1C3` because he is still in the tree
with a Death fact — by design: the tree's Death fact is *undated*, and
`f1` asks for the death **date**. And against his son Heinrich Charles
Dewus (`KJW8-43Q`), who shares the name tokens and carries his own
(dated, 1958) death — a different person, not the answer. Nothing
should be removed.

## Expected difficulty

medium — The family is well-anchored in Milwaukee (four children with
Wisconsin birth/christening records already attached), and the obituary
is reachable through record search. The work is in the variants: the
obituary is jointly indexed under **Dewus** and **Downs** (with
children indexed as Dewes/Downs), children appear under married names
(Schmidt, Kniophoff, Henke), and the agent must separate the three
genuinely new children from the four it already has.

## Notes for reviewers

**RESOLVED — true match** (adjudicated 2026-08-04). The 1936 obituary
(`ark:/61903/1:1:Q5SZ-SH29`) genuinely belongs to tree person Heinrich
Dewus (`9VX4-1C3`). The findings are kept as originally transcribed,
with **one correction: the death date is 23 August 1936, not 28
August** (see `f1`).

How the call was made, so the next reviewer can re-derive it without
redoing the work:

- **Baseline check first.** The only records attached to `9VX4-1C3`
  were the four known children's birth records — no death record, no
  obituary. So the hint is genuinely new information, not a re-index of
  a source the person already had.
- **Four of the obituary's seven children align with the tree's four** —
  Mrs Alma Schmidt ↔ Alma b. 1882 (the tree already shows Alma married
  a Paul Schmidt), Mrs Adele Kniophoff ↔ Adela b. 1883, Mrs Hattie
  Henke ↔ Hedwig b. 1885, Henry C ↔ Heinrich Charles b. 1889; and the
  birth (about 1850, Germany) squares with the tree's Pommerania origin.
- **The three genuinely new children (Walter, Ida, Eleanor) are
  independently confirmed, not merely asserted by the obituary.** The
  1900 U.S. Census shows the whole family in one household — the
  parents, the four known children, and Walter, Ida, and Eleanor
  together. Each of the three also carries their own later records
  naming Henry and Augusta as parents (Walter: WWI draft registration
  and grave; Ida and Eleanor: death records). That independent
  corroboration is what rules out the "extra names belong to another
  family" failure mode that sinks a false match.
- **Dewus/Downs double-index resolved as one man** — the two
  head-of-entry personas (Henry **Dewus**, carpenter / Henry **Downs**,
  builder) share the same birth and death data.
- **Death-date correction.** The obituary is stamped 28 August 1936,
  but that is the print date. A separate death notice and a memorial the
  family ran exactly one year later both give **23 August 1936** as the
  actual date of death — five days earlier. `f1` now reads 23 August.
- **Not added: a possible eighth child, Martha**, who appears in the
  1900 census but not the obituary and had likely died before 1936. No
  record backs an obituary-era claim for her, so she is deliberately
  left out of the expected findings.

`f4` (Eleanor) is kept `required: false`: she is now confirmed a real
child, but she remains the hardest of the three for the agent to
recover — indexed only under the *Downs* variant, and residing in
Chicago rather than Milwaukee.

**2026-08-06 — Resolved and run (EdmondOware).** Adjudicated a **true match**
with one value fix: f1 death date corrected 28 Aug → 23 Aug 1936 (28 Aug is the
obituary print date; 23 Aug is the actual death, per the Q5SZ-J9LG persona, a
separate death notice, and the 1937 memorial). Per-finding confirming ARKs added
to `supporting_sources` by hand (Q5SZ-J9LG / SH29 / SH23 / SH27 / SH2H), pending
#970's ark-capture support. `starting-*` files untouched.

Run `run-2026-08-06_07-25-30` (autonomous): recall **pass** — all three required
findings recovered and materialized into the tree (Heinrich's 23 Aug 1936 death;
Walter and Ida added as children of Heinrich + Augusta). f4 (Eleanor) correctly
**not** asserted: the run judged the obituary a Henry Downs / Henry Dewus
conflation and excluded Eleanor (Downs surname, Chicago) as a Downs daughter — if
this fixture is ever promoted, reconsider whether f4 should remain a bonus Dewus
expected finding. Proof quality **2** (both conclusions thin: single-obituary
source, census/birth corroboration came back nil).

**Compliance: FAIL — not a fixture defect.** The run bypassed the `same_person`
identity guardrail when creating/linking the new children (shadow-mode). Reported
to DallanQ for a separate skill/engine PR; tracked outside this fixture PR.
