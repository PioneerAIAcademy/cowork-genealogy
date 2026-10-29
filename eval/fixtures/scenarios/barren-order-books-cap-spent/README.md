# Scenario: barren-order-books-cap-spent

`barren-order-books-browse-only` one browse later: the court order books have
already been browsed under `pli_003`, and that film's image cap is spent.

- **Subject:** Nathaniel Coombs (`I1`), b. c. 1810, Kentucky, last documented
  alive in the 1870 Barren County census.
- **q_001** (`in_progress`): when and where did he die?
- **pli_001**, **pli_002** (completed): indexed and full-text probate passes,
  both logged `negative`.
- **pli_003** (`planned`): the Barren County court order books, 1870-1885,
  browse-only images. `log_003` is its browse: `image_search` on image group
  `007757419_002_M9Q1-K4T`, images 1-20 read, outcome `negative`, notes saying
  the image cap was reached.
- **`results/image-browse.jsonl`** holds 20 distinct images of film `007757419`,
  so `project_context` reports `exhaustedImageGroups: [{imageGroup:
  "007757419", imagesRead: 20, planItemIds: ["pli_003"]}]`.

The point: pli_003 is still `planned` and still a browse-only item, so the
browse row would send it to `@plugin:search-images` — where every new page is
refused by the cap, and no new agent or session resets it. The router must
send it to `@plugin:research-plan` to dispose of instead. `log_003` is
`negative`, so there is nothing to extract.

No PII: Nathaniel Coombs is invented; the film number is invented; the place and
the record series are real.
