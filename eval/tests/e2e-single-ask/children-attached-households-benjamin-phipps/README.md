# children-attached-households-benjamin-phipps

**Ask:** "Find all the children of LTQD-HM6, whether recorded in Family Tree or not."

**Expected owner:** `search-records`, after `init-project` (`setup_units`). **Expected save:** a new `log`
entry with `tool: "record_search"`. **Read before the search:** `record_read`. **Ends on an offer:** yes.

## Where it came from

Feedback #4666 (hosted web, build `d3c9bc791`, 2026-11-18), quoted on issue #2813 on 2026-11-19 as its item 4
and item 5 failing live. The routing was right, init-project and then search-records, but the turn read nothing
attached before it searched. Benjamin Fairbanks Phipps (LTQD-HM6) has his 1850, 1860, 1870 and 1880 census
households attached on FamilySearch, each as a 1:1 record link; the 1860 one is indexed as "Benj Phillips". The
tester was told that household "could not be located under any name tried".

`read_before_search: ["record_read"]` is the attached-first check: before the first search, on any thread, a
record is read. Nothing the turn could read by then is a search hit, so it is an attached household:
`boundedRequest` tells the router to have search-records read each attached census with `record_read`, by the
source's url from `tree_query`, before its first search. One read before the search passes; whether all four
households
were read is in the transcript, not graded. `required_tools` would not do: it passes a turn that searches first and
reads afterwards.

Not graded (printed as `must_not`): that the reply names the attached 1860 household rather than reporting it not
found, and that a child found and not saved is named as not saved. Item 5's other half, a page the main thread
reads and never logs, is the tool's job since `image_transcribe` logs its own reads.

## Expected result today

Not yet measured.

## Starting state

None: an empty folder. init-project creates the project from LTQD-HM6.

## Caps

`wall_clock_seconds: 1800`, `tool_calls: 80`, `max_turns: 80`: a completeness ask over four censuses, as
`children-skip-router-aleksiy-ivanov`. `max_cost_usd: 4` only labels a run (spec §6).

## Cost

Not yet measured.
