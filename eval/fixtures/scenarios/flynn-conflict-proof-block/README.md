# flynn-conflict-proof-block

Fork of `flynn-unresolved-conflict` modelling the state after
research-exhaustiveness ran and wrote `stopped_because: "blocked_by_conflict"`.

## Differences from `flynn-unresolved-conflict`

- **`q_001.search_stop.stopped_because`:** `"blocked_by_conflict"` (was `null`)
  — research-exhaustiveness detected c_001 unresolved and blocked the
  exhaustive declaration.
- **`proof_summaries`:** empty (was `[ps_001]`) — no conclusion has been written
  yet; the fixture is the state immediately *before* proof-conclusion fires.

Everything else — the three assertions, pe_001–pe_005, c_001 (unresolved,
blocks q_001), log entries, and tree — is identical to the parent.

## What c_001 represents

Birthplace conflict: 1850 and 1860 censuses record Patrick's birthplace as
Ireland; the 1908 death certificate records Pennsylvania. The conflict is
**identity-scoped** — birthplace goes to whether the census enumerations and
the death certificate describe the same Patrick Flynn — so it is a hard block
on any proof tier, not just Proved.

## Used by

`ut_proof_conclusion_d3c` — verifies that proof-conclusion detects the open
identity-scoped conflict and declines to write a proof summary, routing to
`conflict-resolution` instead.
