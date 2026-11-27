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

`names_unsaved: true` grades item 5's other half: a turn that saves no source says so in its reply, naming what it
found and did not save or that it saved nothing. A turn that saved the child passes. The grader reads the turn's last
main-thread text for that statement (`UNSAVED_STATEMENT` in `single_ask_grade.py`). Item 5's first half, a page the
main thread reads and never logs, is the tool's job since `image_transcribe` logs its own reads.

Not graded (printed as `must_not`): that the reply names the attached 1860 household rather than reporting it not
found.

## Expected result today

PASS. Measured 2026-11-27 in the whole-panel run on 24f41ec71, on the Haiku 5.5 low main thread:

```
PASS children-attached-households-benjamin-phipps  expected=search-records  first=search-records  save=ok  stop=clean
    units: research > init-project > search-records  extraction_append=0
```

It passed 7 of 9 runs that day on this rule (063dbcbc0 to 24f41ec71). In one, every FamilySearch search timed out
and the turn ended on a question about retrying rather than a "Continue with …?" offer. In the other, the main
thread called no `project_context` before init-project and stopped after it, on the question-selection offer. The
read came before the search in every run that reached search-records, by search-records itself from the router's
brief.

On `main`'s own `project-context.ts`, `search-delegations.ts`, `project-create.ts` and `agent_relay_note.py`
(fb61b8fc2) it fails `read_before_search`: search-records searched before anything attached was read.

## Starting state

None: an empty folder. init-project creates the project from LTQD-HM6.

## Caps

`wall_clock_seconds: 1800`, `tool_calls: 80`, `max_turns: 80`: a completeness ask over four censuses, as
`children-skip-router-aleksiy-ivanov`. `max_cost_usd: 4` only labels a run (spec §6).

## Cost

About $1.20 to $2.00 a run (2026-11-27), from each run log's cost.
