# Scenario: barren-order-books-browse-only

A pre-1911 Kentucky death question where the indexed and full-text passes are
both spent, and the one plan item left is a **browse** of digitized but
unindexed images.

- **Subject:** Nathaniel Coombs (`I1`), b. c. 1810, Kentucky, last documented
  alive in the 1870 Barren County census.
- **q_001** (`in_progress`): when and where did he die? No death certificate is
  expected before statewide registration in 1911.
- **pli_001** (completed): indexed `record_search` of the probate collection,
  logged `negative` as `log_001`. The collection is about 1% indexed, so the nil
  means un-indexed, not absent.
- **pli_002** (completed): full-text co-occurrence search of the county's
  probate volumes, logged `negative` as `log_002`.
- **pli_003** (`planned`): the Barren County court order books, 1870-1885,
  digitized on FamilySearch as browse-only image groups (0% record-searchable).

The point: the routing table sends a plan item that targets a
digitized-but-unindexed record set, after indexed and full-text search are
exhausted, to `@plugin:search-images`, which reads the volume page by page.
Another `record_search` or full-text pass is the failure. There is nothing to
extract: both log entries are negative.

No PII: Nathaniel Coombs is invented; the place and the record series are real.
