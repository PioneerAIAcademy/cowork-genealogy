# hale-children-enumerative

A first-plan scenario whose question asks for every child of a couple beyond the
five already known, labelled `question_kind: "enumerative"`. Built on the shape of
the `hannah-earnest-children` e2e fixture, as Richard set on #1830 (2026-10-23).

Built for issue #1830 item 1: under the lead's 2026-08-31 ruling on #1917, an
enumerative question's plan covers birth, marriage, death, census and probate,
and says in writing why any of the five is absent.

## State

- **Objective:** Besides their children Mary, John, Rebecca, William and Joseph, did Thomas Hale and his wife Sarah of Greene County, Ohio, have any other children?
- **Questions:** q_001 (the couple's other children, in_progress, `question_kind: "enumerative"`, no `search_stop`)
- **Plans, log, sources, assertions, conflicts, hypotheses, proof summaries:** all empty — this is a first plan
- **Localities:** loc_001, Greene County, Ohio, 1830–1880
- **Tree:** seven persons and eleven relationships. Thomas Hale (I1) — born about 1810 in Pennsylvania, died 1868 in Greene County. Sarah Hale (I2), his wife, with no facts. Five children, each born in Greene County and linked to both parents: Mary (I3, about 1836), John (I4, about 1838), Rebecca (I5, about 1841), William (I6, about 1844), Joseph (I7, about 1847). One couple and ten parent-child relationships. No sources.

## The shape under test

The question names a set of people, not one fact, and five of them are already
known. A plan that searches only for more births, or only the censuses, can find
some missing children but cannot claim to have looked for all of them: children's
marriages and the father's probate are where the rest are named.

Across the committed e2e corpus, 29 of 33 plans for children or siblings questions
miss at least one of the five events with no written reason, most often probate
(23) and marriage (20); every `hannah-earnest-children` plan misses (13 of 13).
Replayed with `_covered_events` on 2026-10-23.

## Why the locality is built the way it is

The collection list is what a locality guide would surface: the 1850, 1860 and
1870 censuses, Ohio county marriages and Ohio probate records. Marriage and
probate are listed deliberately: those are the two events plans skip most often,
so the scenario makes them available and measures whether the plan uses them
(Richard, #1830, 2026-10-23). The one quirk restates what the
FamilySearch wiki says: Greene County marriage and probate records survive from
1803. Nothing in the locality names the five event types or says a plan must
cover them. The Rowe fixture (`rowe-window-is-not-a-ceiling`) showed a quirk that
states the rule lets the old prose pass and spoils the measurement.

**Tightened 2026-10-23.** A second quirk, on Ohio county birth and death
registers (kept by probate courts from 1867, Greene County births from 1869), was
removed after 9 pre-edit runs failed only 1 time: it was the locality's only
mention of births or deaths, and the one failing run was missing exactly a birth
item. Re-measured, the old wording still failed only 1 of 8. Richard then ruled
(#1830, 2026-10-23) that the fixture was too easy rather than the old wording
sufficient, and set its present shape: five known children, with marriage and
probate available.

All five collection ids were checked: 1850, 1860 and 1870 against recorded
collection titles in this repo; Ohio County Marriages (1614804, 2026-10-22) and
Ohio Probate Records (1992421, 2026-10-23) live with
`dev/try-collections-search.ts`.

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
