"""Tests for harness.mock_mcp — in-process MCP fixture server.

These tests exercise the handler logic directly (bypassing the SDK) so they
stay fast and don't require network. Real SDK integration is covered by the
e2e test.
"""

import asyncio
import json
import re
import subprocess
import tempfile
from pathlib import Path

import pytest

from harness import mock_mcp
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
from harness.orchestrator import _build_warnings


REPO_ROOT = Path(__file__).resolve().parents[4]
FIXTURES_DIR = REPO_ROOT / "eval/fixtures/mcp"
BUILD_TOOLS = REPO_ROOT / "packages/engine/mcp-server/build/tools"
BUILD_SCHEMAS_JS = (
    REPO_ROOT / "packages/engine/mcp-server/build/tool-schemas.js"
)
COMPACTOR_JS = (
    REPO_ROOT / "packages/engine/mcp-server/build/utils/staged-compaction.js"
)


def _extract_response_dict(handler_result):
    """The mock handler returns {'content': [{'type':'text','text': '<json>'}]}."""
    return json.loads(handler_result["content"][0]["text"])


def _invoke(tools_by_name, tool_name: str, args: dict):
    """Invoke a mock tool handler directly, bypassing the SDK transport."""
    return asyncio.run(tools_by_name[tool_name].handler(args))


def _seed_project(tmp_path):
    """A minimal project with one tree person, enough for person_warnings."""
    (tmp_path / "research.json").write_text(
        json.dumps({"project": {"id": "rp_x"}, "questions": []}), encoding="utf-8"
    )
    (tmp_path / "tree.gedcomx.json").write_text(
        json.dumps(
            {
                "persons": [
                    {"id": "I1", "names": [{"full_text": "Test Person"}], "facts": []}
                ],
                "relationships": [],
            }
        ),
        encoding="utf-8",
    )


def test_person_warnings_runs_live_when_no_fixture_declared(tmp_path):
    """The bug this closes: `person_warnings` was fixture-backed only, and no
    person-evidence test declares a `person-warnings-*` fixture, so every call
    in every committed person-evidence run log since August reported the tool
    missing. The skill launched; the impossibility check never ran. It computes
    every tag from the workspace tree and holds zero `getValidToken` calls, so
    a live handler is both possible and more faithful than a canned answer.
    """
    _seed_project(tmp_path)
    server, call_log, tools_by_name = create_mock_server(
        [], FIXTURES_DIR, workspace=tmp_path
    )
    assert "person_warnings" in tools_by_name
    body = _extract_response_dict(_invoke(tools_by_name, "person_warnings", {"personId": "I1"}))
    assert "warningCount" in body, f"expected a real computation, got {body}"


def test_a_declared_fixture_beats_the_live_handler(tmp_path):
    """`person_warnings` is the only tool in both LIVE_TOOLS and the fixture
    corpus. The check-warnings suite drives it from fixtures tuned to specific
    tag combinations, so the test's own declaration must win — otherwise going
    live for everyone else would silently retune that suite. Registering both
    would define the name twice and the second would shadow the first, so the
    live loop skips what the fixtures already cover.
    """
    _seed_project(tmp_path)
    server, call_log, tools_by_name = create_mock_server(
        ["person-warnings-early-marriage"], FIXTURES_DIR, workspace=tmp_path
    )
    body = _extract_response_dict(_invoke(tools_by_name, "person_warnings", {"personId": "I1"}))
    issues = [w.get("issueType") for w in body.get("warnings") or []]
    assert "hasEarlyMarriage14" in issues, (
        f"the canned fixture must win over the live handler; got {issues}"
    )


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


@pytest.mark.requires_engine_build
def test_record_search_drops_inline_results_when_ranked_replaces_them(tmp_path):
    """`ranked` replaces the inline rows rather than shipping beside them (#1212).

    The mock must send the shape production sends: a mock that keeps `results`
    grades triage against a payload the agent never receives, which is the
    #1826/#2009 failure the post-staging-path rule exists to prevent.

    The verdict comes from the compiled `dropInlineResultsWhenRanked`, so this
    also pins that the mock is calling it rather than restating the condition.
    """
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
    assert body["ranked"]["matches"], "fixture must supply a usable ranking"
    assert body["ranked"].get("subjectResolvable") is not False
    assert "results" not in body, (
        "ranked carries these rows; shipping `results` too is the duplication "
        "#1212 removed"
    )
    # The rows are still reachable — dropped from the inline block, not lost.
    assert body.get("staged"), "the sidecar still holds the full-fidelity rows"


@pytest.mark.requires_engine_build
def test_dropped_results_do_not_take_the_triage_fields_with_them(tmp_path):
    """The rank fixtures are lean; `results` is not. Dropping one without
    projecting the other hands the agent strictly less than production sends.

    Caught by a real eval run, not by reasoning: `ut_search_records_014`
    regressed pass -> fail because the household `events` the skill needs for
    the Step-4 age cross-check lived only on the dropped `results` row. All 16
    committed rank fixtures are lean, because they were authored when `ranked`
    shipped ALONGSIDE `results`.
    """
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
    assert "results" not in body, "precondition: this fixture pair drops results"

    # The fixture's own stubs carry none of these; they must arrive by
    # projection from the rows that were dropped.
    carried = [
        m
        for m in body["ranked"]["matches"]
        if any(k in m for k in ("events", "collectionId", "recordTitle", "treeMatches"))
    ]
    assert carried, (
        "every triage field vanished with `results` — the agent is being graded "
        "on less than production would send it"
    )


