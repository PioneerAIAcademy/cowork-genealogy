"""The `negative-status-question` validator and the init-project hand-back (#3112).

Each check is proven to fire on a planted defect and to pass the right answer.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

REPO = next(
    q for q in Path(__file__).resolve().parents
    if (q / "eval/harness/validators").is_dir()
)
sys.path.insert(0, str(REPO / "eval/harness/validators"))

import test_research  # noqa: E402
from test_research import (  # noqa: E402
    test_status_question_answered_from_project_context_only as validator,
)
from test_universal import test_hand_back_names_its_owner as hand_back  # noqa: E402

TAGGED = {"tags": ["negative-status-question"]}
PC_CALL = [{"tool": "mcp__genealogy__project_context", "args": {}}]
CLEAN = (
    "The project is working to identify the parents of Patrick Flynn. A proof "
    "summary concludes the parentage question, and the next step is a mentor review."
)


def _run(text=CLEAN, tool_calls=PC_CALL, builtin=()):
    validator(list(tool_calls), list(builtin), {}, {}, text, TAGGED)


def test_the_prefix_list_matches_the_engines_id_prefixes():
    """Validators cannot import validator.ts, so the copy is pinned here."""
    source = (REPO / "packages/engine/mcp-server/src/validation/validator.ts").read_text(encoding="utf-8")
    block = source[source.index("export const ID_PREFIXES"):]
    block = block[: block.index("};")]
    engine = set(re.findall(r':\s*"([a-z]+_)"', block))
    assert engine, "premise gone: ID_PREFIXES not found in validator.ts"
    assert set(test_research._PROJECT_ID_PREFIXES) == engine


def test_a_clean_paragraph_passes():
    _run()


def test_a_glob_for_the_project_file_is_not_a_read():
    """Every passing run so far located the project with a Glob; that is not a read."""
    _run(builtin=[{"tool": "Glob", "args": {"pattern": "**/research.json"}}])


@pytest.mark.parametrize(
    "text",
    [
        "The timeline t_001 shows the gap.",
        "The proof summary (ps_001) is written.",
        "Patrick Flynn (I1) is the subject.",
        "He is supported by S3 and S4.",
        "Locality loc_001 covers Schuylkill.",
    ],
    ids=["timeline-t_", "proof-ps_", "tree-person-I", "tree-source-S", "locality-loc_"],
)
def test_an_identifier_in_the_reply_fails(text):
    with pytest.raises(AssertionError, match="identifiers"):
        _run(text=text)


@pytest.mark.parametrize("spawn_tool", ["Agent", "Task"])
def test_any_subagent_spawn_fails(spawn_tool):
    with pytest.raises(AssertionError, match="not delegated"):
        _run(builtin=[{"tool": spawn_tool, "args": {"subagent_type": "question-selection"}}])


@pytest.mark.parametrize(
    "call",
    [
        {"tool": "Read", "args": {"file_path": "/w/research.json"}},
        {"tool": "Grep", "args": {"pattern": "q_", "path": "/w/tree.gedcomx.json"}},
    ],
    ids=["read", "grep"],
)
def test_reading_the_raw_project_files_fails(call):
    with pytest.raises(AssertionError, match="raw project files"):
        _run(builtin=[call])


def test_no_project_context_call_fails():
    with pytest.raises(AssertionError, match="must call project_context"):
        _run(tool_calls=[])


# --- init-project's existing-project hand-back (ut_init_project_009) -------------

INIT_TEST = {
    "id": "ut_init_project_009",
    "skill": "init-project",
    "type": "negative",
    "tags": ["refuse-if-exists", "hand-back", "direct-arm"],
    "negative": {"correct_skill": ["question-selection"], "grade_on_invariant": True},
}


def _paragraph() -> str:
    """The researcher paragraph init-project.md tells the agent to return verbatim."""
    body = (REPO / "packages/engine/plugin/agents/init-project.md").read_text(encoding="utf-8")
    m = re.search(r'> "(This folder already holds a research project[^"]*)"', body)
    assert m, "premise gone: the fixed researcher paragraph is not in init-project.md"
    return m.group(1)


def test_the_owner_is_never_named_by_the_fixed_paragraph():
    """With owner `research`, the paragraph's "a research project" satisfied the
    check on every reply; the owner must be absent from the paragraph."""
    assert "question-selection" not in _paragraph().lower()


def test_a_reply_without_the_hand_back_line_fails():
    reply = f"---\n{_paragraph()}"
    with pytest.raises(AssertionError, match="never names question-selection"):
        hand_back([], reply, INIT_TEST, agent_returns=[{"subagent_type": "init-project", "text": reply}])


def test_a_reply_with_the_hand_back_line_passes():
    reply = f"Hand-back: question-selection — a project already exists here\n---\n{_paragraph()}"
    hand_back([], reply, INIT_TEST, agent_returns=[{"subagent_type": "init-project", "text": reply}])
