# Benny Raphael Taylor — additional spouse Rosemarie Graham (m. 1962)

**Source PID:** `KNJ1-TRX`
**Genre:** `record-hint` (nothing stripped; the answer lives only in records)
**Benny Raphael Taylor is deceased.** (FamilySearch ToS requires all
committed e2e fixtures to be about deceased persons.) He was born
19 Jul 1921 in McCammon, Bannock, Idaho and died 9 Jul 1991 in
Tillamook, Oregon.

## Research question

> How many times did Benny Raphael Taylor marry, and who was each wife? Benny was born 19 July 1921 in McCammon, Bannock, Idaho; resided in Garibaldi, Tillamook, Oregon from the 1930s into the 1970s; and died 9 July 1991 in Tillamook, Oregon.

The question is deliberately **identity-anchored** (birth, residence-span, death)
and open-ended ("how many / who") so the agent researches broadly rather than
looking up a single named gap. The **graded** finding is unchanged: recovery of
the record-only 1962 marriage to Rosemarie Graham (see below). The count framing
also surfaces the two in-tree marriages — Hildagard (1945, sound) and Jolene
(1941, a phantom edge no record supports) — but those are **not graded** here:
Hildagard is already in the tree, and the Jolene phantom cannot be graded as a
negative finding in a record-hint fixture (the avoid-guard is role-blind and the
claim is pre-asserted in the tree). Treat any "2 vs 3 wives" count the agent
reports as flavor, not a pass/fail criterion.

## What was removed from the starting tree

Nothing. This is a **record-hint** fixture: `starting-tree.gedcomx.json`
is byte-identical to `unstripped-tree.gedcomx.json`. The starting tree is
Benny's real tree as snapshotted — his parents (incl. mother Autossie
"Tossie" Bair), his 1945 wife Hildagard, a 1941 tree edge to Jolene
Bartchy, and his two children. The **answer is a marriage the tree is
missing**, discoverable only from records.

## Expected difficulty

hard. The later marriage is not in the tree and the bride's name is not
in the marriage record's **index title**. Three things make it hard:

1. The spouse is only reachable by finding Benny's **1962 Oregon marriage
   record** and his **1991 Oregon death index** entry (surviving spouse
   "Rosema Taylor").
2. The 1962 record (Oregon, Marriage Records 1906-1968; ark
   `1:1:WBF8-1Q3Z`) is indexed as *"Benny Rapheal Taylor and Tossie
   Bain"* — but **"Tossie Bain" is Benny's MOTHER** on that record (a
   garble of Autossie "Tossie" Bair, listed as his parent), **not the
   bride**. The actual bride, Rosemarie Graham, appears only inside the
   record's persons.
3. Autossie Bair **is in the starting tree** as Benny's mother, so an
   agent that keys off the index title risks concluding Benny married his
   own mother, or attaching "Tossie Bain" as a new spouse. The correct
   result recognizes the mother and identifies Rosemarie Graham instead.

## Notes for reviewers

**Answer.** Benny married **Rosemarie Graham** (b. 1942 Portland, Oregon;
parents Arthur L Graham and Rosamund Hoover) on **28 Sep 1962 in Oregon**
(Oregon, Marriage Records 1906-1968, ark `1:1:WBF8-1Q3Z`), corroborated
by Benny's 1991 Oregon Death Index (ark `1:1:VZCQ-5XC`), which names
surviving spouse "Rosema Taylor."

**Provenance / why record-hint, not strip.** Rosemarie was never in the
FamilySearch tree, so there is nothing to strip — this is the "answer in
a record, missing from the tree" case. The subject's earlier spouse
history (a well-documented 1945 marriage to Hildagard Duclos, indexed
under "Bauer"/"Dorlos"/"Baner", and a phantom 1941 edge to Jolene Bartchy
that no record supports) is left in the starting tree as real state;
record-hint cannot strip it. This fixture was narrowed to a single
recoverable answer after an answerability review showed the two-wife
"strip" design was miscalibrated (the 1941 edge is a phantom, and the
harness cannot grade an in-tree and a records-only marriage in one
fixture).

**Related.** The namespace trap here (a parent surfacing as a false
spouse candidate under a garbled index) is the scenario behind the
bundled skill guard shipped with this fixture's PR.
