# Scenario: flynn-marriage-only-no-child-link

Built for the **child-link exhaustiveness gate** (research-exhaustiveness).

## State

- **Subject:** Patrick Flynn (`I1`), b. ~1845 Ireland, immigrated to Schuylkill
  County, PA, d. 1908. Appears in US records only as an **adult**.
- **Question:** `q_001` — "Who were the parents of Patrick Flynn?" — `in_progress`,
  not yet declared exhaustive.
- **Plan `pl_001` is fully `completed`** (4 items):
  - `pli_001` marriage → **positive**: found Thomas Flynn m. Mary Doyle, 12 Feb
    1843, County Mayo (the couple, before Patrick's birth).
  - `pli_002` Patrick's baptism → **negative** (patchy Mayo registers).
  - `pli_003` US census as a child → **negative** (immigrated as an adult).
  - `pli_004` Patrick's PA death certificate → **positive for identity, silent on
    parentage**: cert. no. 4521 recovered (`src_002`, `a_002`), but **both
    parent-name fields are blank** — the informant was a son-in-law who did not
    know the Irish parents. Recorded as negative evidence in `a_003`.
- **Tree:** candidate parents Thomas (`I2`) and Mary Doyle (`I3`) exist as stubs,
  but there is **no `ParentChild` link to Patrick** — the parentage is unproven.
  The only evidence bearing on the couple is their **marriage to each other**;
  nothing places Patrick with them.
- **Patrick is identified in the tree** — `pe_003` links the death certificate
  (`a_002`) to `I1`. This matters mechanically: the agent's Step 0 `person_evidence`
  hard block requires every person the judgment depends on to carry at least one
  linked identity assertion. Without it the agent correctly stops at Step 0 and
  never reaches the child-link gate this scenario exists to exercise (see
  **Why the death certificate is here**).

## What it exercises

The child-link rule in `research-exhaustiveness/SKILL.md`: a parentage conclusion
at probable+ needs an *examined record that places the child with the concluded
parents* (christening, census household, emigration, probate naming the child). A
couple's **marriage to each other does NOT satisfy this** — it proves they married,
not that this child is theirs.

The trap: every plan item is `completed` and a convincing record (the marriage) was
found, so completion-bias pressures a declaration. The skill must **decline** to
declare exhaustive, name the missing child-linking record, and recommend continuing
(originals, other jurisdictions) rather than concluding on couple-level evidence
alone.

Distinct from `flynn-decisive-record-unsearched` (ut_013): there the decisive
records were never searched; here the marriage *was* found and must be recognized as
insufficient for the child-link.

## Why the death certificate is here

Added on #2269. The tree had always attached `S2` (“Pennsylvania Death
Certificates”, cert. no. 4521) to Patrick's death fact, but `research.json`
carried **no** matching source, log entry, assertion or `person_evidence` — the
audit trail did not record the record the tree said had been examined.

That gap was not cosmetic. It left `I1` with zero linked identity assertions, so
`research-exhaustiveness` hit its Step 0 `person_evidence` hard block, declined
there, and never reached `## 1. Gather evidence` or the decisive-record gate.
The judge scored that run correct (all 3s on `v1_2026-09-16_05-48-00`) because
the agent *was* correct — but `test_fetches_registration_start_date` failed it
for making no `wiki_read`, which a Step 0 exit does not owe. The test was
grading a precondition stop, not the child-link rule in its name.

Completing the audit trail restores the intended path and **strengthens** the
scenario: both decisive parentage records are now searched — the baptism
(`pli_002`, not recovered) and the death certificate (`pli_004`, recovered with
the parent fields blank) — so the decline rests squarely on the missing
child-link and not on an unsearched record.
