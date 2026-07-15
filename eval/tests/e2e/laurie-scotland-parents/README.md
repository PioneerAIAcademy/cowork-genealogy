# John Laurie — parents (Glasgow, Scotland; the stepmother trap)

**Source PID:** `GPZR-3X2`
**John Laurie is deceased.** (FamilySearch ToS requires all committed e2e
fixtures to be about deceased persons.) Born about 1859 in Glasgow, Lanarkshire,
Scotland (baptized 24 February 1859); emigrated to New York; married Ellen Cahill
in 1888; died 7 December 1909 in New York City.

## Research question

> Who were the parents of John Laurie, born about 1859 in Glasgow, Lanarkshire,
> Scotland, who married Ellen Cahill in New York in 1888 and died in 1909 in New
> York City?

## Why this fixture exists — the teaching trap

This is a **biological-mother vs. stepmother** disambiguation. John Laurie (Sr.)
married **three** times:

- **Mary Marshall** — married the father **13 Mar 1857**, so the mother of a child
  born 1859; **died 27 Dec 1860.** She is the **biological mother**, named on the
  1859 baptism.
- **Agnes Wardrop** — married the father **3 Oct 1861**, *after* John was born and
  *after* Mary Marshall died → a **stepmother**. She is enumerated alongside young
  John in the **1871 Scottish census**.
- Agnes McIntyre — a further wife (died before April 1861); a minor distractor.

The trap: the reliable, habitual move — read the census household and take the
adult woman as the mother — yields **Agnes Wardrop, the wrong answer.** The correct
biological mother (Mary Marshall) is reachable only from the **1859 baptism** plus
the **marriage/death timeline** (mother died 1860, father remarried 1861). An agent
that leans on the census will name the stepmother; an agent that reasons about the
timeline will not.

## What was removed from the starting tree

- Removed person K8NG-9FD: John Laurie (father — b. 1833 Gorbals, Glasgow; iron moulder; d. 1910)
- Removed person G1YV-YL1: Mary Marshall (biological mother — b. ~1837; d. 27 Dec 1860 Glasgow)
- Removed person 94B2-5YW: Agnes Wardrop (stepmother — m. the father 3 Oct 1861)
- Removed person GBTQ-468: Agnes McIntyre (a further wife of the father; distractor)
- Removed relationships R2/R3/R4 (Couple links among the father and his three wives): cascaded from removed persons
- Removed relationships R5/R6/R7/R8 (ParentChild links from the father and the three women to John): cascaded from removed persons
- Removed source W7GR-KD1: John Lawrie, "Scotland, Presbyterian & Protestant Church Records, 1736-1990" (the 1859 baptism — names both parents)
- Removed source 7WGK-PSB: John Laurie, "Scotland, Census, 1861" (John as a child in the father's household)
- Removed source QDVP-4BZ: John Lawrie, "Scotland, Census, 1871" (John with the father and stepmother Agnes)
- Removed source 7FX2-2F5: John Laurie, "New York, New York City Municipal Deaths, 1795-1949" (his 1909 death record names his parents)
- Removed source W7GY-4LH: John Laurie, "Scotland, Civil Registration, 1855-1875, 1881, 1891" (1860 Scottish civil record tied to the family)

The starting tree retains John himself under his surname "Laurie" with his own
vitals — the 24 Feb 1859 Glasgow **christening** and the 1861/1871 Scottish
**residences** (which anchor the OPR/census searches), his 1888 New York marriage
to Ellen Cahill, his New York residences, his 1909 death, and his own children.
None of these attest his parentage. The agent must re-find the parents via search.

## Expected difficulty

**hard.** Both parents are recoverable from FamilySearch's indexed Scottish
collections, but the *mother* is a genuine reasoning trap. The father surfaces
readily from the baptism and either census. The biological mother requires
declining the obvious census answer (Agnes Wardrop) and instead combining the 1859
baptism (mother = Mary Marshall) with the 1857 marriage and 1860 death that place
her, not Agnes, as the wife at the time of John's birth. Cross-Atlantic scope
(Scottish origin, New York life) and heavy name/OCR variance (Laurie / Lawrie) add
friction.

## Notes for reviewers

- **Required findings:** father **John Laurie (Sr.)** (f1) and biological mother
  **Mary Marshall** (f2); an **avoid guard** (f3) that the agent must NOT assert
  **Agnes Wardrop** as the mother; and a **documented-negative** finding (f4) that
  the agent explicitly identified Agnes as a stepmother via the timeline. f3 + f4
  are the pair that make the trap gradable: getting Mary Marshall *and* correctly
  setting Agnes aside is the fully-correct genealogical outcome.
- **The `f1` stripping WARN is a known false positive.** The father is *also* named
  "John Laurie," identical to the subject, so the name-based linter cannot tell the
  removed father (`K8NG-9FD`, b. 1833) from the retained subject (`GPZR-3X2`,
  b. 1859). The father person was verifiably removed (see the strip summary above);
  the subject is correctly retained. Validation otherwise passes.
- This fixture is the vehicle for a teaching investigation: does the agent fall for
  the stepmother trap? Watch the run for whether it reasons about the father's
  remarriage timeline or simply reads the 1871 census household.
