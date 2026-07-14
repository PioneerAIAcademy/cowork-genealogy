# Christiana Clark — parents (1830 census bonus)

**Source PID:** `LVS7-1HJ`

Christiana Clark is deceased (born 1847, died 2 April 1929, Oakland, Alameda
County, California). Her father William Clark (KHDH-JTF, b. abt. 1805 Canada,
d. 11 April 1882, Livermore, Alameda County, California) and mother Hannah
Jane Wait (LVS7-BWK, b. 10 June 1815, Isle La Motte, Grand Isle County,
Vermont, d. 7 December 1893, Livermore, Alameda County, California) are both
also confirmed deceased.

> Determine who Christiana Clark's parents were, and (bonus) where they were
> enumerated in the 1830 census.

## What was removed from the starting tree

- Removed person KHDH-JTF: William Clark
- Removed person LVS7-BWK: Hannah Jane Wait
- Removed relationship R2 (Couple KHDH-JTF/LVS7-BWK): cascaded from a removed person
- Removed relationship R3 (ParentChild KHDH-JTF/LVS7-1HJ): cascaded from a removed person
- Removed relationship R4 (ParentChild LVS7-BWK/LVS7-1HJ): cascaded from a removed person
- Removed source 9Z7K-3JF: Christian Clark, "United States, Census, 1850" (household entry naming William Clark and Hannah Clark)
- Removed source 9Z7K-78X: Christina Clark, "United States, Census, 1860" (household entry naming William Clark and Hannah J Clark)

## What the starting tree contains

- Christiana Clark herself (subject), with no parents, and her own vitals/residences (1847–1920)
- Her husband Absalom Mendenhall (married 1871, California) and their three children — the family context the agent starts from, none of which is the answer
- Christiana's remaining attached sources (1880/1900/1910/1920 census, marriage records) — none of which name her parents

## Expected difficulty

Medium — the **required scope is the two parents** (William Clark + Hannah
Jane Wait), both reachable via the 1850 and 1860 US censuses, which list
Christiana (as "Christian Clark" / "Christina Clark") in a household headed
by William Clark and Hannah (J.) Clark, at the same places and years as her
own removed-but-inferable residence pattern.

The **bonus** (1830 census enumeration) is intentionally open-ended and not
grounded in any known answer: neither parent has an 1830 residence fact in
the FamilySearch tree, and neither has a live FamilySearch record hint
(`person_record_matches`) for an 1830 census. A live `record_search` for
"William Clark" with an 1830 residence year returned 267,927 matches with no
tree-linked candidate — the name is too common to disambiguate confidently.
Credit is for search process and honest reporting (a plausible, sourced
candidate, or an explicit documented "cannot be reliably determined"), not
for recovering one specific fixed place.

## Notes for reviewers

- Parent identity is fully grounded in the FamilySearch tree via the
  stripped ParentChild relationships (R3/R4) and the two removed census
  sources.
- Hannah Jane Wait was born 1815, so she would be about 15 in 1830 — almost
  certainly still in her own parents' household rather than married to
  William yet (b. abt. 1805, ~25 in 1830). This is relevant context if the
  agent attempts the bonus finding.
- See `expected-findings.json` f3 for the exact bonus-credit criteria; it
  deliberately omits a fixed date/place, unlike a normal `fact` finding.
