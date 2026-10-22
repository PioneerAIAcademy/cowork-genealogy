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
    echo_query,
)
from harness.orchestrator import _build_warnings
from harness.ts_consts import ts_string_list


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


def test_is_error_fixture_sets_is_error_only_on_its_own_match():
    """A fixture marked `is_error` answers with the flag production's catch arms
    set on a thrown error; a sibling fixture of the same tool, unmarked, does not."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "refused.json").write_text(json.dumps({
            "tool": "image_transcribe",
            "args": {"imageId": "004452257_00021"},
            "is_error": True,
            "response": {"error": "Image cap reached: ..."},
        }), encoding="utf-8")
        (tmp / "ok.json").write_text(json.dumps({
            "tool": "image_transcribe",
            "args": {"imageId": "~"},
            "response": {"transcription": "page text"},
        }), encoding="utf-8")
        server, call_log, tools_by_name = create_mock_server(["refused", "ok"], tmp)
        refused = _invoke(tools_by_name, "image_transcribe", {"imageId": "004452257_00021"})
        assert refused.get("is_error") is True
        assert _extract_response_dict(refused) == {"error": "Image cap reached: ..."}
        ok = _invoke(tools_by_name, "image_transcribe", {"imageId": "004452257_00001"})
        assert "is_error" not in ok


def test_error_fixture_without_the_flag_keeps_its_old_envelope():
    """Opt-in: an unmarked `{error}` fixture still answers with no flag."""
    server, call_log, tools_by_name = create_mock_server(
        ["wikipedia-search-hollow-creek-error"], FIXTURES_DIR
    )
    result = _invoke(tools_by_name, "wikipedia_search", {"query": "Hollow Creek"})
    assert "error" in _extract_response_dict(result)
    assert "is_error" not in result


@pytest.mark.parametrize("fixture, why", [
    ({"is_error": "true", "response": {"error": "x"}}, "must be a boolean"),
    ({"is_error": True, "response": {"error": "x", "code": 1}}, "exactly"),
    ({"is_error": True, "response": {"transcription": "x"}}, "exactly"),
    ({"is_error": True, "response": {"error": 503}}, "exactly"),
])
def test_is_error_fixture_must_carry_the_thrown_error_envelope(fixture, why):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "bad.json").write_text(json.dumps({
            "tool": "image_transcribe", "args": {"imageId": "~"}, **fixture,
        }), encoding="utf-8")
        with pytest.raises(InvalidFixtureError, match=why):
            create_mock_server(["bad"], tmp)


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
    # Under the #1212 ruling the rank fixture's rows are annotated onto
    # `results` and `ranked` keeps metadata only — one row list, never two.
    assert "matches" not in body["ranked"]
    assert body["results"], "the annotated rows are where the matches now live"
    assert any(r.get("matchScore") is not None for r in body["results"])


@pytest.mark.requires_engine_build
def test_record_search_annotates_results_and_reorders_them(tmp_path):
    """#1212 ruling (2026-09-15): one row list, never two.

    The mock must serve production's shape — rows annotated with the match score
    and returned best first — because the skill's triage is graded on what it
    sees. Serving un-annotated rows grades triage on data production would
    really have sent."""
    server, call_log, tools_by_name = create_mock_server(
        ["record-search-1850-census-flynn", "rank-search-matches-flynn-census"],
        FIXTURES_DIR,
        workspace=tmp_path,
    )
    body = _extract_response_dict(
        _invoke(
            tools_by_name,
            "record_search",
            {
                "surname": "Flynn",
                "givenName": "Patrick",
                "projectPath": str(tmp_path),
                "subjectId": "I1",
            },
        )
    )
    rows = body["results"]
    scored = [r for r in rows if r.get("matchScore") is not None]
    assert scored, "the rank fixture's scores must reach the rows"
    # Best first, and every scored row keeps its original search position so the
    # re-ordering is auditable rather than lossy.
    ranks = [r["matchRank"] for r in scored]
    assert ranks == sorted(ranks), f"rows must be ordered by matchRank, got {ranks}"
    assert all(r.get("searchRank") is not None for r in scored)
    assert "matches" not in body["ranked"], "`ranked` carries metadata only"


def test_record_search_never_drops_results(tmp_path):
    """The drop conditional is gone with the ruling: rows always come back.

    Previously three separate tests pinned the branches of a four-way
    conditional deciding when `results` could be removed. There is no decision
    now, so the property to hold is simply that it never disappears."""
    server, call_log, tools_by_name = create_mock_server(
        ["record-search-1850-census-flynn", "rank-search-matches-flynn-census"],
        FIXTURES_DIR,
        workspace=tmp_path,
    )
    for args in (
        {"surname": "Flynn", "givenName": "Patrick", "projectPath": str(tmp_path), "subjectId": "I1"},
        {"surname": "Flynn", "givenName": "Patrick", "projectPath": str(tmp_path)},
    ):
        body = _extract_response_dict(_invoke(tools_by_name, "record_search", args))
        assert body.get("results"), f"results must survive for args={sorted(args)}"


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
    """`STAGING_SEARCH_TOOLS` here vs `STAGING_SEARCH_TOOLS` in the engine.

    The engine consolidated its own two copies for exactly this reason ("a second
    copy would drift"); this is the third, and it lives in another language.

    Compared against the engine's SEARCH set, not its wider `STAGING_CAPABLE_TOOLS`
    (issue #2048): `image_transcribe`, `record_read` and `person_read` stage in
    production but their canned fixtures carry no `results[]` (`person_read` is
    staged by its own path, `_stage_person_read`, issue #2944), and the mock's nil-search /
    unlogged-search notes are search semantics — keying them on the wider set
    would stamp `nilSearchNeedsLog` onto every transcription fixture. The second
    assertion pins the relation the split relies on: every search producer is a
    capable producer. That parity gap is recorded in eval/CLAUDE.md, "Eval vs
    production parity".
    """
    from harness.mock_mcp import STAGING_SEARCH_TOOLS

    src = (
        REPO_ROOT / "packages/engine/mcp-server/src/utils/results-staging.ts"
    ).read_text(encoding="utf-8")
    search_decl = re.search(
        r"export const STAGING_SEARCH_TOOLS = new Set\(\[(.*?)\]\)", src, re.DOTALL
    )
    assert search_decl, "STAGING_SEARCH_TOOLS is gone from results-staging.ts"
    ts_search = set(re.findall(r'"([a-z_]+)"', search_decl.group(1)))
    assert ts_search == STAGING_SEARCH_TOOLS

    capable_decl = re.search(
        r"export const STAGING_CAPABLE_TOOLS = new Set\(\[(.*?)\]\)", src, re.DOTALL
    )
    assert capable_decl, "STAGING_CAPABLE_TOOLS is gone from results-staging.ts"
    capable_body = capable_decl.group(1)
    assert "...STAGING_SEARCH_TOOLS" in capable_body, (
        "STAGING_CAPABLE_TOOLS must be built from STAGING_SEARCH_TOOLS (spread), "
        "so the search producers cannot drop out of the capable set"
    )
    ts_extra = set(re.findall(r'"([a-z_]+)"', capable_body))
    assert ts_extra == {"image_transcribe", "record_read", "person_read"}


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


# --- The search response echoes the call's args (mirrors echoQuery) -----------

_ECHO_ARGS = {
    "surname": "Flynn",
    "givenName": "Patrick",
    "recordType": "census",
    "residencePlace": "Schuylkill, Pennsylvania, United States",
    "birthPlace": None,
}


def test_record_search_query_echoes_the_call_not_the_fixture(tmp_path):
    """Production returns `query: echoQuery(input)`. A fixture's canned query was
    recorded for other args, and its predicate matches only a subset, so serving
    it verbatim told the agent it sent filters it did not (and hid ones it did)."""
    server, call_log, tools_by_name = create_mock_server(
        ["record-search-1850-census-flynn"], FIXTURES_DIR, workspace=tmp_path
    )
    body = _extract_response_dict(_invoke(tools_by_name, "record_search", dict(_ECHO_ARGS)))
    assert "error" not in body, body
    assert body["query"] == _ECHO_ARGS


def test_fulltext_search_query_echoes_the_call_not_the_fixture(tmp_path):
    server, call_log, tools_by_name = create_mock_server(
        ["fulltext-search-flynn-witnesses"], FIXTURES_DIR, workspace=tmp_path
    )
    args = {"keywords": "+Flynn", "place": "Pennsylvania", "yearFrom": None}
    body = _extract_response_dict(_invoke(tools_by_name, "fulltext_search", args))
    assert body["query"] == args


@pytest.mark.requires_engine_build
def test_staged_record_search_payload_carries_the_echoed_query(tmp_path):
    """The staged payload is research_log_append's ground truth for which filters
    a call sent; it must be the echo, not the fixture's recorded query."""
    server, call_log, tools_by_name = create_mock_server(
        ["record-search-1850-census-flynn"], FIXTURES_DIR, workspace=tmp_path
    )
    args = {**_ECHO_ARGS, "projectPath": str(tmp_path)}
    body = _extract_response_dict(_invoke(tools_by_name, "record_search", args))
    assert body.get("staged"), "test assumes staging succeeded — check the build"
    envelope = json.loads((tmp_path / body["staged"]["resultsRef"]).read_text(encoding="utf-8"))
    assert envelope["payload"]["query"] == args


def test_echo_query_keeps_every_sent_argument_including_null():
    """echoQuery drops only `undefined`; a JSON null reaches it as null and is kept."""
    args = {"a": None, "b": 0, "c": "", "d": False, "e": "x"}
    echoed = echo_query(args)
    assert echoed == args
    assert echoed is not args  # a copy: the staged payload must not alias the call log


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


def test_sidecar_read_runs_live_against_the_workspace(tmp_path):
    """The live arm reads the WORKSPACE's own evaluations/ file — a canned
    fixture could only drift from what the mentor actually wrote. Also pins
    the module path / export symbol the arm names, which nothing else checks:
    a typo there is `build not found` at eval time, graded as the skill's
    fault. Skips only when the compiled build is absent (environmental)."""
    if not (BUILD_TOOLS / "sidecar-read.js").exists():
        pytest.skip("compiled MCP build absent")
    _seed_project(tmp_path)
    (tmp_path / "evaluations").mkdir()
    (tmp_path / "evaluations" / "proof-critique-ps_001.json").write_text(
        json.dumps({"verdict": "not craft", "note": "Kraków"}), encoding="utf-8"
    )
    server, call_log, tools_by_name = create_mock_server(
        [], FIXTURES_DIR, workspace=tmp_path
    )
    result = _invoke(
        tools_by_name,
        "sidecar_read",
        {"projectPath": "/somewhere/else", "ref": "evaluations/proof-critique-ps_001.json"},
    )
    body = _extract_response_dict(result)
    assert body.get("ok") is True, body
    assert json.loads(body["content"]) == {"verdict": "not craft", "note": "Kraków"}
    assert body["truncated"] is False
    assert "is_error" not in result
    assert call_log[-1]["matched"] == {"kind": "live", "index": None}

    missing = _invoke(
        tools_by_name, "sidecar_read", {"ref": "evaluations/nope.json"}
    )
    assert _extract_response_dict(missing).get("reason") == "not_found"
    assert missing.get("is_error") is True


def test_census_children_gap_runs_live(tmp_path):
    """The compiled tool computes the answer, not a canned fixture: the
    check-warnings and question-selection tests grade exactly this arithmetic.
    Also pins the module path / export symbol `_COMPILED_TOOLS` names, which the
    OK_FALSE drift lint cannot see (a tool absent from both sets passes it)."""
    if not (BUILD_TOOLS / "census-children-gap.js").exists():
        pytest.skip("compiled MCP build absent")
    server, call_log, tools_by_name = create_mock_server(
        [], FIXTURES_DIR, workspace=tmp_path
    )
    mercer = {
        "censuses": [
            {"year": 1900, "childrenBorn": 6, "childrenLiving": 5},
            {"year": 1910, "childrenBorn": 8, "childrenLiving": 7},
        ],
        "knownChildren": [
            {"birthDate": y} for y in ("1886", "1888", "1891", "1894", "1897", "1906")
        ],
    }
    result = _invoke(tools_by_name, "census_children_gap", mercer)
    body = _extract_response_dict(result)
    assert body.get("ok") is True, body
    assert body["totalMissing"] == 2
    assert {g["kind"] for g in body["missing"]} == {
        "died_before_1900",
        "born_between_living_1910",
    }
    assert "is_error" not in result
    assert call_log[-1]["matched"] == {"kind": "live", "index": None}

    malformed = _invoke(
        tools_by_name,
        "census_children_gap",
        {"censuses": [{"year": 1890, "childrenBorn": 1, "childrenLiving": 1}]},
    )
    assert _extract_response_dict(malformed).get("ok") is False
    assert malformed.get("is_error") is True


def test_census_children_gap_tree_mode_reads_the_workspace_tree(tmp_path):
    """Tree mode (motherId) reads the mother's children from the WORKSPACE's
    tree via the injected projectPath -- what check-warnings' census tests grade.
    Also pins `_COMPILED_TOOLS` at the async `censusChildrenGapTool` export: the
    sync `censusChildrenGap` would ignore motherId and see no children."""
    if not (BUILD_TOOLS / "census-children-gap.js").exists():
        pytest.skip("compiled MCP build absent")
    (tmp_path / "research.json").write_text(
        json.dumps({"project": {"id": "rp_001"}}), encoding="utf-8"
    )
    births = {"C1": "1889", "C2": "1891", "C3": "1893", "C4": "1896", "C5": "1898", "W6": "1906"}
    persons = [{"id": "M", "gender": "Female", "facts": []}] + [
        {"id": pid, "facts": [{"id": f"F{pid}", "type": "Birth", "date": y, "standard_date": y}]}
        for pid, y in births.items()
    ]
    relationships = [
        {"id": f"R{pid}", "type": "ParentChild", "parent": "M", "child": pid} for pid in births
    ]
    (tmp_path / "tree.gedcomx.json").write_text(
        json.dumps({"persons": persons, "relationships": relationships, "sources": []}),
        encoding="utf-8",
    )
    server, call_log, tools_by_name = create_mock_server(
        [], FIXTURES_DIR, workspace=tmp_path
    )
    result = _invoke(
        tools_by_name,
        "census_children_gap",
        {
            "motherId": "M",
            "censuses": [
                {"year": 1900, "childrenBorn": 6, "childrenLiving": 5},
                {"year": 1910, "childrenBorn": 8, "childrenLiving": 7},
            ],
        },
    )
    body = _extract_response_dict(result)
    assert body.get("ok") is True, body
    assert body["totalMissing"] == 2
    assert [c["personId"] for c in body["knownChildrenUsed"]] == list(births)
    assert call_log[-1]["matched"] == {"kind": "live", "index": None}


def test_ok_false_gate_set_has_not_drifted_from_the_typescript_source():
    """The Python gate set must equal OK_FALSE_IS_FAILURE ∩ LIVE_TOOLS.

    An identity, not byte-equality: three of the TypeScript names have no live
    handler here, so the Python side is necessarily a proper subset. Comparing
    the intersection makes those fall out automatically instead of needing a
    hand-maintained exemption list — and still fails if a twelfth tool is added
    on the TypeScript side and never mirrored, which is the drift that would
    otherwise be silent.
    """
    # `ts_string_list` raises on a missing or empty declaration, so a renamed or
    # reshaped constant fails here rather than comparing against nothing.
    ts_names = set(ts_string_list("OK_FALSE_IS_FAILURE"))
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
    not (BUILD_TOOLS / "person-warnings.js").exists(),
    reason="engine build required for the live person_warnings handler",
)
def test_person_warnings_runs_with_place_lookups_disabled(tmp_path, monkeypatch):
    """The live person_warnings call passes a resolver that resolves nothing, so
    its birthplace-distance check never reaches the Places API (issue #1962)."""
    scripts: list[str] = []
    spy = _NodeEvalSpy(stdout='{"warnings": []}')

    def _recording(script, input_str=None, timeout=mock_mcp.NODE_EVAL_TIMEOUT_DEFAULT):
        scripts.append(script)
        return spy(script, input_str, timeout)

    monkeypatch.setattr(mock_mcp, "_run_node_eval", _recording)
    _server, _log, tools_by_name = create_mock_server([], FIXTURES_DIR, workspace=tmp_path)
    scripts.clear()
    _invoke(tools_by_name, "person_warnings", {"projectPath": str(tmp_path), "personId": "I1"})
    assert len(scripts) == 1
    assert "personWarningsTool(input, { placeCoords: async () => null })" in scripts[0]


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


def _pq_tree(tmp_path, persons):
    (tmp_path / "tree.gedcomx.json").write_text(json.dumps({"persons": persons}), encoding="utf-8")


def _pq(tmp_path, fixtures, args):
    _server, call_log, tools_by_name = create_mock_server(fixtures, FIXTURES_DIR, workspace=tmp_path)
    text = _invoke(tools_by_name, "person_quality", args)["content"][0]["text"]
    return json.loads(text), call_log[-1]


PATRICK = {"id": "I1", "names": [{"given": "Patrick", "surname": "Flynn", "preferred": True}]}


def test_person_quality_registration_and_no_principal():
    """Served by its own handler; never given LOCAL, so no path can read the
    developer's own FamilySearch tokens."""
    from harness.mock_mcp import _COMPILED_TOOLS, _COMPILED_TOOLS_WITH_PRINCIPAL, LIVE_TOOLS

    assert "person_quality" in LIVE_TOOLS  # allowed_tools exempts LIVE_TOOLS members
    assert "person_quality" not in _COMPILED_TOOLS
    assert "person_quality" not in _COMPILED_TOOLS_WITH_PRINCIPAL


def test_person_quality_registered_with_and_without_fixtures(tmp_path):
    for fixtures in ([], ["person-quality-hole-christian"]):
        _server, _log, tools_by_name = create_mock_server(fixtures, FIXTURES_DIR, workspace=tmp_path)
        assert "person_quality" in tools_by_name, fixtures


def test_person_quality_unlinked_person_gets_the_tools_real_sentence(tmp_path):
    _pq_tree(tmp_path, [PATRICK])
    response, entry = _pq(tmp_path, [], {"personId": "I1", "projectPath": "/p"})
    assert response["reason"] == "not_familysearch_id"
    assert response["errors"] == ["Patrick Flynn isn't linked to FamilySearch, so there's no FamilySearch quality score."]
    assert entry["matched"]["kind"] == "live"


def test_person_quality_linked_person_answered_from_a_fixture_keyed_on_the_resolved_id(tmp_path):
    """The fixture is keyed KD96-TV2; the call is made with I1. It must be
    logged live with expected_args None — the judge fails a wrong identifier,
    and I1 is the correct argument here."""
    _pq_tree(tmp_path, [dict(PATRICK, ark="ark:/61903/4:1:KD96-TV2")])
    response, entry = _pq(tmp_path, ["person-quality-hole-christian"], {"personId": "I1", "projectPath": "/p"})
    assert "reason" not in response and "overallScore" in response, response
    assert entry["matched"]["kind"] == "live"
    assert entry["expected_args"] is None
    assert entry["response_fixture"] and not str(entry["response_fixture"]).startswith("live:")


def test_person_quality_linked_person_without_a_fixture_is_refused_not_crashed(tmp_path):
    _pq_tree(tmp_path, [dict(PATRICK, ark="ark:/61903/4:1:MKVT-7XR")])
    response, entry = _pq(tmp_path, [], {"personId": "I1", "projectPath": "/p"})
    assert "MKVT-7XR" in response["errors"][0] and "Declare a person-quality fixture" in response["errors"][0]
    assert "resolution failed" not in response["errors"][0]
    assert entry["matched"]["kind"] == "none"  # the uncovered-call warning names it


def test_person_quality_without_projectpath_does_not_read_the_tree(tmp_path):
    """The workspace replaces a projectPath the skill sent; it is never
    supplied for one the skill left out. Otherwise a skill that drops the
    argument passes every eval while production answers every imported person
    with the neutral sentence instead of a score."""
    _pq_tree(tmp_path, [dict(PATRICK, ark="ark:/61903/4:1:KD96-TV2")])
    response, _entry = _pq(tmp_path, ["person-quality-hole-christian"], {"personId": "I1"})
    assert response["reason"] == "not_familysearch_id"
    assert response["errors"] == ["No FamilySearch quality score was retrieved for this person."]


def test_person_quality_familysearch_id_uses_its_fixture(tmp_path):
    """A real FS id still resolves to its captured fixture (the check-warnings
    tests that scored one were deleted with its person_quality use, #2118)."""
    response, entry = _pq(tmp_path, ["person-quality-hole-christian"], {"personId": "KD96-TV2"})
    assert "overallScore" in response
    assert entry["expected_args"] is None


def test_person_quality_familysearch_id_without_a_fixture_is_refused(tmp_path):
    response, entry = _pq(tmp_path, [], {"personId": "KD96-TV2"})
    assert "KD96-TV2" in response["errors"][0]
    assert entry["matched"]["kind"] == "none"


def test_stage_and_compact_degrades_on_node_failure(tmp_path, monkeypatch):
    """The `except` arm must ABSORB a node failure, not become one.

    HISTORY (2026-09-11): the arm returned six values while every other return,
    and the caller's unpack, took five -- so any node timeout raised
    `ValueError: too many values to unpack` from the very branch written to
    survive it. It stayed green because nothing reached the arm: the node call
    has to actually fail.

    The arity has since dropped to FOUR, when the always-False drop flag was
    removed. The number is deliberately not repeated in prose here beyond this
    line: what the test pins is that the arm agrees with the caller's unpack,
    whatever that count currently is, so it survives the next change to it.
    """
    from harness import mock_mcp

    def _boom(*a, **k):
        raise TimeoutError("node did not return in time")

    # Whatever the arm calls inside the try, make it raise.
    monkeypatch.setattr(mock_mcp.subprocess, "run", _boom, raising=False)

    response = {"results": [{"id": "r1"}]}
    ranked = {"matches": [{"recordId": "r1"}]}
    # Absorbed, but not silently: a staging fault must not read as the model's.
    with pytest.warns(UserWarning, match="staging/compaction failed"):
        out = mock_mcp._stage_and_compact_search_results(
            tmp_path, "record_search", response, ranked
        )

    assert len(out) == 4, f"the degrade arm must return four values, got {len(out)}"
    staged, resp, unlogged, rank = out                # the caller's unpack
    assert staged is None
    assert resp == response
    assert unlogged == []
    assert rank == ranked


# ─── same_person writes the attestation a real call would leave (#1731 PR B) ──
#
# `same_person` is not in LIVE_TOOLS, so the compiled tool never runs here and
# `recordMatchScore` never fires. That left `results/.scores/` empty in every
# unit run, which makes any writer-side gate that reads it untestable and makes
# it refuse everything. Same move as the search tools staging their sidecar.
#
# These pin the SCOPING as much as the write: attesting on the explicit
# two-document arm would let a unit run satisfy a gate production refuses,
# because that arm records nothing in production.

FIXTURES_DIR = Path(__file__).resolve().parents[3] / "fixtures" / "mcp"


def _score_workspace(tmp_path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "research.json").write_text(
        json.dumps(
            {
                "assertions": [
                    {"id": "a_001", "record_id": "1:1:ABCD-123",
                     "record_persona_id": "P1", "record_role": "principal"},
                    {"id": "a_002"},
                    {"id": "a_003", "record_id": "r2", "log_entry_id": "log_1",
                     "record_role": "principal"},
                ],
                "log": [{"id": "log_1", "tool": "fulltext_search",
                         "results_ref": "results/log_1.json"}],
            }
        ),
        encoding="utf-8",
    )
    (ws / "tree.gedcomx.json").write_text(
        json.dumps({"persons": [{"id": "I1"}]}), encoding="utf-8"
    )
    return ws


def _call_same_person(ws, args):
    _cfg, call_log, tools = mock_mcp.create_mock_server(
        ["same-person-flynn-degenerate"], FIXTURES_DIR, workspace=ws
    )
    asyncio.run(tools["same_person"].handler({"projectPath": str(ws), **args}))
    scores = ws / "results" / ".scores"
    written = sorted(scores.glob("*.json")) if scores.exists() else []
    return call_log, written


@pytest.mark.requires_engine_build
def test_same_person_attests_on_the_project_relative_arm(tmp_path):
    """The whole point: a fixture-served call leaves a real attestation."""
    ws = _score_workspace(tmp_path)
    call_log, written = _call_same_person(ws, {"assertionId": "a_001", "treePersonId": "I1"})
    assert len(written) == 1, "expected one results/.scores/ file"
    rec = json.loads(written[0].read_text(encoding="utf-8"))
    # Keyed on (assertion, tree person): the pair BOTH sides hold. Keying on the
    # party filed it under what the fetch resolved while the reader computes the
    # key from the assertion, so a real score became unfindable.
    entry = rec["scores"]["a_001|I1"]
    assert entry["record_id"] == "1:1:ABCD-123"
    assert entry["tree_person_id"] == "I1"
    assert entry["score"] == 0.005            # the fixture's own number
    assert entry["record_source"] == "record_read"   # persona id present
    assert call_log[-1]["attested"] is True


@pytest.mark.requires_engine_build
def test_same_person_does_not_attest_on_the_two_document_arm(tmp_path):
    """That arm records nothing in production, so attesting here would let a
    unit run satisfy a gate production would refuse."""
    ws = _score_workspace(tmp_path)
    _log, written = _call_same_person(
        ws,
        {"gedcomx1": {"persons": []}, "primaryId1": "X",
         "gedcomx2": {"persons": []}, "primaryId2": "I1"},
    )
    assert written == []


@pytest.mark.requires_engine_build
def test_same_person_does_not_attest_without_a_record_side(tmp_path):
    """No record_id means nothing to attest -- the same case samePerson refuses."""
    ws = _score_workspace(tmp_path)
    _log, written = _call_same_person(ws, {"assertionId": "a_002", "treePersonId": "I1"})
    assert written == []


@pytest.mark.requires_engine_build
def test_same_person_does_not_attest_for_an_unknown_assertion(tmp_path):
    ws = _score_workspace(tmp_path)
    _log, written = _call_same_person(ws, {"assertionId": "a_999", "treePersonId": "I1"})
    assert written == []


@pytest.mark.requires_engine_build
def test_same_person_does_not_attest_when_no_fixture_matched(tmp_path):
    """A fixture_not_found response is not a score. Uses a fixture whose
    predicate cannot match, so the handler falls through to the error."""
    ws = _score_workspace(tmp_path)
    _cfg, _log, tools = mock_mcp.create_mock_server(
        ["same-person-flynn-mother-distinctive-surname"], FIXTURES_DIR, workspace=ws
    )
    out = asyncio.run(
        tools["same_person"].handler(
            {"projectPath": str(ws), "assertionId": "a_001", "treePersonId": "I9"}
        )
    )
    assert "fixture_not_found" in json.dumps(out)
    scores = ws / "results" / ".scores"
    assert not scores.exists() or list(scores.glob("*.json")) == []


@pytest.mark.requires_engine_build
def test_same_person_attests_when_the_assertion_names_no_party(tmp_path):
    """An assertion with neither a persona id nor a role still attests.

    It did not when the key was the party: both empty meant nothing could look
    the score up, so `recordMatchScore` no-opped and the writer-side gate then
    refused a link whose call had been made. Keying on the assertion removes
    that whole class -- the assertion id is always present on this arm."""
    ws = _score_workspace(tmp_path)
    (ws / "research.json").write_text(
        json.dumps({"assertions": [{"id": "a_004", "record_id": "r3"}], "log": []}),
        encoding="utf-8",
    )
    _log, written = _call_same_person(ws, {"assertionId": "a_004", "treePersonId": "I1"})
    assert len(written) == 1
    rec = json.loads(written[0].read_text(encoding="utf-8"))
    assert "a_004|I1" in rec["scores"]


@pytest.mark.requires_engine_build
def test_same_person_attestation_records_a_projection_route(tmp_path):
    """record_source is the one field a mock cannot copy from the fetch, so it
    is derived. A full-text-sourced assertion is not fetchable."""
    ws = _score_workspace(tmp_path)
    _log, written = _call_same_person(ws, {"assertionId": "a_003", "treePersonId": "I1"})
    assert len(written) == 1
    rec = json.loads(written[0].read_text(encoding="utf-8"))
    entry = next(iter(rec["scores"].values()))
    assert entry["record_source"] == "projection"


# --- the attestation and the served answer name the persona production resolves --
#
# A fetched household: one record naming a child and her father. The harness
# performs no fetch, so what production resolves from a fetched `persons[]` has
# to come from the project documents, through the same compiled lookup.

_HH_RECORD = "ark:/61903/1:1:6LYF-G8RJ"


def _household_workspace(tmp_path):
    ws = tmp_path / "household"
    ws.mkdir()

    def assertion(id_, role, persona, fact_type, value, structured=None):
        return {
            "id": id_, "record_id": _HH_RECORD, "record_role": role,
            "record_persona_id": persona, "fact_type": fact_type, "value": value,
            "structured_value": structured, "record_basis": "stated",
            "log_entry_id": "log_1",
        }

    (ws / "research.json").write_text(
        json.dumps(
            {
                "log": [{"id": "log_1", "tool": "record_read",
                         "results_ref": "results/log_1.json"}],
                "assertions": [
                    assertion("a_031", "child", "p_child", "name", "Maria Elisabeth Mouchang"),
                    assertion("a_034", "father", "p_father", "name", "Pierre Mouchang"),
                    assertion("a_038", "child", "p_child", "relationship",
                              "child of Pierre Mouchang",
                              {"relationship_type": "child", "related_person_role": "father"}),
                ],
            }
        ),
        encoding="utf-8",
    )
    (ws / "tree.gedcomx.json").write_text(
        json.dumps(
            {
                "persons": [
                    {"id": "I1", "names": [{"given": "Pierre", "surname": "Mouchang",
                                            "preferred": True}]},
                    {"id": "I3", "names": [{"given": "Maria Elisabeth", "surname": "Mouchang",
                                            "preferred": True}]},
                ]
            }
        ),
        encoding="utf-8",
    )
    return ws


def _serve_same_person(ws, args, fixtures=("same-person-flynn-degenerate",), fixtures_dir=FIXTURES_DIR):
    """The answer the mock serves for one project-arm call, as the agent reads it."""
    _cfg, _log, tools = mock_mcp.create_mock_server(list(fixtures), fixtures_dir, workspace=ws)
    out = asyncio.run(tools["same_person"].handler({"projectPath": str(ws), **args}))
    return _extract_response_dict(out)


def _written_scores(ws):
    files = sorted((ws / "results" / ".scores").glob("*.json"))
    assert len(files) == 1, "expected one results/.scores/ file"
    return json.loads(files[0].read_text(encoding="utf-8"))["scores"]


def _synthetic_fixture(tmp_path, recorded_persona, recorded_tree_person):
    """A `~` fixture of the test's own, so what it was recorded with is known."""
    fixtures_dir = tmp_path / "fixtures"
    fixtures_dir.mkdir()
    (fixtures_dir / "same-person-synthetic.json").write_text(
        json.dumps(
            {
                "tool": "same_person",
                "description": "a `~` fixture for the overlay tests",
                "args": {"assertionId": "~", "treePersonId": "~"},
                "response": {
                    "matched": True, "confidence": 4, "score": 0.7,
                    "recordSource": "record_read", "recorded": True,
                    "recordPersona": recorded_persona, "treePerson": recorded_tree_person,
                },
            }
        ),
        encoding="utf-8",
    )
    return fixtures_dir


@pytest.mark.requires_engine_build
def test_same_person_attests_the_persona_of_the_requested_role(tmp_path):
    """A call for the father files the father's persona, as production does.

    The attestation used to file the assertion's own persona whatever role the
    call asked for: a child's persona under the role father."""
    ws = _household_workspace(tmp_path)
    _serve_same_person(
        ws, {"assertionId": "a_038", "treePersonId": "I1", "recordRole": "father"}
    )
    entry = _written_scores(ws)["a_038|I1"]
    assert entry["record_persona_id"] == "p_father"
    assert entry["record_role"] == "father"


@pytest.mark.requires_engine_build
def test_same_person_attests_an_explicit_record_persona_id(tmp_path):
    ws = _household_workspace(tmp_path)
    _serve_same_person(
        ws, {"assertionId": "a_034", "treePersonId": "I3", "recordPersonaId": "p_child"}
    )
    # The caller named the persona, so that is the persona, not the assertion's own.
    assert _written_scores(ws)["a_034|I3"]["record_persona_id"] == "p_child"


def _add_assertion(ws, assertion):
    """Append one assertion to a workspace's research.json."""
    path = ws / "research.json"
    research = json.loads(path.read_text(encoding="utf-8"))
    research["assertions"].append(assertion)
    path.write_text(json.dumps(research), encoding="utf-8")


def _father_assertion(id_, persona, value):
    return {
        "id": id_, "record_id": _HH_RECORD, "record_role": "father",
        "record_persona_id": persona, "fact_type": "name", "value": value,
        "structured_value": None, "record_basis": "stated", "log_entry_id": "log_1",
    }


@pytest.mark.requires_engine_build
def test_same_person_attests_the_role_the_named_persona_holds(tmp_path):
    """Naming a persona files the role the record gives THAT persona, and the
    answer served names the same role: the entry never lists the role asked
    beside another persona's id."""
    ws = _household_workspace(tmp_path)
    served = _serve_same_person(
        ws,
        {"assertionId": "a_038", "treePersonId": "I3", "recordRole": "father",
         "recordPersonaId": "p_child"},
    )
    entry = _written_scores(ws)["a_038|I3"]
    assert entry["record_persona_id"] == "p_child"
    assert entry["record_role"] == "child"
    assert served["recordPersona"]["role"] == entry["record_role"]


@pytest.mark.requires_engine_build
def test_same_person_attests_no_persona_the_record_gives_to_several_roles(tmp_path):
    """The record stamps the child's persona id on the father's assertion too. That
    id names no single party, so a call for the father files no persona, as
    production's lookup finds none, and the answer names the one group at the role."""
    ws = _household_workspace(tmp_path)
    research = json.loads((ws / "research.json").read_text(encoding="utf-8"))
    for a in research["assertions"]:
        if a["id"] == "a_034":
            a["record_persona_id"] = "p_child"
    (ws / "research.json").write_text(json.dumps(research), encoding="utf-8")
    served = _serve_same_person(
        ws, {"assertionId": "a_038", "treePersonId": "I1", "recordRole": "father"}
    )
    assert _written_scores(ws)["a_038|I1"]["record_persona_id"] is None
    assert served["recordPersona"] == {"id": None, "name": "Pierre Mouchang", "role": "father"}


@pytest.mark.requires_engine_build
def test_same_person_names_nobody_production_would_refuse(tmp_path):
    """Two fathers on the record: production refuses to choose between them, so the
    answer served does not name one."""
    ws = _household_workspace(tmp_path)
    _add_assertion(ws, _father_assertion("a_050", "p_other", "Johann Mouchang"))
    served = _serve_same_person(
        ws, {"assertionId": "a_038", "treePersonId": "I1", "recordRole": "father"}
    )
    assert served["recordPersona"] == {"id": None, "name": "", "role": "father"}


@pytest.mark.requires_engine_build
def test_same_person_serves_each_pairing_its_own_persona(tmp_path):
    """One `~` fixture answers every pairing its test makes. Each answer names
    the pair that call asked for, not the pair the fixture was recorded with."""
    ws = _household_workspace(tmp_path)
    fixtures_dir = _synthetic_fixture(
        tmp_path,
        {"id": "P1", "name": "Patrick Flynn", "role": "child_1"},
        {"id": "I1", "name": "Patrick Flynn"},
    )
    _cfg, _log, tools = mock_mcp.create_mock_server(
        ["same-person-synthetic"], fixtures_dir, workspace=ws
    )

    def call(args):
        out = asyncio.run(tools["same_person"].handler({"projectPath": str(ws), **args}))
        return _extract_response_dict(out)

    father = call({"assertionId": "a_038", "treePersonId": "I1", "recordRole": "father"})
    child = call({"assertionId": "a_031", "treePersonId": "I3"})

    assert father["recordPersona"] == {"id": "p_father", "name": "Pierre Mouchang", "role": "father"}
    assert father["treePerson"] == {"id": "I1", "name": "Pierre Mouchang"}
    assert child["recordPersona"] == {
        "id": "p_child", "name": "Maria Elisabeth Mouchang", "role": "child"
    }
    assert child["treePerson"] == {"id": "I3", "name": "Maria Elisabeth Mouchang"}
    # Only the persona and tree person are overlaid: the fixture's own score stands.
    assert father["score"] == child["score"] == 0.7


def _wildcard_same_person_fixtures():
    """Every committed same_person fixture that answers ANY pairing: both ids `~`."""
    out = []
    for path in sorted(FIXTURES_DIR.glob("same-person-*.json")):
        args = json.loads(path.read_text(encoding="utf-8"))["args"]
        if args == {"assertionId": "~", "treePersonId": "~"}:
            out.append(path.stem)
    return out


def test_there_are_wildcard_same_person_fixtures_to_check():
    # A parametrize over an empty list runs nothing and reports nothing wrong.
    assert len(_wildcard_same_person_fixtures()) >= 5


@pytest.mark.requires_engine_build
@pytest.mark.parametrize("fixture", _wildcard_same_person_fixtures())
def test_a_committed_wildcard_fixture_serves_each_pairing_its_own_persona(tmp_path, fixture):
    """The same, on the real fixtures: whichever `~` fixture a test loads, two
    pairings through it name two different pairs."""
    ws = _household_workspace(tmp_path)
    _cfg, _log, tools = mock_mcp.create_mock_server([fixture], FIXTURES_DIR, workspace=ws)

    def call(args):
        out = asyncio.run(tools["same_person"].handler({"projectPath": str(ws), **args}))
        return _extract_response_dict(out)

    father = call({"assertionId": "a_038", "treePersonId": "I1", "recordRole": "father"})
    child = call({"assertionId": "a_031", "treePersonId": "I3"})
    assert father["recordPersona"] == {"id": "p_father", "name": "Pierre Mouchang", "role": "father"}
    assert father["treePerson"] == {"id": "I1", "name": "Pierre Mouchang"}
    assert child["recordPersona"] == {
        "id": "p_child", "name": "Maria Elisabeth Mouchang", "role": "child"
    }
    assert child["treePerson"] == {"id": "I3", "name": "Maria Elisabeth Mouchang"}


@pytest.mark.requires_engine_build
def test_same_person_keeps_the_fixture_persona_when_the_documents_cannot_contradict_it(tmp_path):
    """A party the documents cannot name (no persona id, no name assertion) keeps
    the fixture's own persona on the one pairing the fixture was written for."""
    ws = tmp_path / "silent"
    ws.mkdir()
    (ws / "research.json").write_text(
        json.dumps({"assertions": [{"id": "a_005", "record_id": "r1", "record_role": "principal",
                                    "fact_type": "marriage", "value": "married",
                                    "record_persona_id": None, "record_basis": "stated"}],
                    "log": []}),
        encoding="utf-8",
    )
    (ws / "tree.gedcomx.json").write_text(
        json.dumps({"persons": [{"id": "I2", "names": [{"given": "Thomas", "surname": "Flynn"}]}]}),
        encoding="utf-8",
    )
    recorded = {"id": "MP1", "name": "Thomas Flynn", "role": "principal"}
    fixtures_dir = _synthetic_fixture(tmp_path, recorded, {"id": "I2", "name": "Thomas Flynn"})
    served = _serve_same_person(
        ws, {"assertionId": "a_005", "treePersonId": "I2"},
        fixtures=("same-person-synthetic",), fixtures_dir=fixtures_dir,
    )
    assert served["recordPersona"] == recorded


@pytest.mark.requires_engine_build
def test_same_person_does_not_borrow_the_fixture_persona_for_another_role(tmp_path):
    """The same silent documents, but the call asks for the bride: the fixture's
    persona is the principal, so it must not be served as hers."""
    ws = tmp_path / "silent"
    ws.mkdir()
    (ws / "research.json").write_text(
        json.dumps({"assertions": [{"id": "a_005", "record_id": "r1", "record_role": "principal",
                                    "fact_type": "marriage", "value": "married",
                                    "record_persona_id": None, "record_basis": "stated"}],
                    "log": []}),
        encoding="utf-8",
    )
    (ws / "tree.gedcomx.json").write_text(
        json.dumps({"persons": [{"id": "I2", "names": [{"given": "Mary", "surname": "Doyle"}]}]}),
        encoding="utf-8",
    )
    fixtures_dir = _synthetic_fixture(
        tmp_path, {"id": "MP1", "name": "Thomas Flynn", "role": "principal"},
        {"id": "I1", "name": "Thomas Flynn"},
    )
    served = _serve_same_person(
        ws, {"assertionId": "a_005", "treePersonId": "I2", "recordRole": "bride"},
        fixtures=("same-person-synthetic",), fixtures_dir=fixtures_dir,
    )
    assert served["recordPersona"] == {"id": None, "name": "", "role": "bride"}
    assert served["treePerson"] == {"id": "I2", "name": "Mary Doyle"}


@pytest.mark.requires_engine_build
def test_same_person_overlay_never_stops_the_attestation(tmp_path):
    """The overlay reads the tree, and a tree that cannot be read must cost the
    overlay only: the attestation is the side effect a writer-side gate reads, and
    the call log must still say it was written."""
    ws = _household_workspace(tmp_path)
    (ws / "tree.gedcomx.json").write_text("not json", encoding="utf-8")
    _cfg, call_log, tools = mock_mcp.create_mock_server(
        ["same-person-flynn-degenerate"], FIXTURES_DIR, workspace=ws
    )
    out = asyncio.run(
        tools["same_person"].handler(
            {"projectPath": str(ws), "assertionId": "a_034", "treePersonId": "I1"}
        )
    )
    assert "a_034|I1" in _written_scores(ws)
    assert call_log[-1]["attested"] is True
    # Nothing was overlaid, so the persona and the tree person are the fixture's own.
    # The score is no evidence of that: the overlay never touches it. What the
    # documents alone say for this call is the father (p_father), not the fixture's
    # child_1, so an overlay that ran despite the unreadable tree would show here.
    fixture = json.loads(
        (FIXTURES_DIR / "same-person-flynn-degenerate.json").read_text(encoding="utf-8")
    )["response"]
    served = _extract_response_dict(out)
    assert served["recordPersona"] == fixture["recordPersona"]
    assert served["treePerson"] == fixture["treePerson"]


@pytest.mark.requires_engine_build
def test_same_person_does_not_overlay_the_two_document_arm(tmp_path):
    """That arm names no assertion or tree person, so there is nothing to overlay."""
    ws = _household_workspace(tmp_path)
    fixtures_dir = tmp_path / "explicit"
    fixtures_dir.mkdir()
    response = {
        "matched": True, "score": 0.9,
        "queryArk": "ark:/61903/4:1:KGS8-LY1", "candidateArk": "ark:/61903/4:1:KCWM-J9H",
        "apiTitle": "Matches for ark:/61903/4:1:KGS8-LY1", "updated": "2026-05-15T01:58:23.913Z",
    }
    (fixtures_dir / "same-person-explicit.json").write_text(
        json.dumps({"tool": "same_person", "description": "the explicit arm",
                    "args": {"primaryId1": "~"}, "response": response}),
        encoding="utf-8",
    )
    _cfg, _log, tools = mock_mcp.create_mock_server(
        ["same-person-explicit"], fixtures_dir, workspace=ws
    )
    out = asyncio.run(
        tools["same_person"].handler(
            {"gedcomx1": {"persons": []}, "primaryId1": "X",
             "gedcomx2": {"persons": []}, "primaryId2": "I1"}
        )
    )
    assert _extract_response_dict(out) == response


# The overlay's merge rule, without a node process: the fixture's persona is
# served only when nothing the documents do say contradicts it.

_STATIC = {
    "recordPersona": {"id": "P1", "name": "Patrick Flynn", "role": "child_1"},
    "treePerson": {"id": "I1", "name": "Patrick Flynn"},
    "score": 0.5,
}


def test_overlay_parties_leaves_the_response_alone_when_there_is_nothing_to_overlay():
    assert mock_mcp._overlay_parties(_STATIC, None) == _STATIC
    assert mock_mcp._overlay_parties(_STATIC, {}) == _STATIC


def test_overlay_parties_serves_what_the_documents_say_when_it_differs_from_the_fixture():
    derived = {
        "recordPersona": {"id": "p_father", "name": "Pierre Mouchang", "role": "father"},
        "treePerson": {"id": "I9", "name": "Pierre Mouchang"},
    }
    out = mock_mcp._overlay_parties(_STATIC, derived)
    assert out["recordPersona"] == derived["recordPersona"]
    assert out["treePerson"] == derived["treePerson"]
    assert out["score"] == 0.5


def test_overlay_parties_keeps_a_fixture_value_the_documents_leave_empty():
    derived = {
        "recordPersona": {"id": None, "name": "", "role": "child_1"},
        "treePerson": {"id": "I1", "name": ""},
    }
    out = mock_mcp._overlay_parties(_STATIC, derived)
    assert out["recordPersona"] == _STATIC["recordPersona"]
    assert out["treePerson"] == _STATIC["treePerson"]


def test_overlay_parties_judges_the_record_persona_and_the_tree_person_separately():
    derived = {
        "recordPersona": {"id": None, "name": "", "role": "child_1"},   # silent: keep
        "treePerson": {"id": "I7", "name": "Someone Else"},             # contradicts: replace
    }
    out = mock_mcp._overlay_parties(_STATIC, derived)
    assert out["recordPersona"] == _STATIC["recordPersona"]
    assert out["treePerson"] == derived["treePerson"]


def test_overlay_parties_does_not_borrow_a_fixture_persona_held_for_another_role():
    derived = {
        "recordPersona": {"id": None, "name": "", "role": "mother"},
        "treePerson": {"id": "I1", "name": "Patrick Flynn"},
    }
    out = mock_mcp._overlay_parties(_STATIC, derived)
    assert out["recordPersona"] == derived["recordPersona"]


def test_overlay_parties_supplies_the_fields_a_fixture_lacks():
    derived = {
        "recordPersona": {"id": "P2", "name": "Anna", "role": "mother"},
        "treePerson": {"id": "I2", "name": "Anna"},
    }
    out = mock_mcp._overlay_parties({"score": 0.5}, derived)
    assert out["recordPersona"] == derived["recordPersona"]
    assert out["treePerson"] == derived["treePerson"]


# --- A canned live record_read stages, so extractor mode is reachable ----------
#
# Before this, the mock staged only search responses. A canned `record_read`
# returned no `staged.resultsRef`, extraction_append's extractor mode refused
# ("no results sidecar"), and every FamilySearch record in the unit suite fell
# back to record-extractor, so no committed run could exercise the code path.

_SCENARIO = REPO_ROOT / "eval/fixtures/scenarios/empty-project-just-created"


def _copy_scenario(tmp_path):
    for name in ("research.json", "tree.gedcomx.json"):
        (tmp_path / name).write_text(
            (_SCENARIO / name).read_text(encoding="utf-8"), encoding="utf-8"
        )


@pytest.mark.requires_engine_build
def test_live_record_read_stages_the_record_as_production_does(tmp_path):
    _copy_scenario(tmp_path)
    _s, _c, tools_by_name = create_mock_server(
        ["record-read-68Q9-K34P"], FIXTURES_DIR, workspace=tmp_path
    )
    body = _extract_response_dict(
        _invoke(tools_by_name, "record_read", {"recordId": "68Q9-K34P", "projectPath": str(tmp_path)})
    )
    assert body.get("staged"), body.get("stagingError")
    assert body["persons"], "the record itself still comes back inline"
    envelope = json.loads((tmp_path / body["staged"]["resultsRef"]).read_text(encoding="utf-8"))
    assert envelope["tool"] == "record_read"
    assert envelope["payload"]["query"] == {"recordId": "68Q9-K34P"}
    [element] = envelope["payload"]["results"]
    assert element["recordId"] == "68Q9-K34P"
    assert element["gedcomx"]["persons"] == body["persons"]
    assert "staged" not in element["gedcomx"]


@pytest.mark.requires_engine_build
def test_record_ids_are_served_from_record_read_fixtures(tmp_path):
    """The path the unit eval could not reach: one call reads the record (from
    its fixture), logs the read, and extracts it in code."""
    _copy_scenario(tmp_path)
    _s, _c, tools_by_name = create_mock_server(
        ["record-read-68Q9-K34P"], FIXTURES_DIR, workspace=tmp_path
    )
    out = _extract_response_dict(
        _invoke(
            tools_by_name,
            "extraction_append",
            {"projectPath": str(tmp_path), "recordIds": ["68Q9-K34P"]},
        )
    )
    assert out.get("ok"), out.get("errors")
    [record] = out["records"]
    assert record["status"] == "extracted", record
    assert record["logId"] and record["srcId"]
    assert "census" in record["summary"].lower(), record["summary"]


@pytest.mark.requires_engine_build
def test_record_read_stages_nothing_without_projectpath_or_with_resultsref(tmp_path):
    """The other direction: production stages only a LIVE read given a project."""
    _copy_scenario(tmp_path)
    _s, _c, tools_by_name = create_mock_server(
        ["record-read-68Q9-K34P"], FIXTURES_DIR, workspace=tmp_path
    )
    bare = _extract_response_dict(_invoke(tools_by_name, "record_read", {"recordId": "68Q9-K34P"}))
    assert "staged" not in bare
    sidecar = _extract_response_dict(
        _invoke(
            tools_by_name,
            "record_read",
            {"recordId": "68Q9-K34P", "projectPath": str(tmp_path), "resultsRef": "results/log_001.json"},
        )
    )
    assert "staged" not in sidecar
    assert not (tmp_path / "results" / ".staging").exists() or not any(
        (tmp_path / "results" / ".staging").iterdir()
    )


# --- person_read stages its canned response (#2944) ---------------------------

_PERSON_READ_ARGS = {"personId": "LZNY-BRF", "relatives": True, "sourceDescriptions": True}


@pytest.mark.requires_engine_build
def test_person_read_is_staged_when_given_project_path(tmp_path):
    """Production stages every `person_read` given a projectPath and returns
    `staged`; the mock does the same through the compiled `stagePersonRead`,
    so the staged document is the canned response itself."""
    fixture = json.loads(
        (FIXTURES_DIR / "person-read-flynn.json").read_text(encoding="utf-8")
    )["response"]
    server, call_log, tools_by_name = create_mock_server(
        ["person-read-flynn"], FIXTURES_DIR, workspace=tmp_path
    )
    body = _extract_response_dict(
        _invoke(
            tools_by_name,
            "person_read",
            {**_PERSON_READ_ARGS, "projectPath": str(tmp_path)},
        )
    )
    staged = body.get("staged")
    assert staged, f"no staged handle: {body.get('stagingError')!r}"
    assert staged["returnedCount"] == 1
    assert staged["resultsRef"].startswith("results/.staging/")
    envelope = json.loads((tmp_path / staged["resultsRef"]).read_text(encoding="utf-8"))
    assert envelope["tool"] == "person_read"
    assert envelope["payload"]["query"] == _PERSON_READ_ARGS
    assert envelope["payload"]["results"] == [
        {"personId": "LZNY-BRF", "gedcomx": fixture}
    ]
    # The rest of the response is the fixture, unchanged.
    assert {k: v for k, v in body.items() if k != "staged"} == fixture
    # `staged` leads, as production serializes it (#3384), so a truncated
    # preview of an over-limit response still carries the ref.
    assert next(iter(body)) == "staged"


@pytest.mark.parametrize("project_path", [None, "", "   "])
def test_person_read_is_not_staged_without_project_path(tmp_path, project_path):
    server, call_log, tools_by_name = create_mock_server(
        ["person-read-flynn"], FIXTURES_DIR, workspace=tmp_path
    )
    args = dict(_PERSON_READ_ARGS)
    if project_path is not None:
        args["projectPath"] = project_path
    body = _extract_response_dict(_invoke(tools_by_name, "person_read", args))
    assert "staged" not in body
    assert "stagingError" not in body
    assert not (tmp_path / "results").exists()


@pytest.mark.parametrize(
    "failure",
    ["raises", "empty_stdout", "nonzero_exit"],
)
def test_person_read_staging_degrades_on_node_failure(tmp_path, monkeypatch, failure):
    """A node fault is a harness fault, not a production staging failure: the
    canned response comes back unchanged, with no `staged` and no
    `stagingError` that would tell the agent staging failed."""
    from harness import mock_mcp

    def _fake_run(*a, **k):
        if failure == "raises":
            raise TimeoutError("node did not return in time")
        return subprocess.CompletedProcess(
            args=a, returncode=1 if failure == "nonzero_exit" else 0,
            stdout="" if failure == "empty_stdout" else '{"staged": {"resultsRef": "x", "returnedCount": 1}}',
            stderr="",
        )

    # A stub build, so the missing-build early return cannot make this pass
    # without ever reaching the node call it exists to test.
    stub_build = tmp_path / "build"
    (stub_build / "tools").mkdir(parents=True)
    (stub_build / "tools" / "person-read.js").write_text("", encoding="utf-8")
    monkeypatch.setattr(mock_mcp, "_MCP_BUILD", stub_build)
    calls = []

    def _counted(*a, **k):
        calls.append(1)
        return _fake_run(*a, **k)

    monkeypatch.setattr(mock_mcp, "_run_node_eval", _counted)
    response = {"persons": [{"id": "LZNY-BRF"}], "relationships": [], "sources": []}
    # A harness failure must say so: init-project stops when there is no ref.
    with pytest.warns(UserWarning, match="could not be staged"):
        out = mock_mcp._stage_person_read(
            tmp_path, {**_PERSON_READ_ARGS, "projectPath": str(tmp_path)}, response
        )
    assert calls, "the node call was never reached"
    assert out == response


def test_person_read_staging_warns_when_the_engine_build_is_missing(tmp_path, monkeypatch):
    """The commonest harness cause, and the one that used to be silent."""
    from harness import mock_mcp

    monkeypatch.setattr(mock_mcp, "_MCP_BUILD", tmp_path / "no-build")
    response = {"persons": [{"id": "LZNY-BRF"}], "relationships": [], "sources": []}
    with pytest.warns(UserWarning, match="no engine build"):
        out = mock_mcp._stage_person_read(
            tmp_path, {**_PERSON_READ_ARGS, "projectPath": str(tmp_path)}, response
        )
    assert out == response


def _hand_off_workspace(tmp_path):
    """A project whose log a builder hand-off can append to."""
    research = {
        "project": {"id": "rp_001", "objective": "T", "status": "active", "created": "2026-01-01", "updated": "2026-01-01"},
        "questions": [], "plans": [], "log": [], "sources": [], "assertions": [],
        "person_evidence": [], "conflicts": [], "hypotheses": [], "timelines": [],
        "proof_summaries": [], "evaluations": [],
    }
    (tmp_path / "research.json").write_text(json.dumps(research), encoding="utf-8")
    (tmp_path / "tree.gedcomx.json").write_text(
        json.dumps({"persons": [], "relationships": [], "sources": []}), encoding="utf-8"
    )
    return tmp_path


def _logged(ws):
    return json.loads((ws / "research.json").read_text(encoding="utf-8"))["log"]


@pytest.mark.requires_engine_build
def test_build_external_search_url_without_projectpath_writes_nothing(tmp_path):
    """The harness must not hand the builder a projectPath the agent never sent.

    Given one, the builder logs the hand-off itself; production never supplies
    it on the model's behalf, so injecting it would make every run of today's
    skill log each URL twice (its own step-4 entry plus the builder's).
    """
    ws = _hand_off_workspace(tmp_path)
    _cfg, _log, tools = create_mock_server([], FIXTURES_DIR, workspace=ws)
    out = _extract_response_dict(
        _invoke(tools, "build_external_search_url", {"site": "findagrave", "attributes": {"surname": "Flynn"}})
    )
    assert out["ok"] is True
    assert "logId" not in out
    assert _logged(ws) == []


@pytest.mark.requires_engine_build
def test_build_external_search_url_with_projectpath_writes_one_entry(tmp_path):
    """A projectPath the agent sent is rebased onto the workspace and honoured."""
    ws = _hand_off_workspace(tmp_path)
    _cfg, _log, tools = create_mock_server([], FIXTURES_DIR, workspace=ws)
    out = _extract_response_dict(
        _invoke(
            tools,
            "build_external_search_url",
            {"site": "findagrave", "attributes": {"surname": "Flynn"}, "projectPath": "/somewhere/else"},
        )
    )
    assert out["ok"] is True
    log = _logged(ws)
    assert [e["id"] for e in log] == [out["logId"]]
    assert log[0]["outcome"] == "partial"
    assert log[0]["external_site"]["url_generated"] == out["url"]


# ─── surnameVariantHints: production's own rule, computed per call (#3054) ───
#
# The mock runs the compiled `surnameVariantHints` on the arguments the model
# actually sent, inside the node process the call already spawns, so the agent
# sees what production would send and no fixture carries a hand-written copy.

_SURNAME_HINTS_JS = (
    REPO_ROOT / "packages/engine/mcp-server/build/utils/surname-variant-hints.js"
)
_HALSTEINS_NIL = "record-search-surname-not-abbreviated-zero-results"


def _hint_body(tmp_path, fixture, args):
    if not _SURNAME_HINTS_JS.exists():
        pytest.skip("compiled MCP build absent")
    server, call_log, tools_by_name = create_mock_server([fixture], FIXTURES_DIR, workspace=tmp_path)
    return _extract_response_dict(_invoke(tools_by_name, "record_search", args)), call_log


@pytest.mark.parametrize("with_project", [True, False])
def test_nil_datter_search_carries_production_surname_hint(tmp_path, with_project):
    """Both nil paths: with a projectPath (the hint rides the backlog process) and
    without one (the one path that spawns a process only for this)."""
    args = {"givenName": "Unna", "surname": "Halsteinsdatter", "collectionId": "1468080"}
    if with_project:
        args["projectPath"] = str(tmp_path)
    body, call_log = _hint_body(tmp_path, _HALSTEINS_NIL, args)

    hint = body.get("surnameVariantHints")
    assert hint, "the compiled module is present but no hint came back — the node call failed"
    assert hint["fields"] == [{
        "field": "surname",
        "searched": "Halsteinsdatter",
        "variants": ["Halsteinsdr", "Halsteinsdtr", "Halsteinsd"],
    }]
    keys = list(body)
    assert keys.index("surnameVariantHints") == keys.index("results") - 1
    # What the run log keeps is what the model saw.
    assert call_log[-1]["response"]["surnameVariantHints"] == hint


def test_hint_follows_the_call_not_the_fixture(tmp_path):
    """The same catch-all fixture answers an already-abbreviated surname, and
    production would offer nothing for it — neither may the mock."""
    body, _ = _hint_body(
        tmp_path,
        _HALSTEINS_NIL,
        {"givenName": "Urna", "surname": "Halsteinsdtr", "collectionId": "1468080"},
    )
    assert "surnameVariantHints" not in body


def test_spouse_surname_hint_names_its_field(tmp_path):
    body, _ = _hint_body(
        tmp_path,
        _HALSTEINS_NIL,
        {"surname": "Monsen", "spouseSurname": "Halsteinsdatter", "collectionId": "1468080"},
    )
    assert [e["field"] for e in body["surnameVariantHints"]["fields"]] == ["spouseSurname"]


def test_non_patronymic_nil_carries_no_surname_hint(tmp_path):
    body, _ = _hint_body(
        tmp_path,
        "record-search-patrick-flynn-no-results",
        {"surname": "Flynn", "givenName": "Patrick", "projectPath": str(tmp_path)},
    )
    assert "surnameVariantHints" not in body
    assert body["nilSearchNeedsLog"] == NIL_SEARCH_NEEDS_LOG_NOTE


def test_hit_carries_no_surname_hint(tmp_path):
    """A search that found something gets no hint — the trigger is 'did not find
    the subject', and this hit has no ranking to say otherwise."""
    body, _ = _hint_body(
        tmp_path,
        "record-search-urna-halsteinsdr-marriage-match",
        {"surname": "Halsteinsdr", "collectionId": "1468080", "projectPath": str(tmp_path)},
    )
    assert body.get("staged")
    assert "surnameVariantHints" not in body


def test_surname_hint_degrades_with_a_warning_on_node_failure(tmp_path, monkeypatch):
    """A harness fault must not look like the model ignoring the hint: no crash,
    no hint, and a warning that says why."""
    if not _SURNAME_HINTS_JS.exists():
        pytest.skip("compiled MCP build absent")

    def _boom(*a, **k):
        raise TimeoutError("node did not return in time")

    monkeypatch.setattr(mock_mcp.subprocess, "run", _boom, raising=False)
    with pytest.warns(UserWarning, match="surnameVariantHints"):
        hint = mock_mcp._surname_variant_hints(
            {"surname": "Halsteinsdatter"}, {"totalMatches": 0, "results": []}
        )
    assert hint is None

    with pytest.warns(UserWarning, match="nil-search node call failed"):
        unlogged, hint = mock_mcp._unlogged_staged_handles(
            tmp_path, args={"surname": "Halsteinsdatter"}, response={"totalMatches": 0}
        )
    assert (unlogged, hint) == ([], None)


@pytest.mark.parametrize(
    "platform, path, expected",
    [
        ("linux", "/home/x/build/tools/a.js", "/home/x/build/tools/a.js"),
        ("win32", "C:\\Users\\x\\build\\a.js", "file:///C:/Users/x/build/a.js"),
        ("linux", "/home/o'neil/a.js", "/home/o\\'neil/a.js"),
    ],
    ids=["posix-bare-path", "windows-file-url", "quote-escaped"],
)
def test_node_module_url_is_the_one_import_specifier(monkeypatch, platform, path, expected):
    monkeypatch.setattr(mock_mcp.sys, "platform", platform)
    assert mock_mcp._node_module_url(path) == expected


@pytest.mark.requires_engine_build
@pytest.mark.parametrize(
    "notes, refused",
    [
        ("One result: Patrick Flynn in household of Thomas Flynn and Mary Flynn.", True),
        (
            "One result: Patrick Flynn in one dwelling with Thomas and Mary Flynn; "
            "family structure inferred from surname, ages and order, not stated.",
            False,
        ),
    ],
    ids=["unhedged-refused", "hedged-logged"],
)
def test_live_log_append_applies_the_census_check_to_a_staged_1850_search(tmp_path, notes, refused):
    """The production census check runs on the eval write path: a staged 1850
    `record_search` logged with an unhedged household note is refused by the
    compiled `research_log_append`, and the hedged note is logged."""
    import shutil

    scenario = REPO_ROOT / "eval/fixtures/scenarios/flynn-first-plan"
    for name in ("research.json", "tree.gedcomx.json"):
        shutil.copy(scenario / name, tmp_path / name)
    server, call_log, tools_by_name = create_mock_server(
        ["record-search-1850-census-flynn"], FIXTURES_DIR, workspace=tmp_path
    )
    body = _extract_response_dict(
        _invoke(tools_by_name, "record_search", {**_ECHO_ARGS, "projectPath": str(tmp_path)})
    )
    ref = (body.get("staged") or {}).get("resultsRef")
    assert ref, "test assumes staging succeeded — check the build"
    result = _invoke(
        tools_by_name,
        "research_log_append",
        {
            "projectPath": str(tmp_path),
            "tool": "record_search",
            "outcome": "positive",
            "resultsExamined": 1,
            "stagedResultsRef": ref,
            "notes": notes,
        },
    )
    out = _extract_response_dict(result)
    if refused:
        assert out.get("ok") is False and result.get("is_error") is True, out
        assert "relationship-to-head" in json.dumps(out), out
    else:
        assert out.get("ok") is True, out
