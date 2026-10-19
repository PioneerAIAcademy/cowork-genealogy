# flynn-fan-pivot-parent-linked

Patrick Flynn parentage research — all direct evidence searches exhausted, question still unresolved, and the only adult of plausible parental age in his 1860 household is already his mother in the tree.

The negative counterpart to `flynn-fan-pivot-coresident`. There, an unaccounted-for adult is present and the FAN question should name him. Here there is no such adult, and a question naming the one in-band person would be targeting someone the tree already answers.

## State

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Questions:** q_001 (parentage, in_progress), q_002 (1850 census placement, resolved)
- **Plans:** pl_001, pl_002 — both completed, every item searched
- **Timeline:** low-severity gap only
- **Proof summary:** `probable`
- **Tree:** three persons. Thomas Flynn (I2) is linked as Patrick's father, Margaret Hanlon (I3) as his mother. Both links are quality-2 and the question remains open — a tree link is not a proof, which is why q_001 is still `in_progress`.

## The 1860 household

| role | person | age | b. | relative to Patrick |
|------|--------|-----|-----|---------------------|
| head_of_household | Michael Doyle | 28 | ~1832 | **+13 years — below the 15-year floor** |
| boarder | Margaret Hanlon | 45 | ~1815 | **+30 years — in band, and already his mother in the tree** |
| boarder | Patrick Flynn | 15 | ~1845 | the subject |

Patrick and his widowed mother board in another man's household — an ordinary arrangement for Irish immigrants in the Schuylkill coal patches. Thomas Flynn does not appear in this record.

## Why it is built this way

Each of the three choices below is load-bearing. Change any one and the scenario stops testing what it exists for.

**The anchor is out of band.** A correct FAN question sweeps the household and names its head — that is what the agent does on `flynn-fan-pivot`, where the generic question named Thomas Flynn as the head whose neighbours were sought. So the head here must not also be a signal candidate, or a question naming him would be ambiguous between a legitimate sweep and a wrong target. At 28 Michael Doyle is thirteen years older than Patrick and cannot qualify.

**The excluded parent is not the anchor.** This is what lets the negative be checked mechanically rather than only judged. Nothing legitimate puts a boarder's name in a FAN question about the household's neighbours, so "the question names Margaret Hanlon" **is** "the question targeted Margaret Hanlon". That proxy is unavailable where the excluded people are the anchor, which is the case the sibling scenario `flynn-fan-pivot-nuclear-unlinked` covers and why that one is judged instead.

**Her surname differs from the subject's.** A sweep for Flynn associates could surface another Flynn without targeting anyone. "Hanlon" cannot arrive in the question by accident.

## What this scenario does not establish

That Margaret is proved. The tree links her at quality 2 on a single census that states no relationships; q_001 is open precisely because neither parent is proved. The exclusion being tested is "already a parent **in the tree**", not "already proved" — and those are different things.

## Differs from `flynn-fan-pivot`

- `assertions`: `a_005` (the old 1860 relationship assertion placing Patrick in Thomas Flynn's household) is removed; `a_007`–`a_013` describe the Doyle household instead.
- `sources`: `src_003`'s citation, `where_within` and URL now name dwelling 206, the Michael Doyle household.
- `tree.gedcomx.json`: gains Margaret Hanlon (I3) and the ParentChild relationship R2. R1 (Thomas → Patrick) drops its 1860 source, since Thomas is not in that record any more; it rests on the 1850 census and the death certificate.
