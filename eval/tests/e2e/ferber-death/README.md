# William Hubert Ferber — death date & place (1903, Cincinnati, Ohio)

**Source PID:** `G7JB-YH6`
**William Hubert Ferber is deceased.** (FamilySearch ToS requires all
committed e2e fixtures to be about deceased persons.) Born December 1869
in Ohio; died 11 March 1903 in Cincinnati, Hamilton County, Ohio.

## Research question

> When and where did William Hubert Ferber die?

## What was removed from the starting tree

- Removed fact 0677bc72-f54a-425a-a6a3-75482bc79b01 on G7JB-YH6: Death 11 March 1903 Cincinnati, Hamilton, Ohio, United States
- Removed fact a96396c0-4e00-40c9-ae20-66a4922555d2 on G7JB-YH6: Burial  Cincinnati, Hamilton, Ohio, United States
- Removed source 3JRQ-P44: Web: Cincinnati, Ohio, U.S., Spring Grove Cemetery Index, 1845-2012
- Removed source 3JRQ-P4Z: U.S., Find a Grave Index, 1600s-Current
- Removed source QBZV-2V6: William H Ferber, "Find a Grave Index"
- Removed source SLJX-SCP: Wm. Ferber, "Ohio, County Death Records, 1840-2001"

Retained as search anchors: his parents Gerhard Ferber and Eva
(Engermann) Ferber; his wife Emma Becker; his son Charles Hubert
Ferber; his 1890 marriage record; the 1870 and 1900 censuses; and the
Cincinnati city-directory entries (which place him alive in the city
through the early 1900s). His birth fact (December 1869) is retained.

## Expected difficulty

easy–medium — With his death/burial facts and their sources removed, a
targeted death search (`Ferber William`, death, Ohio, 1903) returns the
answer as the **top two hits**: the Ohio county death record (which
names his parents Gerhard and Eva, locking identity) and a FamilySearch
Find a Grave memorial, both giving 11 March 1903, Cincinnati. The main
ways to miss are (a) failing to search for a death at all and concluding
"unknown," or (b) grabbing the wrong record — see the deliberate
distractor below.

## Notes for reviewers

- **Required finding (f1):** died **11 March 1903, Cincinnati, Hamilton
  County, Ohio** — both the date and the place. Fully record-supported
  (Ohio county death record + FamilySearch Find a Grave; both surface on
  `record_search`).
- **Bonus finding (f2):** burial at **Spring Grove Cemetery, Cincinnati**.
  The FamilySearch Find a Grave memorial supports only the burial locale
  (Cincinnati); the specific cemetery name comes from an off-FamilySearch
  index, so it is `required: false`.
- **Deliberate distractor left in place.** A "Kentucky, U.S., Death
  Records, 1852-1965" source (`3JRQ-P4W`) remains attached to William's
  node. It is **not** his death — it is his **widow Emma (Becker)
  Ferber's** (she died 7 Dec 1948 at Dayton, Campbell County, Kentucky;
  the record's parents "John Becker / Mary Kramer" match Emma's maiden
  surname). It was left in on purpose to test whether the agent
  correctly attributes it rather than reporting a 1948 Kentucky death for
  William. The son, Charles Hubert Ferber, died in Florida in 1967, so he
  is not the Kentucky subject either.
- **Verified reachable 2026-07-15** via live `record_read` /
  `record_search`: the Ohio county death record (`F66M-8JZ`) and Find a
  Grave (`QV2R-MD6H`) both read cleanly with 11 Mar 1903 Cincinnati, and
  a death search filtered to Ohio/1903 returns both as the top results.
- **Conflict note:** the death date is concordant across the tree, the
  death record, and Find a Grave (11 Mar 1903). A minor birth-date
  discrepancy exists (tree "Dec 1869" vs Find a Grave "28 Nov 1869" vs
  death record's age-derived "1870") but does not affect the death
  question.
