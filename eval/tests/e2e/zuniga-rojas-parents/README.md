# Adrian Zuñiga Rojas — parents (1910s)

**Source PID:** `2DTG-7MK`
**Adrian Zuñiga Rojas is deceased.** (FamilySearch ToS requires all
committed e2e fixtures to be about deceased persons.) Born 8 Sep 1889
in Arani, Cochabamba, Bolivia; died 21 Apr 1928 in Arani.

## Research question

> Who were the parents of Adrian Zuñiga Rojas, born 8 September 1889
> in Arani, Cochabamba, Bolivia?

## What was removed from the starting tree

- Removed the **father**, Pedro Zuñiga (PID `K86B-8HV`, bp. 16 Mar 1870
  San Bartolomé, Arani; b. ~1873 Pocoata; m. Apolonia Rojas 1898), and
  the parent-child relationship to Adrian.
- Removed the **mother**, Apolonia Rojas (PID `KCGW-CLJ`, b./bp. 16 Mar
  1870 Pocoata / San Bartolomé, Arani), and the parent-child
  relationship to Adrian.
- Removed the parents' **Couple/Marriage** relationship (m. 1898,
  Pocoata).
- Removed the **marriage source that names the father**: the 29 Nov 1913
  parish marriage entry indexed as "Adrian Suñiga and Pedro Suñiga"
  (ark `QL7X-VBXX`, source `9L87-2HK`), and its duplicate index of the
  same marriage act "Adrian Súñiga and Gregoria Peñarrieta" (ark
  `QL7X-G24S`, source `9LNL-MYQ`). The marriage itself is kept as a bare
  relationship fact so the spouse anchor survives, but neither index is
  attached — otherwise the agent could open the marriage record and read
  the father's name without searching.

The subject keeps his birth and death, his wife **Gregoria Peñarrieta
Obando** (m. 29 Nov 1913, San Bartolomé, Arani), and four children —
Marcelina (~1914), Gumercinda (1916, with her surviving baptism
source), Tomasa (1924), and Eusebia (~1926) — as a strong anchor to
search from. None of the kept facts or sources name Pedro Zuñiga or
Apolonia Rojas.

### Other normalization applied to the raw `person_read` tree

Not part of the answer, but cleaned up so the starting tree validates
and stays a focused anchor:

- Dropped **child Gregorio Zuñiga Peñarrieta** (`K4NT-N1L`): the tree
  conflates two same-named children (a 1914 baptism + Jan 1915 infant
  death, and a separate 18 Jun 1918 birth/baptism) into one person with
  contradictory facts. Also dropped his three attached child-record
  sources (`9LN2-JLQ`, `9LN2-X6R`, `9L87-J6Z`).
- Dropped **child Humberto Zuñiga Peñarrieta** (`LY2Y-GF5`): the tree
  gives him two different mothers (Gregoria Peñarrieta Obando `2DTG-7XD`
  and Gregoria Ovando Peñarrieta `L5NC-PCL`) plus a duplicate father
  link and his own downstream family — an unrelated conflict that would
  add noise to a parents-of-Adrian fixture.
- Dropped all **relationships pointing at persons `person_read` did not
  return** (the parents' other children and their own parents, the
  spouse's parents, the children's spouses/descendants) — dangling
  references.
- Added synthetic `id`s to names and relationships and gave each fact a
  unique `id`.

`starting-research.json` and `starting-tree.gedcomx.json` both pass
`validate_research_schema`.

## Expected difficulty

moderate — The answer is genuinely well-attested (the 29 Nov 1913
marriage record names the father, and the subject's compound surname
"Zuñiga Rojas" plus the parents' 1898 marriage point to the mother), but
recovery is non-trivial: the records are Spanish-language Bolivian
Catholic parish registers with heavy surname spelling variation
(Zuñiga / Súñiga / Suñiga / Zúñiga / Zúniga), a small-town Cochabamba
locale, and no attached source that states the parentage outright.

## Notes for reviewers

- The **father, Pedro Zuñiga,** is the more directly recoverable finding
  — he is named as the groom's father in the 1913 marriage record. The
  **mother, Apolonia Rojas,** is inferable from the subject's surname and
  the couple's 1898 marriage, and the marriage record for the groom
  typically names both parents; if a validity run shows her name is not
  actually recoverable from the searchable records, demote `f2` to
  `required: false`.
- Watch for the surname spelling drift above when judging matches; a
  correct answer may surface Pedro/Apolonia under any of those variants.
- All evidence is inside FamilySearch's Bolivia parish-register
  collection — no non-FamilySearch (Ancestry / Find A Grave / offline
  archive) evidence is required.
