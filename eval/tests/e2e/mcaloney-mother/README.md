# Charles Kingsley McAloney

**Source PID:** `99KY-ZQW`
**Charles Kingsley McAloney is deceased** (b. 11 Jan 1911, Massachusetts;
d. 16 Dec 1989, Sonoma, California). His parents and the other persons in
the starting tree are deceased as well. (FamilySearch ToS requires all
committed e2e fixtures to be about deceased persons; the snapshot's
living-person gate passed over the whole tree.)

## Research question

> What evidence identifies the mother of Charles Kingsley McAloney?

## What was removed from the starting tree

- Removed person 99KY-CB2: Jessie MacPhee (the mother — the answer)
- Removed relationship R2 (Couple 99KY-4H1/99KY-CB2): cascaded from a removed person (the parents' 1907 marriage)
- Removed relationship R4 (ParentChild 99KY-CB2/99KY-ZQW): cascaded from a removed person (the mother→Charles link)
- Removed source 3L4S-8YX: Charles Kingsley Mcaloney, "California, Death Index, 1940-1997"
- Removed source 3L4S-DPJ: Kingsley McAloney, "United States, Census, 1920"
- Removed source 3QHW-WMT: Kingsley McAloney, "United States, Census, 1940"
- Removed source SWDM-SN2: C Kingsley Mc Aloney, "United States, Census, 1930"

**Why those four sources:** they are attached to *Charles*, but their
index titles name the mother directly — "…and **Jessie** McCloney/McAloney"
(the three censuses) and "…and **Mcphee**" (the California Death Index) —
so leaving them in the source list would hand the agent the answer without
any research. Removing them forces the mother to be re-discovered.

**Kept as the recovery path:** the father **Charles Smith McAloney
(99KY-4H1)** (b. 1870 Nova Scotia, d. 1942 MA) as the search anchor, plus
Charles's own retained records — the 1911 Massachusetts birth records, the
Social Security Death Index, and the NUMIDENT — whose index titles name
only the father. The mother is recoverable by re-searching the 1920/1930/
1940 U.S. Census (she is enumerated as wife "Jessie" in Charles's
household), the California Death Index (which names her maiden name
"Mcphee"), the 1911 Massachusetts birth record, or the NUMIDENT.

## Expected difficulty

medium — the mother appears as wife "Jessie" in three census households, so
recovering her given name is straightforward once the agent finds Charles's
household. Pinning her **maiden name** (MacPhee) is the second step: it
requires the California Death Index, the NUMIDENT, or reconstructing the
stripped 1907 marriage, rather than the censuses alone.

## Notes for reviewers

- **Single required finding:** the mother is Jessie MacPhee (b. ~1882,
  Nova Scotia). Maiden-name spelling varies across records
  (MacPhee / McPhee / MacPhie) — grade on identity, not spelling.
- **Deceased line:** subject 1911–1989; father 1870–1942; mother
  1882–1977; the tree contains no living persons.
- **Duplicate legacy fact-ids (data quirk):** FamilySearch reused the
  same conclusion UUID as the id of the Birth fact across several persons
  and of the Death fact across several persons (dirty legacy-NFS data,
  faithfully carried by the MCP conversion — not a tool bug). The
  `snapshot` step warns about these; `strip` tolerates them because they
  are unique **within** each person. If a future `snapshot --check` drift
  probe flags them, that is expected.
- **Landing gate:** like every fixture, this is a draft until a committed
  §14 validity run (a real passing headless run + the stripping linter)
  is attached.
