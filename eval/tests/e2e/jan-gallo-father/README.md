# Jan Gallo — father (Slovakia, born 1893)

**Source PID:** `PID-TODO`

Jan Gallo is deceased (born 1893).

> Who was the father of Jan Gallo, born in 1893 in Šútovo, Turany parish, Slovakia
> (then Suttó, Turány parish, Turócz County, Hungary)?

## What was removed from the starting tree

- Jan Gallo's father: Andrej Gallo (recorded as Andrej, a variant of Ondrej)
- Jan Gallo's younger brother Ondrej Gallo (a bonus finding)

## What the starting tree contains

- Jan Gallo himself (subject), with only his known birth: 1893, Šútovo, Turany
  Lutheran parish — no parents, no siblings

## Expected difficulty

Hard — and thin. The source case study is a how-to walkthrough, not a fully
documented proof: it names only the father (given name Andrej ≈ Ondrej) and a
younger brother Ondrej, and gives **no** mother and **no** dates. So the ground
truth is deliberately sparse (one required finding). The evidence lives on a single
FamilySearch microfilm (2062258) of Turany Lutheran parish records in
Slovak/Hungarian/Latin, catalog-ordered and largely browse-only rather than
name-indexed.

## Notes for reviewers

Documented conclusion from the "Slovakia Finding Records of Your Ancestors"
FamilySearch Wiki case study (subject: Jan Gallo, researcher Katarína):

- Jan's christening (birth) record found on Turany Lutheran parish microfilm 2062258.
- A younger brother Ondrej (and several other younger siblings) found in the same
  film's christening records.
- The parents' marriage on the same film names the groom — Jan's father — as
  Andrej, "another variation of Ondrej." **The mother is never named** in the
  source, and no marriage or birth dates are given.

**Recoverability caveat:** the evidence is a microfilm ordered from the FamilySearch
Catalog, not an indexed collection. A benchmark agent restricted to record/full-text
search may not be able to reach the parish images at all. Treat a miss on f1 as
partly a tool-reach limitation.

**Authoring note (PID-less / Path 3):** Built from the wiki case study as ground
truth, with no FamilySearch access — the starting tree was *constructed* from the
document. `source_pid` is an unused placeholder (`PID-TODO`); §6.1 blocks every
person-keyed tool, so neither the run nor the judge reads it. The §14
fixture-validity run is still owed; that check is warn-only, so this PID-less draft
may land with the validity run outstanding. Because the ground truth here is so
thin, consider whether this fixture earns its place in the suite once a validity
run reveals what the agent can actually recover.
