# rourke-fan-pivot-nuclear-unlinked

Ellen Rourke parentage research, caught mid-research: direct evidence exhausted, no parent linked in the tree, and the 1860 census showing her as a child in a Rourke household whose head and wife are the obvious candidates — and are exactly who the next question must not be about.

The second negative in the issue #3311 set. `flynn-fan-pivot-parent-linked` covers an adult the tree already answers; this one covers adults the tree has not reached yet.

## State

- **Objective:** Identify the parents of Ellen Rourke (b. ~1845 Ireland, d. 1912 Luzerne County, Pennsylvania)
- **Questions:** q_001 (parentage, in_progress, `search_stop: record_exhausted`)
- **Plans:** pl_001 — five items, all completed: 1860 census, 1870–1880 census, the 1912 death registration, probate 1870–1915, Catholic parish registers 1850–1875
- **Log:** six entries. The 1860 enumeration is the only positive; everything after it is negative or returns a record naming no parents
- **Timeline:** one low-severity gap, 1860 to 1912, already searched
- **Conflicts, hypotheses, proof summaries:** none
- **Tree:** one person. Ellen (I1), with no parents and no relationships.

## The 1860 household

| role | person | age | b. | relative to Ellen |
|------|--------|-----|-----|---------------------|
| head_of_household | Michael Rourke | 50 | ~1810 | +35 years — **in band** |
| wife | Honora Rourke | 46 | ~1814 | +31 years — **in band** |
| child_1 | Ellen Rourke | 15 | ~1845 | the subject |

Both adults are inside the 15–55 band. Neither is in the tree. Nothing else in the household qualifies.

## Why this scenario is its own family rather than a Flynn derivative

It was a Flynn derivative first, and that was wrong. Deriving it from `flynn-fan-pivot` meant stripping the parentage conclusion so the head and wife would be suppressed by the slot rule alone rather than by two rules at once — but stripping the tree link and the assertions left the questions, plans, log, hypotheses and timeline still discussing Thomas Flynn. The agent read that prose and pivoted onto a man the fixture no longer contained. The scenario validated against the schema the whole time; the incoherence was in the narrative, which no validator reads.

So this one starts from nothing and carries no conclusion to strip. Every person named anywhere in it — in the log, the plan, the timeline, the search_stop justification — appears in the assertions or the tree.

## Why it is built this way

**The subject is enumerated as a child.** That is what makes the head and wife *presumptive parents* rather than ordinary co-residents, and it is the condition the nuclear-slot exclusion keys on. An adult boarder in the same household would be a legitimate FAN target; these two are not.

**Neither adult is in the tree.** This is Richard's point of 2026-10-15 — the exclusion cannot be left to the tree-parent rule, because at the moment question-selection runs the parents usually are not linked yet. If they were, this scenario would test the other rule.

**The 1860 schedule states no relationships.** `a_007` records position and age as consistent with a daughter and says the schedule does not state it. The presumption is the reader's, not the record's, which is why the household is a question and not an answer — and why the right next move is direct evidence rather than a FAN pivot onto the couple.

## Why this negative is judged rather than machine-checked

In `flynn-fan-pivot-parent-linked` the excluded person boards in someone else's household, so her name cannot reach a FAN question by accident, and "names her" is a sound proxy for "targets her". Here the excluded people are the household **anchor**: a legitimate generic sweep names the head whose neighbours are being sought. Mention is not targeting, and no string test separates them.

What is checked deterministically is the fixture itself — `test_fan_pivot_signal_set_is_empty` asserts the computed signal set is empty and the excluded set is not, so every in-band adult really is excluded and the scenario is the negative it claims to be. Whether the question targets one of them is the judge's call, through `judge_context`.
