# Proof-Conclusion Skill — Test Plan (for genealogist review)

*Purpose: we're hardening the automated tests for the **proof-conclusion**
skill. This doc lists every test we plan to have, in plain language, and
flags a few genealogical judgment calls where we need your input. You don't
need to read any code — just sanity-check that the situations and the
expected confidence levels make genealogical sense.*

## What this skill does

It writes the **final GPS conclusion** for a research question. Given the
evidence already gathered, it:

1. picks the **confidence level** — Proved, Probable, Possible, Not Proved,
   or Disproved;
2. picks the **format** — Proof Statement, Summary, or Argument;
3. writes a self-contained narrative that could be uploaded to FamilySearch;
   and
4. **updates the family tree only when the conclusion is Probable or
   stronger** (at Possible or weaker, the tree is left untouched).

## How to read this doc (plain-language glossary of *our* jargon)

- **Test** — one example situation we feed the skill to check it behaves
  correctly.
- **Scenario** — a snapshot of a research project (the questions, records,
  evidence, and tree so far) that a test runs against. Several tests can
  share one scenario.
- **Positive test** — "given this situation, the skill *should* do X." We
  check it does.
- **Negative test** — a look-alike request that really belongs to a
  *different* skill. We check proof-conclusion correctly **steps aside**
  instead of grabbing it. (This is how we keep skills from stepping on each
  other.)
- **"No tree write"** — the test checks that the family-tree file is left
  **exactly as it was** — nothing added.

## What's already covered (3 tests — done)

| Test name | What it should do | Scenario | Type |
|---|---|---|---|
| Probable conclusion, with reasons | With three converging records but the search not yet finished, write a **Probable** conclusion and say plainly what's still needed to reach Proved. | mid-research-flynn-no-proof | Positive |
| Proved conclusion after a thorough search | With a reasonably exhaustive search done and multiple independent sources agreeing, write a **Proved** conclusion. | flynn-research-complete-no-proof | Positive |
| Don't hijack a status request | When the user just wants "where are we on this project?", step aside — that's the project-status skill, not a formal proof. | mid-research-flynn | Negative |

> **The gap:** only the two strongest confidence levels (Probable, Proved)
> are tested. The whole lower half — **Possible, Not Proved, Disproved** —
> is untested, as is the choice of proof format and the "only write the tree
> when confident" rule.

## New project situations we need to build (scenarios)

These three are brand-new project snapshots. Every existing snapshot assumes
Thomas Flynn really *is* Patrick's father, so we have to build evidence
shapes that honestly justify the weaker outcomes. **This is the part where
we most need your eye.**

### Scenario A — `flynn-parentage-possible` (a single weak lead)

- **What's present:** one record only — the **1850 census** showing Patrick
  (age 5) living in a Thomas Flynn household. The relationship is *inferred*
  from household position (the 1850 census has no "relationship to head"
  column).
- **What's absent:** no second census, no death certificate, no other
  corroboration. The search has barely begun.
- **Why this should be Possible:** a child living in a same-surname household
  headed by a man of plausible age is a *credible lead* — but a single
  uncorroborated, indirect record could be coincidence. Viable, needs more
  work. (Contrast: the existing Probable test has *three* agreeing sources.)

### Scenario B — `flynn-parentage-not-proved` (two rival candidates)

- **What's present:** the 1850 census shows a Patrick Flynn (age 5) in
  **Thomas** Flynn's household — *and* a second Patrick Flynn (age 6) in
  **Michael** Flynn's household elsewhere in the same county. The 1860 census
  finds Patrick boarding in an unrelated household (no help). The 1908 death
  certificate informant reported the father as **"unknown."**
- **Why this should be Not Proved:** after a reasonable search, the evidence
  supports two candidate fathers about equally and decisively links Patrick
  to neither. There's no basis to lean either way; the question stays open.
- **Format note:** this is the case that calls for a full **Proof Argument**
  (competing candidates, only indirect evidence) — so it doubles as our test
  that the skill picks the Argument format when the evidence demands it.

### Scenario C — `flynn-parentage-disproved` (the timeline rules it out)

- **The question, narrowed:** "Was **Thomas** Flynn the father of Patrick
  Flynn?"
- **Where the bad guess came from:** an unsourced online family tree asserts
  Thomas Flynn is Patrick's father — the kind of unverified claim researchers
  routinely have to check.
- **What's present:** Thomas Flynn's **burial record shows he died in 1842**
  (in Ireland), while Patrick's records consistently place his birth at
  **~1845**. A man who died in 1842 cannot have fathered a child born in 1845.
- **Why this should be Disproved:** the timeline makes the hypothesis
  impossible — the evidence affirmatively refutes it. (This is the most
  airtight kind of refutation: no judgment call, no weighing.)
- **Scope note:** the conclusion *disproves Thomas*; finding the actual
  father is a separate future question — so nothing is added to the tree, and
  no alternative father is named.

## The new tests (9)

| Test name | What it should do | Scenario | Type |
|---|---|---|---|
| Possible conclusion (one weak lead) | Write a **Possible** conclusion — frame it as a credible lead, not proven — and **leave the family tree unchanged**. | flynn-parentage-possible *(new)* | Positive |
| Not Proved (two rival candidates) | Write a **Not Proved** conclusion as a full **Proof Argument**, laying out both candidates and why neither can be confirmed; **leave the tree unchanged**. | flynn-parentage-not-proved *(new)* | Positive |
| Disproved (a record rules it out) | Write a **Disproved** conclusion explaining the refuting record; **leave the tree unchanged**. | flynn-parentage-disproved *(new)* | Positive |
| Grade an existing proof against the standard | When the user asks "does my proof meet the GPS?" on a project that already has a conclusion, give a real GPS assessment across all five components — **not** just a "the file is valid" check. | mid-research-flynn | Positive |
| Refuse to conclude while a conflict is open | Asked to write the proof while a source conflict is still unresolved, the skill should decline to finalize and point to conflict-resolution first (no Proved conclusion over an open conflict). | flynn-with-birthplace-conflict | Positive |
| Update the existing conclusion, don't duplicate it | Re-asked to conclude a question that already has a conclusion, the skill should **update the existing one in place**, not create a second one. | mid-research-flynn | Positive |
| Don't hijack a "resolve the disagreement" request | "These two sources disagree on the birth year — reconcile them first" should go to conflict-resolution. | flynn-with-birthplace-conflict | Negative |
| Don't hijack an "is this primary or secondary?" request | "Is this death-cert informant primary or secondary for the father's name?" should go to assertion-classification. | mid-research-flynn | Negative |
| Don't hijack a "what should I research next?" request | "What should I research next now that this is done?" should go to question-selection. | flynn-resolved | Negative |

## Decisions we need from you

For each, our recommendation is in **bold** — a simple "yes" or a redirect
is all we need.

1. **Possible vs. Not Proved (Scenario A).** Is a *single* uncorroborated
   1850 co-residence the right strength for **Possible**? **We say yes** —
   the evidence does lean one way, it's just thin. Or would you call one lone
   record Not Proved?
2. **The Not Proved shape (Scenario B).** Does "two rival Flynn households,
   neither confirmable" read as honestly inconclusive? **We recommend this
   shape.** Alternative if you prefer: an unresolvable date/age conflict
   instead of two candidates.
3. **The Disproved shape (Scenario C).** Do you prefer the **baptism naming
   a different father** as the refuting record (**our recommendation**), or a
   **chronological impossibility** (the candidate father died well before the
   child was conceived), which is even harder to argue against?
