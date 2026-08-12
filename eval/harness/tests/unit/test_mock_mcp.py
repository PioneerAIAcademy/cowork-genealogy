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
    OK_FALSE_IS_FAILURE_LIVE,
    RANKING_SKIPPED_NOTE,
    create_mock_server,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
FIXTURES_DIR = REPO_ROOT / "eval/fixtures/mcp"


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

_GATE_SET_TOOLS = [
    "research_append",
    "extraction_append",
    "research_log_append",
    "tree_edit",
    "tree_correct",
    "materialize_facts",
    "project_context",
    "research_query",
]


@pytest.mark.parametrize("tool_name", _GATE_SET_TOOLS)
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
        json.dumps({"project": {"id": "rp_x"}}), encoding="utf-8"
    )
    result = _invoke(tools_by_name, "research_query", {"section": "project"})
    if _extract_response_dict(result).get("ok") is not False:
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
