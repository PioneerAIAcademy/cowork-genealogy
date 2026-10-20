"""Offline contract test for the SDK options the three run paths build.

Issue #2488 item (from issue #1207): no offline gate exercises the live Agent
SDK path, so a kwarg that the installed `claude-agent-sdk` no longer accepts, or
a `setting_sources` that drifts off `["project"]` at one site, ships green and
fails only at a live run. Two things are pinned here, by parsing the source (the
options are built inline with no seam to construct them in isolation), so neither
can regress silently:

1. Every option name that reaches `ClaudeAgentOptions` is a real field of the
   installed SDK dataclass. A renamed or misspelled kwarg fails here instead of
   at a billed run.
2. `setting_sources` is `["project"]` at all three sites. "user" was removed
   deliberately (it reads a source no run writes and widens the gap between what
   CI exercises and what production loads, real_agent.py); a drift back to
   `["user"]`, or to `["project", "user"]`, fails here.

Two option-building shapes are in use and both are handled: a direct
`ClaudeAgentOptions(setting_sources=..., ...)` call (skill_runner, e2e), and a
`dict(...)` built first and spread in as `ClaudeAgentOptions(**kwargs)`
(real_agent). No model call; runs under `make harness-test`.
"""

import ast
import dataclasses
from pathlib import Path

import pytest
from claude_agent_sdk import ClaudeAgentOptions

_REPO = Path(__file__).resolve().parents[4]

# The three places a run's ClaudeAgentOptions is built: the unit harness, the
# hosted control plane, and the e2e harness. Kept in sync by this test.
_SITES = {
    "skill_runner": _REPO / "eval" / "harness" / "harness" / "skill_runner.py",
    "real_agent": _REPO / "apps" / "server" / "app" / "agent" / "real_agent.py",
    "e2e_orchestrator": _REPO / "eval" / "harness" / "e2e" / "orchestrator.py",
}

_SDK_FIELDS = frozenset(f.name for f in dataclasses.fields(ClaudeAgentOptions))


def _as_str_list(node):
    """The Python list of strings for an ast list literal, or None if not one."""
    if not isinstance(node, ast.List):
        return None
    out = []
    for elt in node.elts:
        if not isinstance(elt, ast.Constant) or not isinstance(elt.value, str):
            return None
        out.append(elt.value)
    return out


def _resolved_options(path: Path):
    """Map option-name -> ast value node for the ClaudeAgentOptions built here.

    Resolves both shapes: keywords passed straight to ClaudeAgentOptions, and a
    `dict(...)`/`{...}` bound to a local name and spread in via `**name`.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))

    simple_assigns = {}
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
        ):
            simple_assigns[node.targets[0].id] = node.value

    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "ClaudeAgentOptions"
    ]
    assert calls, f"no ClaudeAgentOptions(...) call found in {path}"

    options = {}
    for call in calls:
        for kw in call.keywords:
            if kw.arg is not None:
                options[kw.arg] = kw.value
                continue
            # `**spread` — resolve a local name to its dict(...) / {...} source.
            src = kw.value
            if isinstance(src, ast.Name) and src.id in simple_assigns:
                src = simple_assigns[src.id]
            if (
                isinstance(src, ast.Call)
                and isinstance(src.func, ast.Name)
                and src.func.id == "dict"
            ):
                for k in src.keywords:
                    if k.arg is not None:
                        options[k.arg] = k.value
            elif isinstance(src, ast.Dict):
                for key, val in zip(src.keys, src.values):
                    if isinstance(key, ast.Constant) and isinstance(key.value, str):
                        options[key.value] = val
    return options


@pytest.mark.parametrize("label", sorted(_SITES))
def test_options_kwargs_are_real_sdk_fields(label):
    options = _resolved_options(_SITES[label])
    assert options, f"{label}: resolved no options for ClaudeAgentOptions"
    for name in options:
        assert name in _SDK_FIELDS, (
            f"{label}: ClaudeAgentOptions gets option '{name}', which is not a "
            f"field of the installed claude-agent-sdk. Either the name is "
            f"misspelled or the SDK dropped it; fix the call or the pin."
        )


@pytest.mark.parametrize("label", sorted(_SITES))
def test_setting_sources_pinned_to_project(label):
    options = _resolved_options(_SITES[label])
    assert "setting_sources" in options, (
        f"{label}: ClaudeAgentOptions does not set setting_sources. It must pin "
        f'["project"] so CI exercises what production loads.'
    )
    value = _as_str_list(options["setting_sources"])
    assert value == ["project"], (
        f'{label}: setting_sources must be ["project"], got {value!r}. '
        f"'project' is the only source every run path loads reproducibly; "
        f"'user' reads a source no run writes."
    )
