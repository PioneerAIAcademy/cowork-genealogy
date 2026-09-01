"""Tests for harness.mock_mcp — in-process MCP fixture server.

These tests exercise the handler logic directly (bypassing the SDK) so they
stay fast and don't require network. Real SDK integration is covered by the
e2e test.
"""

import asyncio
import json
import re
import tempfile
from pathlib import Path

import pytest

from harness.fixtures import InvalidFixtureError
from harness.mock_mcp import (
    LIVE_TOOLS,
    UNLOGGED_REFS_SHOWN,
    NIL_SEARCH_NEEDS_LOG_NOTE,
    OK_FALSE_IS_FAILURE_LIVE,
    RANKING_SKIPPED_NOTE,
    UNLOGGED_SEARCHES_NOTE,
    _fixture_is_nil,
    _tool_envelope,
    create_mock_server,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
FIXTURES_DIR = REPO_ROOT / "eval/fixtures/mcp"
COMPACTOR_JS = (
    REPO_ROOT / "packages/engine/mcp-server/build/utils/staged-compaction.js"
)


def _extract_response_dict(handler_result):
    """The mock handler returns {'content': [{'type':'text','text': '<json>'}]}."""
    return json.loads(handler_result["content"][0]["text"])


def _invoke(tools_by_name, tool_name: str, args: dict):
    """Invoke a mock tool handler directly, bypassing the SDK transport."""
    return asyncio.run(tools_by_name[tool_name].handler(args))


def test_returns_fixture_response_for_known_tool():
    server, call_log, tools_by_name = create_mock_server(
        ["wikipedia-search-schuylkill-county"], FIXTURES_DIR
    )
    result = _invoke(tools_by_name, "wikipedia_search", {"query": "Schuylkill County"})
    body = _extract_response_dict(result)
    assert body["title"] == "Schuylkill County, Pennsylvania"
    assert call_log[0]["tool"] == "mcp__genealogy__wikipedia_search"
    assert call_log[0]["matched"]["kind"] == "predicate"
    assert call_log[0]["response_fixture"] == "wikipedia-search-schuylkill-county"
    # expected_args carries the matched fixture's args block.
    assert call_log[0]["expected_args"] == {"query": "~Schuylkill"}


def test_only_registers_tools_for_loaded_fixtures():
    server, call_log, tools_by_name = create_mock_server(
        ["wikipedia-search-schuylkill-county"], FIXTURES_DIR
    )
    # Live tools (e.g. validate_research_schema) are always registered
    # regardless of fixture_names, so subtract LIVE_TOOLS before asserting.
    from harness.mock_mcp import LIVE_TOOLS
    fixture_backed = set(tools_by_name.keys()) - LIVE_TOOLS
    assert fixture_backed == {"wikipedia_search"}


def test_predicate_match_dispatches_to_matching_fixture():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "ohio.json").write_text(json.dumps({
            "tool": "record_search",
            "args": {"args.q": "Ohio"},
            "response": {"hits": "ohio-fixture"},
        }), encoding="utf-8")
        (tmp / "iowa.json").write_text(json.dumps({
            "tool": "record_search",
            "args": {"args.q": "Iowa"},
            "response": {"hits": "iowa-fixture"},
        }), encoding="utf-8")
        server, call_log, tools_by_name = create_mock_server(
            ["ohio", "iowa"], tmp
        )
        result = _invoke(tools_by_name, "record_search", {"q": "Ohio"})
        body = _extract_response_dict(result)
        assert body["hits"] == "ohio-fixture"
        assert call_log[0]["matched"]["kind"] == "predicate"
        assert call_log[0]["expected_args"] == {"args.q": "Ohio"}

        result2 = _invoke(tools_by_name, "record_search", {"q": "Iowa"})
        body2 = _extract_response_dict(result2)
        assert body2["hits"] == "iowa-fixture"
        assert call_log[1]["expected_args"] == {"args.q": "Iowa"}


