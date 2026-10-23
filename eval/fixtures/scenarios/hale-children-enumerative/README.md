# hale-children-enumerative

A first-plan scenario whose question asks for every child of a couple, labelled
`question_kind: "enumerative"`.

Built for issue #1830 item 1: under the lead's 2026-08-31 ruling on #1917, an
enumerative question's plan covers birth, marriage, death, census and probate,
and says in writing why any of the five is absent.

## State

- **Objective:** Identify all the children of Thomas Hale and his wife Sarah of Greene County, Ohio
- **Questions:** q_001 (the couple's children, in_progress, `question_kind: "enumerative"`, no `search_stop`)
- **Plans, log, sources, assertions, conflicts, hypotheses, proof summaries:** all empty — this is a first plan
- **Localities:** loc_001, Greene County, Ohio, 1830–1880
- **Tree:** two persons and one couple relationship. Thomas Hale (I1) — born about 1810 in Pennsylvania, died 1868 in Greene County. Sarah Hale (I2), his wife, with no facts. No children, no sources.

## The shape under test

The question names a set of people, not one fact. A plan that searches only the
censuses, or only birth records, can list some children but cannot claim to have
looked for all of them.

## Why the locality is built the way it is

The collection list is what a locality guide would surface: the 1850, 1860 and
1870 censuses and Ohio county marriages. The one quirk restates what the
FamilySearch wiki says: Greene County marriage and probate records survive from
1803. Nothing in the locality names the five event types or says a plan must
cover them. The Rowe fixture (`rowe-window-is-not-a-ceiling`) showed a quirk that
states the rule lets the old prose pass and spoils the measurement.

**Tightened 2026-10-23.** A second quirk, on Ohio county birth and death
registers (kept by probate courts from 1867, Greene County births from 1869), was
removed after 9 pre-edit runs failed only 1 time: it was the locality's only
mention of births or deaths, and the one failing run was missing exactly a birth
item. Same step Richard set for item 3 (#1830, 2026-10-20): tighten once, then
measure 9 pre-edit runs again. The fact is still true; the scenario no longer
volunteers it.

All four collection ids were checked: 1850, 1860 and 1870 against recorded
collection titles in this repo, Ohio County Marriages live with
`dev/try-collections-search.ts` (2026-10-22).

## Grading

`test_enumerative_plan_accounts_for_five_events`
(`eval/harness/validators/test_research_plan.py`) gates this scenario: each of
the five events is covered by a new plan item, or written as a `skipped` item
with a `skip_category` and a `skip_reason`. Birth, marriage and death match on a
vital-type item whose rationale names the event, because `record_type` files all
three as `vital_record`.

Births before 1869 have no county register here, so a plan that covers birth
through a church baptism register, or writes birth as a skip with that reason,
are both legitimate.
