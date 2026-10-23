# kovac-held-death-certificate

A first-plan scenario whose objective says the user holds the document its facts
came from: "Who were the parents of my grandmother Anna Kovač (d. 1952, Chicago)?
Her death certificate, which I have, names Josef Kovač and Marie Horák."

Built for issue #1830 item 2: when the objective's facts came from a document the
user holds, the plan reaches that document first, and plans no fresh search for
facts taken from a document nobody has read.

## State

- **Objective:** who were the user's grandmother's parents; her 1952 death certificate, which the user holds, names them
- **Questions:** q_001 (Anna's parents, in_progress, `question_kind: "targeted"`, no `search_stop`)
- **Plans, log, sources, assertions, conflicts, hypotheses, proof summaries:** all empty — this is a first plan
- **Known holdings:** none. The issue body requires the test to need no `known_holdings` entry; the held document is stated only in the objective
- **Localities:** loc_001, Cook County, Illinois, 1890–1960, with no quirks
- **Tree:** one person. Anna Kovač (I1) — born about 1890, died 1952 in Chicago. No parents, no sources.

## Why it is built this way

The objective asks the question first and mentions the record last, with its place
and year, and the question names the fact.

**Tightened 2026-10-23.** The objective used to open with the certificate itself
("My grandmother Anna Kovač's death certificate (Chicago, Cook County, Illinois,
1952) gives her parents as …"). With it in first position, 9 pre-edit runs never
failed. It now leads with the question and names the certificate last; the facts
are unchanged. Same step Richard set for item 3 (#1830, 2026-10-20): tighten once,
then measure 9 pre-edit runs again. The certificate is the one source whose informant reported the parents'
names; every other item in the plan corroborates it. A plan that searches the
censuses for a Josef and Marie before reading the certificate plans a fresh search
for facts nobody has yet read.

The locality lists two collections, both checked live with
`dev/try-collections-search.ts` on 2026-10-22: Illinois, Cook County Deaths,
1871-1998 (1463134) and Illinois, Cook County Marriages, 1871-1969 (1463145).
The county facts (seat Chicago, organized 15 January 1831) are from the
FamilySearch wiki page.

## Grading

`test_objective_target_leads_the_plan` gates this scenario through its
per-test-id table (`ut_research_plan_hdo`): a vital-type item in Chicago or Cook
County whose rationale names the death certificate must be the first item, and
must not be a `fallback_for` any other item.