def test_unmatched_call_returns_fixture_not_found_error():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "only.json").write_text(json.dumps({
            "tool": "record_search",
            "args": {"args.q": "Ohio"},
            "response": {"hits": "ohio"},
        }), encoding="utf-8")
        server, call_log, tools_by_name = create_mock_server(["only"], tmp)
        result = _invoke(tools_by_name, "record_search", {"q": "Texas"})
        body = _extract_response_dict(result)
        assert body.get("error") == "fixture_not_found"
        # No fixture matched → matched.kind == "none" and expected_args is null.
        assert call_log[0]["matched"]["kind"] == "none"
        assert call_log[0]["expected_args"] is None
        assert call_log[0]["response_fixture"] is None


def test_fixture_without_args_is_rejected():
    """Spec change: `args` is now required on every fixture. The mock
    server constructor surfaces the InvalidFixtureError at build time."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "noargs.json").write_text(json.dumps({
            "tool": "record_search",
            "response": {"hits": "x"},
        }), encoding="utf-8")
        with pytest.raises(InvalidFixtureError):
            create_mock_server(["noargs"], tmp)


def test_fixture_input_schema_honored_for_tool_absent_from_build():
    """A fixture-provided input_schema is the escape hatch for aspirational
    tools that have fixtures but no compiled .ts source. For a tool absent
    from the build, the fixture's declared schema is advertised verbatim."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "typed.json").write_text(json.dumps({
            "tool": "future_tool_not_in_build",
            "args": {"query": "X"},
            "input_schema": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
            "response": {"title": "X"},
        }), encoding="utf-8")
        server, _, tools_by_name = create_mock_server(["typed"], tmp)
        tool_obj = tools_by_name["future_tool_not_in_build"]
        assert tool_obj.input_schema["required"] == ["query"]
        assert "query" in tool_obj.input_schema["properties"]


@pytest.mark.requires_engine_build
def test_build_schema_advertised_for_fixture_backed_tool():
    """The core of the drift fix: a fixture-backed tool that exists in the
    compiled build advertises the real production input schema, not a
    permissive stub. Regression for rx_007/008 (match-tool fixtures had no
    schema, so the model probed with `{}`). Skips gracefully if the build
    is absent (the loader degrades to a permissive schema, no schema to
    assert)."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        # A fixture with NO input_schema of its own — the schema must come
        # from the build, not the permissive fallback.
        (tmp / "match.json").write_text(json.dumps({
            "tool": "record_person_matches",
            "args": {"id": "9XKV-ABC"},
            "response": {"matches": []},
        }), encoding="utf-8")
        server, _, tools_by_name = create_mock_server(["match"], tmp)
        schema = tools_by_name["record_person_matches"].input_schema
        # Real production schema: `id` is required and it is not the
        # permissive `additionalProperties: True` fallback.
        assert schema.get("required") == ["id"]
        assert schema.get("additionalProperties") is not True


@pytest.mark.requires_engine_build
def test_live_tool_advertises_build_schema():
    """Live tools pull their input schema from the same build catalog. The
    `ops` batch array on research_append is the field the old hand-maintained
    mirror once dropped — assert it is advertised. Skips if the build is
    absent."""
    # Live tools register regardless of fixtures, so any fixture set works.
    server, _, tools_by_name = create_mock_server(
        ["wikipedia-search-schuylkill-county"], FIXTURES_DIR
    )
    schema = tools_by_name["research_append"].input_schema
    assert "ops" in schema["properties"]
    assert schema["properties"]["ops"]["type"] == "array"


@pytest.mark.requires_engine_build
def test_record_search_folds_in_ranked_when_subject_given(tmp_path):
    """record_search ranks host-side when given a subjectId, so the mock must
    compose the test's own rank fixture in — otherwise a skill that correctly
    passes subjectId gets nothing to triage and grades badly for it.

    Skips when the build is absent, like the two tests above: staging runs
    through the COMPILED stager, so with no build `staged` is never set and
    this fails for an environmental reason rather than a real one."""
    server, call_log, tools_by_name = create_mock_server(
        ["record-search-1850-census-flynn", "rank-search-matches-flynn-census"],
        FIXTURES_DIR,
        workspace=tmp_path,
    )
    result = _invoke(
        tools_by_name,
        "record_search",
        {
            "surname": "Flynn",
            "givenName": "Patrick",
            "projectPath": str(tmp_path),
            "subjectId": "I1",
        },
    )
    body = _extract_response_dict(result)
    assert body.get("staged"), "staging must still happen"
    assert "ranked" in body, "ranking should be folded into the search response"
    assert body["ranked"]["subjectId"] == "I1"
    assert body["ranked"]["matches"], "the test's own rank fixture supplies the matches"


def test_record_search_omits_ranked_without_subject(tmp_path):
    """No subjectId means no ranking — the same shape the real tool returns."""
    server, call_log, tools_by_name = create_mock_server(
        ["record-search-1850-census-flynn", "rank-search-matches-flynn-census"],
        FIXTURES_DIR,
        workspace=tmp_path,
    )
    result = _invoke(
        tools_by_name,
        "record_search",
        {"surname": "Flynn", "givenName": "Patrick", "projectPath": str(tmp_path)},
    )
    body = _extract_response_dict(result)
    assert "ranked" not in body
    # ...and the mock says so, the way the real tool does. Without this the
    # nudge is invisible to every unit test and cannot be graded at all.
    assert body["rankingSkipped"] == RANKING_SKIPPED_NOTE
    # Before `results`, which is the property that survives a size bound.
    keys = list(body)
    assert keys.index("rankingSkipped") < keys.index("results")


def test_record_search_omits_ranking_skipped_once_a_subject_is_named(tmp_path):
    """The note's contract is "no subject was named" — never "ranking ran"."""
    server, call_log, tools_by_name = create_mock_server(
        ["record-search-1850-census-flynn", "rank-search-matches-flynn-census"],
        FIXTURES_DIR,
        workspace=tmp_path,
    )
    result = _invoke(
        tools_by_name,
        "record_search",
        {
            "surname": "Flynn",
            "givenName": "Patrick",
            "projectPath": str(tmp_path),
            "subjectId": "I1",
        },
    )
    assert "rankingSkipped" not in _extract_response_dict(result)


