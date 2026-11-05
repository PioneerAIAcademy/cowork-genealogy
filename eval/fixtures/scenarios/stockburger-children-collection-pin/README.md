# stockburger-children-collection-pin

Johann Georg Meyer and Maria Dorothea Stockburger, a couple of the Sankt Georgen im Schwarzwald parish in Baden. The tree holds the couple and two of their children, Magdalena (born 5 March 1817) and Anna Maria (born 9 November 1821). The research question is to enumerate the rest of their children; the plan item names collection 3015626 as the parish's name-searchable baptisms.

**Collection-pin quirk.** The couple has 11 children indexed on FamilySearch, spread over two collections. A search pinned to collection 3015626 (Germany, Lutheran Baptisms, Marriages, and Burials) returns 9 hits and none of four children who are indexed only in collection 1473000 (Germany, Births and Baptisms, 1558-1898):

- Christina, born 22 October 1809 (ark:/61903/1:1:NRG5-HRM)
- Andreas, born 5 September 1812 (ark:/61903/1:1:NNXZ-4L9), indexed under "Sankt Georgen, Freiburg"
- Dorothea, born 18 January 1814 (ark:/61903/1:1:NV6K-789)
- Johannes, born 8 March 1820 (ark:/61903/1:1:NLWF-JHK)

The same search with no `collectionId` (both parents' names, `recordCountry: Germany`, birth 1808-1830) returns 20 hits covering all 11 children. A search pinned to 1395660 (Baden Church Book Duplicates) returns unrelated Meyers.

**Source.** Alpha feedback bundle `feedback-2026-10-28T11-47-20-014338Z` (issue #3948, maria-stockburger-son): every children search in that run was pinned to 3015626 or 1395660, and the four children above never reached the tree. The 3015626 and unpinned responses were captured live on 2026-11-05; the 1395660 response is the bundle's own `log_013`.

**Expected outcome.** The agent runs at least one children search that names a parent and carries no `collectionId`, no `batchNumber` and no place, surfaces Christina, Andreas, Dorothea and Johannes, and logs it. A collection-pinned search may come first but does not replace the unpinned one. `test_children_enumeration_unpinned` (tag `children-enumeration-unpinned`) checks the unpinned call; the judge checks the four children were surfaced.
