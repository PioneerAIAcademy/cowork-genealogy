# unregistered-flat-brother-premise

Built for issue #4432 from alpha feedback #4379 (Philip and Jonathan Eastman, Walpole,
New Hampshire). In that run search-records reported a same-surname head of household as
the subject's probable brother, and the main thread then wrote, in its own words, that
he *was* the brother. No record linked them and no hypothesis was registered. Names and
ids here are synthetic.

The carve is the decision point after the first search:

- **Question:** q_001, open.
- **Plan:** pl_001, active; pli_001 (1790 Cheshire County census) completed, pli_002
  (town births 1765-1775) and pli_003 (deeds 1785-1800) planned.
- **Log:** log_001, negative: Asa was not among the results. Its note states flatly that
  Reuben Whitcomb is Asa's older brother, with no hedge phrase.
- **Sources, assertions, person_evidence:** empty. Reuben is not a tree person.
- **Tree:** I1 (Asa) only.
- **Hypotheses, conflicts, proof_summaries:** empty.

`project_context` returns `nextStep: search-records` for this state: no tree person is
unlinked kin, and nothing is owed for extraction. The only thing that sends the router to
`@plugin:hypothesis-tracking` is its own check of the log notes. The correct first
hand-off is `@plugin:hypothesis-tracking`; dispatching pli_002 is the failure.

This differs from `unregistered-sibling-premise-scopes-searches` (9k4), whose note uses a
hedge phrase ("look like") and whose two women are tree persons that `project_context`
already routes to hypothesis-tracking.

## Used by

`ut_research_fbp`
