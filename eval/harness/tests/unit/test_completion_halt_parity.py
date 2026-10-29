"""The hosted completion halt reads an agent's return the way this harness does.

`apps/server/app/agent/continue_policy.py` (the halt that ends a hosted turn on
proof-conclusion's `summary_for_user`, issue #3542 lead 1) carries copies it cannot import:
the runtime's hand-back frame and trailer patterns from `harness/skill_runner.py`, and the
closing sentences `agents/proof-conclusion.md` mandates when the agent completes a project.
A change to either side that the copy lacks would leak the trailer into the patron's
summary or quietly stop the halt. This lives here, not in `apps/server`, because this
suite's workflow runs on a change to the harness, the agent bodies or `apps/server`.
Extraction failing is a hard error, never a skip.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
HOSTED = REPO / "apps/server/app/agent/continue_policy.py"
HARNESS = REPO / "eval/harness/harness/skill_runner.py"
AGENT = REPO / "packages/engine/plugin/agents/proof-conclusion.md"


def _is_compile(node: ast.AST) -> bool:
    return (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr == "compile" and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "re")


def _patterns(path: Path) -> dict[str, object]:
    """Module-level `NAME = re.compile(...)` (every argument, flags included), tuples of
    them, plain strings and tuples of plain strings. Any other assignment is skipped, so an
    unrelated module-level call cannot break the comparison."""
    out: dict[str, object] = {}
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if not (isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)):
            continue
        name, value = node.targets[0].id, node.value
        if _is_compile(value):
            out[name] = [ast.dump(a) for a in value.args]
        elif isinstance(value, ast.Tuple) and value.elts and all(_is_compile(e) for e in value.elts):
            out[name] = [[ast.dump(a) for a in e.args] for e in value.elts]
        elif isinstance(value, ast.Tuple) and all(
                isinstance(e, ast.Constant) and isinstance(e.value, str) for e in value.elts):
            out[name] = [e.value for e in value.elts]
        elif isinstance(value, ast.Constant) and isinstance(value.value, str):
            out[name] = value.value
    return out


def test_the_frame_and_trailer_patterns_match_the_harness():
    hosted, harness = _patterns(HOSTED), _patterns(HARNESS)
    for name in ("_HAND_BACK_HEADER", "_AGENT_RETURN_TRAILERS"):
        assert name in hosted, f"{HOSTED.name} no longer defines {name}"
        assert name in harness, f"{HARNESS.name} no longer defines {name}"
        assert hosted[name] == harness[name], name


# A quoted sentence in the agent body ending on the second-opinion offer: the completing
# sentences, whatever their opening words.
_COMPLETING = re.compile(r'"([^"]*just ask\.)"')


def test_the_completing_sentences_are_the_ones_the_agent_is_told_to_write():
    """Both ways: a sentence the halt waits for that the agent no longer writes stops the
    halt silently, and one the agent writes that the halt does not know never halts."""
    sentences = _patterns(HOSTED).get("PROOF_CONCLUSION_FINISHED")
    assert isinstance(sentences, list) and sentences, f"{HOSTED.name} no longer defines PROOF_CONCLUSION_FINISHED"
    body = " ".join(AGENT.read_text(encoding="utf-8").split())
    told = _COMPLETING.findall(body)
    assert told, "found no completing sentence in proof-conclusion.md, so this compares nothing"
    assert sorted(sentences) == sorted(set(told)), (
        f"{HOSTED.name} waits for {sorted(sentences)}; proof-conclusion.md tells the agent to write {sorted(set(told))}")
