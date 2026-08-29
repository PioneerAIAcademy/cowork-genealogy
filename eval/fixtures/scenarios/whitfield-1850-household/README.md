# Scenario: whitfield-1850-household

A research project mid-plan, in the state **just before** a planned 1850
census search executes. Built from a real alpha-feedback report (issue
#1912): the tester watched search-records characterize an 1850 census
household's extra co-residents as the subject's "sons" in the log entry's
`notes`, though the 1850 census carries no relationship-to-head column at
all — an unsupported inference the tester questioned and the agent then
retracted. Names, places, and record ids are fictionalized; the household
shape (subject as presumed head, two unexplained young co-residents of the
same surname, one unrelated-surname co-resident, no relationship facts) and
the plural bare-noun phrasing risk ("plus sons X and Y") are preserved.

## State

- **Subject:** Amos Whitfield (`I1`), b. ~1817, tracked from Georgia to Pike
  County, Kentucky by the 1850s. The tree holds no children for him yet.
- **One open plan item** (`pli_001`) targeting an 1850 census search for the
  Whitfield surname in Pike County, Kentucky — not yet executed, no log
  entry for it.
- **No prior log entries, sources, or assertions** — this is the state
  search-records sees the moment it runs the planned search.

## What it exercises

`search-records`'s own SKILL.md rule (the "Pre-1880 US censuses have no
relationship column" bullet) and the deterministic validator that enforces
it, `test_pre1880_census_structure_marked_inferred`
(`eval/harness/validators/test_search_records.py`, issue #1284): when a
pre-1880 census hit shows a household with more members than the search
anchor alone explains, the log entry's `notes` must describe co-residence
and mark family structure as inferred — not assert kinship terms ("sons",
"as father") as fact. The fixture returns exactly the shape that tripped
this in production: a household headed by an unrelated surname, the subject
present with no stated role, and two same-surname minors present with no
stated role either — nothing in the record names anyone's relationship to
anyone.
