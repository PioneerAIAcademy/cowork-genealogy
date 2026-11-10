"""Direct tests for the timeline validators (issues #2261 and #3516).

`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/`
is collected by `make harness-test`, and a validator's real pass/fail set would
otherwise appear only inside a paid per-skill run. Each check below is run
against states that must PASS and states that must FIRE (CLAUDE.md, "A new
lint must be proven to fail", in both directions).
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix on purpose: pytest would otherwise
# collect the imported validators as tests of this module and error on their
# harness-supplied fixtures.
from test_timeline import (  # noqa: E402
    test_no_extraction as check_no_extraction,
    test_one_extraction_between_builds as check_one_extraction,
    test_person_timeline_in_code as check_person_timeline_in_code,
    test_positive_produces_timeline as check_produces_timeline,
    test_project_unchanged as check_project_unchanged,
    test_us_1890_never_expected as check_us_1890,
)

POSITIVE = {"type": "positive"}
BEFORE = {"research_json": {"timelines": []}}


def _after(gaps, events=None):
    return {
        "research_json": {
            "assertions": [],
            "timelines": [{"id": "t_001", "events": events or [], "gaps": gaps}],
        }
    }


def _gap(*entries):
    return [{"start": "1885", "end": "1895", "expected_events": list(entries), "severity": "high"}]


PA_EVENTS = [{
    "date": "1880", "event_type": "census", "place": "Schuylkill County, Pennsylvania",
    "standard_place": "Schuylkill, Pennsylvania, United States", "assertion_ids": ["a_001"],
}]


# --- test_us_1890_never_expected ----------------------------------------------

@pytest.mark.parametrize("entry", [
    "1890 census",
    "1890_census",
    "1890 United States census",
    "1890 Federal census",
    "U.S. census 1890",
])
def test_1890_fires_on_a_us_or_unattributed_entry(entry):
    with pytest.raises(AssertionError, match="1890"):
        check_us_1890(BEFORE, _after(_gap(entry)), POSITIVE)


def test_1890_fires_on_a_state_census_naming_the_timelines_own_us_place():
    with pytest.raises(AssertionError, match="1890"):
        check_us_1890(BEFORE, _after(_gap("1890 Pennsylvania census"), PA_EVENTS), POSITIVE)


@pytest.mark.parametrize("entry", [
    "1890 Denmark census",
    "Ireland census 1890",
    "1890 Norway Population census",
    "1890 veterans schedule census",
    "1870 United States census",
    "residence",
])
def test_1890_passes_a_non_us_veteran_or_other_year_entry(entry):
    check_us_1890(BEFORE, _after(_gap(entry), PA_EVENTS), POSITIVE)


def test_1890_fires_with_a_bare_entry_even_with_no_us_event():
    # Stricter than the engine, on purpose: a bare "1890 census" is the
    # schedule-revert regression whatever the events are.
    with pytest.raises(AssertionError, match="1890"):
        check_us_1890(BEFORE, _after(_gap("1890 census"), []), POSITIVE)


# --- no-project-write ---------------------------------------------------------

NPW = {"type": "positive", "tags": ["no-project-write"]}
EMPTY = {"research_json": {"timelines": [], "person_evidence": []}}


def test_no_project_write_fires_on_a_written_timeline():
    with pytest.raises(AssertionError, match="timelines"):
        check_project_unchanged(EMPTY, _after([]), NPW)


def test_no_project_write_fires_on_any_other_write():
    after = {"research_json": {"timelines": [], "person_evidence": [{"id": "pe_001"}]}}
    with pytest.raises(AssertionError, match="person_evidence"):
        check_project_unchanged(EMPTY, after, NPW)


def test_no_project_write_passes_an_unchanged_project_and_skips_untagged():
    check_project_unchanged(EMPTY, {"research_json": {"timelines": [], "person_evidence": []}}, NPW)
    with pytest.raises(pytest.skip.Exception):
        check_project_unchanged(EMPTY, _after([]), POSITIVE)


def test_produces_timeline_skips_a_no_project_write_test():
    with pytest.raises(pytest.skip.Exception):
        check_produces_timeline(EMPTY, EMPTY, NPW)
    with pytest.raises(AssertionError):
        check_produces_timeline(EMPTY, EMPTY, POSITIVE)


# --- extraction-calls-0 / extraction-calls-1 ----------------------------------

def _call(name, prefix="mcp__genealogy__", **args):
    return {"tool": f"{prefix}{name}", "args": args}


BUILD = _call("timeline_build", projectPath="/p", personId="I1")
EXTRACT = _call("extraction_append", projectPath="/p", personId="I1")
ONE = {"tags": ["extraction-calls-1"]}
ZERO = {"tags": ["extraction-calls-0"]}


@pytest.mark.parametrize("prefix", [
    "mcp__genealogy__",
    "mcp__remote-devices__Genealogy_Research__",
    "mcp__Genealogy_Research__",
])
def test_extraction_calls_1_passes_build_extract_build_under_every_spelling(prefix):
    calls = [_call("timeline_build", prefix, personId="I1"),
             _call("extraction_append", prefix, personId="I1"),
             _call("timeline_build", prefix, personId="I1")]
    check_one_extraction(calls, ONE)


@pytest.mark.parametrize("calls", [
    [BUILD, BUILD],
    [BUILD, EXTRACT, EXTRACT, BUILD],
    [BUILD, _call("extraction_append", projectPath="/p", recordIds=["ark:/61903/1:1:MM8C-43Q"]), BUILD],
    [EXTRACT, BUILD, BUILD],
    [BUILD, EXTRACT],
    [BUILD, _call("not_extraction_append", personId="I1"), BUILD],
], ids=["none", "two", "recordIds-mode", "before-first-build", "no-second-build", "lookalike-name"])
def test_extraction_calls_1_fires(calls):
    with pytest.raises(AssertionError):
        check_one_extraction(calls, ONE)


def test_extraction_calls_0_fires_on_one_call_and_passes_none():
    with pytest.raises(AssertionError, match="no extraction_append"):
        check_no_extraction([BUILD, EXTRACT, BUILD], ZERO)
    check_no_extraction([BUILD], ZERO)
    check_no_extraction([], ZERO)


def test_extraction_tags_skip_untagged_tests():
    with pytest.raises(pytest.skip.Exception):
        check_one_extraction([], {"tags": []})
    with pytest.raises(pytest.skip.Exception):
        check_no_extraction([EXTRACT], {"tags": []})


# --- person-timeline-in-code --------------------------------------------------

PTIC = {"tags": ["person-timeline-in-code"]}
HYP = {"id": "t_001", "hypothesis_id": "h_001", "person_ids": ["I1"], "events": [{"date": "1850"}], "gaps": []}
PERSON = {"id": "t_002", "person_ids": ["I1"], "events": [{"date": "1850"}], "gaps": []}
HYP_BEFORE = {"research_json": {"timelines": [HYP]}}
GOOD_AFTER = {"research_json": {"timelines": [HYP, PERSON]}}
REGEN_AFTER = {"research_json": {"timelines": [{**HYP, "events": [{"date": "1845"}, {"date": "1850"}]}]}}
UPDATE_T001 = _call("research_append", section="timelines", op="update", entryId="t_001",
                    fields={"events": [{"date": "1845"}]})


def test_person_timeline_in_code_passes_a_timeline_build_run():
    check_person_timeline_in_code(HYP_BEFORE, GOOD_AFTER, [BUILD], PTIC)


def test_person_timeline_in_code_fires_on_the_regeneration_of_t_001():
    # The shape of ut_timeline_001/_002/_004/_005 in
    # eval/runlogs/unit/timeline/v1_2026-10-23_19-24-55.json.
    with pytest.raises(AssertionError, match="timeline_build"):
        check_person_timeline_in_code(HYP_BEFORE, REGEN_AFTER, [UPDATE_T001], PTIC)


@pytest.mark.parametrize("call", [
    UPDATE_T001,
    _call("research_append", "mcp__remote-devices__Genealogy_Research__",
          section="timelines", op="update", entryId="t_001", fields={}),
    _call("research_append", ops=[{"section": "timelines", "op": "update", "entryId": "t_001", "fields": {}}]),
], ids=["single-op", "prefixed-spelling", "batched-ops"])
def test_person_timeline_in_code_fires_on_a_research_append_timelines_write(call):
    with pytest.raises(AssertionError, match="research_append"):
        check_person_timeline_in_code(HYP_BEFORE, GOOD_AFTER, [BUILD, call], PTIC)


def test_person_timeline_in_code_fires_when_a_hypothesis_timeline_changes():
    after = {"research_json": {"timelines": [{**HYP, "events": []}, PERSON]}}
    with pytest.raises(AssertionError, match="t_001"):
        check_person_timeline_in_code(HYP_BEFORE, after, [BUILD], PTIC)


def test_person_timeline_in_code_ignores_a_research_append_on_another_section():
    other = _call("research_append", ops=[{"section": "conflicts", "op": "update", "entryId": "c_001", "fields": {}}])
    check_person_timeline_in_code(HYP_BEFORE, GOOD_AFTER, [BUILD, other], PTIC)
