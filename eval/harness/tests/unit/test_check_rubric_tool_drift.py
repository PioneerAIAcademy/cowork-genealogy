"""Unit tests for scripts/check_rubric_tool_drift.py.

Covers the pure Path-in/set-out helpers the script's main() composes:
loading the tool vocabulary, finding whole-word tool mentions in prose,
parsing a skill's/agent's declared tools, and scanning rubric.md /
judge_context / agent bodies for mentions outside that declared set.

Also covers the SUPPRESSIONS mechanism (issue #1522) end-to-end through
main(): a suppressed entry does not mask an unrelated genuine hit (the
same tool in a different file survives), and a stale entry (one whose
(file, tool) no longer fires) fails loudly.
"""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "check_rubric_tool_drift",
    Path(__file__).resolve().parents[2] / "scripts" / "check_rubric_tool_drift.py",
)
check_rubric_tool_drift = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(check_rubric_tool_drift)

# The gh_annotations module object the script imported its `gh_warning` FROM is
# the one that records warnings. Read the recording off that reference: a second
# `spec_from_file_location` load of the same file is a DIFFERENT module object
# with its own empty `_warnings` list, so every assertion would pass vacuously.
# Same pattern as test_check_slot_queue.py.
_recorded = check_rubric_tool_drift.gh_warning.__globals__["recorded_warnings"]
_reset = check_rubric_tool_drift.gh_warning.__globals__["reset"]


@pytest.fixture(autouse=True)
def _clean_warnings():
    _reset()
    yield
    _reset()


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


def test_agent_declared_tools_multi_spelling_normalizes(tmp_path: Path) -> None:
    """All three server spellings must collapse to one bare name.

    The fixture carries the on-computer spelling (`mcp__Genealogy_Research__`, no
    `remote-devices` segment) as well as the harness and bridged forms, so this
    exercises the shape that actually ships. It previously carried only the two
    older spellings, which passed without ever reaching the third (#1341).
    """
    agent_md = tmp_path / "gps-mentor.md"
    agent_md.write_text(
        "---\n"
        "name: gps-mentor\n"
        "tools:\n"
        "  - Read\n"
        "  - mcp__genealogy__research_append\n"
        "  - mcp__remote-devices__Genealogy_Research__research_append\n"
        "  - mcp__Genealogy_Research__research_append\n"
        "disallowedTools:\n"
        "  - mcp__genealogy__record_search\n"
        "  - mcp__remote-devices__Genealogy_Research__record_search\n"
        "  - mcp__Genealogy_Research__record_search\n"
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


# ── SUPPRESSIONS mechanism tests (issue #1522) ───────────────────────
#
# These exercise main() end-to-end via recorded_warnings(), not just the
# is_suppressed() predicate: a mutation at the call site (e.g. replacing
# the check with `if False:`) would be caught because main()'s emitted
# warnings would still include the suppressed pair.


def _warning_file_tool_pairs() -> set[tuple[str, str]]:
    """(file, tool) pairs extracted from the warnings main() emitted.

    Tool names are pulled from the message by looking for the first
    backtick-quoted word after 'mentions `' or 'mentioning `' (rubric
    warnings say "mentions", judge_context warnings say "mentioning").
    """
    pairs: set[tuple[str, str]] = set()
    for f, m in _recorded():
        if f is None:
            continue
        match = re.search(r"mention(?:s|ing) `(\w+)`", m)
        if match:
            pairs.add((f, match.group(1)))
    return pairs


def test_suppression_is_selective_end_to_end(monkeypatch) -> None:
    """Direction (a): suppressing (file_A, tool_X) through main() must not
    suppress (file_A, tool_Y) or (file_B, tool_X).

    Calls main() with a real SUPPRESSIONS entry, then verifies the emitted
    warnings via recorded_warnings(). The suppressed pair must be absent
    and the same tool in different files must survive."""
    # Run main() once with no suppression to get the full hit set.
    # Clear SUPPRESSIONS first so the baseline is unsuppressed — main()
    # applies suppressions, so any populated entry would be invisible here
    # and would cause the target lookup to skip.
    real = list(check_rubric_tool_drift.SUPPRESSIONS)
    monkeypatch.setattr(check_rubric_tool_drift, "SUPPRESSIONS", [])
    check_rubric_tool_drift.main()
    all_pairs = _warning_file_tool_pairs()
    _reset()
    monkeypatch.setattr(check_rubric_tool_drift, "SUPPRESSIONS", real)

    # Pick a real (file, tool) pair that fires. validate_research_schema
    # in tree-edit's rubric is the most durable: the rubric documents a
    # post-edit validation call that tree-edit's own contract says is
    # unnecessary, i.e. clear drift that won't be "fixed" away.
    target = ("eval/tests/unit/tree-edit/rubric.md", "validate_research_schema")
    if target not in all_pairs:
        pytest.skip("expected baseline hit not present — corpus changed")

    # Find another file that also mentions validate_research_schema
    # (different file, same tool) to verify it survives.
    same_tool_other_file = {
        (f, t)
        for f, t in all_pairs
        if t == "validate_research_schema" and f != target[0]
    }
    if not same_tool_other_file:
        pytest.skip("no second file mentions the same tool — cannot test selectivity")

    # Run again with the one entry suppressed.
    monkeypatch.setattr(
        check_rubric_tool_drift,
        "SUPPRESSIONS",
        [{"file": target[0], "tool": target[1], "reason": "test: selective suppression proof"}],
    )
    check_rubric_tool_drift.main()
    suppressed_pairs = _warning_file_tool_pairs()

    # The suppressed pair is gone.
    assert target not in suppressed_pairs
    # Same tool in other files survived (direction a).
    for pair in same_tool_other_file:
        assert pair in suppressed_pairs, (
            f"{pair} should not have been suppressed — only {target} was"
        )


def test_no_stale_suppressions(monkeypatch) -> None:
    """Direction (b): every SUPPRESSIONS entry must match a (file, tool)
    main() would otherwise warn about. An entry that stopped matching means
    the drift it excused was fixed and the entry should be removed.

    Trivially passes while the list is empty; arms itself when PR 2
    populates it.
    """
    # Collect the unsuppressed hit set: clear SUPPRESSIONS so main() emits
    # every warning, including the ones that would normally be suppressed.
    real = list(check_rubric_tool_drift.SUPPRESSIONS)
    monkeypatch.setattr(check_rubric_tool_drift, "SUPPRESSIONS", [])
    check_rubric_tool_drift.main()
    all_pairs = _warning_file_tool_pairs()
    stale = [
        s
        for s in real
        if (s["file"], s["tool"]) not in all_pairs
    ]
    assert stale == [], (
        "SUPPRESSIONS has entries that no longer match a hit — the drift was "
        "fixed and the entry should be removed:\n  "
        + "\n  ".join(f'{s["file"]}:{s["tool"]}' for s in stale)
    )


def test_every_suppression_carries_a_reason() -> None:
    """Same >20-char convention as UNREACHED_PENDING_ADJUDICATION in
    skill-reference-reachability.test.ts."""
    for s in check_rubric_tool_drift.SUPPRESSIONS:
        assert len(s.get("reason", "").strip()) > 20, (
            f'SUPPRESSIONS entry ({s["file"]}, {s["tool"]}) needs a reason '
            f"longer than 20 characters — not a dumping ground"
        )
