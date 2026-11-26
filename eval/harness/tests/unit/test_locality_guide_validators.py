"""Direct tests for the locality-guide validators (issue #1886, deep dive #1664).

Same reason as `test_person_evidence_validators.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set would otherwise
appear only inside a paid per-skill run.

These exist to satisfy CLAUDE.md's "a new lint must be proven to fail" rule.
Each check is exercised so it FIRES on a bad state, ACCEPTS a legitimate
variant, and STANDS DOWN when not applicable.

Scope after PR #2579 review: VR1 checks only the two properties the shared
schema validator does not (source + four-section coverage). VR3 was dropped as
subsumed by VR4 and would only false-fire — SKILL.md:82 makes volume_search a
required Step-3 call and Step 4 derives every label from its result, so the one
acceptance run assigning a label without a volume_search call is ut_002, whose
fixtures don't register volume_search. VR2 is HELD, not dropped: its earlier
"circular / duplicates test_research_plan / provenance_report" rationale does not
hold (it grounds against same-run cs/vs responses not project_context;
test_research_plan doesn't run on locality-guide; provenance_report is
non-gating), so VR2 is deferred pending the skill->agent conversion, not rejected
(#1886). VR4 gates that a records survey called both Step-3 searches.
"""

import json
import re
import sys
from copy import deepcopy
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix on purpose: pytest would otherwise collect
# the imported validators as tests of this module and error on their
# harness-supplied fixtures. Same pattern as test_person_evidence_validators.py.
from test_locality_guide import (  # noqa: E402
    test_persisted_localities_entry_shape as check_shape,
    test_survey_run_calls_both_collections_and_volume_search as check_both_searches,
    test_catalog_search_called_and_broadened as check_catalog_broadening,
    test_persisted_guide_is_the_guide as check_guide,
    test_in_project_return_follows_the_contract as check_return_contract,
    _GUIDE_HEADING_LINES,
    _LOCALITY_RECORD_TYPES,
    _heading,
)

from harness.mock_mcp import create_mock_server  # noqa: E402
from tests.unit.skip_blind import expect_fires, expect_passes  # noqa: E402

_EVAL_DIR = Path(__file__).resolve().parents[3]
_FIXTURES_DIR = _EVAL_DIR / "fixtures" / "mcp"
_LOCALITY_TESTS = _EVAL_DIR / "tests" / "unit" / "locality-guide"



# --- helpers ------------------------------------------------------------


def _state(localities):
    return {
        "research_json": {"localities": localities} if localities is not None else {},
        "tree_gedcomx_json": None,
        "tree_gedcomx": None,
        "files": {},
        "skill_frontmatter": {},
    }


def _entry(*, lid="loc_001", source="locality-guide",
           sections=("home", "getting_started", "online_records", "research_tips")):
    return {
        "id": lid,
        "place": "Pennsylvania, United States",
        "source": source,
        "created": "2026-09-15T00:00:00Z",
        "pages_read": [{"section": s, "found": True} for s in sections],
    }


def _call(tool, **args):
    return {"tool": f"mcp__genealogy__{tool}", "args": args}


# --- VR1: test_persisted_localities_entry_shape (source + 4-section) -----


def test_shape_passes_on_a_valid_new_entry():
    check_shape(_state([]), _state([_entry()]))


def test_shape_fires_on_missing_wiki_section():
    with pytest.raises(AssertionError) as exc:
        check_shape(_state([]), _state([_entry(
            sections=("home", "getting_started", "online_records"),
        )]))
    assert "missing wiki sections" in str(exc.value)
    assert "research_tips" in str(exc.value)


def test_shape_fires_on_wrong_source():
    with pytest.raises(AssertionError) as exc:
        check_shape(_state([]), _state([_entry(source="research-plan")]))
    assert "source" in str(exc.value)


def test_shape_stands_down_when_no_new_entry():
    with pytest.raises(pytest.skip.Exception):
        check_shape(_state([]), _state([]))


