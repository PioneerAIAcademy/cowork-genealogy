# hale-birthplace-targeted

A first-plan scenario whose question asks one fact about one person, labelled
`question_kind: "targeted"`. The companion of `hale-children-enumerative`: same
couple, same tree, same locality, a different kind of question.

Built for issue #1830 item 1: under the lead's 2026-08-31 ruling on #1917, a
targeted question carries no five-event obligation and a narrow plan stays
legitimate. This scenario is what stops the enumerative rule from over-firing.

## State

- **Objective:** Determine where in Pennsylvania Thomas Hale was born
- **Questions:** q_001 (Thomas's birth county, in_progress, `question_kind: "targeted"`, no `search_stop`)
- **Plans, log, sources, assertions, conflicts, hypotheses, proof summaries:** all empty — this is a first plan
- **Localities:** loc_001, Greene County, Ohio, 1830–1880 — identical to `hale-children-enumerative`
- **Tree:** identical to `hale-children-enumerative`: Thomas Hale (I1), Sarah Hale (I2) and their five known children, seven persons and eleven relationships, no sources.

## Grading

The test carries the `new-plan-items-planned-status` tag. Under the amended
`test_new_plan_items_planned_status`, a `skipped` item at plan creation is
allowed only on an enumerative question, so on this targeted question it fails —
the footprint the enumerative bookkeeping would leave if it over-fired. No new
validator.

This is a regression guard, not evidence the enumerative rule works: before
the #1830 edit there is no rule to over-fire, so the test passes then too.
