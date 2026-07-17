# anders-unna-marriage-proof

Anders Monsen (`LKFW-9XH`) and Unna Halsteinsdatter (`KZHH-VTX`) research is
search-complete: one source (`src_001`, the FamilySearch "Norway, Marriages,
1660-1926" index entry) and three assertions (groom name, bride name variant,
marriage date/place) are recorded. `q_001` is `in_progress` with no proof
summary written yet — this scenario starts right before `proof-conclusion` runs.

The source's `notes` and the `log_001` entry explicitly record that
`record_search` returned **no `imageId`/`artifacts` field** for this hit, and
that `record_read` was never called to check for a digitized image. The
source's `url` is a record-level ARK (`1:1:...`), not a confirmed image ARK.

Derived from the real starting state of the `anders-monsen-ancestry` e2e
fixture's search results (`eval/tests/e2e/anders-monsen-ancestry/`) — the case
where a prior run's proof narrative claimed a digital church-book image was
"accessible" without any tool data confirming one existed, which prompted the
`proof-conclusion` fix ("never claim a digital image exists unless the tool
data confirms it").

Use when: testing that `proof-conclusion` does not assert image accessibility
beyond what the search/read tool data actually confirmed.
