# children-skip-router-aleksiy-ivanov

**Ask:** "Research PID L8PL-3W8. What children did Алексий Васильев Иванов of Samara, husband of Елизавета Васильева and father of Виктор (born 29 October 1894) and Павел (born 15 February 1902), have besides these two?"

**Expected owner:** `search-records`, after `init-project` (`setup_units`). **Expected save:** a new `log`
entry with `tool: "record_search"`. **Required:** `project_create`. **Ends on an offer:** yes.

## Where it came from

Issue #3768's own bundle (`feedback-2026-10-22T21-13-59-482832Z.zip`, web build `5cdedcb45`): a first
message that skipped `/research`. The main thread called `project_context`, got `no_project`, answered from
one `person_read` and stopped, with no project. Issue #3768 lists four such sessions; of the other three,
#3720 is a no-PID ask (`birth-no-pid-marie-brigard`), and #3775 and #3792 are vital-event questions, the
shape `marriage-victoriana-vasquez` covers.

The owner comes from `research/SKILL.md`'s bounded list: "whether a person's children or siblings are
complete" goes to `search-records`. The bounded first-message paragraph puts init-project first and ends the
turn on the deliverable's offer, hence `ends_on_offer`. `required_tools: ["project_create"]` is the
router-skip check: the failing session never created a project.

The save is a `record_search` log entry of any outcome, not "a new source or a negative log entry" as
issue #4509 first set it. In an empty folder `project_create` imports the person's FamilySearch Memories as
sources, so a new source passes before the search runs (the first authoring run of
`find-records-arthur-naisbitt` passed on three imported Memories). A `record_search` row is written only
by a search, and a search that finds candidates logs `positive`, which `negative` alone would fail.

Not graded: whether the 1885 Павел (a different family, per the tester) is kept out of the tree.

## Expected result today

PASS. Measured 2026-11-16 in the eight-fixture panel run:

```
PASS children-skip-router-aleksiy-ivanov  expected=search-records  first=search-records  save=ok  stop=clean
    units: research > init-project > search-records  extraction_append=0
```

The authoring run (`TEST=`, same day) also passed, with three `positive` `record_search` entries.

## Starting state

None: an empty folder (no `starting-research.json`, no `starting-tree.gedcomx.json`), the shape of a first
message. The panel sends Cowork's routing sentence with it (spec §16.3), so a PASS here does not show the
hosted alpha routes it (spec §16.5).

## Caps

`wall_clock_seconds: 1800`, `tool_calls: 80`, `max_turns: 80`: project creation plus one search request.
The measured runs used 13 and 15 tool calls in 2 to 3 minutes. `max_cost_usd: 4` only labels a run.

## Cost

Measured 2026-11-16: $0.99 in the panel run and $0.85 in the authoring run
(`usage.whole_run_cost_usd_estimated`), `claude-sonnet-4-6` at effort `medium`.
