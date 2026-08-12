# search-continue-authorized-in-message

Michael Sheahan (same fictional subject as `first-plan-migration-hypothesis`)
research, mid-plan execution for q_001. An active plan already has TWO
`planned` items — the point under test is what happens after the first is
executed, not what the plan itself contains.

- **Objective:** confirm/refute the coal-mining-relocation hypothesis via
  residence and occupation records.
- **Questions:** q_001 (`in_progress` — a plan already exists).
- **Plans:** pl_001 (`active`), two items: pli_001 (census, 1880, `planned`)
  and pli_002 (church, 1880-1885, `planned`). Neither has been executed yet.
- **GedcomX persons:** I1 (Michael Sheahan).

## Source and scrub note

**Hand-authored, not mined** — unlike `plan-continue-authorized-in-message`
(Test B, carved from a real case's actual pre-plan state), neither
reproduced feedback case showed `search-records` itself stalling mid-plan;
both real stalls traced to `research-plan`'s Step 7. This scenario exists
to give the doctrinal fix's `search-records` half (its structurally
identical Step 9 "Shall I continue with the next search?") a regression
test before that text is edited, per the same "capture before you fix"
principle — it is a confirmatory test for a documented-but-not-directly-
observed control-flow gap, not a capture of an observed one. Flagged
explicitly per issue #1319's discussion. No real person's data is
involved; the MCP fixtures (`record-search-1880-census-sheahan`,
`record-search-church-sheahan-collectionid`, `record-search-church-sheahan-anyplace`)
were authored for this test alone.

**Correction (post-baseline-run):** the church item's rationale now names the
real `collectionId` (1401638, "Pennsylvania, Church and Town Records,
1708-1985" -- reused from the existing `collections-search-schuylkill`
fixture) directly, matching `search-records/SKILL.md`'s own guidance that
`collectionId` may come "from `collections_search` output **or plan
rationale**." The first baseline run's fixture for this item anchored on a
`recordType` argument that `record_search` does not accept at all (verified
against `packages/engine/mcp-server/src/tools/record-search.ts` -- it is a
`research_log_append` logging field, not a tool parameter), so no real call
could ever match it. Two fixtures now cover the two most likely real
argument shapes (collectionId-anchored, and an `anyPlace`-anchored
fallback for a run that doesn't use the rationale's collectionId).

**Second correction (post-fixture-fix run, 2026-08-06):** with the fixture gap fixed, the
run instead ABORTED on `max_turns` (default 20) -- the model went further than the test
required, delegating to `record-extraction` for pli_001's result before starting pli_002,
which is real production-realistic (if arguably over-eager, given search-records'
"let the user confirm before extraction" default) behavior but costs extra turns. Bumped
`execution.max_turns` to 40 in the test JSON so the full two-item continuation can complete
and actually get judged.

**Third correction (same day):** raising the turn budget wasn't enough -- the re-run instead
hit `max_wall_clock_seconds` (400s), because the model tried to delegate to
`record-extraction`, which itself couldn't reach `extraction_append` (`ToolSearch` is not in
that sub-agent's allowed tools under this harness's per-test scoping), and spent most of the
budget retrying that dead end before ever reaching pli_002. Reworded `input.user_message` to
explicitly scope extraction OUT ("I'll handle extraction myself afterward") so the model stays
on the two searches this test is actually about, and added a `judge_context` scope note in
case it still wanders into extraction anyway.

## Used by

- `search-records` tests asserting that when an active plan has more than
  one `planned` item and the invoking message already authorizes
  continuing through the whole plan, the skill executes successive planned
  items in the same turn rather than stopping after one to ask.
