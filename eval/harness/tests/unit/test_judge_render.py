"""Break table for `judge_render_hash`, driving the REAL function.

Review 2026-10-23, finding 1: the first version of these stubbed the hash or
compared it to itself, so shipping it as a constant left every test green while
every render edit passed CI forever. These mutate a COPY of eval/harness, so a
mutation proves the hash and never touches the repo.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from harness import judge_render

# --- judge render hash: break table, driving the REAL function ----------------
# Review 2026-10-23, finding 1: the first version of these tests stubbed
# `judge_render_hash` or compared it to itself, so shipping it as a constant
# left every test green while every render edit passed CI forever. These drive
# the actual function over a COPY of eval/harness, so a mutation proves the
# hash and never touches the repo.

_HARNESS_DIR = Path(__file__).resolve().parents[2]


@pytest.fixture
def harness_copy(tmp_path: Path) -> Path:
    dst = tmp_path / "h"
    shutil.copytree(_HARNESS_DIR / "harness", dst / "harness")
    shutil.copytree(_HARNESS_DIR / "validators", dst / "validators")
    return dst


def _render_hash(root: Path) -> str:
    judge_render._judge_render_hash_cached.cache_clear()
    return judge_render.judge_render_hash(root / "validators")


def _edit(root: Path, rel: str, old: str, new: str) -> None:
    p = root / "harness" / rel
    s = p.read_text(encoding="utf-8")
    assert s.count(old) >= 1, f"anchor missing in {rel}: {old[:40]}"
    p.write_text(s.replace(old, new, 1), encoding="utf-8")


@pytest.mark.parametrize(
    "rel,old,new",
    [
        # a reached function's body
        ("judge.py", "_RESPONSE_STRING_MAX = 2000", "_RESPONSE_STRING_MAX = 2001"),
        # a constant the request settings read (review: "change JUDGE_TEMPERATURE")
        ("judge.py", "JUDGE_TEMPERATURE = 0.0", "JUDGE_TEMPERATURE = 0.2"),
        # a CROSS-MODULE callee: judge_skills_slot IS the skills-invoked block
        ("skill_runner.py", "    rest = list(skills_invoked or [])", "    rest = list(skills_invoked or [])[:1]"),
        # the whole-module half
        ("scenario_brief.py", "def readme_fallback_warning(", "def _probe():\n    return 1\n\n\ndef readme_fallback_warning("),
    ],
)
def test_render_hash_moves_when_the_graph_moves(harness_copy, rel, old, new):
    before = _render_hash(harness_copy)
    _edit(harness_copy, rel, old, new)
    assert _render_hash(harness_copy) != before, f"{rel} edit did not move the hash"


def test_render_hash_ignores_an_edit_outside_the_graph(harness_copy):
    """The property rule 2b's recompute rests on: a trigger-path file can be
    edited without owing a regrade, so long as the render graph is untouched."""
    before = _render_hash(harness_copy)
    _edit(
        harness_copy,
        "orchestrator.py",
        "def _stub_skills(",
        "def _probe_outside_graph():\n    return 1\n\n\ndef _stub_skills(",
    )
    assert _render_hash(harness_copy) == before


def test_render_hash_ignores_a_comment_only_edit(harness_copy):
    before = _render_hash(harness_copy)
    _edit(harness_copy, "judge.py", "JUDGE_TEMPERATURE = 0.0", "JUDGE_TEMPERATURE = 0.0  # probe")
    assert _render_hash(harness_copy) == before


def test_render_graph_raises_when_a_root_stops_resolving(harness_copy):
    """A renamed root must FAIL, not silently shrink the fingerprint: the one
    hash move a rename causes is cleared by the mandated regrade, after which
    that code is invisible to the gate forever."""
    _edit(harness_copy, "judge.py", "def render_prompt_parts(", "def build_prompt_parts(")
    with pytest.raises(judge_render.JudgeRenderGraphError, match="render_prompt_parts"):
        _render_hash(harness_copy)


def test_render_graph_raises_when_a_stop_set_name_stops_resolving(harness_copy):
    _edit(harness_copy, "judge.py", "def _make_client(", "def _build_client(")
    with pytest.raises(judge_render.JudgeRenderGraphError, match="_make_client"):
        _render_hash(harness_copy)


def test_render_graph_raises_on_an_unparseable_module(harness_copy):
    """Must name the file, not abort check_runlogs with a bare traceback."""
    (harness_copy / "harness" / "scenario_brief.py").write_text(
        "def broken(:\n", encoding="utf-8"
    )
    with pytest.raises(judge_render.JudgeRenderGraphError, match="cannot parse"):
        _render_hash(harness_copy)


def test_render_graph_follows_an_aliased_import(harness_copy):
    """`from m import f as g` binds `g` here and defines `f` there; enqueueing
    `g` against `m` would drop the callee and everything behind it."""
    before_nodes = judge_render._render_graph_nodes(harness_copy / "validators")
    assert ("harness.rubric", "empty_rubric") in {(m, n) for m, n, _ in before_nodes}
    _edit(
        harness_copy,
        "orchestrator.py",
        "from harness.rubric import Rubric, empty_rubric, parse_rubric_or_empty",
        "from harness.rubric import Rubric, empty_rubric as _er, parse_rubric_or_empty",
    )
    _edit(harness_copy, "orchestrator.py", "empty_rubric(", "_er(")
    after = {(m, n) for m, n, _ in judge_render._render_graph_nodes(harness_copy / "validators")}
    assert ("harness.rubric", "empty_rubric") in after, "aliased import dropped the callee"
