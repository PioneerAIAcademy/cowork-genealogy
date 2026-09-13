# flynn-unresolved-conflict

Fork of `flynn-exhaustive-ready` with two changes. The birthplace conflict
(c_001: Ireland vs. Pennsylvania) is set to `"status": "unresolved"` instead of
`"resolved"`, and `blocks_question_ids` includes `"q_001"`. And
`ps_001.resolved_conflict_ids` is `[]` rather than the parent's `["c_001"]` —
a proof summary may only cite a conflict that is `resolved` or `moot`, so with
c_001 open the parent's value was a false claim that nothing could see until
issue #1972 V5 added the referential check to `validator.ts`.

All plan items for the parentage question are completed or skipped, and the
evidence consistently supports Thomas Flynn as Patrick's father. But the
unresolved birthplace discrepancy should block an exhaustive declaration
under the `conflict_resolution` stop criterion.

Used by: ut_research_exhaustiveness_009 (unresolved conflict blocks declaration).