def test_record_search_omits_ranking_skipped_without_a_project(tmp_path):
    """No projectPath means nothing was on offer to skip."""
    server, call_log, tools_by_name = create_mock_server(
        ["record-search-1850-census-flynn"], FIXTURES_DIR, workspace=tmp_path
    )
    result = _invoke(
        tools_by_name,
        "record_search",
        {"surname": "Flynn", "givenName": "Patrick"},
    )
    assert "rankingSkipped" not in _extract_response_dict(result)


def test_ranking_skipped_note_has_not_drifted_from_the_typescript_source():
    """The mock's copy and the tool's must stay byte-identical.

    They cannot share a definition — TypeScript on the host, Python in the
    harness — and a stale copy is silent: the eval would grade the skill against
    a nudge production no longer sends.
    """
    src = (
        REPO_ROOT / "packages/engine/mcp-server/src/tools/record-search.ts"
    ).read_text(encoding="utf-8")
    decl = re.search(r"const RANKING_SKIPPED_NOTE =(.*?);\n", src, re.DOTALL)
    assert decl, "RANKING_SKIPPED_NOTE is gone from record-search.ts"
    ts_note = "".join(re.findall(r'"((?:[^"\\]|\\.)*)"', decl.group(1)))
    assert ts_note, "parsed an empty note — the declaration's shape changed"
    assert ts_note == RANKING_SKIPPED_NOTE


def test_unlogged_search_notes_have_not_drifted_from_the_typescript_source():
    """Both #2056 notes must stay byte-identical to the compiled source.

    Same rule as the ranking note above, and the same silent failure mode: a stale
    copy grades the skill against wording production no longer sends. These two live
    in the staging util rather than the tool, because both search tools emit them.
    """
    src = (
        REPO_ROOT / "packages/engine/mcp-server/src/utils/results-staging.ts"
    ).read_text(encoding="utf-8")
    for name, expected in (
        ("UNLOGGED_SEARCHES_NOTE", UNLOGGED_SEARCHES_NOTE),
        ("NIL_SEARCH_NEEDS_LOG_NOTE", NIL_SEARCH_NEEDS_LOG_NOTE),
    ):
        decl = re.search(rf"const {name} =(.*?);\n", src, re.DOTALL)
        assert decl, f"{name} is gone from results-staging.ts"
        ts_note = "".join(re.findall(r'"((?:[^"\\]|\\.)*)"', decl.group(1)))
        assert ts_note, f"parsed an empty note for {name} — the declaration shape changed"
        # The TS source escapes the inner quotes of `outcome: "negative"`; Python's
        # own literal does not, so unescape before comparing.
        assert ts_note.replace('\\"', '"') == expected


