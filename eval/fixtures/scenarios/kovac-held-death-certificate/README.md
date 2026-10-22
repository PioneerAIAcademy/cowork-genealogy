# kovac-held-death-certificate

A first-plan scenario whose objective says the user holds the document its facts
came from: "My grandmother Anna Kovač's death certificate (Chicago, Cook County,
Illinois, 1952) gives her parents as Josef Kovač and Marie Horák."

Built for issue #1830 item 2: when the objective's facts came from a document the
user holds, the plan reaches that document first, and plans no fresh search for
facts taken from a document nobody has read.

## State

- **Objective:** the user's grandmother's 1952 death certificate names her parents; who were they
- **Questions:** q_001 (Anna's parents, in_progress, `question_kind: "targeted"`, no `search_stop`)
- **Plans, log, sources, assertions, conflicts, hypotheses, proof summaries:** all empty — this is a first plan
- **Known holdings:** none. The issue body requires the test to need no `known_holdings` entry; the held document is stated only in the objective
- **Localities:** loc_001, Cook County, Illinois, 1890–1960, with no quirks
- **Tree:** one person. Anna Kovač (I1) — born about 1890, died 1952 in Chicago. No parents, no sources.

## Why it is built this way

The objective names the record, its place and its year, and the question names the
fact. The certificate is the one source whose informant reported the parents'
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
