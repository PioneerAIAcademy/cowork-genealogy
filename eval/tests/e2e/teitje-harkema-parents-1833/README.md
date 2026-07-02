# Teitje Harkema — parents (1830s)

**Source PID:** `LHZM-TR7`
**Teitje Harkema is deceased.** (FamilySearch ToS requires all
committed e2e fixtures to be about deceased persons.) Born 31 July
1833 Veenhuizen, Norg, Drenthe, Netherlands; died 17 January 1899
Vries, Drenthe, Netherlands.

## Research question

> Who were the parents of Teitje Harkema, born 31 July 1833 in
> Veenhuizen, Norg, Drenthe, Netherlands?

## What was removed from the starting tree

- Removed the **father**, Jan Roelfs Harkema (PID `9VHH-ZSG`, b. 5 May
  1799 Scharmer, Groningen; d. 30 Jun 1876; occupation "bouwboer"), and
  the parent-child relationship to Teitje.
- Removed the **mother**, Hillichje Willems Jager (PID `LHZM-T19`,
  b. 25 Jan 1800 Scharmer, Groningen; d. 14 Aug 1867 Veenhuizen,
  Drenthe), and the parent-child relationship to Teitje.
- Removed the parents' **Couple/Marriage** relationship (married
  13 Apr 1824, Slochteren, Groningen).
- Removed the two **vital-records index sources that name the
  father alongside Teitje**: the 1833 birth-index entry for "Teitje
  Harkema and Jan Roelfs Harkema" (source `S1PK-C76`) and the 1899
  death-index entry for "Feitje Harkema and Jan Roelfs Harkema"
  (source `S1PK-JYR`). 6 → 4 sources.

The subject keeps her own birth and death facts, plus her marriage
(30 Jun 1876, Norg, Drenthe) to Roelf Meerten Huisman — a strong
anchor to search from. Roelf's own birth, death, burial, and
occupation facts are also retained, along with the two sources that
attest his side of the record trail (his own death-index entry and
the marriage-index entry) and Teitje's own birth/death sources that
do not name her parents. None of the kept sources name the stripped
parents.

### Other normalization applied to the raw `person_read` tree

Not part of the answer, but cleaned up so the starting tree validates
and is internally consistent:

- Dropped Roelf Meerten Huisman's **first marriage** (to a different
  wife, `LC9J-84F`) and all descendant relationships from that
  marriage — none of those person records were returned by
  `person_read`, so the relationships were dangling references.
- Dropped relationships pointing at relatives one hop beyond the
  four returned persons (the parents' own parents and siblings, the
  spouse's parents) whose person records `person_read` did not
  include — they were dangling references, and both parent persons
  are removed anyway as the stripped answer.
- Added synthetic `id`s to names and the one retained relationship
  (existing fact `id`s from `person_read` were kept as-is).

`starting-research.json` and `starting-tree.gedcomx.json` both pass
`validate_research_schema`.

## Expected difficulty

moderate — Parentage is attested only by a foreign-language (Dutch)
civil-registration index, and the subject's given name is transcribed
inconsistently across entries ("Teitje" vs. "Feitje"), requiring the
agent to correctly correlate name variants rather than relying on an
exact-match search.

## Notes for reviewers

The source index alternates between "Teitje" and "Feitje" Harkema —
the agent needs to recognize these as the same person despite the
spelling variant. Both the birth-index entry (1833) and the
death-index entry (1899) name the father, Jan Roelfs Harkema,
alongside the subject; the agent should recover both parents' names
from this Dutch vital-records collection.
