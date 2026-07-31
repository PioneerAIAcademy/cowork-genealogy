# josefa-oliveira-father-anchor-search

Manoel Melquiades de Oliveira (`GHJ6-2WV`) and Cândida Damasceno de Oliveira
(`GHJ6-L4F`) are in the tree with two known children (not included here — not
needed as input). The research question asks whether they also had a daughter
Josefa who married around 1926 in Rio Grande do Norte, Brazil. Josefa is not
yet a tree person, so she can't be searched as a ranked principal.

One open question (`q_001`) and one active plan (`pl_001`): `pli_001` (a plain
given-name search for "Josefa" in the target collections) is already
`completed` and logged as `log_001` — undifferentiated, too many results (84+)
with no parent names visible in the stubs. `pli_002` — searching using the
father's distinctive given name as an anchor — is `planned`, about to execute.

This scenario starts right before `search-records` executes `pli_002`.

Derived from the real, live `manoel-oliveira-daughter` e2e run
(`eval/runlogs/e2e/manoel-oliveira-daughter/run-2026-07-30_20-51-24.json`),
resolved as a true-match record-hint fixture
(`eval/tests/e2e/manoel-oliveira-daughter/`). Real identifiers are kept
per the recorded-e2e exception — the exact spelling of the father's given
name (tree: "Melquiades"; the actual marriage-register index: "Melchiades")
*is* the finding under test, so scrubbing it would defeat the point.

**The live run's actual mistake:** it searched `fatherGivenName: "Melquiades"`
(the tree's modern spelling), got zero results, and concluded "parent names
are not indexed as primary searchable fields in these Brazilian collections"
— it never tried a period-accurate spelling variant of the father's given
name (e.g. "Melchiades") before giving up on that search avenue entirely.
Searching with `fatherGivenName: "Melchiades"` (independently verified live)
surfaces the real marriage record in the top few ranked results.

Use when: testing that `search-records` retries a *relative-anchor* field
(father's/mother's given name used to disambiguate an undifferentiated
principal search) with spelling variants — not just concluding the anchor
field "doesn't work" — when an exact-spelling anchor search returns zero
results. This generalizes `ut_search_records_022`/`023` (which cover spelling
variants on the search *principal*) to anchor/relative-name fields.
