# recent-birth-first-plan

First research plan for a parentage question whose subject has died recently, so his own
birth and death certificates are both closed to the public. Used by the research-plan test
`first-plan-subject-own-birth-death.json` (issue #4696 Part B, was #4654).

Derived from `recent-birth-sealed` (Alan Glen Applegarth, b. 29 Apr 1936 Ogden, Weber County,
Utah; 2023 obituary). What changes from it:

- **`plans`: empty.** The test asks for the first plan for q_001, and q_001 is `open`.
- **`log`: `log_004`, `log_011` and `log_012` dropped.** They recorded the sealed 1936 birth
  certificate, the nil births-index search, and the sealed 2023 death certificate. Keeping
  them would hand the planner the answer this test measures (whether the plan accounts for the
  subject's own birth and death records at all). Nothing cites them.
- **`plan_item_id` set to null on the kept log entries** (`log_001`-`log_003`,
  `log_005`-`log_007`). They pointed at the old plan's items; with no plan left, new items
  reuse the ids `pli_001`… and the old links would attach finished searches to new items.
  The entries stay because `src_001`-`src_004` and the assertions cite them.
- **`localities`: `loc_001` added**, from `recent-birth-wiki-untouched`, with its planted
  school-census line removed and `time_period` widened to 1930-2025. Without an entry the
  planner stops on a first plan and asks for a locality survey.

The tree is `recent-birth-sealed`'s, unchanged: Alan has no Death fact and no `ark`, so his
death is known only from the obituary (`src_004`).
