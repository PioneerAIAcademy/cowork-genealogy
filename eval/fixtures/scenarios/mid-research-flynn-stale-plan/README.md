# mid-research-flynn-stale-plan

Derivative of `mid-research-flynn` exercising project-status stale-plan
detection (test `ut_project_status_007`).

- **The staleness signal (inherited from the base, central to the test):**
  five sources `src_005`–`src_009` (baptism, **Thomas Flynn's 1881 will**,
  birth cert, deed, obituary) were accessed `2026-05-10`/`2026-05-12` — about
  a week *after* the active plan and its last logged execution
  (`log_005`, `2026-05-03`). They carry **no `log_entry_id`** (found outside
  the research log) and **no assertions** (not yet extracted). So new
  findings have arrived that the active plan `pl_002` does not account for:
  the plan predates these findings. (Notably `pli_006`, a planned probate/will
  search, is now redundant — Thomas Flynn's will `src_006` is already in hand.)
- **Mutations layered on top (reinforce the signal):**
  - `pl_002.created` moved back from `2026-05-02` to `2026-04-28`, so the
    active plan clearly predates the newest findings for its question
    (`q_001`).
  - `pl_002` item `pli_006` flipped from `in_progress` to `planned`, so the
    active plan has an outstanding planned item (decision-tree branch 2's
    "active plan with items status planned" condition). The clean
    `mid-research-flynn` has no `planned` items left in `pl_002`.
- **Why this shape:** `project-status/SKILL.md` Step 2 ("Stale plans") flags
  an active plan whose most recent item predates the newest log entry or
  assertion for its question. Here the "recent findings" are the five
  unprocessed post-plan sources.
- **Expected skill behavior:** detect and **flag `pl_002` as stale** —
  recent sources (`src_005`–`src_009`, accessed 2026-05-10/12) arrived after
  the plan and aren't accounted for — and recommend a concrete next step that
  addresses them. Either routing is acceptable: processing the new sources
  (→ record-extraction, starting with the will `src_006`) and/or revising the
  plan (→ research-plan). What must NOT happen: silently continuing the plan
  (e.g. "execute pli_006") without recognizing the new evidence.
- Everything else is identical to `mid-research-flynn`.
