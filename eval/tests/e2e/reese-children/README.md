# Benjamin Franklin Reese

**Source PID:** `L4X1-2RB`
**Benjamin Franklin Reese (1878–1938) is deceased.** All 11 of his
children are also deceased (births 1906–1930, every one with a recorded
death year). (FamilySearch ToS requires all committed e2e fixtures to be
about deceased persons; the snapshot's living-person gate passed over the
whole tree.)

## Research question

> Who were the children of Benjamin Franklin Reese (1878–1938) of Navarro and Hill Counties, Texas?

## What was removed from the starting tree

- **All 11 children** of Benjamin Franklin Reese (L4X1-2RB) and Mallie
  Shue (L4X1-NQX), and the 22 cascaded parent–child relationships:
  Jessie Cleveland (1906), Delia (1907), Cora Bell (1909), Lida Mae
  (1911), Whitfield Donald (1915), Willard Franklin (1917), Abner Wesley
  (1919), Janie Faye (1921), Floyd Haden (1924), Mary Janice (1927),
  Patsy Ruth (1930).
- **18 birth/christening sources** ("Texas, Births and Christenings" and
  "Texas Birth Certificates") whose titles read "… in entry for
  <child>" — these name individual children directly and would leak the
  answer through the source list.

**Kept as the recovery path:** Benjamin's own records — including the
**1910, 1920, and 1930 U.S. Census** sources (his household in
Navarro/Hill County, where the children appear), plus his marriage,
death, draft, and Find A Grave records. Benjamin, his wife Mallie, and
his parents (Thomas Milas Hix Reece, Margaret Inman) remain in the tree.

## Expected difficulty

hard — the agent must reconstruct a large sibling set (11 children) by
reading the 1910/1920/1930 census households and correlating them (the
1920/1930 schedules state "son"/"daughter"; 1910 requires inference),
then re-searching Texas birth/christening records. Volume + multi-census
correlation is the challenge, not any single hard-to-find record.

## Notes for reviewers

- **Subject pivot:** the request named Willard Franklin Reese (G7S1-TLQ),
  but Willard has **0 children** in FamilySearch (his ~1944 marriage's
  children would be post-1944 and likely still living, so FS omits them
  and we could not commit them). The "Children (11)" seen on Willard's
  page are his **parents'** children — i.e. Willard and his 10 siblings.
  The fixture therefore uses Willard's **father, Benjamin Franklin Reese
  (L4X1-2RB)**, whose 11 children are all deceased and linked — the
  clean, ToS-safe way to build the intended "find the children" test.
- **Required vs bonus:** the 5 oldest children (Jessie, Delia, Cora Bell,
  Lida Mae, Whitfield) are marked `required` — all appear in the 1910
  and/or 1920 census households on the kept sources, so they are firmly
  recoverable. The 6 younger children (Willard, Abner, Janie Faye, Floyd
  Haden, Mary Janice, Patsy Ruth) are `required: false` bonus credit.
  Adjust the split if you want a different pass bar.
- **De-duped fact ids (data-quality workaround):** FamilySearch returned
  **duplicate legacy fact-ids** — the same conclusion UUID reused as the
  id of the same fact *type* across multiple persons (e.g. one "Birth"
  id shared by 5 people, one "Burial" id by 6). This is dirty upstream
  data (a legacy-NFS import artifact), faithfully copied by the MCP
  conversion, not a tool bug. `strip` refuses a tree with duplicate ids,
  so the 13 colliding ids in `unstripped-tree.gedcomx.json` were made
  unique (a `-2`/`-3`/… suffix on the 2nd+ occurrence). Only the
  duplicate id *labels* changed; all names/dates/places/relationships
  are untouched. Because of this, a future `snapshot --check` drift
  probe will report those ids as differing from the live tree — that is
  expected, not drift.
- **Landing gate:** like every fixture, this is a draft until a committed
  §14 validity run (a real passing headless run + the stripping linter)
  is attached.