def test_shape_validates_only_the_new_entry_not_a_pre_existing_seed():
    """A seed entry present in both before and after is out of scope; only the
    entry this run wrote is checked. A wrong-source seed left unchanged must SKIP
    (nothing new written), while a new valid entry alongside it passes.

    The unchanged seed is a `deepcopy` in the after-state, not the same object:
    the harness parses before/after from separate JSON, so they hold value-equal
    but identity-distinct dicts. Reusing one object would let an identity check
    (`prior[eid] is not e`) pass here while over-reporting every unchanged entry
    in production — this mirrors the real shape so that mutation is caught."""
    seed = _entry(lid="loc_seed", source="research-plan")  # would fail VR1 if checked
    with pytest.raises(pytest.skip.Exception):
        check_shape(_state([seed]), _state([deepcopy(seed)]))  # unchanged seed → skip
    check_shape(_state([seed]), _state([deepcopy(seed), _entry(lid="loc_new")]))  # new → passes


def test_shape_checks_every_new_entry_not_just_the_first():
    """Two entries written in one run, the defective one SECOND. VR1's
    `for loc in written` must check both — truncating to `written[:1]` would
    validate only the first (valid) entry and skip the bad one, reading green."""
    good = _entry(lid="loc_a")
    bad = _entry(lid="loc_b", sections=("home", "getting_started", "online_records"))
    with pytest.raises(AssertionError) as exc:
        check_shape(_state([]), _state([good, bad]))
    assert "loc_b" in str(exc.value)
    assert "missing wiki sections" in str(exc.value)


def test_shape_fires_on_an_in_place_update_that_drops_a_section():
    """Exercises the `include_modified` diff branch: an entry rewritten in place
    (same id) that drops a wiki section must be caught, not skipped as a
    new-id-only diff would. A `skip` here is a FAILURE — reverting
    include_modified would return nothing and a plain `pytest.raises` would let
    that read green."""
    good = _entry(lid="loc_001")
    modified = _entry(lid="loc_001", sections=("home", "getting_started", "online_records"))
    try:
        check_shape(_state([good]), _state([modified]))
    except AssertionError as exc:
        assert "missing wiki sections" in str(exc)
    except pytest.skip.Exception:
        pytest.fail("VR1 skipped a modified same-id entry instead of validating it")
    else:
        pytest.fail("VR1 did not fire on a modified same-id entry")


# --- VR4: test_survey_run_calls_both_collections_and_volume_search ------
# A run that produced a guide called locality_survey (issue #4602).


def _survey(place="Javorje, Škofja Loka, Slovenia", catalog_places=(), prefix="mcp__genealogy__"):
    return {
        "tool": f"{prefix}locality_survey",
        "args": {"standardPlace": place},
        "response": {"catalog": {"levels": [{"place": c, "totalHits": 0, "hits": []} for c in catalog_places]}},
    }


_A_RETURNED_GUIDE = [{"subagent_type": "locality-guide", "text": "# Locality Guide: X\n\n## Jurisdiction overview\n- x"}]


def test_survey_fires_when_a_written_guide_had_no_survey():
    with pytest.raises(AssertionError) as exc:
        check_both_searches(_state([]), _state([_guide_entry()]), [_call("wiki_read")])
    assert "locality_survey" in str(exc.value)


def test_survey_fires_when_a_returned_guide_had_no_survey():
    with pytest.raises(AssertionError) as exc:
        check_both_searches(_state([]), _state([]), [_call("wiki_read")], _A_RETURNED_GUIDE)
    assert "locality_survey" in str(exc.value)


@pytest.mark.parametrize(
    "prefix", ["mcp__genealogy__", "mcp__remote-devices__Genealogy_Research__", "mcp__Genealogy_Research__"]
)
def test_survey_passes_when_the_survey_ran_in_every_server_spelling(prefix):
    check_both_searches(_state([]), _state([_guide_entry()]), [_survey(prefix=prefix)])


