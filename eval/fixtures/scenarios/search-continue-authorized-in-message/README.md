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
involved; the two MCP fixtures (`record-search-1880-census-sheahan`,
`record-search-church-sheahan`) were authored for this test alone.

## Used by

- `search-records` tests asserting that when an active plan has more than
  one `planned` item and the invoking message already authorizes
  continuing through the whole plan, the skill executes successive planned
  items in the same turn rather than stopping after one to ask.
