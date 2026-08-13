# Charles Hubert Ferber — grandparents (1820s–1870s)

**Source PID:** `G7JB-Y46`
**Charles Hubert Ferber is deceased** (b. 22 Jun 1891, d. 12 Dec 1967). (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.)

## Research question

> Who were the grandparents of Charles Hubert Ferber, born 22 June 1891 in Cincinnati, Ohio (the parents of his father William Hubert Ferber and his mother Emma Becker)?

## What was removed from the starting tree

- Removed paternal grandfather **Gerhard Ferber** (b. ~1820 Germany, d. 1917 Cincinnati) and paternal grandmother **Eva Engermann** (b. 1834 Bavaria, d. 1872 Cincinnati), along with the `ParentChild` relationships linking them to William Hubert Ferber and the `Couple` relationship between them.
- Removed maternal grandfather **John Becker** (b. ~1845 Kentucky) and maternal grandmother **Mary Kramer** (b. Ohio), along with the `ParentChild` relationships linking them to Emma Becker and the `Couple` relationship between them.
- Edited the Ohio death-record source citation (S3) to drop its mention of "Gerhard Ferber" by name — the original citation text named him directly, which would have leaked the paternal-grandfather answer without the agent doing any lookup. The source is still attached to William's death fact and resolves to the same real FamilySearch record (`ark:/61903/1:1:F66M-8JZ`), which the agent can fetch via `record_read` to discover the parents itself.
- Kept intact: Charles's own vitals/residences, his two marriages (Lydian Inez Hall, Harriet Helen Bailey), and William & Emma's own vitals and their 1890 marriage.

## Expected difficulty

Moderate — the paternal grandparent link is independently corroborable via two live FamilySearch sources (the compiled tree and a name search + `record_read` on the Ohio death record found by searching William Ferber's death), which is a reasonably direct path. The maternal grandparent link (Becker/Kramer) is only findable via the compiled tree in the live source data — no independent record corroborating it was located during authoring, so it may be harder to recover through record search alone, and person_search on the compiled tree is likely the intended path there.

## Notes for reviewers

This fixture was authored (Path 2: convert a finished research project) from a live client research project (`research.json` objective: circumstances of William Hubert Ferber's death, and extending Charles Hubert Ferber's ancestry). That project's own research surfaced two *unresolved* conflicts about William's and Emma's own birthplaces (Ohio per FamilySearch's 1900 census index vs. Germany/Kentucky per the client's reading of the same census clipping) — those conflicts are about William/Emma's *own* birthplaces, not about who their parents were, so they don't affect this fixture's expected findings, but a very literal-minded agent might get distracted by a birthplace mismatch if it happens to notice the tree's Ohio-birthplace facts while searching. That's expected and shouldn't be graded against the fixture's actual (parentage) findings.

## Reference project

`reference-project/` holds the full source research this fixture's grandparent question was
distilled from: the complete `research.json` (GPS-classified sources, assertions, person_evidence,
the two open birthplace conflicts noted above, and both proof summaries — including the
`not_proved` conclusion for the death-circumstances question, which is why this fixture only
covers the ancestry-extension half) and the unstripped `tree.gedcomx.json` with all four
grandparents included. It is provenance/documentation only — not part of the benchmark contract
that `starting-research.json` / `starting-tree.gedcomx.json` / `expected-findings.json` define, and
the harness does not read it.
