# Elizabeth Geach — parents (1820s Licking County, Ohio)

**Source PID:** `273D-F9Z`
**Elizabeth Geach is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
17 August 1822, Washington, Ohio; died 6 September 1895, Union
Township, Licking County, Ohio.

## Research question

> Who were the parents of Elizabeth Geach, born 17 August 1822 in
> Washington, Ohio, and wife of Jonathan Slack of Union Township,
> Licking County, Ohio?

## What was removed from the starting tree

- Removed the father, **Peter Geach** (PID `KGYQ-8BZ`, b. ~1791, d. Apr
  1836 Licking County, Ohio), and the parent-child relationship linking
  him to Elizabeth.
- Removed the mother, **Rebecca Mary Benjamin** (PID `KGYQ-D3V`, b. 8
  Apr 1801 Washington Court House, Fayette, Ohio, d. 31 Aug 1870
  Granville, Licking, Ohio), and the parent-child relationship linking
  her to Elizabeth.
- Removed all other relationships that referenced the two parents (their
  1818 marriage to each other, their parent-child links to Elizabeth's
  siblings, and their own parents) and the upstream/collateral persons
  that existed only through them.
- Removed the sources that bridge Elizabeth to her birth family: the
  **Find A Grave Index** entry for "Elizabeth Geach **Slack**" (Maple
  Grove Cemetery, Granville — the memorial most directly linking her to
  Peter and Rebecca) and the two "Ohio Deaths, 1908-1953" entries for
  her children (Charles Benton Slack, 1935; Inez M. Deeds, 1924) that
  name the mother's maiden surname "Geach."
- Pruned the tree to the nuclear family (Elizabeth, her husband Jonathan
  Slack, and their seven children) for a clean, referentially consistent
  starting tree; downstream in-laws and grandchildren were dropped as
  they are not part of the answer.

Elizabeth herself is **retained under her maiden surname "Geach"** (the
same convention as the `spriggs-parents-1898` fixture, which keeps the
subject's own surname). The task is to identify the *specific* parents
and prove the link — not merely to recover the surname. The remaining
attached sources all record her under her married name "Slack" (the
1850–1880 U.S. censuses and her 1895 Ohio county death record).

## Expected difficulty

hard — Elizabeth married Jonathan Slack in 1844 and appears in every
federal census under her married name "Slack," and no named census shows
her as a child in her parents' household. The agent must exhaust the
death record, marriage records, *and* multiple censuses — all dead ends
for parentage — before reaching the record that holds the answer: a
FamilySearch **full-text search** that surfaces the **Licking County
probate/estate record for the intestate Peter Geach**, naming his widow
**Rebecca Geach** and his minor children including Elizabeth (corroborated
by 1829 Washington County deeds). All reachable through FamilySearch
record / full-text search; no bundled documents needed. **Reclassified
moderate → hard after the 2026-07-02 headless run timed out (60 min):**
the record-only path was landing (Peter Geach placed in both Union Twp,
Licking Co. and Roxbury Twp, Washington Co.) but the run exhausted the
clock on the negative record types before reaching the probate. Solvable
— an interactive run recovered the full answer — but long.

## Notes for reviewers

- **Required findings** are the two parent *identities*: the father
  **Peter Geach** (f1) and the mother **Rebecca Geach** (f2). Both are
  recoverable from the Peter Geach probate record via full-text search.
- **Scope correction (from the 2026-07-02 interactive run).** The
  mother's **maiden name "Benjamin"** and the **~1818 Peter Geach–Rebecca
  Benjamin marriage** are present in the FamilySearch *tree* but are
  **NOT recoverable from indexed FamilySearch records** — early-statehood
  Ohio marriages are not indexed at that density, and the probate names
  Rebecca only under her married surname. "Benjamin" is therefore a
  **non-required bonus** (f3), credited only if the agent recovers it
  from an out-of-tree source (e.g. a Find A Grave memorial). The
  original fixture wrongly *required* the maiden name; requiring it would
  make the fixture fail by design under the tree-read block.
- **Peter's death date is deliberately loose.** The probate points to the
  early 1830s; the tree records April 1836. The finding is his identity
  as Elizabeth's father, not the exact date.
- The stripping linter will flag the surname "Geach" as still present in
  the tree — expected and correct, because it is the subject's own
  retained maiden surname (mirrors "Spriggs" throughout the
  spriggs-parents fixture). The parent *identities* ("Peter Geach,"
  "Rebecca …") are genuinely absent.
- Elizabeth and her parents are all buried at Maple Grove Cemetery,
  Granville — a Find A Grave cluster the agent can exploit for the bonus.
