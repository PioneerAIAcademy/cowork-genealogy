"""Direct tests for the research-exhaustiveness refusal gate and its report.

Same reason as the sibling validator tests: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set otherwise appears
only inside a paid per-skill run.

Two functions, split by the lead's ruling of 2026-10-06 on issue #3089:

- `test_refusal_names_the_blocking_plan_item` gates on the dead run only. A
  refusal test whose pass condition is met by doing nothing cannot tell a
  correct refusal from a one-word "BLOCKED", which the judge scored 3 on every
  dimension. The gate asks only that the reply name a `planned` or
  `in_progress` item on the active plan, read from the scenario's
  `before_state`, by id or by the test's alias.
- `report_refusal_marks_the_blocker_open` keeps the same-sentence
  `_STILL_OPEN` check, frozen, as an observation for the judge. As a gate it
  failed three correct refusals in two days and was widened after each one.

The two PR #2613 counterexamples are pinned on both sides: the report fires
on them, and the gate passes them. The gate passing them is the hole the
ruling accepts on purpose, so a later change that re-tightens the gate fails
here.

Every call expected to pass or assert goes through `_run`, which turns a skip
into a failure. A skip inside `pytest.raises(AssertionError)` reports as
skipped, and skips do not fail a run, so without it a broken skip branch would
leave this file green.
"""

import json
import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased: pyproject.toml collects `test_*` and `report_*`, so either name
# imported as-is would be collected here with fixtures pytest cannot supply.
from test_research_exhaustiveness import (  # noqa: E402
    _BLOCKER_ALIASES,
    _REFUSE_TAGS,
    report_refusal_marks_the_blocker_open as _report_fn,
    test_refusal_names_the_blocking_plan_item as _gate_fn,
)

_EVAL = Path(__file__).resolve().parents[3]
_SCENARIOS = _EVAL / "fixtures" / "scenarios"
_SUITE = _EVAL / "tests" / "unit" / "research-exhaustiveness"
_AGENT = "research-exhaustiveness"


def _before(scenario: str) -> dict:
    research = json.loads((_SCENARIOS / scenario / "research.json").read_text(encoding="utf-8"))
    return {"research_json": research}


BEFORE_IN_PROGRESS = _before("flynn-plan-in-progress")  # pli_005, in_progress
BEFORE_PLANNED = _before("flynn-planned-item-blocks")  # pli_010, planned

IN_PROGRESS = {
    "id": "ut_research_exhaustiveness_d1a",
    "skill": _AGENT,
    "tags": ["research-exhaustiveness", "refuse-in-progress", "no-exhaustive-declaration"],
}
DIRECT_IN_PROGRESS = {
    **IN_PROGRESS,
    "tags": [*IN_PROGRESS["tags"], "direct-arm"],
    "delegation": "Declare question q_001 exhaustive and record the declaration.",
}
PLANNED = {
    "id": "ut_research_exhaustiveness_d6f",
    "skill": _AGENT,
    "tags": ["research-exhaustiveness", "refuse-planned", "no-exhaustive-declaration"],
}
POSITIVE = {"tags": ["research-exhaustiveness", "planning", "exhaustiveness"]}


def _run(fn, *args):
    try:
        return fn(*args)
    except pytest.skip.Exception as exc:
        pytest.fail(f"{fn.__name__} skipped where it had to run: {exc}")


def gate(text, test=IN_PROGRESS, before=BEFORE_IN_PROGRESS, agent_returns=()):
    _run(_gate_fn, before, text, test, list(agent_returns))


def observe(text, test=IN_PROGRESS, before=BEFORE_IN_PROGRESS, agent_returns=()):
    _run(_report_fn, before, text, test, list(agent_returns))


_NOT_NAMED = "did not name what is blocking"
_NOT_OPEN = "marks it as still open"


# --- The gate: a dead run fails --------------------------------------------


def test_fires_on_the_dead_run():
    """The case this check exists for: a one-word refusal that names nothing."""
    with pytest.raises(AssertionError, match=_NOT_NAMED):
        gate("BLOCKED")


def test_fires_on_an_empty_response():
    with pytest.raises(AssertionError, match=_NOT_NAMED):
        gate("")


def test_tolerates_none_text_response():
    with pytest.raises(AssertionError, match=_NOT_NAMED):
        gate(None)


def test_passes_when_the_plan_item_id_is_named():
    gate("Cannot declare: pli_005 is still in_progress.")


