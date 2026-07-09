# Find Alan Glen Applegarth's parents from 1940/1950 census and Utah vital records

**Source PID:** `KWZH-XB6`
**Alan Glen Applegarth is deceased.** (b. 29 Apr 1936, Ogden, Weber
County, Utah; d. 16 May 2023, Providence, Cache County, Utah.)
FamilySearch ToS requires all committed e2e fixtures to be about
deceased persons.

## Research question

> Who were the parents of Alan Glen Applegarth, born 29 April 1936 in
> Ogden, Weber County, Utah, and died 16 May 2023 in Providence, Cache
> County, Utah?

## Expected answer

- **Father:** John Obrien Applegarth — b. 7 Oct 1905, Oshkosh, Garden
  County, Nebraska; d. 1 Apr 1998, Ogden, Weber County, Utah.
- **Mother:** Olive Annie Harvey — b. 29 Jul 1906, Kaysville, Davis
  County, Utah; d. 19 Aug 1970, Ogden, Weber County, Utah.

They married 20 Oct 1926 in Ogden, Weber County, Utah.

## What was removed from the starting tree

- Removed both parent persons — John Obrien Applegarth (KWCH-VCZ) and
  Olive Annie Harvey (KWCH-VC8) — and every relationship that
  referenced them: the two parent-child links to Alan, their couple
  bond, John's second marriage, Alan's three unhydrated siblings'
  parent-child links, and the parents' own parent-child links to their
  respective parents. The starting tree retains only Alan, his wife
  Carole Sue Checketts, and their daughter Shauna Sue Applegarth
  (living). The `person_read` response also included several
  relationship edges to persons FamilySearch did not hydrate in this
  call (Shauna's spouse, Carole's parents, a grandchild) — these were
  dropped too, since a dangling reference to a person absent from the
  tree fails schema validation and none of them bear on the parents
  question.
- Removed six sources whose citations **named a parent**, which would
  otherwise leak the answer off the local citations:
  - two GenealogyBank obituary-index entries co-naming "Alan Glen
    Applegarth and John Obrien Applegarth" (the father's full name);
  - the 1940 U.S. Census entry ("Entry for J O Applegarth and Olive
    Applegarth") showing the household Alan was enumerated in as a
    child;
  - the 1950 U.S. Census entry ("Entry for John O Applegarth and Olive
    H Applegarth") showing the same household a decade later;
  - two GenealogyBank entries pairing other Applegarth relatives with
    a "John Applegarth" — ambiguous, but removed conservatively since
    they could point to the father by given name + surname.

The other 12 sources remain, including two GenealogyBank obituary
entries and two church-census entries that name only Alan himself —
these are legitimate *leads* the agent must follow to the underlying
record rather than answer leaks.

## How the answer is recoverable (records only; tree-reads blocked)

- **1940 U.S. Census, South Boise Election Precinct, Ada County,
  Idaho** — Alan (age ~4) enumerated in the household of John O. and
  Olive Applegarth. Establishes both parents directly.
- **1950 U.S. Census, Ogden, Weber County, Utah** — the same household
  a decade later, corroborating both parents independently.
- Alan's own church-census and obituary-index entries (retained) are
  findable leads that point toward the same 1936 Ogden birth and 1935
  Idaho residence, anchoring the search to the right household.

Both censuses live on FamilySearch and are findable by record search;
neither requires reading the (blocked) family tree.

## Expected difficulty

easy — a single household appears intact across two censuses a decade
apart, both parents share the child's surname, and no name-transcription
variation obscures the match.

## Notes for reviewers

Parents are attested by the 1940 and 1950 U.S. Census (John O. and
Olive Applegarth's Ogden/Ada County households, with Alan as a child)
and by church census records. A failed run likely means the agent
didn't search census or church-membership records for the subject's
birth-era Utah/Idaho residence.
