"""All three env builders spell `CLAUDE_CODE_DISABLE_AUTO_MEMORY` the same way.

`apps/server/tests/test_auto_memory_parity.py` compares the two `apps/server`
planes by BUILDING them, which catches a runtime override but cannot see this
one: the harness lives in a different venv with no package in common, so no test
can import all three.

It does not need to. The value is a literal in each builder's dict, so reading
the three sources covers the plane the build-based check cannot reach. The two
are complementary and neither subsumes the other -- that one sees what the
builders actually produce, this one sees every plane.

Parsed, never grepped. `real_agent.py` names the variable three times (docstring,
dict, comment) and a line match would score the prose; this reads the value
paired with the key inside an actual dict literal, which is the one spelling that
reaches the CLI.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

VAR = "CLAUDE_CODE_DISABLE_AUTO_MEMORY"

# "1" is OFF. Named so the check cannot pass by all three planes moving together:
# agreement alone is satisfied by three copies of "0", which is `forced_on`.
OFF = "1"

REPO = Path(__file__).resolve().parents[4]

BUILDERS = {
    "hosted control plane (_sdk_env)": "apps/server/app/agent/real_agent.py",
    "prototype worker (build_worker_options)": "apps/server/proto/worker/options.py",
    "eval harness (env_for_sdk)": "eval/harness/harness/auth.py",
}


def _dict_values(path: Path, key: str) -> list[str]:
    """Every string a dict literal in `path` pairs with `key`."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Dict):
            continue
        for k, v in zip(node.keys, node.values):
            if (
                isinstance(k, ast.Constant) and k.value == key
                and isinstance(v, ast.Constant) and isinstance(v.value, str)
            ):
                found.append(v.value)
    return found


@pytest.mark.parametrize("label,rel", sorted(BUILDERS.items()), ids=lambda v: v)
def test_each_builder_sets_auto_memory_exactly_once(label, rel):
    path = REPO / rel
    assert path.exists(), f"{rel} moved; this check is now reading nothing"
    values = _dict_values(path, VAR)
    assert len(values) == 1, (
        f"{label} ({rel}) pairs {VAR} with {len(values)} dict value(s), expected 1. "
        "Zero means the plane lost the key and auto-memory is live there."
    )


def test_the_three_planes_agree_and_the_value_turns_memory_off():
    values = {label: _dict_values(REPO / rel, VAR) for label, rel in BUILDERS.items()}
    spelled = {label: v[0] for label, v in values.items() if v}
    assert len(set(spelled.values())) == 1, (
        "the planes disagree on this variable: "
        + "; ".join(f"{label} = {value!r}" for label, value in sorted(spelled.items()))
    )
    assert set(spelled.values()) == {OFF}, (
        f'all three planes set {VAR}={next(iter(spelled.values()))!r}, but "1" is the '
        "value that turns memory OFF. A falsy value is read as forced_on, which "
        "overrides even a settings-level autoMemoryEnabled: false."
    )
