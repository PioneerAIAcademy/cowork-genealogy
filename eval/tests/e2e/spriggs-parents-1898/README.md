# Reuben Spencer Spriggs — parents (1890s–1900s)

**Source PID:** `L64C-QQX`
**Reuben Spencer Spriggs is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
6 Nov 1898 Maddock, Benson County, North Dakota; died 21 May 1998
Riverside, California.

## Research question

> Who were the parents of Reuben Spencer Spriggs, born 6 November 1898
> in Maddock, Benson County, North Dakota?

## What was removed from the starting tree

- Removed the **father**, John William Spriggs (PID `KNSQ-3LB`,
  b. 1872 Decorah Twp, Winneshiek, Iowa; d. 1934), and the
  parent-child relationship to Reuben.
- Removed the **mother**, Charlotte Marie Westby (PID `KNSQ-3GK`,
  b. 1876 Akershus, Norway; immigrated 1877), and the parent-child
  relationship to Reuben.
- Removed the parents' **Couple/Marriage** relationship.
- Removed the two **census sources that name the parents**: the 1910
  U.S. Census entry for John W & Charlotte Spriggs (ark `MPXD-MZ4`,
  source `M39R-56Y`) and the 1920 U.S. Census entry for Will & Charlott
  Spriggs (ark `M6N2-M3W`, source `9ZX6-4LB`). 12 → 10 sources.

The subject keeps his birth, death, residences (1910 SD residence,
1998 Riverside residence), obituary, and burial, plus his wife
Nora Alvina Satter (m. 1926) and two deceased children (Reuben Jr.
and Donna Jean) — a strong anchor to search from. None of the kept
sources name the stripped parents.

### Other normalization applied to the raw `person_read` tree

Not part of the answer, but cleaned up so the starting tree validates
and is ToS-compliant:

- Dropped the **living daughter** her marriage, and the relationships referencing her.
- Dropped relationships pointing at relatives one hop beyond the
  returned persons (the parents' own parents, the children's spouses,
  Nora's parents) whose person records `person_read` did not include —
  they were dangling references.
- Added synthetic `id`s to names and relationships, gave each fact a
  unique `id`, and normalized the WWII draft fact type to
  `Military Draft Registration` to satisfy the schema.

`starting-research.json` and `starting-tree.gedcomx.json` both pass
`validate_research_schema`.

## Expected difficulty

easy — Parentage is directly attested by two readily searchable U.S.
census records (1910 and 1920) that place Reuben as a son in his
parents' Beadle County, South Dakota household, with the subject's
birth, marriage, and children all intact as search anchors.

## Notes for reviewers

The mother was Norway-born (Akershus, immigrated 1877) and the father
Iowa-born (Decorah, Winneshiek) — the agent should recover both names
from census record search. Note the recurring transcription of Reuben's
given name as "Spencer"/"Will" for the father in census indexes; a
correct match should still resolve to John William Spriggs and
Charlotte (Westby) Spriggs.
