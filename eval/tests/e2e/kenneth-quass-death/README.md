# Kenneth Werner Quass — death and burial (1982)

**Source PID:** `KNS4-P6W`
**Kenneth Werner Quass is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.)

## Research question

> When and where did Kenneth Werner Quass die, and where was he buried?

## What was removed from the starting tree

- Removed Kenneth's **Death** fact (17 Sep 1982, Grapevine, Tarrant
  County, Texas) from his `facts` array.
- Removed Kenneth's **Burial** fact (25 Sep 1982, Madelia, Watonwan
  County, Minnesota) from his `facts` array.
- Removed the three sources that attest the death/burial: the Texas
  Death Index 1903-2000 entry, the Texas Death Index 1964-1998 entry,
  and the Find a Grave Index entry (16 → 12 sources).

The subject keeps his birth, residences (1920/1930/1935/1940 census),
1962 move, and WWII draft registration, plus his parents, spouse, and
two deceased children — so the agent has a strong anchor to search from.

### Other normalization applied to the raw `person_read` tree

Not part of the answer, but cleaned up so the starting tree validates
and is ToS-compliant:

- Dropped the living son (PID `LF4F-ML8`, `living: true`) and the
  relationships referencing him.
- Dropped 21 ParentChild relationships that pointed at relatives one
  hop beyond the returned persons (grandparents, aunts/uncles, in-laws)
  whose person records `person_read` did not include — they were
  dangling references.
- Added synthetic `id`s to names and relationships and normalized the
  `move` fact type to PascalCase (`Move`) to satisfy the schema.

`starting-research.json` and `starting-tree.gedcomx.json` both pass
`validate_research_schema`.

## Expected difficulty

easy — A 20th-century US death documented by multiple modern indexed
records (Texas death index, Find a Grave). The one twist worth noting:
Kenneth died in Texas but was buried back in Minnesota near family, so
the agent must recover a death and a geographically separate burial.

## Notes for reviewers

The two required findings are the death (place/date in Texas) and the
burial (place/date in Minnesota). The agent may legitimately reach the
same answer through a different source path than the three stripped
sources — grade on the recovered facts, not on which record was cited.
