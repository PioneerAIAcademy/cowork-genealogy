"""The hosted completion halt reads an agent's return the way this harness does.

`apps/server/app/agent/continue_policy.py` (the halt that ends a hosted turn on
proof-conclusion's `summary_for_user`, issue #3542 lead 1) carries copies it cannot import:
the runtime's hand-back frame and trailer patterns from `harness/skill_runner.py`, and the
closing sentence `agents/proof-conclusion.md` mandates when the agent completes a project.
A change to either side that the copy lacks would leak the trailer into the patron's
summary or quietly stop the halt. This lives here, not in `apps/server`, because this
suite's workflow runs on a change to the harness, the agent bodies or `apps/server`.
Extraction failing is a hard error, never a skip.
"""

from __future__ import annotations

import ast
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
HOSTED = REPO / "apps/server/app/agent/continue_policy.py"
HARNESS = REPO / "eval/harness/harness/skill_runner.py"
AGENT = REPO / "packages/engine/plugin/agents/proof-conclusion.md"


def _patterns(path: Path) -> dict[str, object]:
    """Module-level `NAME = re.compile("...")`, tuples of them, and plain strings."""
    out: dict[str, object] = {}
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if not (isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)):
            continue
        name, value = node.targets[0].id, node.value
        if isinstance(value, ast.Call) and value.args:
            out[name] = ast.literal_eval(value.args[0])
        elif isinstance(value, ast.Tuple) and all(isinstance(e, ast.Call) and e.args for e in value.elts):
            out[name] = [ast.literal_eval(e.args[0]) for e in value.elts]
        elif isinstance(value, ast.Constant) and isinstance(value.value, str):
            out[name] = value.value
    return out


def test_the_frame_and_trailer_patterns_match_the_harness():
    hosted, harness = _patterns(HOSTED), _patterns(HARNESS)
    for name in ("_HAND_BACK_HEADER", "_AGENT_RETURN_TRAILERS"):
        assert name in hosted, f"{HOSTED.name} no longer defines {name}"
        assert name in harness, f"{HARNESS.name} no longer defines {name}"
        assert hosted[name] == harness[name], name


def test_the_completing_sentence_is_the_one_the_agent_is_told_to_write():
    sentence = _patterns(HOSTED).get("PROOF_CONCLUSION_FINISHED")
    assert isinstance(sentence, str) and sentence, f"{HOSTED.name} no longer defines PROOF_CONCLUSION_FINISHED"
    body = " ".join(AGENT.read_text(encoding="utf-8").split())
    assert sentence in body, f"proof-conclusion.md no longer tells the agent to write {sentence!r}"
