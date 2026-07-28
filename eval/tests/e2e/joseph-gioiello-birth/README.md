# Joseph Gioiello

**Source PID:** `GCT1-Z84`
**Joseph Gioiello is deceased.** (FamilySearch ToS requires all committed
e2e fixtures to be about deceased persons.)

## Research question

> What evidence supports the birth date and birthplace of Joseph Gioiello
> (GCT1-Z84)?

## What was removed from the starting tree

- Removed fact f42acfd5-0f1c-4b62-9bb6-731f4ccb142a on GCT1-Z84: Birth 1898 South America

The stripping linter flagged a name-overlap false positive on GBX7-JT7 ("Neil
Joseph Gioiello," the subject's son) since his name shares the tokens
"Gioiello" and "Joseph" with the answer. His own Birth fact (3 September 1929,
Trumbull, Ohio) is unrelated data and was confirmed untouched.

## Expected difficulty

Easy — the birth year and birthplace are already independently corroborated
by two original U.S. federal census records (1940 and 1950), both of which
are already cited in the tree's `sources` (untouched by this strip). The
recovery task is a sourcing exercise: find and cite the two census records
that already agree, not a fact-discovery task.

## Notes for reviewers

The Birth fact (1898, South America) had **zero sources attached** in the
unstripped tree. During authoring, both cited census sources were read
directly and independently confirm the exact same birth year and birthplace
— this is a solid, corroborated answer, not a guess.

"South America" as a birthplace is unusually vague (a continent, not a
country), but it is what both records genuinely state. Do not expect or
require a more specific country or city from a run unless it turns up an
actual new record supplying one (e.g. a naturalization record, ship
manifest, or draft registration).

This fixture was authored twice: the first attempt's live-research validation
pass hit a persistent FamilySearch `record_search` outage ("fetch failed" on
every attempt) that never recovered within that session, and was later
discarded and re-authored fresh (this version) rather than carried forward.
The re-snapshot is byte-identical in substance to the first attempt (same
facts, sources, and IDs) -- nothing about the fixture itself was wrong; the
outage was purely a transient upstream issue. Worth noting for whoever runs
the scored pass: if `record_search` is down, the agent has no way to answer
this question (the tree-read tools are blocked in the scored run), so a
`fail`/`aborted` verdict in that situation reflects a tool outage, not an
agent or fixture defect -- rerun once the tool recovers before concluding
anything about the agent's performance.
