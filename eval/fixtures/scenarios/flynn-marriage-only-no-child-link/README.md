# Scenario: flynn-marriage-only-no-child-link

Built for the **child-link exhaustiveness gate** (research-exhaustiveness).

## State

- **Subject:** Patrick Flynn (`I1`), b. ~1845 Ireland, immigrated to Schuylkill
  County, PA, d. 1908. Appears in US records only as an **adult**.
- **Question:** `q_001` — "Who were the parents of Patrick Flynn?" — `in_progress`,
  not yet declared exhaustive.
- **Plan `pl_001` is fully `completed`** (3 items):
  - `pli_001` marriage → **positive**: found Thomas Flynn m. Mary Doyle, 12 Feb
    1843, County Mayo (the couple, before Patrick's birth).
  - `pli_002` Patrick's baptism → **negative** (patchy Mayo registers).
  - `pli_003` US census as a child → **negative** (immigrated as an adult).
- **Tree:** candidate parents Thomas (`I2`) and Mary Doyle (`I3`) exist as stubs,
  but there is **no `ParentChild` link to Patrick** — the parentage is unproven.
  The only positive evidence is the couple's **marriage to each other**.

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
