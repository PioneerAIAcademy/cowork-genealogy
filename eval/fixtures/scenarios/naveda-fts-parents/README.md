# Scenario: naveda-fts-parents

Mid-research state for a **compound-surname (Iberian) parentage** full-text
search. The subject, **Francisco Naveda Somarriba**, is a known emigrant from
Spain living in Papantla, Veracruz, Mexico by 1862; his own baptism is not
name-indexed and indexed surname searches have failed. One open question
(`q_001` — his parents) with an active plan whose next item (`pli_001`) is a
full-text search of the Cantabrian parish registers.

Used by the `search-full-text` unit test that checks the skill decomposes the
compound surname into a **co-occurrence** query (`+Naveda +Somarriba`) rather
than an adjacent **phrase** (`+"Naveda Somarriba"`), and does not scope the
full-text search to a borrowed record `collectionId`. Derived from the
`naveda-spain-origin` e2e fixture, with the answer (parents, sibling,
grandparents, Limpias origin) absent from the tree.
