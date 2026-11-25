"""All three env builders agree, and each value reads the way the CLI needs.

`CLAUDE_CODE_DISABLE_AUTO_MEMORY` and `CLAUDE_CODE_FORK_SUBAGENT` are written as
three independent literals -- `real_agent._sdk_env`, `build_worker_options` and
the harness's `env_for_sdk` -- each pinned only by an assertion sitting beside
it, which moves when the literal does. Edit one "for consistency with the line
above it", update its neighbour assertion, and CI stays green while that plane
runs with the opposite behaviour. `HOSTED_PLANE_ENV` is the repo's existing
answer to that shape: compare the planes to each other, not each to a literal.

The harness lives in another venv, but its builder is a plain module and loads
here with importlib, so all three are BUILT rather than read as source. That
matters: a value assembled at runtime, or overridden after the dict literal, is
invisible to anything that greps or parses the file.

Compared by how the CLI READS each value, not by the exact string. The two
variables share one reader and need opposite readings, so the table below is
measured rather than assumed -- captured from the CLI's own request on 2.1.322,
via eval/harness/tests/unit/cli_capture.py:

    DISABLE_AUTO_MEMORY  1 true TRUE yes on " 1 "  -> no memory block (OFF)
                         0 false no off 2 banana "" -> memory block present
    FORK_SUBAGENT        0 false off FALSE " 0 "   -> no fork offer (OFF)
                         1 true banana ""          -> fork offered

So the reader trims and lower-cases, anything outside both sets falls through to
the default, and "1" is not the only correct value for either one. Asserting the
string would fail a legitimate `"true"`.
"""
from __future__ import annotations

import importlib.util
import sys
import tempfile
from pathlib import Path

import pytest

from app.agent import real_agent
from app.agent_secrets import secrets_bytes
from proto.worker import options

from test_proto_worker import PLUGIN_DIR, WORKER_ENV

REPO = Path(__file__).resolve().parents[3]

# Measured, not assumed -- see the table in the module docstring.
TRUTHY = {"1", "true", "yes", "on"}
FALSY = {"0", "false", "no", "off"}

#: variable -> the reading that produces the behaviour we want. Note the
#: polarity is OPPOSITE between the two, which is exactly why copying one line
#: onto the other is the mistake worth guarding.
REQUIRED = {
    "CLAUDE_CODE_DISABLE_AUTO_MEMORY": ("truthy", "auto-memory off"),
    "CLAUDE_CODE_FORK_SUBAGENT": ("falsy", "fork subagents off"),
}


def reading(value: str | None) -> str:
    """How the CLI reads this value: truthy, falsy, or neither."""
    if value is None:
        return "unset"
    token = value.strip().lower()
    if token in TRUTHY:
        return "truthy"
    if token in FALSY:
        return "falsy"
    # Including "" -- the CLI falls through to its default, which for both of
    # these variables is the behaviour we are turning off.
    return "neither"


def _hosted_env(tmp_path, monkeypatch) -> dict[str, str]:
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes("some-token"))
    monkeypatch.setattr(real_agent, "_SECRETS_PATH", str(secrets))
    return real_agent.build_options(tmp_path).env


def _worker_env() -> dict[str, str]:
    return options.build_worker_options(
        project_id="proj-1", cwd="/project", plugin_dir=str(PLUGIN_DIR),
        agents={"gps-mentor": object()}, store=object(),
        config_dir=tempfile.mkdtemp(prefix="env-parity-"),
        pretool_hook=lambda *a: {}, posttool_hook=lambda *a: {},
        worker_env=WORKER_ENV, bearer="grant-token", turn_id="turn-1", claim_epoch=1,
    ).env


def _harness_env() -> dict[str, str]:
    """`eval/harness`'s builder, loaded out of its own tree.

    It is a plain module with no harness-only imports at module scope, so the
    server venv can execute it. It must be registered in sys.modules before
    exec_module or its @dataclass fails to resolve its own module.
    """
    path = REPO / "eval" / "harness" / "harness" / "auth.py"
    spec = importlib.util.spec_from_file_location("harness_auth", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["harness_auth"] = mod
    spec.loader.exec_module(mod)
    return mod.env_for_sdk(
        mod.AuthConfig(skill_runner_mode="subscription", api_key=None, detail="")
    )


def _all_planes(tmp_path, monkeypatch) -> dict[str, dict[str, str]]:
    return {
        "hosted control plane": _hosted_env(tmp_path, monkeypatch),
        "prototype worker": _worker_env(),
        "eval harness": _harness_env(),
    }


@pytest.mark.parametrize("var", sorted(REQUIRED), ids=lambda v: v)
def test_every_plane_reads_the_same_way(var, tmp_path, monkeypatch):
    pytest.importorskip("claude_agent_sdk")
    readings = {
        plane: reading(env.get(var)) for plane, env in _all_planes(tmp_path, monkeypatch).items()
    }
    assert len(set(readings.values())) == 1, (
        f"the planes disagree on {var}: "
        + "; ".join(f"{p} reads {r}" for p, r in sorted(readings.items()))
        + ". They run the same agent; a plane that differs is one nobody meant to change."
    )


@pytest.mark.parametrize("var", sorted(REQUIRED), ids=lambda v: v)
def test_that_shared_reading_is_the_one_we_want(var, tmp_path, monkeypatch):
    pytest.importorskip("claude_agent_sdk")
    want, behaviour = REQUIRED[var]
    for plane, env in _all_planes(tmp_path, monkeypatch).items():
        got = reading(env.get(var))
        assert got == want, (
            f"{plane} sets {var}={env.get(var)!r}, which the CLI reads as {got}; "
            f"{behaviour} needs a {want} value. The two variables have OPPOSITE "
            "polarity, so copying one line onto the other is wrong even though "
            "they sit together."
        )