def test_survey_skips_a_run_that_produced_no_guide():
    with pytest.raises(pytest.skip.Exception):
        check_both_searches(_state([]), _state([]), [_call("place_search")], [{"subagent_type": "locality-guide", "text": "Which years?"}])


def test_locality_survey_is_registered_in_every_suite():
    """The survey is live (no fixture of its own), so VR4 can never be disarmed by a
    test's fixture list."""
    _, _, armed = create_mock_server([], _FIXTURES_DIR)
    assert "locality_survey" in armed


# --- VR5: test_catalog_search_called_and_broadened (issue #3107) ----------


_UT028_TEST = {"id": "ut_locality_guide_028"}


def test_catalog_broadening_fires_when_no_survey():
    with pytest.raises(AssertionError) as exc:
        check_catalog_broadening([_call("wiki_read")], _UT028_TEST)
    assert "locality_survey" in str(exc.value)


def test_catalog_broadening_fires_when_only_one_level():
    with pytest.raises(AssertionError) as exc:
        check_catalog_broadening([_survey(catalog_places=["Javorje, Škofja Loka, Slovenia"])], _UT028_TEST)
    assert "parent jurisdictions" in str(exc.value)


def test_catalog_broadening_fires_on_sibling_villages():
    with pytest.raises(AssertionError) as exc:
        check_catalog_broadening(
            [_survey(catalog_places=["Javorje, Škofja Loka, Slovenia", "Javorje, Gorenja Vas-Poljane, Slovenia"])],
            _UT028_TEST,
        )
    assert "parent jurisdictions" in str(exc.value)


def test_catalog_broadening_passes_when_the_survey_climbed():
    check_catalog_broadening(
        [_survey(catalog_places=["Javorje, Škofja Loka, Slovenia", "Škofja Loka, Slovenia"])], _UT028_TEST
    )


def test_catalog_broadening_reads_an_mcp_text_response():
    call = _survey()
    call["response"] = {"content": [{"type": "text", "text": json.dumps(
        {"catalog": {"levels": [{"place": "Javorje, Škofja Loka, Slovenia"}, {"place": "Škofja Loka, Slovenia"}]}}
    )}]}
    check_catalog_broadening([call], _UT028_TEST)


def test_catalog_broadening_skips_for_other_tests():
    with pytest.raises(pytest.skip.Exception):
        check_catalog_broadening([_survey(catalog_places=["Pennsylvania, United States"])], {"id": "ut_locality_guide_004"})


# --- The guide is written once: (a) persisted, (b) in-project return, (c) no-project
# return (issue #3442). Every break goes through `expect_fires`, every legitimate
# variant through `expect_passes`, so a skip gate that over-matches fails here
# instead of reading green.

_ALL_HEADINGS = _GUIDE_HEADING_LINES
_REQUIRED_HEADINGS = _ALL_HEADINGS


def _guide(*headings, nl="\n"):
    lines = ["# Locality Guide: Schuylkill County, Pennsylvania (1840-1880)", ""]
    for heading in headings:
        lines += [heading, "", "- Body text for this section.", ""]
    return nl.join(lines)


_GUIDE = _guide(*_ALL_HEADINGS)


def _guide_entry(guide=_GUIDE, *, lid="loc_001", types=_LOCALITY_RECORD_TYPES):
    entry = _entry(lid=lid)
    entry["guide_markdown"] = guide
    entry["record_types"] = [{"type": t, "access": "unknown", "summary": "Not confirmed."} for t in types]
    return entry


def _no_project_state():
    state = _state(None)
    state["research_json"] = None
    return state


def _returns(*texts, agent="locality-guide"):
    return [{"subagent_type": agent, "text": text} for text in texts]


