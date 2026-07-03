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
- Removed everything else that links **through** those two parents:
  Teitje's siblings (the parents' other children) and both sets of
  grandparents (the parents' own parents). Keeping any of these would
  re-expose a stripped parent by name — e.g. a sibling's parent-child
  edge to "Jan Roelfs Harkema" hands the agent the father for free — so
  they are part of the stripped answer, not context.
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

### Retained extended family (spouse side)

The subject's spouse, Roelf Meerten Huisman, brings his own extended
family, which is **kept** as realistic starting context — none of it
references the stripped parents, so it cannot leak the answer:

- Roelf's **first marriage** (3 Sep 1836, Norg) to Anna Jans
  (`LC9J-84F`) and their eleven children (Teitje's step-children).
- Roelf's parents, Meerten Kornelis Huisman (`LCQ7-13R`) and Anna
  Roelfs Jager (`LCQC-FXF`).

These relatives appeared only as edges (no person records) in the
subject's `person_read`, so each was fetched with an individual
`person_read` and added as a schema-valid person stub (`id` + `gender`
+ name). Synthetic `id`s were added to the new relationships
(`rel-2`…`rel-26`) and to names; existing fact `id`s from `person_read`
were kept as-is.

> **Review note (Leduthet):** an earlier revision *dropped* this
> spouse-side family; it has been restored per review. The parent-side
> extended family (Teitje's siblings, the grandparents, the parents'
> own marriage) stays removed because every one of those relationships
> names a stripped parent — restoring them would either leak the answer
> or dangle against removed person records. See "What was removed."

`starting-research.json` and `starting-tree.gedcomx.json` both pass
`validate_research_schema`, and the stripping linter reports every
finding absent.

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