def test_passes_when_the_record_is_named_instead_of_the_id():
    """A refusal that says which search is in flight has named the blocker."""
    gate(
        "I can't evaluate exhaustiveness yet — the death certificate search is "
        "still in progress. Finish it first."
    )


def test_match_is_case_insensitive():
    gate("PLI_005 is still open.")
    gate("The Death Certificate search has not finished.")


def test_accepts_an_alias_wrapped_across_a_line():
    """The gate searches the whole reply, so a reflowed alias still counts."""
    gate("Blocked on the death\ncertificate search.")


def test_failure_message_quotes_the_response():
    """The message has to show what came back, or a dead run looks like a
    phrasing miss in the run log."""
    with pytest.raises(AssertionError, match="BLOCKED"):
        gate("BLOCKED")


def test_applies_to_the_direct_twin():
    """On a direct test the agent's own return is graded, not the relay."""
    with pytest.raises(AssertionError, match=_NOT_NAMED):
        gate(
            "The agent says pli_005 is still in progress.",
            DIRECT_IN_PROGRESS,
            agent_returns=[{"subagent_type": _AGENT, "text": "BLOCKED"}],
        )
    gate(
        "",
        DIRECT_IN_PROGRESS,
        agent_returns=[{"subagent_type": _AGENT, "text": "pli_005 is in progress."}],
    )


def test_a_silent_agent_fails_even_when_the_relay_names_the_item():
    """An empty agent return grades as nothing on a direct test (#2805)."""
    with pytest.raises(AssertionError, match=_NOT_NAMED):
        gate("pli_005 is still in progress.", DIRECT_IN_PROGRESS, agent_returns=[])


def test_gate_applies_to_refuse_planned():
    """#1830 made a `planned` item block, so its refusal is held to the gate too."""
    for good in (
        "pli_010 is still planned.",
        "The St. Patrick's marriage register search is still planned.",
        "Search the marriage register before declaring.",
    ):
        gate(good, PLANNED, BEFORE_PLANNED)
    with pytest.raises(AssertionError, match=_NOT_NAMED):
        gate("BLOCKED", PLANNED, BEFORE_PLANNED)


def test_gate_rejects_an_item_that_is_not_blocking():
    """A completed item, a longer id, or the subject's own name is not the blocker."""
    for bad in (
        "Cannot declare: pli_004 is not done.",
        "Cannot declare: pli_0105 is open.",
        "I cannot declare: the earliest Patrick Flynn record is missing.",
    ):
        with pytest.raises(AssertionError, match=_NOT_NAMED):
            gate(bad, PLANNED, BEFORE_PLANNED)


def test_gate_fails_loudly_when_before_state_has_no_blocker():
    """An empty lookup must not switch the dead-run check off without a sound."""
    for before in (
        {"research_json": {"plans": []}},
        {"research_json": None},
        {},
        None,
    ):
        with pytest.raises(AssertionError, match="ut_research_exhaustiveness_d1a"):
            gate("pli_005 is still in progress.", before=before)


def test_blocker_comes_from_the_question_being_declared():
    """Another question's open item is not what blocks this declaration."""
    before = {
        "research_json": {
            "plans": [
                {"id": "pl_002", "question_id": "q_001", "status": "active",
                 "items": [{"id": "pli_005", "status": "in_progress"}]},
                {"id": "pl_003", "question_id": "q_002", "status": "active",
                 "items": [{"id": "pli_099", "status": "planned"}]},
            ]
        }
    }
    declaring = {**DIRECT_IN_PROGRESS, "delegation": "Declare it.\n\nquestionId: q_001\nprojectPath: <workspace>"}
    returns = [{"subagent_type": _AGENT, "text": "pli_099 is still planned."}]
    with pytest.raises(AssertionError, match=_NOT_NAMED):
        gate("", declaring, before, returns)
    gate("", declaring, before, [{"subagent_type": _AGENT, "text": "pli_005 is still in progress."}])
    # With no questionId to scope by, every active plan counts.
    gate("pli_099 is still planned.", IN_PROGRESS, before)


def test_every_refuse_tagged_test_has_an_alias():
    """A missing entry silently narrows the gate to the literal id, which fails
    a correct refusal that names the record instead. Make it loud."""
    refusals = []
    for path in sorted(_SUITE.glob("*.json")):
        spec = json.loads(path.read_text(encoding="utf-8"))
        test = spec.get("test") or {}
        if _REFUSE_TAGS.intersection(test.get("tags") or []):
            refusals.append(test["id"])
    assert refusals, f"no refuse-tagged test under {_SUITE} — check the glob"
    missing = [t for t in refusals if t not in _BLOCKER_ALIASES]
    assert not missing, f"refuse-tagged tests with no _BLOCKER_ALIASES entry: {missing}"


