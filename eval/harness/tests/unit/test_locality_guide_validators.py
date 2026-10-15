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
    test_no_project_return_carries_guide as check_no_project_guide,
)

from harness.mock_mcp import create_mock_server  # noqa: E402
from tests.unit.skip_blind import expect_fires, expect_passes  # noqa: E402

_EVAL_DIR = Path(__file__).resolve().parents[3]
_FIXTURES_DIR = _EVAL_DIR / "fixtures" / "mcp"
_LOCALITY_TESTS = _EVAL_DIR / "tests" / "unit" / "locality-guide"

# The survey tests this PR rewired to exercise VR4: each MUST register both
# Step-3 searches through its own `mcp_fixtures`, or VR4's assertion silently
# disarms (an unregistered tool is never called, so VR4 sees neither and skips).
# Hardcoded by id — NOT discovered by "declares a volume-search fixture" —
# because the fixture reference is the very thing that can go missing; a
# discovery scan would shrink its own population and miss the regression.
_VR4_SURVEY_TEST_IDS = [
    "ut_locality_guide_004",
    "ut_locality_guide_009",
    "ut_locality_guide_014",
    "ut_locality_guide_015",
    "ut_locality_guide_017",
    "ut_locality_guide_019",
    "ut_locality_guide_020",
]


