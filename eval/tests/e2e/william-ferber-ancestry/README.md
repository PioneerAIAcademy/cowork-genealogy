# William Hubert Ferber — ancestral origins & death

**Source PID:** `G7JB-YH6`
**William Hubert Ferber is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.)

## Research question

> What are the ancestral origins and details surrounding the death of
> William Hubert Ferber (father of Charles Hubert Ferber, b. 1891,
> Cincinnati, Ohio)?

This is a **compound objective** with two halves — the agent must recover
both to fully answer it:

1. **Ancestral origins** — William's parents and their German/Bavarian
   immigrant roots (findings f1, f2).
2. **Death details** — William's death and burial (findings f3, f4).

The subject is anchored via his son Charles Hubert Ferber (b. 1891), who
is left in the starting tree along with William's wife Emma Becker.

## What was removed from the starting tree

- Removed fact 0677bc72-f54a-425a-a6a3-75482bc79b01 on G7JB-YH6: Death 11 March 1903 Cincinnati, Hamilton, Ohio, United States
- Removed fact a96396c0-4e00-40c9-ae20-66a4922555d2 on G7JB-YH6: Burial  Cincinnati, Hamilton, Ohio, United States
- Removed person G7J1-QF2: Eva Engermann
- Removed person GCD9-9X1: Gerhard Ferber
- Removed relationship R2 (Couple GCD9-9X1/G7J1-QF2): cascaded from a removed person
- Removed relationship R3 (ParentChild GCD9-9X1/G7JB-YH6): cascaded from a removed person
- Removed relationship R4 (ParentChild G7J1-QF2/G7JB-YH6): cascaded from a removed person
- Removed source 3JRQ-P44: Web: Cincinnati, Ohio, U.S., Spring Grove Cemetery Index, 1845-2012
- Removed source 3JRQ-P48: 1870 United States Federal Census
- Removed source 3JRQ-P4Z: U.S., Find a Grave Index, 1600s-Current
- Removed source QBZV-2V6: William H Ferber, "Find a Grave Index"
- Removed source SL2T-6WR: William Faerber, "United States, Census, 1870"
- Removed source SLJX-SCP: Wm. Ferber, "Ohio, County Death Records, 1840-2001"

Two of the removed sources were double answer-leaks and were the primary
targets of the strip: the **1870 census** (SL2T-6WR / 3JRQ-P48) lists both
parents — "Gerhardt and Eva Faerber" — with infant William in the
household, and the **1903 Ohio death record** (SLJX-SCP) gives the death
date *and* separately names Gerhard Ferber as the decedent's father.

**Anchors left intact** (known starting context): William's birth
(Dec 1869, Ohio) and Cincinnati residences (1870, 1900); his wife Emma
Becker and their 1890 marriage; his son Charles Hubert Ferber; the 1900
census (which lists William's parents' birthplace as *Germany* — a
legitimate origin breadcrumb that does **not** name them); the 1890
marriage records; Emma's 1948 Kentucky death record; and the "Wm"/"Wm H"
Cincinnati city-directory entries.

## Expected difficulty

medium — Both halves are strongly corroborated in the live source data
(1870 census household, 1903 death record naming the father, father's
1917 obituary, Find a Grave, Spring Grove cemetery index), so the answers
are recoverable. The friction is that this is a **compound** objective and
that the ancestral origins reach back into German/Bavarian immigrant
records, requiring the agent to correlate a census household with a death
record rather than reading parents off a single profile.

## Notes for reviewers

- **Two expected `fact` findings (f3 death, f4 burial) trip a name-overlap
  WARN** in the stripping linter, because the anchor person Charles Hubert
  Ferber (G7JB-Y46) remains in the tree and shares the surname "Ferber"
  (and given "Hubert"). This is a **false positive**: William's death and
  burial facts were removed from William (G7JB-YH6); Charles's *own* death
  (12 Dec 1967, Fort Lauderdale, Florida) and burial facts are legitimately
  his and are unrelated to William's answer. William's 1903 death date is
  **not** present anywhere in the starting tree.
- **Burial is graded leniently.** William's own tree burial fact recorded
  only "Cincinnati" (no cemetery), so finding f4's graded place is
  "Cincinnati, Hamilton, Ohio"; the specific cemetery (Spring Grove) is a
  bonus. Note that both retained relatives (Charles and Emma) are buried at
  Spring Grove, so the cemetery name is visible in the tree — treat "Spring
  Grove" as a family-context breadcrumb, not proof for William specifically.
- Eva Engermann's maiden surname and the exact parent names come only from
  the removed 1870 census; the retained 1900 census leaks the *origin*
  (Germany) but not the *names*, which is the intended breadcrumb.