def test_fixture_with_matches_but_no_mapped_results_is_not_nil():
    """The mock's nil gate must match production's, which requires a zero total.

    `results` is the post-`mapEntry` set in production, so a page that fails mapping
    empties it while the upstream total stays non-zero. A mock that emitted the note
    there would fire where production does not, and then a zero firing count could
    not be read as "the condition never held".
    """
    assert _fixture_is_nil({"totalMatches": 0, "results": []})
    assert _fixture_is_nil({"results": []})  # no total declared → claims no matches
    assert not _fixture_is_nil({"totalMatches": 812, "results": []})
    assert not _fixture_is_nil({"totalResults": 812, "results": []})
    assert not _fixture_is_nil({"totalForPlace": 3, "results": []})
    assert not _fixture_is_nil({"totalMatches": 0, "results": [{"id": "x"}]})


def test_unlogged_refs_shown_has_not_drifted_from_the_typescript_source():
    """The refs formatter is restated in Python; nothing else guards the two copies.

    The pairing rule is called out of the compiled build precisely so it cannot
    drift. This constant could, and the note's text would then differ from
    production's at the boundary rather than obviously.
    """
    src = (
        REPO_ROOT / "packages/engine/mcp-server/src/utils/results-staging.ts"
    ).read_text(encoding="utf-8")
    decl = re.search(r"const UNLOGGED_REFS_SHOWN = (\d+);", src)
    assert decl, "UNLOGGED_REFS_SHOWN is gone from results-staging.ts"
    assert int(decl.group(1)) == UNLOGGED_REFS_SHOWN


def test_staging_tool_sets_agree_across_the_two_copies():
    """`STAGING_SEARCH_TOOLS` here vs `STAGING_CAPABLE_TOOLS` in the engine.

    The engine consolidated its own two copies for exactly this reason ("a second
    copy would drift"); this is the third, and it lives in another language.
    """
    from harness.mock_mcp import STAGING_SEARCH_TOOLS

    src = (
        REPO_ROOT / "packages/engine/mcp-server/src/utils/results-staging.ts"
    ).read_text(encoding="utf-8")
    decl = re.search(
        r"export const STAGING_CAPABLE_TOOLS = new Set\(\[(.*?)\]\)", src, re.DOTALL
    )
    assert decl, "STAGING_CAPABLE_TOOLS is gone from results-staging.ts"
    ts_tools = set(re.findall(r'"([a-z_]+)"', decl.group(1)))
    assert ts_tools == STAGING_SEARCH_TOOLS


def test_nil_search_carries_the_negative_log_note(tmp_path):
    """The emission CONDITION, not the text — a text-only test passes on a wrong gate."""
    server, call_log, tools_by_name = create_mock_server(
        ["record-search-patrick-flynn-no-results"], FIXTURES_DIR, workspace=tmp_path
    )
    body = _extract_response_dict(
        _invoke(
            tools_by_name,
            "record_search",
            {"surname": "Flynn", "givenName": "Patrick", "projectPath": str(tmp_path)},
        )
    )
    assert body["nilSearchNeedsLog"] == NIL_SEARCH_NEEDS_LOG_NOTE
    # Ordered ahead of `results`, like every other model-facing note.
    keys = list(body)
    assert keys.index("nilSearchNeedsLog") < keys.index("results")


def test_no_log_note_without_a_project_path(tmp_path):
    """Neither note fires when the caller passed no projectPath — nothing is owed."""
    server, call_log, tools_by_name = create_mock_server(
        ["record-search-patrick-flynn-no-results"], FIXTURES_DIR, workspace=tmp_path
    )
    body = _extract_response_dict(
        _invoke(tools_by_name, "record_search", {"surname": "Flynn", "givenName": "Patrick"})
    )
    assert "nilSearchNeedsLog" not in body
    assert "unloggedSearches" not in body


