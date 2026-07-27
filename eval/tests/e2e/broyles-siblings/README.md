# Charles Robinson Broyles

**Source PID:** `LCPC-PZK` (the **father**, George Broyles — see "Snapshot
note" below; the question's subject is Charles, `MJ7L-SL9`)
**Charles Robinson Broyles is deceased** (b. 9 Dec 1878; d. 18 Mar 1966,
Houston, Harris, Texas). All six siblings are 19th-century births and are
deceased as well. (FamilySearch ToS requires all committed e2e fixtures to be
about deceased persons; the snapshot's living-person gate passed over the whole
tree.)

## Research question

> Who were the siblings of Charles Robinson Broyles (MJ7L-SL9), born 9 December
> 1878 and died 18 March 1966, and what evidence supports their relationship to
> him?

## What was removed from the starting tree

All **six** of Charles's siblings, plus their cascaded parent–child links:

**Full siblings** (children of George Broyles *and* Mary Elizabeth Davis, m. 1867):
- Judith A. Broyles (1869)
- Minnie Belle Broyles (28 Feb 1877)
- Myrtle Leana Broyles (17 May 1886)

**Half-siblings** (children of George Broyles by his first wife, Liddy, m. 1856):
- William Harrison Broyles (4 Sep 1857)
- Milton M. Broyles (1859)
- Geo. W. Broyles (1861)

No sibling-specific sources were present in the snapshot to strip — every source
belongs to the father, George Broyles, and none names an individual sibling in
its title.

**Kept as the recovery path:**
- **Charles** (MJ7L-SL9) and **both parents** — father **George Broyles**
  (LCPC-PZK, b. 1830 TN) and mother **Mary Elizabeth Davis** (LCPC-PDH,
  b. 1849, d. 1918), with their 1867 marriage and Charles's links to both.
- The father's **first wife, Liddy** (KP3V-5CY, m. 1856) — kept childless in the
  starting tree as the lead to the half-siblings (George's first marriage).
- The father's household census records: the **1880 U.S. Census** (George Broyles
  household, Marshall, Saline, Missouri — where the full siblings appear alongside
  Charles) and the **1860 U.S. Census** (the first-marriage household — where the
  half-siblings appear), plus the paternal grandparents.

## Expected difficulty

hard — the agent must reconstruct a six-person sibling set spanning **two
marriages** and **three censuses**: the full siblings from the 1880 household
(Judith, Minnie) plus a later census/birth search for Myrtle (b. 1886, after the
1880 census), and the half-siblings from the father's first-marriage household
(1860/1870). Distinguishing full from half siblings — and realizing the father
married twice — is the core challenge.

## Notes for reviewers

- **Required vs bonus:** the **three full siblings** (Judith, Minnie, Myrtle) are
  `required`; the **three half-siblings** (William, Milton, Geo. W.) are
  `required: false` bonus credit. Adjust the split if you want a different pass
  bar (e.g. Myrtle, born after the 1880 census, could move to bonus).
- **Snapshot note:** because a person's siblings are two hops away (subject →
  parent → parent's other children), this fixture was snapshotted from the
  **father** (`source_pid = LCPC-PZK`) so the sibling set is captured as full
  persons to strip. The question's subject is **Charles** (`subject_person_ids =
  MJ7L-SL9`); `source_pid` is provenance only (§6.1 blocks every person-keyed
  tool, so neither the run nor the judge reads it).
- **Half-sibling lead:** the father's first wife Liddy (KP3V-5CY) is intentionally
  retained (childless in the starting tree) as a genuine research lead — it tells
  the agent George married before 1867 without naming the half-siblings.
- **Duplicate legacy fact-ids (data quirk):** FamilySearch reused the same Birth
  and Death UUIDs across several persons (dirty legacy-NFS data, faithfully copied
  by the MCP conversion — not a tool bug). `strip` tolerates them (unique within
  each person). A future `snapshot --check` may flag them as drift — expected.
- **Landing gate:** like every fixture, this is a draft until a committed §14
  validity run (a real passing headless run + the stripping linter) is attached.
