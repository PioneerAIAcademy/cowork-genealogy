# anders-unna-marriage-search

Anders Monsen (`LKFW-9XH`, b. 1759, Hordaland, Norway) and Unna Halsteinsdatter
(`KZHH-VTX`, b. 1745, Hestdal, Meland, Hordaland) are linked in the tree as a
`Couple` with no marriage date or place recorded yet. One open question (`q_001`)
and one active plan (`pl_001`) with a single planned item (`pli_001`) targeting
FamilySearch collection 1468080, "Norway, Marriages, 1660-1926," searching under
Unna's name as the principal.

No searches have been logged yet (`log: []`) — this scenario starts right before
`search-records` executes `pli_001`.

Derived from the real starting state of the `anders-monsen-ancestry` e2e fixture
(`eval/tests/e2e/anders-monsen-ancestry/`), the case that prompted the
given-name-spelling-variant fix to `search-records` (see
`references/collection-quirks.md`, Norway section, and
`docs/plan/` git history for PR #565).

Use when: testing that `search-records` retries a secondary party's **given
name** with spelling variants (not just query-structure changes or surname
variants) when an exact-spelling search returns zero results.
