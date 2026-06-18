# mid-research-flynn-stale-plan

Derivative of `mid-research-flynn` exercising project-status stale-plan
detection (test `ut_project_status_007`).

- **Mutations (two, working together):**
  - `pl_002.created` moved back from `2026-05-02` to `2026-04-28`, so
    the active plan predates the newest findings for its question
    (`q_001`): the 1860-census search (`log_004`, performed
    `2026-05-02`) and the death-certificate search (`log_005`, performed
    `2026-05-03`) both landed *after* the plan was created.
  - `pl_002` item `pli_006` (the 1870–1890 probate search) flipped from
    `in_progress` to `planned`, so the active plan still has an
    outstanding planned item.
- **Why this shape:** `project-status/SKILL.md` Step 2 ("Stale plans")
  flags an active plan whose most recent item predates the newest log
  entry or assertion for its question. Decision-tree branch 2 then
  recommends revising the plan before continuing. Both conditions must
  hold: an active plan with a `planned` item **and** a creation date
  earlier than the newest finding. The clean `mid-research-flynn` has
  no `planned` items left in `pl_002`, so it cannot trigger this branch.
- **Expected skill behavior:** flag that `pl_002` predates recent
  findings (1860 census + death certificate), and recommend reviewing
  whether the new evidence changes the planned probate approach
  (→ research-plan) rather than blindly continuing the plan.
- Everything else is identical to `mid-research-flynn`.