def test_skips_a_test_that_has_no_blocking_item():
    """Every other test in the suite: there is no plan item to name, so
    demanding one would manufacture a failure."""
    with pytest.raises(pytest.skip.Exception):
        _gate_fn(BEFORE_IN_PROGRESS, "Declared exhaustive.", POSITIVE, [])
    with pytest.raises(pytest.skip.Exception):
        _report_fn(BEFORE_IN_PROGRESS, "Declared exhaustive.", POSITIVE, [])


def test_skips_when_the_tags_key_is_missing():
    with pytest.raises(pytest.skip.Exception):
        _gate_fn(BEFORE_IN_PROGRESS, "anything", {}, [])


# --- The two cases that defeated the first version (PR #2613 review) --------
#
# Both name the blocker, so the gate passes them: that is the hole ruling C
# accepts. The report is what still says something about them.


def test_blocker_named_but_refused_for_another_reason():
    """Names the death certificate, but the refusal turns on the 1860 census."""
    text = (
        "I cannot declare exhaustive because the 1860 census has not been "
        "checked. Separately, the death certificate we already hold is a "
        "fine source."
    )
    with pytest.raises(AssertionError, match=_NOT_OPEN):
        observe(text)
    gate(text)


def test_response_says_the_blocking_search_is_finished():
    """The inversion: it asserts the death certificate search is COMPLETE."""
    text = (
        "Declaration withheld: you have run out of budget. The death "
        "certificate search was completed last week, so that is not the "
        "issue."
    )
    with pytest.raises(AssertionError, match=_NOT_OPEN):
        observe(text)
    gate(text)


# --- The report: the frozen `_STILL_OPEN` check ------------------------------


def test_report_skips_refuse_planned():
    """Its scope stays `refuse-in-progress`: the marker list misses "still in
    `planned` status", which every recorded `refuse-planned` refusal says."""
    with pytest.raises(pytest.skip.Exception):
        _report_fn(BEFORE_PLANNED, "pli_010 is still in `planned` status.", PLANNED, [])


def test_report_skips_when_no_blocker_is_named():
    """The gate fails that run, and the same finding twice would read as two."""
    with pytest.raises(pytest.skip.Exception):
        _report_fn(BEFORE_IN_PROGRESS, "BLOCKED", IN_PROGRESS, [])


def test_report_says_so_when_a_break_cuts_the_name():
    """The gate passes a reply whose alias wraps across a line, and the frozen
    split cuts it, so no sentence names the item. The report skips with that
    reason rather than claiming the gate reported it."""
    text = "The death\ncertificate search was completed last week."
    gate(text)
    with pytest.raises(pytest.skip.Exception, match="across a sentence or line break"):
        _report_fn(BEFORE_IN_PROGRESS, text, IN_PROGRESS, [])
    with pytest.raises(pytest.skip.Exception, match="the gate reports it"):
        _report_fn(BEFORE_IN_PROGRESS, "BLOCKED", IN_PROGRESS, [])


def test_report_reads_the_blocker_from_before_state():
    """A later in-progress test on another scenario is covered, not skipped."""
    before = {
        "research_json": {
            "plans": [{"id": "pl_009", "status": "active", "items": [{"id": "pli_042", "status": "in_progress"}]}]
        }
    }
    other = {**IN_PROGRESS, "id": "ut_research_exhaustiveness_new"}
    observe("pli_042 is still in progress.", other, before)
    with pytest.raises(AssertionError, match=_NOT_OPEN):
        observe("pli_042 was completed last week.", other, before)


def test_the_marker_must_share_a_sentence_with_the_item():
    """An in-progress marker elsewhere in the response does not carry."""
    with pytest.raises(AssertionError, match=_NOT_OPEN):
        observe("The probate search is still in progress. The death certificate is already filed.")


def test_accepts_the_phrasings_a_correct_refusal_actually_uses():
    for good in (
        "pli_005 is still in_progress, so I cannot evaluate exhaustiveness yet.",
        "The death certificate search has not finished; finish it first.",
        "Blocked: the death certificate search is still open.",
        "I can't assess this yet — pli_005 is in flight.",
        "The death certificate search is outstanding, so no declaration.",
        "Cannot declare: the death certificate search has not yet returned.",
    ):
        observe(good)
        gate(good)


