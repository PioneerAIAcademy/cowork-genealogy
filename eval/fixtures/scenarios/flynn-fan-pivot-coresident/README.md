# flynn-fan-pivot-coresident

Patrick Flynn parentage research — all direct evidence searches exhausted, question still unresolved, and the 1860 census household contains an older adult who is not a member of the family as the tree records it.

Extends `flynn-fan-pivot` by a single change: three assertions adding Owen Gallagher, aged 58, to the Thomas Flynn household in the 1860 census. Everything else — questions, plans, log, timeline, proof summary, tree — is identical to that scenario.

## State

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Questions:** q_001 (parentage, in_progress), q_002 (1850 census placement, resolved)
- **Plans:** pl_001 (completed), pl_002 (completed — 1860 census + death cert + 1870/1880/1900 census + probate + church records)
- **Log:** 10 entries; the post-1860 census, probate and church-record searches are all negative
- **Timeline:** low-severity gap only; the census-year gap has been searched
- **Proof summary:** `probable`
- **Tree:** two persons. Thomas Flynn (I2) is linked as Patrick's (I1) father. Patrick's mother is not in the tree and is not named in any source here.

## Differs from `flynn-fan-pivot`

`assertions` gains `a_007`–`a_009`, all on `src_003` (the 1860 census, `ark:/61903/1:1:MABC`), all `record_role: "boarder"`:

| id | fact_type | value |
|----|-----------|-------|
| a_007 | name | Owen Gallagher |
| a_008 | birth | age 58 → b. ~1802, Ireland |
| a_009 | residence | enumerated in the Thomas Flynn household, dwelling 112, family 119 |

Nothing else in `research.json` changes, and `tree.gedcomx.json` is untouched — Owen is in the record and not in the tree.

## Why Owen is shaped the way he is

**Aged 58 in 1860, against Patrick's ~15.** That is 43 years, inside the 15–55 band the co-resident signal is defined on. A narrower or wider gap would put him outside it, and the scenario would stop testing what it exists for.

**A boarder, not the head or his wife.** The household head, Thomas Flynn, is already Patrick's father in the tree, so he is excluded twice over — as a tree parent and as a nuclear slot. Owen is excluded by neither.

**Male, deliberately.** Patrick's mother is unknown. An older *woman* boarding in the household would read as a candidate mother, and a question about her would be a parentage question wearing a FAN costume — the shape the 2026-10-12 review-ready decision on issue #3311 rejects. Owen cannot be mistaken for the missing parent.

**His information is `indeterminate`, not primary.** The 1860 schedule names no informant, so who told the enumerator a boarder's name and age is unknown, and the information cannot be classified. `informant_proximity: "unknown"` requires exactly this, and the validator enforces it.

## What this scenario does not establish

Owen's relationship to the Flynns, if any. The 1860 census states no relationships — household position is the only thing tying him to the family, which is what `a_009` records, and what makes him a question rather than an answer.
