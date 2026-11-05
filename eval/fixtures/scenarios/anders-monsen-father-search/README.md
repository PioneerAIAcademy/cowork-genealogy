# anders-monsen-father-search

A copy of `anders-monsen-parents-search` (same tree) whose one question asks a yes or no
question about the father alone instead of who the parents were. Anders Monsen
(`LKFW-9XH`, christened 7 April 1759 at Hamre kirke, Hordaland, Norway) has two parents in
the tree, Mons Monsen (`LKFW-9ML`) and Anna Andersdatter (`LKFW-9QR`), and nothing in the
research cites a record for either link.

One open question (`q_001`, whether he was the son of Mons Monsen, in progress) and one
active plan (`pl_001`) with a single planned item (`pli_001`): a search of FamilySearch's
indexed Norwegian church-book baptisms for Hamre, 1757-1761, whose rationale says the
baptism may name his father. The question never uses the word "parents".

No searches have been logged yet (`log: []`): this scenario starts right before
`search-records` executes `pli_001`.

Use when: testing that the router's hand-off for a search serving a question about one of
the subject's parents, worded as "was he the son of", carries the subject block without
`parents`, since the tree's father is what the search tests.