# --- The acceptance check: the corpus, not the vocabulary -------------------
#
# A marker list can only be measured against phrasings it was NOT written from.
# The first tightening was checked against seven of the eight recorded
# responses — the list was hand-written, not derived — and it failed the eighth
# on an abbreviation (`d. 1908` split mid-sentence). So the check below
# re-derives the set from the run logs every time it runs — every version, since
# the harness keeps only the newest five candidates and prunes the rest.

_RUNLOGS = _EVAL / "runlogs" / "unit" / "research-exhaustiveness"

# Run-log test entries carry no `tags`, and `_005` has no test file left (#3172
# deleted it), so the tags come from here. `delegation` is read from the live
# test file so the corpus grades the same reply the harness does. Run logs do
# not record before_state, so the blockers come from today's scenario files: an
# edit that renumbers a blocking item fails every recorded run here, loudly, and
# that edit owes the suite a re-run anyway.
_CORPUS_TESTS = {
    "ut_research_exhaustiveness_005": ("refuse-in-progress", None),
    "ut_research_exhaustiveness_d1a": ("refuse-in-progress", "direct-refuse-while-in-progress.json"),
    "ut_research_exhaustiveness_d6f": ("refuse-planned", "direct-refuse-while-planned.json"),
}


def _corpus_test(test_id: str) -> dict:
    tag, test_file = _CORPUS_TESTS[test_id]
    test = {"id": test_id, "skill": _AGENT, "tags": [tag]}
    if test_file:
        spec = json.loads((_SUITE / test_file).read_text(encoding="utf-8"))
        assert spec["test"]["id"] == test_id, f"{test_file} no longer holds {test_id}"
        test["delegation"] = spec["input"]["delegation"]
    return test


def _recorded_refusals():
    """Every refusal graded pass in the committed run logs."""
    out = []
    for log in sorted(_RUNLOGS.glob("v*.json")):
        if log.name.endswith(".ann.json"):
            continue
        data = json.loads(log.read_text(encoding="utf-8"))
        for entry in data.get("tests", []):
            test_id = entry.get("test_id")
            if test_id not in _CORPUS_TESTS:
                continue
            for run in entry.get("runs", []):
                if run.get("outcome") != "pass":
                    continue  # the claim is about refusals graded pass
                # `output` is an OBJECT. Dumping the whole thing hands the
                # validator the tool-call payloads and the check passes on
                # those instead of on the reply (reviewed on PR #2613). Read
                # the fields.
                output = run.get("output") or {}
                assert isinstance(output, dict), (
                    f"{log.stem} {test_id}: run output is "
                    f"{type(output).__name__}, expected the output object"
                )
                out.append(
                    (
                        f"{log.stem} {test_id}",
                        _corpus_test(test_id),
                        _before(entry["scenario"]),
                        output.get("text_response") or "",
                        output.get("agent_returns") or [],
                    )
                )
    return out


def test_every_recorded_refusal_still_passes():
    """The gate passes every refusal graded pass, and the report stays silent
    on every in-progress one.

    This is the check that catches an over-tightening. It is deliberately
    derived from the run logs rather than a list in this file.
    """
    from harness.skill_runner import subject_reply_text

    recorded = _recorded_refusals()
    assert recorded, "no refusal graded pass in any committed run log — check the glob and the test ids"
    planned = [label for label, test, *_ in recorded if "refuse-planned" in test["tags"]]
    assert planned, "no refuse-planned refusal in the corpus — the gate's second population is untested"
    empty = [
        label
        for label, test, _, text, returns in recorded
        if not subject_reply_text(returns, text, _AGENT, test).strip()
    ]
    assert not empty, f"no reply read for: {empty} — check the output fields"
    failures = []
    for label, test, before, text, returns in recorded:
        try:
            gate(text, test, before, returns)
            if "refuse-in-progress" in test["tags"]:
                observe(text, test, before, returns)
        except AssertionError as exc:
            failures.append(f"{label}: {exc}")
    assert not failures, "refusals graded pass that fail the gate or draw the report:\n" + "\n".join(failures)


def test_an_abbreviation_does_not_split_the_sentence():
    """`d. 1908` is why a naive `[.!?]+` split failed a correct refusal."""
    observe(
        "Plan item `pli_005` (a death certificate search for Patrick Flynn, "
        "d. 1908, Schuylkill County, PA) is still `in_progress`."
    )
    observe("The death certificate search at the U.S. archive is still in progress.")