_NO_RESPONSE = object()
_REFUSED = {"ok": False, "errors": ["no research.json at the project path"], "reason": "no_project"}
_FIXABLE_REFUSAL = {"ok": False, "errors": ["research.json/localities[1]: unexpected property 'notes'"]}
_LOC_OP = {"section": "localities", "op": "append", "entry": {"place": "Schuylkill"}}


def _append(response=_NO_RESPONSE, *, prefix="mcp__genealogy__", **args):
    call = {"tool": f"{prefix}research_append", "args": args}
    if response is not _NO_RESPONSE:
        call["response"] = response
    return call


# --- (a) test_persisted_guide_is_the_guide -------------------------------


def _check_guide(*after, before=()):
    return lambda: check_guide(_state(list(before)), _state(list(after)))


@pytest.mark.parametrize("dropped", _REQUIRED_HEADINGS)
def test_guide_fires_when_a_required_heading_is_missing(dropped):
    headings = [h for h in _ALL_HEADINGS if h != dropped]
    expect_fires(
        _check_guide(_guide_entry(_guide(*headings))),
        rf"localities\[loc_001\].*{re.escape(dropped)}",
    )


def test_guide_passes_with_every_heading():
    expect_passes(_check_guide(_guide_entry(_GUIDE)))


@pytest.mark.parametrize("dropped", ["vital_record", "tax", "other"])
def test_guide_fires_when_a_record_type_has_no_row(dropped):
    expect_fires(
        _check_guide(_guide_entry(types=[t for t in _LOCALITY_RECORD_TYPES if t != dropped])),
        rf"loc_001.*record_types has no row for \['{dropped}'\]",
    )


def test_guide_fires_on_an_entry_with_no_rows():
    entry = _guide_entry()
    del entry["record_types"]
    expect_fires(_check_guide(entry), r"record_types has no row for \['census'")


def test_record_types_are_the_schema_enum():
    assert _LOCALITY_RECORD_TYPES[0] == "census" and "vital_record" in _LOCALITY_RECORD_TYPES
    assert len(_LOCALITY_RECORD_TYPES) == 12


def test_guide_fires_when_the_headings_are_demoted_a_level():
    demoted = _guide(*(f"#{h}" for h in _ALL_HEADINGS))
    expect_fires(
        _check_guide(_guide_entry(demoted)),
        r"loc_001.*Jurisdiction overview.*Boundary changes.*Research tips",
    )


@pytest.mark.parametrize(
    "pointer",
    [
        "See full guide in research session output.",
        "see the full guide above",
        "SEE FULL GUIDE",
        "Full guide text as presented to user.",
        "Full guide presented to user in session.",
        "See research log for full locality guide text.",
        "see  the full\tguide in the session",
    ],
)
def test_guide_fires_on_a_pointer_to_the_guide_even_with_every_heading(pointer):
    expect_fires(
        _check_guide(_guide_entry(_GUIDE + "\n" + pointer + "\n")),
        r"loc_001.*points elsewhere",
    )


@pytest.mark.parametrize(
    "prose",
    [
        "This is the full guide for the county.",
        "Records presented to the user below are indexed.",
        "The deeds are represented to the user as abstracts.",
        "Oversee full guidebook editions at the archive.",
    ],
)
def test_guide_passes_ordinary_prose_near_the_pointer_words(prose):
    expect_passes(_check_guide(_guide_entry(_GUIDE + "\n" + prose + "\n")))


def test_guide_fires_on_a_pointer_under_every_heading():
    lines = ["# Locality Guide: Schuylkill County, Pennsylvania (1840-1880)", ""]
    for heading in _ALL_HEADINGS:
        lines += [heading, "", "Full guide text as presented to user.", ""]
    expect_fires(
        _check_guide(_guide_entry("\n".join(lines))),
        r"loc_001.*points elsewhere",
    )


@pytest.mark.parametrize("value", [None, "", "  \n\t", 42, ["## Research tips"]])
def test_guide_fires_when_guide_markdown_is_not_a_non_empty_string(value):
    expect_fires(_check_guide(_guide_entry(value)), r"loc_001.*guide_markdown")


