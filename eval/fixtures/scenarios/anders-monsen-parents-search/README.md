# anders-monsen-parents-search

A copy of `anders-unna-marriage-search` (same tree) whose one question asks for a parentage
instead of a marriage. Anders Monsen (`LKFW-9XH`, christened 7 April 1759 at Hamre kirke,
Hordaland, Norway) has two parents in the tree, Mons Monsen (`LKFW-9ML`) and Anna
Andersdatter (`LKFW-9QR`), and nothing in the research cites a record for either link.

One open question (`q_001`, who his parents were, in progress) and one active plan
(`pl_001`) with a single planned item (`pli_001`): a search of FamilySearch's indexed
Norwegian church-book baptisms for Hamre, 1757-1761, whose rationale says the baptism may
name his parents.

No searches have been logged yet (`log: []`): this scenario starts right before
`search-records` executes `pli_001`.

Use when: testing that the router's hand-off for a search serving a question about the
subject's parents carries the subject block without `parents`, since those parents are what
the search tests.