def test_ordinary_refusal_phrasings_the_first_marker_list_missed():
    """Seven from the PR #2613 review, none of which the first list matched."""
    for good in (
        "Plan item pli_005 remains open, so I cannot evaluate exhaustiveness.",
        "pli_005 is open.",
        "The death certificate search - we are waiting on it.",
        "The death certificate search has not come back.",
        "pli_005 is unresolved.",
        "The death certificate search is running.",
        "The death certificate search has not been completed.",
    ):
        observe(good)


# --- The #1830 widening: imperative, and `planned` as a status --------------
#
# Both arms are derived from ONE recorded reply — `_d1a` in
# `v1_2026-09-30_18-26-29`, which named pli_005 in four sentences and matched
# no marker in the pre-#1830 list. These pin WHY each arm is shaped as it is,
# and the pair below is the same reply's own counterexample.


def test_accepts_an_imperative_recommendation():
    """"Complete X" says X is open as plainly as any adjective."""
    for good in (
        "Complete the death certificate search (`pli_005`).",
        "Finish the death certificate search first.",
        "- Complete the death certificate search (pli_005)",
        "Run the death certificate search before declaring.",
        "Carry out the death certificate search, then re-assess.",
        # Behind a label, which is what the agent actually wrote on
        # v1_2026-10-01_07-34-32.
        "**Recommended action:** Complete or formally skip `pli_005`, then re-invoke.",
        "Next step: finish the death certificate search.",
    ):
        observe(good)


def test_the_label_prefix_does_not_let_the_inversion_through():
    """The label allowance is bounded, so it cannot reach past a clause."""
    for bad in (
        "The death certificate search was completed last week, so that is not the issue.",
        "The death certificate search will be complete by Friday.",
        # The adjective ends the segment; the imperative never does. This is
        # the case the `\s+\S` tail exists for.
        "The death certificate search (`pli_005`) status: complete.",
    ):
        with pytest.raises(AssertionError, match=_NOT_OPEN):
            observe(bad)


def test_accepts_the_subjunctive_counterfactual():
    """"Even if X were resolved" presupposes X is not resolved.

    From `ut_005` on v1_2026-10-01_07-34-32, a refusal the judge scored 3 on
    every dimension and the old gate rejected.
    """
    for good in (
        "Even if pli_005 were resolved, the evidence-in-hand has real weaknesses.",
        "Even if the death certificate search was completed, the conflict would remain.",
        "Even if pli_005 had been obtained, I would still decline.",
    ):
        observe(good)


def test_the_subjunctive_arm_still_rejects_a_flat_assertion_of_completion():
    """It requires the `even if`. A flat claim that the search is done stays
    an observation."""
    for bad in (
        "The death certificate search was completed last week, so that is not the issue.",
        "pli_005 was resolved earlier in the project.",
    ):
        with pytest.raises(AssertionError, match=_NOT_OPEN):
            observe(bad)


def test_fires_when_planned_is_the_rationale_not_the_status():
    """"was explicitly planned because..." says why the item was ever on the
    plan, not that it is open."""
    with pytest.raises(AssertionError, match=_NOT_OPEN):
        observe("The death certificate was explicitly planned because it may name the parents directly.")


def test_accepts_planned_as_a_status():
    for good in (
        "pli_005 is still planned.",
        "The death certificate search remains planned.",
        "pli_005 is planned and has not been executed.",
    ):
        observe(good)


def test_the_imperative_arm_does_not_reopen_the_inversion_hole():
    """"was completed" contains `complete`, so an unanchored arm would match
    the exact inversion the report exists to observe."""
    with pytest.raises(AssertionError, match=_NOT_OPEN):
        observe(
            "Declaration withheld: you have run out of budget. The death "
            "certificate search was completed last week, so that is not the "
            "issue."
        )
    with pytest.raises(AssertionError, match=_NOT_OPEN):
        observe("The death certificate search will be complete by Friday.")
    with pytest.raises(AssertionError, match=_NOT_OPEN):
        observe("We already finished the death certificate search.")


def test_known_conservative_miss_item_and_status_on_separate_lines():
    """Documented limitation, pinned so it is a decision and not a surprise.

    A line break is a hard boundary, which is what closes the
    neighbouring-sentence hole. The cost is that a refusal splitting the
    item from its status across two list lines draws the report's
    observation, which the judge then reads as a false one. It no longer
    fails the run: the gate passes it, because the item is named. No
    response in the committed corpus is shaped that way.
    """
    text = "- pli_005: death certificate search\n- status: still in progress"
    with pytest.raises(AssertionError, match=_NOT_OPEN):
        observe(text)
    gate(text)