def test_guide_fires_when_guide_markdown_is_absent():
    expect_fires(_check_guide(_entry()), r"loc_001.*guide_markdown")


# The engine refuses a guide on the same rule (research_append, research-append-tool-spec
# section 5.14), and its twin of this table is in
# packages/engine/mcp-server/tests/tools/research-append.test.ts. Change _heading() and
# both tables, and the engine's missingGuideHeadings, move together.
_HEADING_BEFORE = "\n\n".join(h for h in _ALL_HEADINGS if h != "## Research tips") + "\n\n"


@pytest.mark.parametrize(
    "tail, found",
    [
        ("## Research tips\nx", True),
        ("x\n## Research tips", True),
        ("x\r\n## Research tips", True),
        ("x\r## Research tips", False),
        ("x\u2028## Research tips", False),
        ("x\u2029## Research tips", False),
        ("## Re\u017fearch tips", True),
        ("## RESEARCH TIPS (1840)", True),
        ("### Research tips", False),
        ("Notes: ## Research tips", False),
        (" ## Research tips", False),
        ("##\tResearch tips", True),
        ("##Research tips", False),
        ("## research tipsy", True),
        ("", False),
        ("##  Research tips", True),
        ("# Research tips", False),
        ("Research tips", False),
        ("##\nResearch tips", False),
        ("##\u00a0Research tips", False),
        ("> ## Research tips", False),
        ("- ## Research tips", False),
        ("## Research tips and tricks", True),
    ],
)
def test_heading_rule_matches_the_engine_twin_table(tail, found):
    assert bool(_heading("## Research tips").search(_HEADING_BEFORE + tail)) is found


def test_heading_rule_ignores_a_heading_behind_a_byte_order_mark():
    assert not _heading("## Research tips").search("\ufeff## Research tips")


def test_guide_fires_on_an_in_place_update_that_stubs_the_guide():
    """`include_modified`: an entry rewritten in place with a pointer instead of
    the guide is this run's write and must be checked, not skipped."""
    stub = _guide_entry("See full guide in research session output.")
    expect_fires(
        lambda: check_guide(_state([_guide_entry()]), _state([stub])),
        r"loc_001",
    )


def test_guide_checks_every_written_entry():
    expect_fires(
        _check_guide(_guide_entry(lid="loc_a"), _guide_entry("", lid="loc_b")),
        r"loc_b",
    )


@pytest.mark.parametrize(
    "guide",
    [
        _guide(*reversed(_ALL_HEADINGS)),
        _guide(*_ALL_HEADINGS, "## Local newspapers", "## Maps"),
        _guide(*(h.replace("overview", "overview (1840s)") for h in _ALL_HEADINGS)),
        _guide(*_ALL_HEADINGS, nl="\r\n"),
        _GUIDE + "\nThis is the full guide for the county.\n",
        _guide(*(h.upper() for h in _ALL_HEADINGS)),
    ],
    ids=["reordered", "extra-sections", "suffixed", "crlf", "full-guide-without-see", "upper-case"],
)
def test_guide_passes_on_a_legitimate_guide(guide):
    expect_passes(_check_guide(_guide_entry(guide)))


def test_guide_stands_down_when_nothing_was_written():
    with pytest.raises(pytest.skip.Exception):
        check_guide(_state([]), _state([]))
    stub = _guide_entry("See full guide in research session output.")
    with pytest.raises(pytest.skip.Exception):
        check_guide(_state([stub]), _state([deepcopy(stub)]))


# --- (b) test_in_project_return_follows_the_contract ---------------------


def _check_contract(returns, *, before=(), after=(), calls=()):
    return lambda: check_return_contract(
        _state(list(before)), _state(list(after)), list(calls), returns
    )


_SHORT = "The guide is saved as `loc_001` in `research.json`.\n\n---\n\nSchuylkill survey done."


