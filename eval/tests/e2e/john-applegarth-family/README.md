# John Edward Applegarth

**Source PID:** `KZJT-4PT`
**John Edward Applegarth is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.)

## Research question

> Who were John Edward Applegarth's parents, and who were (at least three of) his siblings?

## What was removed from the starting tree

- Removed person K2SF-JWG: Elmer Thomas Applegarth
- Removed person K2SF-X4L: Abzina Applegarth
- Removed person KFJM-K3K: Andrew Joseph Applegarth
- Removed person KFNB-VZ8: Henry William Applegarth
- Removed person KFNB-VZB: Mary Jane Applegarth
- Removed person KZ1W-41D: Lewis Henry Applegarth
- Removed person KZ65-PLD: William Charles Applegarth
- Removed person L489-94J: Nancy Jane Clark
- Removed relationship R2 (Couple KFNB-VZ8/L489-94J): cascaded from a removed person
- Removed relationship R3 (ParentChild KFNB-VZ8/KZJT-4PT): cascaded from a removed person
- Removed relationship R4 (ParentChild L489-94J/KZJT-4PT): cascaded from a removed person
- Removed relationship R17 (ParentChild KFNB-VZ8/K2SF-X4L): cascaded from a removed person
- Removed relationship R18 (ParentChild L489-94J/K2SF-X4L): cascaded from a removed person
- Removed relationship R19 (ParentChild KFNB-VZ8/K2SF-JWG): cascaded from a removed person
- Removed relationship R20 (ParentChild L489-94J/K2SF-JWG): cascaded from a removed person
- Removed relationship R21 (ParentChild KFNB-VZ8/KZ65-PLD): cascaded from a removed person
- Removed relationship R22 (ParentChild L489-94J/KZ65-PLD): cascaded from a removed person
- Removed relationship R23 (ParentChild KFNB-VZ8/KFJM-K3K): cascaded from a removed person
- Removed relationship R24 (ParentChild L489-94J/KFJM-K3K): cascaded from a removed person
- Removed relationship R25 (ParentChild KFNB-VZ8/KFNB-VZB): cascaded from a removed person
- Removed relationship R26 (ParentChild L489-94J/KFNB-VZB): cascaded from a removed person
- Removed relationship R27 (ParentChild KFNB-VZ8/KZ1W-41D): cascaded from a removed person
- Removed relationship R28 (ParentChild L489-94J/KZ1W-41D): cascaded from a removed person
- Removed 26 sources that named Henry William Applegarth or a sibling directly
  (Minnesota state censuses, Nebraska marriage/pension/burial records, Find A
  Grave entries) so the parent/sibling identities aren't leaked through the
  starting tree's source list.

John's spouse Georgian Francis Pebley and their six children remain in the
starting tree as known context; they are not part of this fixture's
findings.

## Expected difficulty

easy — Parents and siblings are all well-documented via Minnesota state/federal
censuses and Nebraska marriage/death records; the 1861 Wabasha County, MN
marriage record directly names both parents.

## Notes for reviewers

- This fixture snapshots from two FamilySearch `person_read` calls merged
  together (subject KZJT-4PT and father KFNB-VZ8), because `person_read
  --relatives` only returns kin one hop from the queried PID and John's own
  siblings sit two hops away (through his parents). The merge is filtered
  down to exactly: John, his 2 parents, his 6 siblings, his spouse, and his
  6 children — no other collateral relatives from the broader family network.
- 8 total findings (2 parents + 6 siblings) exceeds the skill's 1-5 required
  finding guidance, so only 5 are `required: true` (both parents + siblings
  Andrew Joseph, Mary Jane, and Lewis Henry). The remaining 3 siblings
  (William Charles, Abzina, Elmer Thomas) are `required: false` bonus
  findings — a passing run does not need to recover them.