@pytest.mark.requires_engine_build
def test_record_search_keeps_inline_results_on_a_scoreable_no_match(tmp_path):
    """The arm a length-only drop condition gets wrong (#1212).

    `subjectResolvable: false` with POPULATED matches means "the subject is
    scoreable and nothing in this pool matches it" — the rows exist but every
    score sits at or below the degenerate floor. Dropping `results` here would
    leave the agent holding search order wearing match scores, which is the
    silent degradation the withheld branch exists to refuse.

    The mock must reproduce that, or no unit eval can ever grade the skill's
    response to a genuine negative against the payload production sends.
    """
    server, call_log, tools_by_name = create_mock_server(
        ["record-search-1850-census-flynn", "rank-search-matches-pool-has-no-match"],
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
    assert body["ranked"]["subjectResolvable"] is False
    assert body["ranked"]["matches"], "this branch returns the matches, unlike the withheld one"
    assert body.get("results"), (
        "a ranking the caller must not triage on does not replace the inline "
        "rows — dropping them here hands back search order wearing match scores"
    )


def test_record_search_keeps_inline_results_when_no_ranking_is_folded(tmp_path):
    """No rank fixture -> no `ranked` -> `results` must survive untouched.

    The complement of the test above, and the arm that fails if the drop is
    ever made unconditional on a subject being named.
    """
    server, call_log, tools_by_name = create_mock_server(
        ["record-search-1850-census-flynn"],
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
    assert "ranked" not in body
    assert body.get("results"), "with no ranking, the inline rows are all there is"


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


@pytest.mark.requires_engine_build
def test_fulltext_search_strips_textDocument_once_staged(tmp_path):
    """Mirrors fulltext_search.ts's own strip (issue #1826): once staging
    succeeds, the inline textDocument must not reach the agent — the fixture's
    canned response carries it unconditionally (pre-strip upstream shape), so
    the mock must strip it the same way the real tool does.

    Skips when the build is absent, like the record_search staging tests
    above: staging runs through the COMPILED stager, so with no build
    `staged` is never set and this fails for an environmental reason rather
    than a real one."""
    server, call_log, tools_by_name = create_mock_server(
        ["fulltext-search-flynn-witnesses"], FIXTURES_DIR, workspace=tmp_path
    )
    result = _invoke(
        tools_by_name,
        "fulltext_search",
        {"keywords": "+Flynn", "projectPath": str(tmp_path)},
    )
    body = _extract_response_dict(result)
    assert body.get("staged"), "test assumes staging succeeded — check the build"
    assert "textDocument" not in body["results"][0]
    # The remaining triage stubs survive the strip.
    assert body["results"][0].get("names")
    assert body["results"][0].get("highlightTerms")


def test_fulltext_search_keeps_textDocument_when_not_staged(tmp_path):
    """No projectPath -> nothing staged -> nothing to strip (matches the real
    tool's `if (out.staged)` guard — never strips an un-staged search)."""
    server, call_log, tools_by_name = create_mock_server(
        ["fulltext-search-flynn-witnesses"], FIXTURES_DIR, workspace=tmp_path
    )
    result = _invoke(tools_by_name, "fulltext_search", {"keywords": "+Flynn"})
    body = _extract_response_dict(result)
    assert "staged" not in body
    assert "textDocument" in body["results"][0]


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


def test_mapping_failure_response_does_not_get_the_negative_log_note(tmp_path):
    """The WIRING, not the predicate.

    `_fixture_is_nil`'s own unit tests prove the predicate; nothing proved the
    call site uses it. Reverting that call site to `not response.get("results")`
    leaves the whole suite green, because the only committed fixture routed
    through dispatch has `totalMatches: 0`, where both conditions agree. The
    discriminating shape is built here rather than committed: it exists to
    exercise this branch, not to describe a real search.
    """
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    (fixtures / "unmappable-page.json").write_text(
        json.dumps(
            {
                "tool": "record_search",
                "args": {"surname": "Flynn"},
                "response": {"query": {"surname": "Flynn"}, "totalMatches": 812, "results": []},
            }
        ),
        encoding="utf-8",
    )
    workspace = tmp_path / "ws"
    workspace.mkdir()
    server, call_log, tools_by_name = create_mock_server(
        ["unmappable-page"], fixtures, workspace=workspace
    )
    body = _extract_response_dict(
        _invoke(
            tools_by_name,
            "record_search",
            {"surname": "Flynn", "projectPath": str(workspace)},
        )
    )
    assert body["totalMatches"] == 812
    assert body["results"] == []
    assert "nilSearchNeedsLog" not in body


# --- Node-subprocess timeout budget + visibility (#2025) --------------------
#
# The mock caps every `node --input-type=module --eval` subprocess. Under
# concurrency a live writer tool (a genealogist's `research_append` /
# `extraction_append` batch) occasionally trips a too-tight cap, the model sees
# a write failure and recovers by splitting the batch, and the run is then
# graded down for the recovery. These pin (a) the raised cap on the workspace-
# I/O paths vs the default on the graceful catalog probe, and (b) that a trip
# is surfaced as a run-log warning instead of living only inside a response
# string nobody greps.


class _NodeEvalSpy:
    """Stand-in for `_run_node_eval` recording the timeout each call was given.

    Signature default mirrors the real function so a caller that omits `timeout`
    (the catalog probe) records the default, and one that passes the raised
    budget (a writer) records that — the contrast is the assertion.
    """

    def __init__(self, stdout: str = "{}", raise_timeout: bool = False):
        self.timeouts: list[int] = []
        self._stdout = stdout
        self._raise = raise_timeout

    def __call__(self, script, input_str=None, timeout=mock_mcp.NODE_EVAL_TIMEOUT_DEFAULT):
        self.timeouts.append(timeout)
        if self._raise:
            raise subprocess.TimeoutExpired(cmd=["node"], timeout=timeout)
        return subprocess.CompletedProcess(
            args=["node"], returncode=0, stdout=self._stdout, stderr=""
        )


@pytest.mark.skipif(
    not (BUILD_TOOLS / "research-append.js").exists(),
    reason="engine build required for the live research_append handler",
)
def test_live_writer_handler_uses_long_node_timeout(tmp_path, monkeypatch):
    """A live writer's node subprocess gets NODE_EVAL_TIMEOUT_LONG, not the default."""
    spy = _NodeEvalSpy(stdout='{"ok": true}')
    monkeypatch.setattr(mock_mcp, "_run_node_eval", spy)
    _server, _log, tools_by_name = create_mock_server([], FIXTURES_DIR, workspace=tmp_path)
    # Isolate the handler call from any catalog-probe call during server setup.
    spy.timeouts.clear()
    _invoke(
        tools_by_name,
        "research_append",
        {"projectPath": str(tmp_path), "section": "assertions", "entries": []},
    )
    assert spy.timeouts == [mock_mcp.NODE_EVAL_TIMEOUT_LONG]


@pytest.mark.skipif(
    not BUILD_SCHEMAS_JS.exists(),
    reason="engine build required for the catalog probe",
)
def test_catalog_probe_uses_default_node_timeout(monkeypatch):
    """The catalog probe degrades gracefully and stays on the fast default (#2025)."""
    spy = _NodeEvalSpy(stdout="[]")
    monkeypatch.setattr(mock_mcp, "_run_node_eval", spy)
    mock_mcp._load_build_tool_catalog_uncached()
    assert spy.timeouts == [mock_mcp.NODE_EVAL_TIMEOUT_DEFAULT]


@pytest.mark.skipif(
    not (BUILD_TOOLS / "research-append.js").exists(),
    reason="engine build required for the live research_append handler",
)
def test_node_timeout_is_recorded_and_surfaced_as_warning(tmp_path, monkeypatch):
    """A tripped node subprocess lands in the live response AND a run-log warning."""
    spy = _NodeEvalSpy(raise_timeout=True)
    monkeypatch.setattr(mock_mcp, "_run_node_eval", spy)
    _server, call_log, tools_by_name = create_mock_server([], FIXTURES_DIR, workspace=tmp_path)
    _invoke(
        tools_by_name,
        "research_append",
        {"projectPath": str(tmp_path), "section": "assertions", "entries": []},
    )

    live = [c for c in call_log if c["tool"].endswith("research_append")]
    assert live, "research_append call not recorded in the call log"
    errors = live[-1]["response"].get("errors") or []
    assert any(mock_mcp.NODE_EVAL_TIMEOUT_PATTERN.search(e) for e in errors), errors

    warnings = _build_warnings(call_log)
    timeout_warnings = [w for w in warnings if w["kind"] == "harness_node_timeout"]
    assert len(timeout_warnings) == 1, [w["kind"] for w in warnings]
    assert any("research_append" in t for t in timeout_warnings[0]["tools"])


def test_upstream_fetch_timeout_is_not_flagged_as_a_harness_timeout():
    """The engine's fetchWithTimeout says '...ms'; subprocess.TimeoutExpired says
    'seconds'. Only the latter is a harness flake. A real upstream FamilySearch
    timeout, folded into the same {ok: false} shape by a network-calling live
    tool, must NOT be excused with 'do not grade the recovery as a skill error' —
    that would hide a genuine failure behind a harness excuse."""
    upstream = {
        "tool": "mcp__genealogy__research_append",
        "args": {},
        "matched": {"kind": "live", "index": None},
        "response": {
            "ok": False,
            "errors": ["research_append: Request to https://x timed out after 30000ms."],
        },
    }
    warnings = _build_warnings([upstream])
    assert not any(w["kind"] == "harness_node_timeout" for w in warnings)