def _padded(n, head="Saved `loc_001`.\n"):
    return head + "x" * (n - len(head))


def test_contract_fires_on_a_return_over_3000_characters():
    expect_fires(
        _check_contract(_returns(_padded(3001)), after=[_guide_entry()]),
        r"3000.*3001",
    )


def test_contract_counts_every_return_the_agent_made():
    returns = _returns(_padded(1600), _padded(1600))
    expect_fires(_check_contract(returns, after=[_guide_entry()]), r"3000")


def test_contract_passes_at_exactly_3000_characters():
    expect_passes(_check_contract(_returns(_padded(3000)), after=[_guide_entry()]))


def test_contract_fires_when_the_return_names_no_id():
    expect_fires(
        _check_contract(_returns("Saved the guide.\n\n---\n\nSummary."), after=[_guide_entry()]),
        r"loc_001",
    )


def test_contract_fires_when_the_return_names_the_wrong_id():
    expect_fires(
        _check_contract(_returns(_SHORT), after=[_guide_entry(lid="loc_002")]),
        r"loc_002",
    )


def test_contract_does_not_accept_an_id_inside_a_longer_id():
    expect_fires(
        _check_contract(_returns("Saved as loc_0012."), after=[_guide_entry()]),
        r"loc_001",
    )


@pytest.mark.parametrize(
    "returns",
    [None, [], _returns(_SHORT, agent="record-extractor"), _returns("")],
    ids=["none", "empty-list", "other-agent-only", "empty-text"],
)
def test_contract_fires_on_an_empty_return_after_a_write(returns):
    expect_fires(_check_contract(returns, after=[_guide_entry()]), r"empty")


def test_contract_passes_on_the_id_in_backticks():
    expect_passes(_check_contract(_returns(_SHORT), after=[_guide_entry()]))


def test_contract_passes_on_a_modified_entry_named_by_its_id():
    before = [_guide_entry(lid="loc_003")]
    after = [_guide_entry(_GUIDE + "\n## Maps\n", lid="loc_003")]
    expect_passes(
        _check_contract(_returns("Updated `loc_003`.\n\n---\n\nDone."), before=before, after=after)
    )


def test_contract_requires_every_written_id():
    after = [_guide_entry(lid="loc_001"), _guide_entry(lid="loc_002")]
    expect_fires(_check_contract(_returns(_SHORT), after=after), r"loc_002")
    expect_passes(
        _check_contract(_returns("Saved `loc_001` and `loc_002`.\n\n---\n\nDone."), after=after)
    )


_NOTHING_WRITTEN = "in a research project, nothing persisted and no localities write was refused"


def test_contract_fires_when_nothing_was_written_and_the_return_is_a_summary():
    expect_fires(
        _check_contract(_returns("Survey done.\n\n---\n\nSummary."), calls=[_call("wiki_place_page")]),
        _NOTHING_WRITTEN,
    )


@pytest.mark.parametrize(
    "calls",
    [
        [_call("wiki_place_page")],
        [_append({"ok": True, "id": "loc_001"}, **_LOC_OP)],
        [_append(**_LOC_OP)],
        [_append(None, **_LOC_OP)],
        [_append("not json", **_LOC_OP)],
        [_append({"errors": ["no ok key"]}, **_LOC_OP)],
        [_append(_REFUSED, section="log", op="append", entry={})],
        [_append(_REFUSED, ops="not json [")],
        [_append(_REFUSED, ops=[{"section": "log", "op": "append", "entry": {}}])],
        [{"tool": "mcp__genealogy__research_log_append", "args": _LOC_OP, "response": _REFUSED}],
        [_append(_FIXABLE_REFUSAL, **_LOC_OP)],
        [_append({"content": [{"type": "text", "text": json.dumps(_FIXABLE_REFUSAL)}]}, **_LOC_OP)],
        [_append({**_REFUSED, "reason": "other"}, **_LOC_OP)],
    ],
    ids=[
        "no-localities-write",
        "ok-true",
        "no-response-key",
        "response-none",
        "response-unparseable",
        "ok-absent",
        "refused-other-section",
        "ops-unparseable",
        "batch-other-section",
        "other-tool",
        "fixable-refusal",
        "fixable-refusal-mcp-text",
        "refusal-other-reason",
    ],
)
def test_contract_fires_when_nothing_was_written_and_no_localities_write_was_refused(calls):
    expect_fires(_check_contract(_returns(_GUIDE), calls=calls), _NOTHING_WRITTEN)


