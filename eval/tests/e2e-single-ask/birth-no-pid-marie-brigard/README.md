# birth-no-pid-marie-brigard

**Ask:** "Locate the birth date of Marie Anne Brigard born in Hamm in 1895."

**Expected owner:** `init-project`. **Expected save:** no new `log` entry. **Required:** `project_context`.
**Forbidden:** `record_search`, `person_search`, `fulltext_search`, `project_create`.

## Where it came from

Feedback #3720 (`feedback-2026-10-21T18-28-27-732397Z.zip`): a name and place with no FamilySearch ID. The
session searched German record sets, then Luxembourg's, and never asked for an ID. A project always starts
from a FamilySearch person ID: with none, init-project creates nothing and asks for one (CLAUDE.md), and the
router's no-project rule sends a message naming a person to init-project. The shape was decided on issue
#4509 (2026-11-12). `ends_on_offer` is not set: a turn that asks the researcher a question writes no offer
line (`research/SKILL.md` §"One step per turn").

An empty folder with no `research.json` afterwards is the right ending here, so the grade reads it as
"no new rows" (spec §16.4).

## Expected result today

**FAIL on `owner`, `forbidden_tools` and `stop`. Issue #2813 owns it** (items 3 and 4; the lead filed this
very turn there on 2026-10-22). Measured 2026-11-16 in the eight-fixture panel run:

```
FAIL birth-no-pid-marie-brigard  expected=init-project  first=search-records  save=ok  stop=max_tool_calls  failed=[owner,forbidden_tools,stop]
    units: search-records > search-records > search-records > search-records > search-records  extraction_append=0
    forbidden_tools: called record_search
```

The authoring run (`TEST=`, same day) failed the same way (units `search-records > search-full-text >
search-images`, `record_search` and `fulltext_search` called). Both called `project_context`, got
`no_project`, and searched without loading the router: the routing sentence reached the turn and did not
route it. Both were cut off by the 20-tool-call cap.

## Starting state

None: an empty folder (no `starting-research.json`, no `starting-tree.gedcomx.json`), the shape of a first
message. The panel sends Cowork's routing sentence with it (spec §16.3), so a PASS here does not show the
hosted alpha routes it (spec §16.5).

## Caps

`wall_clock_seconds: 600`, `tool_calls: 20`, `max_turns: 20`: the right turn is a few calls (project_context,
the router, init-project asking for an ID). A runaway search ends at the tool-call cap, as both measured
runs did. `max_cost_usd: 1` only labels a run.

## Cost

Measured 2026-11-16: no `usage.whole_run_cost_usd_estimated`, because both runs were capped before a final
result. The main-thread estimate (`usage.total_cost_usd_estimated`) was $0.71 in the panel run and $1.63 in
the authoring run, `claude-sonnet-4-6` at effort `medium`; subagent spend is on top.