def test_record_search_omits_ranked_when_test_declares_no_rank_fixture(tmp_path):
    """A fabricated ranking would be worse than none — the absence is honest."""
    server, call_log, tools_by_name = create_mock_server(
        ["record-search-1850-census-flynn"], FIXTURES_DIR, workspace=tmp_path
    )
    result = _invoke(
        tools_by_name,
        "record_search",
        {
            "surname": "Flynn",
            "givenName": "Patrick",
            "projectPath": str(tmp_path),
            "subjectId": "I1",
        },
    )
    body = _extract_response_dict(result)
    assert "ranked" not in body


# --- Returned-failure visibility (mirrors src/tool-result.ts) ------------------
#
# The production dispatch marks a returned `{ok: false}` as `isError`; this
# harness bypasses that dispatch entirely, so without the mirror a failed write
# would read as an error in production and a SUCCESS in every unit eval run.
#
# Every case below builds the server with NO workspace, which makes each live
# handler take its `_ws is None` short-circuit and return `{"ok": False, ...}`
# with no node call and no build — fast, and needs no fixtures.

# Derived from the gate set itself, never hand-copied: a ninth tool added to
# OK_FALSE_IS_FAILURE_LIVE is exercised here automatically. A parallel list would
# leave the new tool unasserted while the drift lint below still passed, since
# that lint pins the set's membership rather than each tool's behaviour.
@pytest.mark.parametrize("tool_name", sorted(OK_FALSE_IS_FAILURE_LIVE))
def test_returned_failure_sets_is_error(tool_name):
    """A tool that reports failure by RETURNING must not read as a success."""
    server, call_log, tools_by_name = create_mock_server([], FIXTURES_DIR)
    result = _invoke(tools_by_name, tool_name, {})
    body = _extract_response_dict(result)
    assert body.get("ok") is False, f"{tool_name} did not take its no-workspace path"
    assert result.get("is_error") is True, (
        f"{tool_name} returned ok:false but the envelope carries no is_error — "
        "the model and the guardrail detectors would read it as a success"
    )


def test_merge_warnings_failure_does_not_set_is_error():
    """The exclusion, and the only thing anywhere that checks it survived.

    `merge_warnings` shares `_make_compiled_tool_handler` with six tools that ARE
    marked, so a gate written on `response["ok"]` instead of the tool name would
    silently flip it. Its `ok: false` is a dry-run verdict about a merge — the
    tool working — so marking it would tell the agent a good preview had crashed.
    """
    server, call_log, tools_by_name = create_mock_server([], FIXTURES_DIR)
    result = _invoke(tools_by_name, "merge_warnings", {})
    assert _extract_response_dict(result).get("ok") is False
    assert "is_error" not in result


def test_successful_call_carries_no_is_error(tmp_path):
    """`is_error` is set on failure only — a success keeps its original shape."""
    server, call_log, tools_by_name = create_mock_server(
        [], FIXTURES_DIR, workspace=tmp_path
    )
    (tmp_path / "research.json").write_text(
        json.dumps({"project": {"id": "rp_x"}, "questions": []}), encoding="utf-8"
    )
    result = _invoke(tools_by_name, "research_query", {"section": "questions"})
    # Assert the call SUCCEEDED before asserting anything about a success. Guarding
    # the assertion on `ok is not False` instead makes the test vacuous the moment
    # the call starts failing — `section: "project"` is not a valid section, so this
    # test passed without ever executing its assertion.
    assert (
        _extract_response_dict(result).get("ok") is True
    ), "the call must succeed for this test to be asserting anything"
    assert "is_error" not in result


def test_ok_false_gate_set_has_not_drifted_from_the_typescript_source():
    """The Python gate set must equal OK_FALSE_IS_FAILURE ∩ LIVE_TOOLS.

    An identity, not byte-equality: three of the TypeScript names have no live
    handler here, so the Python side is necessarily a proper subset. Comparing
    the intersection makes those fall out automatically instead of needing a
    hand-maintained exemption list — and still fails if a twelfth tool is added
    on the TypeScript side and never mirrored, which is the drift that would
    otherwise be silent.
    """
    src = (
        REPO_ROOT / "packages/engine/mcp-server/src/tool-result.ts"
    ).read_text(encoding="utf-8")
    decl = re.search(r"OK_FALSE_IS_FAILURE = \[(.*?)\]", src, re.DOTALL)
    assert decl, "OK_FALSE_IS_FAILURE is gone from tool-result.ts"
    ts_names = set(re.findall(r'"([a-z_]+)"', decl.group(1)))
    assert ts_names, "parsed an empty list — the declaration's shape changed"
    assert ts_names & LIVE_TOOLS == OK_FALSE_IS_FAILURE_LIVE


