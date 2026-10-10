# William Honeyman (Hunneman)

**Source PID:** `PID-TODO`
**William Honeyman (Hunneman) is deceased** (buried Rudby, Yorkshire, 27 March 1783). Every person in this tree is deceased. (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.)

## Research question

> There's a dispute about my ancestor William Honeyman's baptism: some sources say 1716, others 1719. His father is listed as from Fife but I'm not sure that's proven. Can you sort this out?

## What was removed from the starting tree

Nothing was stripped. This is a PID-less fixture: the starting tree was
**constructed** from a FamilySearch tree import (FamilySearch Family Tree person
LZJF-J13, imported 6 Oct 2026) so it holds the family's long-held claim the patron
is asking about:

- **William (I1):** the import's 5 Apr 1719 Hutton Rudby christening and birth were
  replaced with the family's claim, a christening on 2 Dec 1716 at Edinburgh and a
  birth in 1716 at Edinburgh. His 1783 death and burial and the "weaver" occupation are kept.
- **Father William Honniman (I2):** kept as imported, with the claim under test: born
  about 1679, christened Scoonie, Fife, 8 May 1692, died 1737 Hutton Rudby, "slater".
- Mother Phillis Mackannel, wife Catherine Codling (marriage 20 Aug 1738), and their
  eight children are kept as imported.
- The tree's **life sketches are not included**: they argue the 1716-versus-1719
  question themselves and would leak the answer.

## Expected difficulty

medium — the 1719 baptism and the sibling baptisms are indexed on FamilySearch, but
the agent has to argue against a claim already in the tree, and the 1783 burial age
(66) points to a birth around 1716–17.

## Notes for reviewers

**Ground truth** is a Cowork run on 8 Oct 2026, graded by the fixture author,
corroborated by an earlier Cowork run on 6 Oct 2026. Both runs are recorded on issue
#3177 (patron query 1939) and agree on:
the 1719 Hutton Rudby baptism is Probable, the 1716 Edinburgh baptism belongs to a
different child (parents William Honniman and Elizabeth Duncan), and the father's
Fife origin is Not proved.

**Grade the evidence, not just the conclusion.** Removing the 1716 claim from I1
without parish records the agent found and cited should not earn f2.

**f3 is not required.** Not proved is not disproved, so a correct run may leave I2's
Scoonie facts in place, and the final tree cannot tell that run from one that did
nothing.

**Authoring note.** The starting tree was constructed rather than snapshotted, so
its fidelity should be sanity-checked against the source above. `source_pid` is an
unused placeholder. Evidence beyond FamilySearch's reach: the "proved" upgrade the
write-up names (wills at the Borthwick Institute, York; Hutton Rudby settlement
certificates at North Yorkshire County Record Office) is offline, so f1 is graded at
the indexed-record level and Probable is a correct tier. A §14 validity run is
recommended before relying on this fixture's grades; it is not a merge blocker.
