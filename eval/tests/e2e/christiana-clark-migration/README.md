# Christiana (Schreck) Clark — Ohio to Wisconsin migration (1840s)

**Source PID:** `GP3R-215`
**Christiana (Schreck) Clark is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
29 January 1783 in Pennsylvania (baptized Rehrersburg, Berks County);
died 27 December 1848. She is the widow of William Clark
(`KGCJ-XPW`, b. 1783 Philadelphia, d. 1829 Coshocton County, Ohio),
and appears in the tree under her maiden name, "Christina Schreck."

## Research question

> Did Christiana Clark migrate from Coshocton County, Ohio to Green
> County, Wisconsin?

## What was removed from the starting tree

- Removed fact 67b65b39-cdf0-43cb-a77a-68b8f1ce292a on GP3R-215: Death 27 December 1848 Monroe, Green, Wisconsin, United States
- Removed fact 95cdf8d6-4bfe-4c27-89e8-9680b7e6b3b8 on GTP4-6L3: Residence 1849 Green County, Wisconsin, United States
- Removed fact 54756bf2-0eab-4615-8497-70f560c6a99e on LHVD-1MC: LifeSketch
- Removed fact a2b0fca8-86fb-4485-88dd-d34ab0bb6d18 on LZLH-PPW: Residence 1850 Monroe, Green, Wisconsin, United States
- Removed source 3VYM-S2X: Christina Clark in entry for Joseph Clark, "Wisconsin, Marriages, 1836-1930"

Everything else is **retained** as search anchors: her birth/baptism in
Pennsylvania; her Coshocton County, Ohio residences (1820, 1830) and
tax assessments (1831, 1833); her 1840 residence in Fallsbury Township,
Licking County, Ohio; her burial at West Carlisle Cemetery, Coshocton,
Ohio; her husband William Clark; her parents; and all ~12 children
(with their Ohio births). The stripping removed **every** Wisconsin
reference from the starting tree — not just her own death place, but
also son Samuel's life sketch (which narrates the family's 1846 move to
"Greene County," Wisconsin) and two sons' Green County residence facts —
so the agent cannot read the answer off a relative's record and must
rediscover the migration by searching records.

## Expected difficulty

hard — There is no single clean record stating "Christiana resided in
Green County, Wisconsin." The migration must be inferred by correlating
several records the agent has to find itself: her sons' presence in
Green County, Wisconsin (Joseph Clark in the 1850 U.S. census at Monroe;
William Clark by 1849), son Joseph's 1854 Wisconsin marriage naming his
mother, and a 1847 Wisconsin federal-land entry for a "Christiana Clark"
(BLM Tract Books, Mineral Point land office). Two features actively
mislead: her **burial and Find a Grave memorial point back to Coshocton,
Ohio**, and she **died in December 1848 — before the 1850 census — so no
census ever names her in Wisconsin**. The agent must resist concluding
"stayed in Ohio."

## Notes for reviewers

- **Required finding (f1)** is the migration itself: Christiana moved
  from Coshocton County, Ohio to **Green County, Wisconsin** by the late
  1840s. Credit the *conclusion that she migrated to Wisconsin (Green
  County)*, supported by the record trail above — not an exact date.
- **Bonus finding (f2)** is the exact death — **27 December 1848,
  Monroe, Green County, Wisconsin.** That precise date/place is
  **tree-only**: her Find a Grave memorial gives an Ohio burial and a
  1849 death year, and no indexed record confirms the exact Wisconsin
  death. Per the fixture rule that tree-only specifics are bonus, f2 is
  `required: false`.
- **Anchor correction vs. the authoring brief.** The original brief
  listed "Wisconsin census records" and "Find a Grave / cemetery
  records" as evidence for the migration. Reachability probing showed
  neither supports *her* Wisconsin presence: she died before the 1850
  census (Wisconsin census evidence is for her **sons**, not her), and
  Find a Grave places her burial in **Ohio**. The recoverable evidence
  is instead the sons' Green County records + the 1847 BLM land entry.
- **Verified reachable 2026-07-14** via live `record_read` /
  `record_search`: son Joseph Clark's 1854 marriage at Monroe, Green
  County, Wisconsin (`Wisconsin, Marriages, 1836-1930`, ARK
  `XRP8-7XG`) reads cleanly and names "Christina Clark"; and
  `record_search` for `Clark / Christiana` filtered to Wisconsin
  surfaces the 1847 BLM Tract Books land entries. The identity of the
  BLM "Christiana Clark" is a strong name+date+place match but is not
  provable from the index alone (no age/kin in the indexed fields) — a
  point a grader should weigh when scoring a run that leans on it.
- **Identity note.** The subject's tree name is "Christina Schreck"
  (maiden). The husband's PID `KGCJ-XPW` was originally supplied for
  this fixture by mistake; `KGCJ-XPW` is William Clark, who died in Ohio
  in 1829 and never migrated. The correct subject is his widow,
  `GP3R-215`.