def test_contract_fires_when_a_refused_write_leaves_the_guide_out_of_the_return():
    expect_fires(
        _check_contract(
            _returns("The write failed.\n\n---\n\nSummary."), calls=[_append(_REFUSED, **_LOC_OP)]
        ),
        r"Jurisdiction overview",
    )


@pytest.mark.parametrize(
    "call",
    [
        _append(_REFUSED, **_LOC_OP),
        _append(_REFUSED, ops=[{"section": "log", "op": "append", "entry": {}}, _LOC_OP]),
        _append(_REFUSED, ops=json.dumps([_LOC_OP])),
        _append({"content": [{"type": "text", "text": json.dumps(_REFUSED)}]}, **_LOC_OP),
        _append(json.dumps(_REFUSED), **_LOC_OP),
        _append(_REFUSED, prefix="mcp__remote-devices__Genealogy_Research__", **_LOC_OP),
        _append(_REFUSED, prefix="mcp__Genealogy_Research__", **_LOC_OP),
        _append(_REFUSED, ops=[], **_LOC_OP),
    ],
    ids=[
        "single-op",
        "batch-ops",
        "ops-json-string",
        "mcp-text-content",
        "response-json-string",
        "bridged-spelling",
        "bare-display-spelling",
        "top-level-op-with-empty-ops",
    ],
)
def test_contract_passes_when_a_refused_localities_write_falls_back_to_the_guide(call):
    expect_passes(_check_contract(_returns(_GUIDE), calls=[call]))


_UNRESOLVED = {
    "ok": False,
    "errors": [
        "for_place 'Billy, County Antrim, Ireland': FamilySearch's place standard has no place 'Billy' there. "
        "Look up 'Billy' with place_search, contextName 'Ireland'."
    ],
}


def test_contract_passes_when_an_unresolved_place_falls_back_to_the_guide():
    expect_passes(_check_contract(_returns(_GUIDE), calls=[_append(_UNRESOLVED, **_LOC_OP)]))


def test_contract_fires_when_an_unresolved_place_returns_no_guide():
    expect_fires(
        _check_contract(_returns("The place did not resolve."), calls=[_append(_UNRESOLVED, **_LOC_OP)]),
        r"Jurisdiction overview",
    )


def test_contract_stands_down_outside_a_project():
    with pytest.raises(pytest.skip.Exception):
        check_return_contract(_no_project_state(), _no_project_state(), [], _returns(_GUIDE))


def test_contract_grades_a_project_whose_research_json_is_empty():
    """The gate is `research_json is None` (no file), not falsiness: an empty
    research.json is still a project."""
    expect_fires(
        lambda: check_return_contract(_state(None), _state(None), [], _returns("Survey done.")),
        _NOTHING_WRITTEN,
    )


# --- No test runs locality-guide without a project ---------------------


def test_every_locality_guide_test_runs_in_a_project():
    """locality-guide always saves its guide to a project (lead, 2026-11-19): every test's
    delegation names the project path, and none carries the retired `no-project` tag."""
    for path in sorted(_LOCALITY_TESTS.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        test = data.get("test") or {}
        if test.get("type") == "negative":
            continue
        assert "no-project" not in (test.get("tags") or []), test.get("id")
        assert "projectPath" in ((data.get("input") or {}).get("delegation") or ""), test.get("id")
