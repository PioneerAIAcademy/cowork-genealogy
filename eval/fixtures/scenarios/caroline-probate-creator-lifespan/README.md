# Scenario: caroline-probate-creator-lifespan

The state immediately before `research-plan` writes the plan for a
parentage question whose most promising lead is an **indirect** record
(a father's probate/estate file) — the canonical worked case from issue
#1472 (Rule 2), where a naive plan sizes the search window to the
subject's own early-life research window rather than to the record
CREATOR's (the father's) plausible lifespan. No plan for q_001 yet.

- **Subject:** Caroline Voss (`I1`), born 1839, Rowan County, North
  Carolina. Married ~1858 (the only other dated fact about her). No
  record found so far names her father.
- **q_001** (`open`): "Which probate or estate record names Caroline
  Voss's father?" — the rationale states plainly that a father's estate
  could be probated any time from Caroline's infancy to roughly 60 years
  after her birth, i.e. as late as ~1899 — decades after her own 1858
  marriage.
- `plans` is empty — research-plan should create the first plan (Add-new
  path).
- `localities` already has an entry (loc_001) for Rowan County, North
  Carolina spanning 1839-1899 (the father's full plausible lifespan, not
  just Caroline's early-life window) — so the "no localities entry" stop
  condition doesn't block a wide-window probate item, and research-plan
  is tested purely on whether it sizes the item's `date_range` correctly
  given a locality survey that already supports the wide window.

The point of this scenario: an indirect record's date window belongs to
its record's **creator**, not the research subject. A probate item
capped anywhere near Caroline's own 1858 marriage (or her birth year, or
any subject-centric bound well short of ~1899) excludes most of the
range where the record could actually sit. The failure this scenario
guards against is a plan item whose `date_range` ends decades before the
father's plausible death, especially when nothing else in the fixture
suggests he died young.

Derived from issue #1472 (Rule 2)'s own worked example (a report
originally captured from a Claude thinking block, not user-facing
output — the issue itself asks that the craft point be reproduced
against a real plan before treating it as settled, which this test
does). Fictional subject (Caroline Voss); the craft point — sizing an
indirect record to its creator's lifespan — is the real, general
doctrine point being tested, not this specific person.
