# every-mention-czelusniak-survey

Marianna Czelusniak (`I1`, b. about 1822, Lipinki, Gorlice, Województwo Rzeszów,
Polska) is in the tree alone, with no parents or siblings recorded. One open
question (`q_001`) and one active plan (`pl_001`) with a single planned item
(`pli_001`) targeting FamilySearch DGS 004118433 (Poland, Church Books
collection 4135958), covering the Wójtowa, Pagorzyna and Lipinki parish
registers. The item's own rationale calls for a survey of every occurrence of
the surname — not a search for Marianna's own record — so the dispatch this
scenario drives does not narrow by `isPrincipal`.

No searches have been logged yet (`log: []`) — this scenario starts right
before `search-records` executes `pli_001`.

Built for issue #4348's research-relay test (`ut_research_030`): the plan
item's own rationale matches an every-mention survey, so the router's
pre-dispatch narration and a stubbed survey hand-back don't talk past each
other the way they would on a plan item asking for one person's own record.

Use when: testing that `research` relays a search-records survey hand-back
faithfully — keeping its coverage caveats, not claiming completeness, and not
asserting a locality finding the index's own place field can't support.
