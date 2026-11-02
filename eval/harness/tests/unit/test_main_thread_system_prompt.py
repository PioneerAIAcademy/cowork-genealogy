"""Issue #4011: both harnesses give the main thread the collections sentence.

Every production path carries it to the main thread: the hosted planes append
`continue_policy.COLLECTIONS_GUIDANCE`, and Cowork gets `COLLECTIONS_NOTE` from the
plugin's `no_project_route.py` hook. The harnesses otherwise run an empty system
prompt (the SDK sends `--system-prompt ""` for None), so dropping the kwarg would
leave `ut_research_ken` red with the fix shipped. Asserted on the source, the way
`test_skill_runner_mcp_isolation.py` does: the options are built inline in `run`.
"""

import ast
import importlib.util
from pathlib import Path

from harness.context_policy import MAIN_THREAD_SYSTEM_PROMPT

_HARNESS = Path(__file__).resolve().parents[2]
_HOOK = _HARNESS.parents[1] / "packages" / "engine" / "plugin" / "hooks" / "no_project_route.py"


def _options_kwargs(path: Path) -> dict:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id == "ClaudeAgentOptions":
            return {kw.arg: kw.value for kw in node.keywords if kw.arg}
    raise AssertionError(f"no ClaudeAgentOptions(...) call in {path.name}")


def test_the_prompt_is_the_shipped_hook_sentence():
    spec = importlib.util.spec_from_file_location("_route_hook_for_test", _HOOK)
    hook = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hook)
    assert MAIN_THREAD_SYSTEM_PROMPT == hook.COLLECTIONS_NOTE
    assert "collections_search" in MAIN_THREAD_SYSTEM_PROMPT


def test_both_harnesses_pass_it():
    for path in (_HARNESS / "harness" / "skill_runner.py", _HARNESS / "e2e" / "orchestrator.py"):
        value = _options_kwargs(path).get("system_prompt")
        assert isinstance(value, ast.Name) and value.id == "MAIN_THREAD_SYSTEM_PROMPT", (
            f"{path.name} must pass system_prompt=MAIN_THREAD_SYSTEM_PROMPT"
        )
