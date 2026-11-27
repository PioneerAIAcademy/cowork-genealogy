# raymond-pre1850-parentage

A first-plan scenario for a parentage question whose answer predates the 1850
census. Built for issue #4163: a US federal census from 1790 to 1840 names only
the head of household, so it can place a man in a town but cannot name a child.

## State

- **Objective:** Verify the parents shown in the FamilySearch Tree for Paul Raymond
- **Questions:** q_001 (was Paul Raymond, d. 1828 in Berkshire County, Massachusetts, the father of Paul Raymond, b. about 1770, of Bristol, Vermont, by 1800?), in_progress, `question_kind: "targeted"`, no plan
- **Plans, log, sources, assertions, conflicts, hypotheses, proof summaries:** all empty
- **Localities:** loc_001 Addison County, Vermont, 1770–1850; loc_002 Berkshire County, Massachusetts, 1760–1830. Each lists the 1790–1840 federal censuses beside probate, land and town records. The quirks are true and neutral: none says that an early census names only the head, so a plan that knows it learned it from the agent body, not the fixture.
- **Tree:** two men named Paul Raymond linked as father (I2) and son (I1). No `ark`, no sources. The son's birthplace is blank on purpose: Bristol was not settled until 1786.

## Grading

The test fails a plan that presents a 1790–1840 census as naming the son or as
household proof of parentage, or that puts such a census ahead of the records
that can name a child (probate, land, town and church records). A census used
only to place each man in a town is acceptable in any position.

The MCP fixtures serve live FamilySearch collection lists captured on
2026-11-05, including the national list with the 1790–1840 censuses, so the
agent can see an early census and the test cannot pass for lack of one.
