# ma-birth-record-unsearched

Parentage research for **Ida F. Braman** (b. ~1875, Taunton, Bristol County,
Massachusetts) sitting at the exhaustiveness assessment with a **completed**
plan.

## Starting state

`q_001` asks for Ida's parents. `pl_001` has five items and **all five are
`completed`**:

| item | record type | outcome |
|---|---|---|
| `pli_001` | 1880 census, Taunton | positive — Ida, age 5, in the Charles W. Braman household |
| `pli_002` | 1900 census, Taunton | positive — Ida, age 25, enumerated as daughter of the head |
| `pli_003` | 1946 Massachusetts death registration | positive — names father Charles W. Braman and mother Ellen Sullivan |
| `pli_004` | Taunton parish baptism | negative — the 1875 register does not survive in any consulted collection |
| `pli_005` | Bristol County probate for the candidate father | negative — no estate administered |

`exhaustive_declaration.declared` is `false`. Both candidate parents are
identity-linked via `person_evidence`, all five assertions are classified, and
`conflicts` and `hypotheses` are empty.

## What the fixture holds that the plan does not

**Ida's own 1875 Massachusetts birth registration is not a plan item and appears
nowhere in `log`.** Massachusetts kept statewide civil registration of births
from 1841, and those returns are public — held by the Registry of Vital Records,
the State Archives and the town clerks, and digitized. So the record exists for
this time and place and is obtainable.

The death registration that *is* worked carries the parents' names from an
informant recorded in the fixture as `family_not_present` — the decedent's
daughter, reporting a birth seventy-one years earlier that she did not witness.
A birth registration's informant is a parent at the event.

## What it exercises

`research-exhaustiveness`'s **named-decisive-record rule** in the case where:

- the plan is complete and every *other* decisive record type for a parentage
  question has been worked, so a completion-biased evaluation has nothing left
  to point at;
- the unworked decisive type is the subject's **own birth record**, and the
  jurisdiction and period are ones that kept it — the era condition, as opposed
  to `flynn-*` scenarios (1845, Ireland/Pennsylvania, before registration) where
  no such record exists;
- the record is **accessible**, as opposed to `recent-birth-sealed` (1936 Utah,
  privacy-embargoed ~100 years) where the rule's inaccessibility carve-out
  applies.

Also exercises whether an informant's distance from the event is weighed rather
than the record's directness alone: the death registration names both parents
outright.

## Used by

`ut_research_exhaustiveness_018`. Referenced by no other test — edits here
invalidate one run log, not a corpus of them.
