# Scenario: wilkins-probate-nil

The state where `search-records` is executing a **probate** plan item
(`pli_001`) for a pre-1911 Kentucky death, and the indexed `record_search`
on the probate collection comes back essentially empty — **because that
collection is browse-only / barely indexed, not because the record is
absent.**

- **Subject:** Elijah Wilkins (`I1`), b. c. 1814, last documented alive in
  the 1870 Muhlenberg County census. No death information.
- **q_001** (`in_progress`): when/where did he die? No death certificate is
  expected — statewide Kentucky registration began 1911.
- **pl_001 / pli_001** (probate, `planned`): the county estate
  administration (administrator's bond, settlement) is the primary death
  evidence for a pre-1911 death.

The companion `record-search-wilkins-probate-no-results` fixture returns
zero for the indexed probate search (the real Kentucky Probate Records
collection is ~1% record-indexed); `fulltext-search-wilkins-estate`
returns the estate-administration hit that the browse-only volumes carry.

The point of this scenario: a nil on a browse-only / low-index collection
is **not** a negative finding — `search-records` must pivot to full-text
(delegate to search-full-text, or run `fulltext_search`) on that
collection's volumes before logging the item negative. A run that logs
pli_001 `negative` on the indexed nil, or that concludes no death evidence
exists, is the failure this scenario guards.

Derived from the `wilkins-death-kentucky` e2e fixture (issue #657): across
seven headless runs, the runs that reached the ground-truth estate records
did so via full-text search of the probate image volumes; the run that
relied on indexed `record_search` (0 results, "1.2% indexed") never found
them and under-concluded.
