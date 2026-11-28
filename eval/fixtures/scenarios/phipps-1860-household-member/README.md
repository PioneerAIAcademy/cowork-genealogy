# Scenario: phipps-1860-household-member

A project for the children of Benjamin Fairbanks Phipps (`I1`), in the state
**just before the researcher asked who Harriet Phillips is** in the 1860
household (issue #4670; the Phipps feedback session, the tester's message at
session-log line 54, counted from 1).

## State

- **The tree** is the session's starting tree, whole: `I1`, his parents Peyton
  Randolph Phipps (`I2`, LQRZ-FVX, d. 1843) and Clarisa Davis (`I6`, KNSW-567,
  d. 1830), his wife Mary L Childs (`I4`, 94Z5-N1F), their two sons and Benjamin's
  siblings. Mary's parents are not in the project tree, and neither is any other
  marriage of Peyton's.
- **The log** is the session's log_001 to log_017, each with its `results/`
  sidecar but log_011 (an error, no sidecar). log_013 holds the 1860 census
  household of "Benj Phillips" (MHR9-JWT) in Thompson, with Mary S Phillips
  (b. 1828) and Harriet Phillips (b. 1800, Connecticut).
- **The question and plan are reconstructed.** The session ran its searches
  without writing a question or a plan, so `q_001` and `pl_001` were built from
  those searches: six items, all `completed`, each owning the log entries that
  ran it. `q_001` has no proof summary.
- `namesakes` ns_001 and ns_002 are the session's, both written by searches in
  this log.
- **`localities` are added.** The session never ran locality-guide, and
  research-plan stops for a locality survey without an entry. `loc_001`
  (Windham, Connecticut) and `loc_002` (Worcester, Massachusetts) were written
  with `research_append` from two `collections_search` calls recorded live on
  2026-11-26; the tool added the rest of each state's catalog and the national
  collections. Neither has a `guide_markdown`. The Connecticut response is kept
  as the `collections-search-windham-connecticut-1790-1880` fixture. The
  Massachusetts one is not: its person counts differ from older recordings of
  the same collections, which the corpus guard
  (`test_no_collection_attribute_conflicts_across_corpus`) refuses, and no run
  called it.

## Bug it captures

The router answered "who is she?" in conversation from surname and age (the
spouse's mother, an unrecorded sister, a boarder) and never planned records.
Six turns later, a `person_read` of Peyton showed a second marriage, in 1831,
to Harriet Davis of Dudley, Massachusetts: Benjamin's stepmother.

## Caveats

- The carve of `q_001`/`pl_001` is a best guess at the state the router and
  research-plan would have held at that point; verify it before relying on it.
- The data is real (deceased, public Family Tree persons), as in
  `phipps-1860-cited-census`; no scrub was applied.
