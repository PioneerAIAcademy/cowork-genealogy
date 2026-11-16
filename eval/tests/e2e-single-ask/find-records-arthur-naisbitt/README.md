# find-records-arthur-naisbitt

**Ask:** "Can you help me find records on Arthur Lee Naisbitt KWCF-S1C on FamilySearch? Is he found in records and sources not currently attached to his PID?"

**Expected owner:** `search-records`, after `init-project` (`setup_units`). **Expected save:** a new `log`
entry with `tool: "record_search"`. **Ends on an offer:** yes.

## Where it came from

Feedback #4237 (`feedback-2026-11-04T18-00-56-461263Z.zip`, web build `1f6827db8`); the message is quoted in
PR #4350. The session ran init-project, then question-selection, locality-guide and research-plan, and its
first search came 32 minutes after the message. "Finding a record" is on `research/SKILL.md`'s bounded list,
and its "bounded first message that names a FamilySearch person ID and finds no project" paragraph (PR #4350)
says: init-project, then search-records in the same turn, never question-selection, ending on the search's
"Continue with …?" line. A `question-selection` or `research-plan` spawn fails `no_research_job`.

This fixture is the new-folder "find records for <PID>" check issue #2813's step 2 asks for, run on the harness.

The save is a `record_search` log entry of any outcome, not "a new source or a negative log entry" as
issue #4509 first set it: in an empty folder a new source can be an imported Memory (spec §16.2), and a
search that finds candidates logs `positive`.

Not graded: "no search for a record already attached to KWCF-S1C" (printed as `must_not`).

## Expected result today

PASS. Measured 2026-11-16 in the eight-fixture panel run:

```
PASS find-records-arthur-naisbitt  expected=search-records  first=search-records  save=ok  stop=clean
    units: research > init-project > search-records  extraction_append=0
```

The save passed on `record_search` log entries and the offer on "Continue with `running the searches`?".
The authoring run (`TEST=`, same day) also passed: 10 `record_search` log entries, 27 tool calls, 4 minutes.
Under the issue's first save it passed on three Memories `project_create` imported, before any search.

## Starting state

None: an empty folder (no `starting-research.json`, no `starting-tree.gedcomx.json`), the shape of a first
message. The panel sends Cowork's routing sentence with it (spec §16.3), so a PASS here does not show the
hosted alpha routes it (spec §16.5).

## Caps

`wall_clock_seconds: 1800`, `tool_calls: 80`, `max_turns: 80`: project creation plus one search request.
The measured runs used 15 and 27 tool calls in 3 to 4 minutes. `max_cost_usd: 4` only labels a run (spec §6).

## Cost

Measured 2026-11-16: $1.25 in the panel run and $1.92 in the authoring run
(`usage.whole_run_cost_usd_estimated`), `claude-sonnet-4-6` at effort `medium` (`main-thread.json`).