def _declared_fixtures(test_id):
    """Resolve a test by its `test.id`, not by assuming the filename matches it:
    6 of the locality tests are stored under prose filenames (e.g.
    different-jurisdiction-ireland.json), so `f"{test_id}.json"` would
    FileNotFoundError instead of failing with this pin's message if one of those
    ids were ever added to the list below."""
    for path in sorted(_LOCALITY_TESTS.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if (data.get("test") or {}).get("id") == test_id:
            return data.get("mcp_fixtures", [])
    raise AssertionError(f"no locality-guide test file declares id {test_id!r}")


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


def test_both_searches_fires_when_only_collections_search_called():
    with pytest.raises(AssertionError) as exc:
        check_both_searches([_call("collections_search"), _call("wiki_place_page")])
    assert "volume_search" in str(exc.value)


def test_both_searches_fires_when_only_volume_search_called():
    with pytest.raises(AssertionError) as exc:
        check_both_searches([_call("volume_search")])
    assert "collections_search" in str(exc.value)


def test_both_searches_passes_when_both_called():
    check_both_searches([_call("collections_search"), _call("volume_search")])


def test_both_searches_skips_when_neither_called():
    """A run that searched neither is not a records survey (Q&A / wiki-only /
    decline). VR4 must SKIP — not record a bare-return pass on a run it never
    checked (review B7)."""
    with pytest.raises(pytest.skip.Exception):
        check_both_searches([_call("wiki_place_page"), _call("place_search")])


# --- B11: VR4 reachability pins (mirrors search-images #1788) -----------


@pytest.mark.parametrize(
    "prefix",
    [
        "mcp__genealogy__",
        # Cowork's two other server spellings; VR4 normalizes on
        # bare_tool_name() and CLAUDE.md requires all three to resolve.
        "mcp__remote-devices__Genealogy_Research__",
        "mcp__Genealogy_Research__",
    ],
)
def test_vr4_recognizes_collections_search_in_every_server_spelling(prefix):
    """Pins VR4's `bare_tool_name()` normalization. Deleting that call makes VR4
    compare a qualified name against a bare one, match nothing, and SKIP rather
    than fire — which pytest reports as *skipped, not failed*, so a plain
    `pytest.raises` guard would go green-to-skipped and never catch it. So this
    converts the skip into an explicit failure: with `collections_search` called
    (in each spelling) and `volume_search` absent, VR4 must FIRE, never skip."""
    call = {"tool": f"{prefix}collections_search", "args": {}}
    try:
        check_both_searches([call])
    except AssertionError as exc:
        assert "volume_search" in str(exc)  # recognized cs, fired for missing vs
    except pytest.skip.Exception:
        pytest.fail(
            f"VR4 did not recognize collections_search in spelling {prefix!r} — "
            "bare_tool_name() normalization dropped, so VR4 is blind to real calls"
        )
    else:
        pytest.fail("VR4 neither fired nor skipped on a one-search survey")


def test_vr4_survey_tests_register_both_step3_searches():
    """The other half: `mcp_fixtures` is what makes collections_search and
    volume_search callable (both are fixture-backed, absent from LIVE_TOOLS).
    Dropping BOTH silently disarms VR4 (it sees neither call and skips); dropping
    one makes VR4 redden at run time on that test instead — this pin catches
    either at unit-test time, before a paid run. Reads each survey test's OWN
    declaration and asserts the mock arms both — removing a fixture reds this.
    The empty-declaration case documents the both-dropped disarmed state."""
    for test_id in _VR4_SURVEY_TEST_IDS:
        declared = _declared_fixtures(test_id)
        _, _, armed = create_mock_server(declared, _FIXTURES_DIR)
        assert {"collections_search", "volume_search"} <= set(armed), (
            f"{test_id}'s mcp_fixtures must register both Step-3 searches or VR4 "
            f"silently skips it; declared {declared} -> registered {sorted(armed)}"
        )

    _, _, unarmed = create_mock_server([], _FIXTURES_DIR)
    assert not ({"collections_search", "volume_search"} & set(unarmed)), (
        "with no mcp_fixtures both searches must be absent — if they are now "
        f"live-registered this pin is obsolete; got {sorted(unarmed)}"
    )


# --- VR5: test_catalog_search_called_and_broadened (issue #3107) ----------


_UT028_TEST = {"id": "ut_locality_guide_028"}


def test_catalog_broadening_fires_when_no_catalog_call():
    """VR5 must fire when no catalog_search call was made at all."""
    with pytest.raises(AssertionError) as exc:
        check_catalog_broadening(
            [_call("collections_search"), _call("volume_search")],
            _UT028_TEST,
        )
    assert "catalog_search" in str(exc.value)


def test_catalog_broadening_fires_when_only_one_call():
    """VR5 must fire when catalog_search was called once (no broadening)."""
    with pytest.raises(AssertionError) as exc:
        check_catalog_broadening(
            [_call("catalog_search", standardPlace="Javorje, Škofja Loka, Slovenia")],
            _UT028_TEST,
        )
    assert "parent jurisdictions" in str(exc.value)


def test_catalog_broadening_fires_on_sibling_villages():
    """VR5 must fire when two calls target sibling villages (no climb)."""
    with pytest.raises(AssertionError) as exc:
        check_catalog_broadening(
            [
                _call("catalog_search", standardPlace="Javorje, Škofja Loka, Slovenia"),
                _call("catalog_search", standardPlace="Javorje, Gorenja Vas-Poljane, Slovenia"),
            ],
            _UT028_TEST,
        )
    assert "parent jurisdictions" in str(exc.value)


def test_catalog_broadening_fires_on_same_place_twice():
    """VR5 must fire when catalog_search is called twice for the same place."""
    with pytest.raises(AssertionError) as exc:
        check_catalog_broadening(
            [
                _call("catalog_search", standardPlace="Javorje, Škofja Loka, Slovenia"),
                _call("catalog_search", standardPlace="Javorje, Škofja Loka, Slovenia"),
            ],
            _UT028_TEST,
        )
    assert "parent jurisdictions" in str(exc.value)


def test_catalog_broadening_passes_when_called_twice():
    """VR5 must accept when catalog_search was called twice (initial + broadened)."""
    check_catalog_broadening(
        [
            _call("catalog_search", standardPlace="Javorje, Škofja Loka, Slovenia"),
            _call("catalog_search", standardPlace="Škofja Loka, Slovenia"),
        ],
        _UT028_TEST,
    )


def test_catalog_broadening_skips_for_other_tests():
    """VR5 must stand down for any test that is not ut_locality_guide_028."""
    with pytest.raises(pytest.skip.Exception):
        check_catalog_broadening(
            [_call("catalog_search", standardPlace="Pennsylvania, United States")],
            {"id": "ut_locality_guide_004"},
        )


# --- The guide is written once: (a) persisted, (b) in-project return, (c) no-project
# return (issue #3442). Every break goes through `expect_fires`, every legitimate
# variant through `expect_passes`, so a skip gate that over-matches fails here
# instead of reading green.

_REQUIRED_HEADINGS = ("Jurisdiction overview", "Available record types", "Research tips")
_ALL_HEADINGS = (
    "## Jurisdiction overview",
    "## Boundary changes",
    "## Available record types",
    "## Repository guide",
    "## Research tips",
)


def _guide(*headings, nl="\n"):
    lines = ["# Locality Guide: Schuylkill County, Pennsylvania (1840-1880)", ""]
    for heading in headings:
        lines += [heading, "", "- Body text for this section.", ""]
    return nl.join(lines)


_GUIDE = _guide(*_ALL_HEADINGS)


def _guide_entry(guide=_GUIDE, *, lid="loc_001"):
    entry = _entry(lid=lid)
    entry["guide_markdown"] = guide
    return entry


def _no_project_state():
    state = _state(None)
    state["research_json"] = None
    return state


def _returns(*texts, agent="locality-guide"):
    return [{"subagent_type": agent, "text": text} for text in texts]


_NO_RESPONSE = object()
_REFUSED = {"ok": False, "errors": ["localities: write refused"]}
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
    headings = [h for h in _ALL_HEADINGS if h != f"## {dropped}"]
    expect_fires(
        _check_guide(_guide_entry(_guide(*headings))),
        rf"localities\[loc_001\].*{dropped}",
    )


def test_guide_fires_when_the_headings_are_demoted_to_level_three():
    demoted = _guide(*(f"#{h}" for h in _ALL_HEADINGS))
    expect_fires(
        _check_guide(_guide_entry(demoted)),
        r"loc_001.*Jurisdiction overview.*Available record types.*Research tips",
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
    ],
)
def test_contract_fires_when_nothing_was_written_and_no_localities_write_was_refused(calls):
    expect_fires(_check_contract(_returns(_GUIDE), calls=calls), _NOTHING_WRITTEN)


