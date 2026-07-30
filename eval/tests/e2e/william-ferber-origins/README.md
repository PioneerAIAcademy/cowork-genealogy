# William Hubert Ferber — ancestral origins

**Source PID:** `G7JB-YH6`
**William Hubert Ferber is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.)

## Research question

> What were the ancestral origins of William Hubert Ferber (father of
> Charles Hubert Ferber, b. 1891, Cincinnati, Ohio) — who were his
> parents, and where did the family come from?

This is the **single-focus origins half** split off from the compound
`william-ferber-ancestry` fixture. Its companion is
`william-ferber-death-1903`; together the two single-focus fixtures
replace the compound one, which timed out before finishing both halves.
Here the agent must recover only **who William's parents were** and
**where the family came from** (German/Bavarian immigrant roots).

## What was removed from the starting tree

- Removed person G7J1-QF2: Eva Engermann
- Removed person GCD9-9X1: Gerhard Ferber
- Removed relationship R2 (Couple GCD9-9X1/G7J1-QF2): cascaded from a removed person
- Removed relationship R3 (ParentChild GCD9-9X1/G7JB-YH6): cascaded from a removed person
- Removed relationship R4 (ParentChild G7J1-QF2/G7JB-YH6): cascaded from a removed person
- Removed source 3JRQ-P48: 1870 United States Federal Census
- Removed source SL2T-6WR: William Faerber, "United States, Census, 1870"
- Removed source SLJX-SCP: Wm. Ferber, "Ohio, County Death Records, 1840-2001"

**Only William's parents and the sources that name them were removed.**
William's own vitals — including his death (11 Mar 1903) and burial — and
the rest of the family (wife Emma Becker, son Charles Hubert Ferber, the
1890 marriage) are all retained as given context. This is the deliberate
mirror of the death split: the death is *given* here, so the agent's only
job is the parents and their origins.

Two of the removed sources are the parent-namers and were the primary
targets: the **1870 census** (SL2T-6WR / 3JRQ-P48) lists both parents —
"Gerhardt and Eva Faerber" — with infant William in the household, and the
**1903 Ohio death record** (SLJX-SCP) separately names Gerhard Ferber as
the decedent's father. The agent must re-find these (or equivalent
records) through the FamilySearch tools.

**Anchors left intact:** the 1900 census, which lists William's parents'
birthplace as *Germany* — a legitimate origin breadcrumb that does **not**
name them; the 1890 marriage records; Emma's 1948 Kentucky death record;
William's Find a Grave / Spring Grove burial sources; and the "Wm"/"Wm H"
Cincinnati city-directory entries.

## Expected difficulty

medium — The parents are recoverable, but only by re-finding the stripped
1870 census (which places infant William in Gerhard and Eva's household)
or the 1903 death record (which names Gerhard as father); the retained
1900 census only points at *Germany*, not at names. The mother's maiden
surname, **Engermann**, appears solely in the stripped 1870 census, so it
is the hardest single detail — in the compound run the agent found the
mother but recorded her as "Eva Ferber" (married surname). German
immigrant origins add the usual correlation friction.

## Notes for reviewers

- The mother's maiden name **Engermann** is the discriminating detail:
  recovering her as "Eva Ferber" (married surname) with the right parent
  link is a partial result; recovering "Eva Engermann" is full.
- William's death and burial are present in the starting tree by design —
  they are context here, not the answer. Do not treat their presence as a
  leak; the origins answer (parent identities and German/Bavarian birth)
  is absent.
- The retained 1900 census leaks the *origin* (parents born in Germany)
  but not the *names*, which is the intended breadcrumb.
