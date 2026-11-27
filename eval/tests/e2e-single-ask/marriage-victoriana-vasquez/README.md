# marriage-victoriana-vasquez

**Ask:** "Research PID GFG9-7H4. When and where did Victoriana Vasquez, daughter of Remigio Vasquez and Bernarda Sandoval, marry Jose Cleofas Gutierrez?"

**Expected owner:** `search-records`, after `init-project` (`setup_units`). **Expected save:** a new `log`
entry with `tool: "record_search"`. **Ends on an offer:** yes.

## Where it came from

Feedback #3898 (`feedback-2026-10-27T10-09-36-762051Z.zip`): a first message with a PID, answered with a
verdict from one search (the hinted 1875 date at face value) and no offer. The tester's answer: the 1875
record is a velación, and the marriage was about 1859. The shape was decided on issue #4509 (2026-11-12):
the same `setup_units: ["init-project"]` / `expected_owner: "search-records"` shape as feedback #4237, plus
`ends_on_offer: true`.

The save is a `record_search` log entry of any outcome, not "a new source or a negative log entry" as
issue #4509 first set it: in an empty folder a new source can be an imported Memory (spec §16.2), and a
search that finds candidates logs `positive`.

Not graded: whether the 1875 velación is reported as the marriage (printed as `must_not`).

## Expected result today

PASS in 4 of 5 runs on 2026-11-27 (063dbcbc0 to 24f41ec71, Haiku 5.5 low main thread). The whole-panel run on
24f41ec71 was the one that failed:

```
FAIL marriage-victoriana-vasquez  expected=search-records  first=none  save=missing log tool=record_search (new log rows: none)  stop=clean  failed=[owner,save]
    units: research > init-project  extraction_append=0
```

After init-project the main thread relayed its report with the question-selection offer, though init-project's
relay note names when or where one event happened as a bounded request. Two runs on 24f41ec71 an hour before it
passed, as did the panel runs on 063dbcbc0 and fbc87a159.

Re-measured 2026-11-26 on the Haiku 5.5 low main thread, once `project_context` returned
`boundedRequest` with its closing-offer clause:

```
PASS marriage-victoriana-vasquez  expected=search-records  first=search-records  save=ok  stop=clean
    units: research > init-project > search-records  extraction_append=0
```

On `main` 84e94e6c9 without the field it stopped after init-project the same day (FAIL on `owner` and
`save`), and on `main` 202730796 it ran `question-selection` after init-project. A run with the field but
without the clause ended on a plain question and failed `ends_on_offer`.

Measured 2026-11-16 in the eight-fixture panel run:

```
PASS marriage-victoriana-vasquez  expected=search-records  first=search-records  save=ok  stop=clean
    units: research > init-project > search-records  extraction_append=0
```

The authoring run (`TEST=`, same day) also passed. It logged two `positive` `record_search` entries, named
the 1875 Degollado record as unconfirmed, and offered "Continue with `running the searches`?" to check the
register page and the 1859 entries. Under the issue's first `outcome: negative` save it would have failed.

## Starting state

None: an empty folder (no `starting-research.json`, no `starting-tree.gedcomx.json`), the shape of a first
message. The panel sends Cowork's routing sentence with it (spec §16.3), so a PASS here does not show the
hosted alpha routes it (spec §16.5).

## Caps

`wall_clock_seconds: 1800`, `tool_calls: 80`, `max_turns: 80`: project creation plus one search request.
The measured runs used 14 and 17 tool calls in under 2 minutes. `max_cost_usd: 4` only labels a run.

## Cost

Measured 2026-11-16: $0.74 in the panel run and $0.82 in the authoring run
(`usage.whole_run_cost_usd_estimated`), `claude-sonnet-4-6` at effort `medium`.
