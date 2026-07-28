"""Unit tests for scripts/check_rubric_tool_drift.py.

Covers the pure Path-in/set-out helpers the script's main() composes:
loading the tool vocabulary, finding whole-word tool mentions in prose,
parsing a skill's/agent's declared tools, and scanning rubric.md /
judge_context / agent bodies for mentions outside that declared set.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "check_rubric_tool_drift",
    Path(__file__).resolve().parents[2] / "scripts" / "check_rubric_tool_drift.py",
)
check_rubric_tool_drift = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(check_rubric_tool_drift)


def test_load_manifest_tools_reads_name_field(tmp_path: Path) -> None:
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps({"tools": [{"name": "record_search"}, {"name": "same_person"}]}),
        encoding="utf-8",
    )
    assert check_rubric_tool_drift.load_manifest_tools(manifest) == {
        "record_search",
        "same_person",
    }


def test_load_manifest_tools_missing_file_returns_none(tmp_path: Path) -> None:
    assert check_rubric_tool_drift.load_manifest_tools(tmp_path / "nope.json") is None


def test_find_mentions_matches_whole_word_only() -> None:
    vocabulary = {"record_search", "same_person"}
    text = "Call record_search first; record_searches is not a real tool."
    assert check_rubric_tool_drift.find_mentions(text, vocabulary) == {"record_search"}


def test_find_mentions_ignores_unmentioned_vocabulary() -> None:
    vocabulary = {"record_search", "same_person"}
    text = "This test only ever calls record_read."
    assert check_rubric_tool_drift.find_mentions(text, vocabulary) == set()


def test_declared_tools_parses_skill_frontmatter(tmp_path: Path) -> None:
    skill_md = tmp_path / "SKILL.md"
    skill_md.write_text(
        "---\n"
        "name: search-records\n"
        "allowed-tools:\n"
        "  - record_search\n"
        "  - mcp__genealogy__record_read\n"
        "---\n"
        "# body\n",
        encoding="utf-8",
    )
    assert check_rubric_tool_drift.declared_tools(skill_md) == [
        "record_search",
        "record_read",
    ]


def test_declared_tools_missing_file_returns_empty(tmp_path: Path) -> None:
    assert check_rubric_tool_drift.declared_tools(tmp_path / "SKILL.md") == []


def test_rubric_mentions_flags_undeclared_tool(tmp_path: Path) -> None:
    rubric_md = tmp_path / "rubric.md"
    rubric_md.write_text(
        "## Result triage\n"
        "- **fail:** results present but no `same_person` call was made.\n",
        encoding="utf-8",
    )
    vocabulary = {"same_person", "record_search"}
    assert check_rubric_tool_drift.rubric_mentions(
        rubric_md, vocabulary, declared={"record_search"}
    ) == {"same_person"}


def test_rubric_mentions_clean_when_declared(tmp_path: Path) -> None:
    rubric_md = tmp_path / "rubric.md"
    rubric_md.write_text(
        "- **pass:** `record_search` was called with subjectId.\n",
        encoding="utf-8",
    )
    vocabulary = {"same_person", "record_search"}
    assert (
        check_rubric_tool_drift.rubric_mentions(
            rubric_md, vocabulary, declared={"record_search"}
        )
        == set()
    )


def test_rubric_mentions_missing_file_returns_empty(tmp_path: Path) -> None:
    assert (
        check_rubric_tool_drift.rubric_mentions(
            tmp_path / "rubric.md", {"same_person"}, declared=set()
        )
        == set()
    )


def test_judge_context_mentions_scans_string_array(tmp_path: Path) -> None:
    test_json = tmp_path / "execute-census-search.json"
    test_json.write_text(
        json.dumps(
            {
                "judge_context": [
                    "record_search ranks host-side when called with subjectId.",
                    "Must NOT set pli_001 status to 'completed'.",
                    "A separate rank_search_matches call is redundant here.",
                ]
            }
        ),
        encoding="utf-8",
    )
    vocabulary = {"record_search", "rank_search_matches"}
    assert check_rubric_tool_drift.judge_context_mentions(
        test_json, vocabulary, declared={"record_search"}
    ) == {"rank_search_matches"}


def test_judge_context_mentions_ignores_files_without_the_field(tmp_path: Path) -> None:
    test_json = tmp_path / "no-context.json"
    test_json.write_text(json.dumps({"test": "x"}), encoding="utf-8")
    assert (
        check_rubric_tool_drift.judge_context_mentions(
            test_json, {"record_search"}, declared=set()
        )
        == set()
    )


def test_judge_context_mentions_malformed_json_returns_empty(tmp_path: Path) -> None:
    test_json = tmp_path / "broken.json"
    test_json.write_text("{not valid json", encoding="utf-8")
    assert (
        check_rubric_tool_drift.judge_context_mentions(
            test_json, {"record_search"}, declared=set()
        )
        == set()
    )


def test_agent_declared_tools_dual_spelling_normalizes(tmp_path: Path) -> None:
    agent_md = tmp_path / "gps-mentor.md"
    agent_md.write_text(
        "---\n"
        "name: gps-mentor\n"
        "tools:\n"
        "  - Read\n"
        "  - mcp__genealogy__research_append\n"
        "  - mcp__remote-devices__Genealogy_Research__research_append\n"
        "disallowedTools:\n"
        "  - mcp__genealogy__record_search\n"
        "  - mcp__remote-devices__Genealogy_Research__record_search\n"
        "---\n"
        "# body\n",
        encoding="utf-8",
    )
    tools, disallowed = check_rubric_tool_drift.agent_declared_tools(agent_md)
    assert tools == {"Read", "research_append"}
    assert disallowed == {"record_search"}


def test_agent_declared_tools_missing_file_returns_empty_sets(tmp_path: Path) -> None:
    tools, disallowed = check_rubric_tool_drift.agent_declared_tools(
        tmp_path / "missing.md"
    )
    assert tools == set()
    assert disallowed == set()


def test_agent_body_mentions_flags_undeclared_tool(tmp_path: Path) -> None:
    agent_md = tmp_path / "record-extractor.md"
    agent_md.write_text(
        "---\n"
        "name: record-extractor\n"
        "tools:\n"
        "  - mcp__genealogy__record_read\n"
        "disallowedTools:\n"
        "  - mcp__genealogy__research_append\n"
        "---\n"
        "# Body\n"
        "Never call research_append directly; use extraction_append instead.\n",
        encoding="utf-8",
    )
    vocabulary = {"record_read", "research_append", "extraction_append"}
    assert check_rubric_tool_drift.agent_body_mentions(agent_md, vocabulary) == {
        "extraction_append"
    }


def test_agent_body_mentions_missing_file_returns_empty(tmp_path: Path) -> None:
    assert (
        check_rubric_tool_drift.agent_body_mentions(
            tmp_path / "missing.md", {"record_read"}
        )
        == set()
    )


def test_usable_vocabulary_excludes_common_word_exemptions() -> None:
    manifest_tools = {"record_search", "login", "logout"}
    assert check_rubric_tool_drift.usable_vocabulary(manifest_tools) == {
        "record_search"
    }


def test_skill_delegated_agents_finds_plugin_references(tmp_path: Path) -> None:
    skill_md = tmp_path / "SKILL.md"
    skill_md.write_text(
        "---\nname: record-extraction\n---\n"
        "Delegate each record to `@plugin:record-extractor`, which owns the "
        "write. Route images through `@plugin:image-reader` first.\n",
        encoding="utf-8",
    )
    assert check_rubric_tool_drift.skill_delegated_agents(skill_md) == {
        "record-extractor",
        "image-reader",
    }


def test_skill_delegated_agents_no_references_returns_empty(tmp_path: Path) -> None:
    skill_md = tmp_path / "SKILL.md"
    skill_md.write_text("---\nname: search-records\n---\nNo delegation here.\n", encoding="utf-8")
    assert check_rubric_tool_drift.skill_delegated_agents(skill_md) == set()


def test_delegated_tools_unions_only_delegate_tools_not_disallowed(
    tmp_path: Path,
) -> None:
    skill_md = tmp_path / "SKILL.md"
    skill_md.write_text(
        "---\nname: record-extraction\n---\nDelegates to `@plugin:record-extractor`.\n",
        encoding="utf-8",
    )
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "record-extractor.md").write_text(
        "---\n"
        "name: record-extractor\n"
        "tools:\n"
        "  - mcp__genealogy__extraction_append\n"
        "disallowedTools:\n"
        "  - mcp__genealogy__research_append\n"
        "---\n"
        "# body\n",
        encoding="utf-8",
    )
    assert check_rubric_tool_drift.delegated_tools(skill_md, agents_dir) == {
        "extraction_append"
    }


def test_delegated_tools_missing_agent_file_returns_empty(tmp_path: Path) -> None:
    skill_md = tmp_path / "SKILL.md"
    skill_md.write_text(
        "---\nname: record-extraction\n---\nDelegates to `@plugin:ghost-agent`.\n",
        encoding="utf-8",
    )
    assert check_rubric_tool_drift.delegated_tools(skill_md, tmp_path / "agents") == set()


def test_delegated_tools_no_delegation_returns_empty(tmp_path: Path) -> None:
    skill_md = tmp_path / "SKILL.md"
    skill_md.write_text("---\nname: search-records\n---\nNo delegation.\n", encoding="utf-8")
    assert check_rubric_tool_drift.delegated_tools(skill_md, tmp_path / "agents") == set()
