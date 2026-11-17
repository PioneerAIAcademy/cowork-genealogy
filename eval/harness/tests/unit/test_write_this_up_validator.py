"""The `write-this-up-*` validator (#4576): each check fires on a planted defect and
passes the right report."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = next(
    q for q in Path(__file__).resolve().parents
    if (q / "eval/harness/validators").is_dir()
)
sys.path.insert(0, str(REPO / "eval/harness/validators"))

from test_research import test_write_this_up_built_from_project_state as validator  # noqa: E402

PROOF = {"tags": ["write-this-up-proof"]}
NO_PROOF = {"tags": ["write-this-up-no-proof"]}


def _q(section):
    return {"tool": "mcp__genealogy__research_query", "args": {"section": section}}


READS = [_q("proof_summaries"), _q("evaluations"), _q("conflicts"), _q("plans")]
REPORT = (
    "Report on the parentage of Patrick Flynn. Rated probable. The reviewer's verdict is looks solid. "
    "The birthplace conflict was resolved for Ireland. Not yet searched: the 1870, 1880 and 1900 censuses."
)
OPEN = "Patrick Flynn's parentage is open: the censuses name Thomas Flynn, but no conclusion is written and no review was requested."


def _run(test=PROOF, text=REPORT, tool_calls=READS, builtin=()):
    validator(list(tool_calls), list(builtin), text, test)


def test_a_complete_report_passes():
    _run()


def test_the_report_may_be_in_a_written_file():
    _run(text="Done.", builtin=[{"tool": "Write", "args": {"file_path": "/w/report.md", "content": REPORT}}])


def test_the_report_may_be_in_a_bash_command():
    _run(text="Done.", builtin=[{"tool": "Bash", "args": {"command": f"python make_docx.py <<'E'\n{REPORT}\nE"}}])


def test_the_cowork_spelling_of_the_read_counts():
    reads = [{"tool": "mcp__remote-devices__Genealogy_Research__research_query", "args": {"section": s}}
             for s in ("proof_summaries", "evaluations")]
    _run(tool_calls=reads)


@pytest.mark.parametrize("missing", ["proof_summaries", "evaluations"])
def test_a_missing_read_fails(missing):
    with pytest.raises(AssertionError, match="must read"):
        _run(tool_calls=[c for c in READS if c["args"]["section"] != missing])


@pytest.mark.parametrize("drop", ["probable", "looks solid", "birthplace", "1900"])
def test_an_omission_fails(drop):
    with pytest.raises(AssertionError, match="omits"):
        _run(text=REPORT.replace(drop, "XX"))


@pytest.mark.parametrize("tool", ["Agent", "Task"])
def test_any_spawn_fails(tool):
    with pytest.raises(AssertionError, match="no hand-off"):
        _run(builtin=[{"tool": tool, "args": {"subagent_type": "proof-conclusion"}}])


def test_a_spawn_inside_a_subagent_is_not_the_main_threads():
    _run(builtin=[{"tool": "Agent", "agent_id": "a1", "args": {"subagent_type": "x"}}])


def test_research_append_fails():
    with pytest.raises(AssertionError, match="adds no claims"):
        _run(tool_calls=READS + [{"tool": "mcp__genealogy__research_append", "args": {}}])


@pytest.mark.parametrize(
    "call",
    [
        {"tool": "Read", "args": {"file_path": "/w/research.json"}},
        {"tool": "Grep", "args": {"pattern": "q_", "path": "/w", "glob": "tree.gedcomx.json"}},
    ],
)
def test_reading_the_raw_files_fails(call):
    with pytest.raises(AssertionError, match="raw project files"):
        _run(builtin=[call])


def test_a_glob_for_the_project_file_is_not_a_read():
    _run(builtin=[{"tool": "Glob", "args": {"pattern": "**/research.json"}}])


def test_no_proof_report_without_a_tier_passes_and_needs_no_reads():
    _run(test=NO_PROOF, text=OPEN, tool_calls=[])


@pytest.mark.parametrize("word", ["probable", "Proved", "disproved", "not proved"])
def test_a_tier_word_with_no_proof_fails(word):
    with pytest.raises(AssertionError, match="states no tier"):
        _run(test=NO_PROOF, text=f"{OPEN} Rated {word}.")


def test_a_tier_word_in_a_written_file_fails_too():
    with pytest.raises(AssertionError, match="states no tier"):
        _run(test=NO_PROOF, text="Done.",
             builtin=[{"tool": "Write", "args": {"content": "Rated probable."}}])


def test_an_untagged_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        _run(test={"tags": []})