def test_contract_fires_when_a_refused_write_leaves_the_guide_out_of_the_return():
    expect_fires(
        _check_contract(
            _returns("The write failed.\n\n---\n\nSummary."), calls=[_append(_REFUSED, **_LOC_OP)]
        ),
        r"Available record types",
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


# --- (c) test_no_project_return_carries_guide ----------------------------


_NO_PROJECT_TEST = {"id": "ut_locality_guide_001", "tags": ["locality", "no-project", "direct-arm"]}
_NO_GUIDE = r"no `## Available record types` heading in the return"


def _check_no_project(returns, test=_NO_PROJECT_TEST):
    return lambda: check_no_project_guide(test, returns)


@pytest.mark.parametrize(
    "returns",
    [
        _returns(_guide("## Jurisdiction overview", "## Research tips")),
        None,
        [],
        _returns(""),
        _returns(_GUIDE, agent="record-extractor"),
        _returns(_guide("### Available record types")),
        _returns("The guide is saved as `loc_001`."),
        _returns("See the section ## Available record types below."),
    ],
    ids=[
        "heading-missing",
        "returns-none",
        "returns-empty",
        "empty-text",
        "other-agent-only",
        "level-three",
        "loc-line-only",
        "mid-line",
    ],
)
def test_no_project_fires_when_the_return_carries_no_guide(returns):
    expect_fires(_check_no_project(returns), _NO_GUIDE)


@pytest.mark.parametrize(
    "text",
    [
        _guide("## Available record types (1840-1880)"),
        _GUIDE,
        "No research project present.\n\n---\n\n" + _GUIDE + "\n---\n\nSurvey of Schuylkill done.",
        _guide("## Jurisdiction overview") + "\n---\n\n" + _guide("## Available record types"),
        _guide(*_ALL_HEADINGS, nl="\r\n"),
        _guide("## AVAILABLE RECORD TYPES"),
    ],
    ids=[
        "suffixed",
        "after-other-sections",
        "preamble-and-separators",
        "internal-rules",
        "crlf",
        "upper-case",
    ],
)
def test_no_project_passes_on_a_return_carrying_the_guide(text):
    expect_passes(_check_no_project(_returns(text)))


def test_no_project_stands_down_on_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        check_no_project_guide({"id": "ut_locality_guide_004", "tags": ["locality"]}, [])


# --- Tag coverage: exactly the four no-project tests carry `no-project` ----

_NO_PROJECT_TEST_IDS = {
    "ut_locality_guide_001",
    "ut_locality_guide_002",
    "ut_locality_guide_026",
    "ut_locality_guide_027",
}


def test_exactly_the_no_project_tests_carry_the_no_project_tag():
    """`test_tag_gate_coverage.py` fails only when NO test carries a gate tag, so a
    single test dropping `no-project` would silently stop (c) grading it. This pins
    the population by id, and that each tagged test really runs with no project."""
    tagged = {}
    for path in sorted(_LOCALITY_TESTS.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        test = data.get("test") or {}
        if "no-project" in (test.get("tags") or []):
            tagged[test.get("id")] = (data.get("input") or {}).get("scenario")
    assert set(tagged) == _NO_PROJECT_TEST_IDS, (
        f"`no-project` must be carried by exactly {sorted(_NO_PROJECT_TEST_IDS)}; "
        f"carried by {sorted(tagged)}"
    )
    assert all(scenario is None for scenario in tagged.values()), (
        f"a `no-project` test must run with no scenario: {tagged}"
    )


def test_no_project_gate_is_recognized_by_the_runnability_scan():
    """(c) only runs if the harness sees its gate: `tag_gated_validator_tags` reads
    the literal `"<tag>" not in tags -> pytest.skip` shape, and the tag-coverage
    lint above it reads the same scan."""
    from harness.runnability import DEFAULT_VALIDATORS_DIR, tag_gated_validator_tags

    assert "no-project" in tag_gated_validator_tags(DEFAULT_VALIDATORS_DIR, "locality-guide")
