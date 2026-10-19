# rowe-window-is-not-a-ceiling

A first-plan scenario whose question states its own date window, and whose best evidence is a record created a quarter-century after that window closes.

Built for issue #1830, item A: a question's date range bounds the **question**, not the records that may answer it.

## State

- **Objective:** Determine where Josiah Rowe resided between 1850 and 1865, and with whom he was living
- **Questions:** q_001 (residence and household, in_progress, no `search_stop`)
- **Plans, log, sources, assertions, conflicts, hypotheses, proof summaries:** all empty — this is a first plan
- **Localities:** loc_001, Vigo County, Indiana, 1828–1900
- **Tree:** one person. Josiah Rowe (I1) — born about 1828 in Ohio, military service 1862–1865 in Indiana, died 1879 in Vigo County. No spouse, children or parents; no sources on any fact.

## The shape under test

The question names its window out loud: **1850 to 1865**. The record that best answers it is a Civil War pension file, which for a man who served 1862–65 would have been assembled in the 1880s or 1890s — commonly after the 1890 Dependent Pension Act. Such files carry neighbours' and comrades' affidavits describing where the soldier lived, whom he married and when, reaching back thirty and forty years.

So the file postdates the question's window by a quarter-century and is the best evidence inside it. A plan item dated 1850–1865 will never retrieve it.

## Why the locality is built the way it is

**The pension collection is listed deliberately.** `loc_001` names *United States Civil War and Later Pension Files, 1861-1934*, and a quirk explains that such files are retrospective. The agent is not being tested on whether it knows pensions exist — it is told. The only variable is whether a record dated later than the window is disqualified in the agent's mind.

**The collection list is short on purpose.** Census 1850, census 1860, and the pension file. Indiana marriage and probate collections were removed, because both run past 1865 for reasons that have nothing to do with this rule — a marriage collection spanning to 2007 does not mean a marriage item should be dated to 2007 — and their presence made it impossible to tell a plan that reaches the pension from one that merely reaches *something* late. A quirk records that probate and marriage records do exist for the county and should be planned from the clerk rather than from a collection id.

**Indiana kept no statewide vital registration before 1882**, which is true and which removes an easy alternative route to the answer for a man who died in 1879.

## What a sound plan does

Includes an item that reaches the pension file — dated to the file's own period rather than to the service years. Observed correct shapes across nine runs: `1861-1900`, `1861-1934`, `1861-1880`.

The failure shape, observed once before the issue #1830 edit: a military item that names the pension collection in its rationale and is then dated `1862-1865`.

Several items legitimately stop inside the window. The 1850 and 1860 censuses do, and so does a compiled-service-record item dated to the service years. Their presence is not the defect; the absence of any item reaching past 1865 is.

## Note on grading

There is no deterministic validator for this scenario, and that is deliberate rather than an omission. Five mechanisms were built and measured against real runs; each either passed a plan carrying the defect or failed a correct one. The distinguishing property — whether a record was created after the events it describes — is a genealogical judgement that no field in a plan item carries. The reasoning and the five failure modes are recorded on issue #1830.
