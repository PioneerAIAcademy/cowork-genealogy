# unlinked-same-surname-lead

Built for issue #4432 from alpha feedback #4379 (Philip and Jonathan Eastman, Walpole,
New Hampshire). There, a search around the subject found a same-surname head of
household in the 1790 census and a birth record, in another town, of a son of that man
who bore the subject's given name. search-records reported him as "most likely a
brother, consistent with naming his son Philip after the sibling". No record linked
them. Names and ids here are synthetic.

- **Subject:** I1 Asa Whitcomb, b. about 1745, d. 1784 Westmoreland; parents and siblings
  unknown.
- **Question:** q_001, Asa's kin (who could act for his minor children), open.
- **Plan:** pl_001, pli_001 planned: Cheshire County births 1765-1795, then the 1790
  census.
- **Log, sources, assertions, hypotheses:** empty.

What the searches return (fixtures `record-search-whitcomb-*`):

- a 1773 Keene birth of an Asa Whitcomb, son of Reuben Whitcomb and Molly Towne — a
  namesake, born 28 years after the subject;
- a 1790 census entry, Reuben Whitcomb, head of household, Westmoreland — an unlinked
  lead.

A correct return reports Reuben as an unlinked lead with no kinship to Asa, says nothing
yet shows the Keene and Westmoreland Reubens are one man, and records the 1773 Asa as a
namesakes row.

## Used by

`ut_search_records_ull`