def test_no_project_answer_is_not_marked_is_error():
    """Mirrors `writerToolResult`'s one ok:false exemption (issue #1695).

    A user who is simply not in a research project gets an answer, not a fault.
    Without this mirror the unit tier would show an error where production shows
    an answer — the exact drift `_tool_envelope` exists to prevent.
    """
    envelope = _tool_envelope(
        "research_append",
        {"ok": False, "reason": "no_project", "errors": ["not a project"]},
    )
    assert "is_error" not in envelope


def test_ordinary_returned_failure_is_still_marked_is_error():
    """The other half — without it the test above would pass on a gate that had
    stopped marking anything at all."""
    envelope = _tool_envelope("research_append", {"ok": False, "errors": ["bad"]})
    assert envelope["is_error"] is True


def test_record_search_response_is_compacted_once_staged(tmp_path):
    """The mock must apply the SAME post-staging compaction the real tool does.

    Without it the agent is handed `gedcomx`, `collectionUrl` and a per-row
    `collectionTitle` that production deletes, and every unit test grading
    triage or tool usage is scored against a shape production never sends
    (#2009 — the same class as #1826's `textDocument`). The mock runs the
    compiled `compactStagedRecordSearch` rather than restating it in Python,
    so there is no second copy to drift.

    Skips only when the compiled module is absent — an environmental reason.
    It must NOT skip on `staged` being falsy: a compactor name that no longer
    resolves in the build makes the node import throw, the staging helper
    swallows it, and staging silently stops. Keying the skip on that symptom
    would mute this test on exactly the failure it exists to catch.
    """
    fixture = json.loads(
        (FIXTURES_DIR / "record-search-1850-census-flynn.json").read_text(
            encoding="utf-8"
        )
    )
    raw_rows = (fixture.get("response") or fixture).get("results") or []
    # Guards the assertions below against silently passing on a fixture that
    # was already written in the compacted shape — then this test would prove
    # nothing. If this trips, point it at a fixture that still carries them.
    assert any(
        "gedcomx" in row or "collectionTitle" in row for row in raw_rows
    ), "fixture no longer carries the fields production strips"

    server, call_log, tools_by_name = create_mock_server(
        ["record-search-1850-census-flynn"], FIXTURES_DIR, workspace=tmp_path
    )
    result = _invoke(
        tools_by_name,
        "record_search",
        {"surname": "Flynn", "givenName": "Patrick", "projectPath": str(tmp_path)},
    )
    if not COMPACTOR_JS.exists():
        pytest.skip("compiled MCP build absent")
    body = _extract_response_dict(result)
    assert body.get("staged"), (
        "the compiled module is present but nothing staged — compaction never ran"
    )

    for row in body["results"]:
        assert "gedcomx" not in row
        assert "collectionUrl" not in row
        assert "collectionTitle" not in row, "hoisted into response-level collections"
        assert row.get("treeMatches") != [], "empty treeMatches is dropped"
    # The hoist landed, and the field the re-ranker needs survived.
    assert body["collections"], "per-row titles hoist into one response-level map"
    assert all(row.get("primaryId") for row in body["results"])


def test_unstaged_record_search_is_not_compacted(tmp_path):
    """The other half. Compaction is only correct once the sidecar holds the
    full payload — an exploratory search with no `projectPath` retains nothing,
    so stripping its inline results would destroy the only copy."""
    server, call_log, tools_by_name = create_mock_server(
        ["record-search-1850-census-flynn"], FIXTURES_DIR, workspace=tmp_path
    )
    result = _invoke(
        tools_by_name, "record_search", {"surname": "Flynn", "givenName": "Patrick"}
    )
    body = _extract_response_dict(result)
    assert not body.get("staged")
    assert any("gedcomx" in row for row in body["results"]), (
        "an un-staged search keeps full fidelity inline"
    )
