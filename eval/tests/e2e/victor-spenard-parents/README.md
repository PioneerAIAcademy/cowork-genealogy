# Victor Spénard — parents and paternal grandparents (Quebec, 1896)

**Source PID:** `PID-TODO`

Victor Spénard is deceased (married 1896; born c. 1873 or earlier).

> Who were the parents and paternal grandparents of Victor Spénard, who married Orise (Aurise) Lesage on 29 September 1896 in Quebec, Canada?

## What was removed from the starting tree

- Victor Spénard's parents: Maximin Spénard and Zoé Brousseau
- Victor's paternal grandparents: Jean Baptiste Spénard and Geneviève Payan (dite St-Onge)
- The ParentChild relationships linking Victor to Maximin and Zoé
- Maximin Spénard's own vital events (baptism 1819, marriage 1863, death 1901)

## What the starting tree contains

- Victor Spénard himself (subject), with no parents
- His wife Orise (Aurise) Lesage and their marriage (29 September 1896, Quebec)
- Their son Henri Spénard (born August 1897, died 1967, Quebec) — the anchor the
  original case study starts from; his death certificate names his parents as
  Victor and Aurise

## Expected difficulty

Medium — **required scope is the two PARENTS** (Maximin Spénard + Zoé Brousseau),
which are reachable on FamilySearch: the 1891 Census of Canada indexes Victor in
the household of Maximin & Zoé (Ste Sophie de Levrard, Nicolet, Quebec), and the
1896 Drouin marriage names both parents. The difficulty is that the source case
study never names the specific parish/town, so disambiguation rests on the
uncommon surname Spénard plus the specific 1896 marriage of Victor Spénard and
Orise Lesage.

**Scope note (re-scoped 2026-07-08).** This fixture originally required the
paternal **grandparents** (Jean Baptiste Spénard + Geneviève Payan) as well.
A recoverability probe showed those are recorded *only* in Maximin Spénard's 1819
Drouin baptism, which is **not name-indexed** on FamilySearch (0 hits in "Quebec,
Births and Baptisms, 1662-1898") and **does not surface in full-text search** — it
exists only in the browse-only Drouin image collections, unreachable by the agent's
search tools. The grandparents (f3/f4) were therefore demoted to **non-required
bonus**; the required findings are the parents (f1/f2). This makes the fixture a
fair, recoverable "parents" benchmark rather than one that fails on an unindexed
image.

## Notes for reviewers

Documented pedigree from the "Step-by-Step Quebec, Canada Research" FamilySearch
Wiki case study:

- 1896 Drouin marriage record: "Victor Spénard, son of Maximin Spénard, farmer,
  and Zoé Brousseau"; bride Orise Lesage, daughter of Michel Lesage and Elmise Roux.
- 1891 Census of Canada: Victor listed in the household of his parents Maximin and
  Zoé Spénard.
- Maximin Spénard's baptism, 31 October 1819: parents Jean Baptiste Spénard
  (cultivateur) and Geneviève Payan, also known as St-Onge.
- Maximin Spénard & Zoé Brousseau married 2 June 1863; Maximin was the widower of
  Exupine Perrault.
- Maximin Spénard died 20 March 1901, age 82 (spouse Zoé Brousseau).

**Authoring note (PID-less / Path 3):** Built from the wiki case study as ground
truth, with no FamilySearch access — the starting tree was *constructed* from the
document, not captured from a live `person_read` snapshot, so sanity-check its
fidelity. `source_pid` is an unused placeholder (`PID-TODO`); §6.1 blocks every
person-keyed tool, so neither the run nor the judge reads it. The §14
fixture-validity run is still owed (a committed `run-*.json` with `verdict=pass`);
that check is warn-only, so this PID-less draft may land with the validity run
outstanding.
