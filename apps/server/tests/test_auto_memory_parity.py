"""The two `apps/server` planes agree on `CLAUDE_CODE_DISABLE_AUTO_MEMORY`.

`eval/harness/tests/unit/test_auto_memory_off.py` captures the CLI's own system
prompt and so catches a rename or a polarity change anywhere -- but it builds
its environment from `env_for_sdk` and cannot see these two builders. Each is
pinned only by an `== "1"` beside it, which moves with the literal: edit
`_sdk_env` to `"0"` "for consistency with the CLAUDE_CODE_FORK_SUBAGENT line
above it", update the one assertion next to it, and CI stays green while the
hosted plane runs with auto-memory `forced_on` -- stronger than no setting at
all, since `forced_on` overrides even `autoMemoryEnabled: false`.

This is the shape `HOSTED_PLANE_ENV` already uses for a value defined twice
(`test_the_hosted_flag_is_the_one_the_plugin_hook_reads`): compare the planes to
each other rather than each to a literal, so disagreement fails even when both
sides' own assertions were updated to match.
"""
from __future__ import annotations

import tempfile

import pytest

from app.agent import real_agent
from app.agent_secrets import secrets_bytes
from proto.worker import options

from test_proto_worker import PLUGIN_DIR, WORKER_ENV

VAR = "CLAUDE_CODE_DISABLE_AUTO_MEMORY"

# "1" is OFF. Spelled here so the parity check cannot pass by both planes moving
# together -- agreement alone would be satisfied by both reading "0".
OFF = "1"


def _hosted_env(tmp_path, monkeypatch) -> dict[str, str]:
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes("some-token"))
    monkeypatch.setattr(real_agent, "_SECRETS_PATH", str(secrets))
    return real_agent.build_options(tmp_path).env


def _worker_env() -> dict[str, str]:
    return options.build_worker_options(
        project_id="proj-1", cwd="/project", plugin_dir=str(PLUGIN_DIR),
        agents={"gps-mentor": object()}, store=object(),
        config_dir=tempfile.mkdtemp(prefix="auto-memory-parity-"),
        pretool_hook=lambda *a: {}, posttool_hook=lambda *a: {},
        worker_env=WORKER_ENV, bearer="grant-token", turn_id="turn-1", claim_epoch=1,
    ).env


def test_both_apps_server_planes_set_auto_memory_to_the_same_value(tmp_path, monkeypatch):
    pytest.importorskip("claude_agent_sdk")
    hosted = _hosted_env(tmp_path, monkeypatch).get(VAR)
    worker = _worker_env().get(VAR)
    assert hosted == worker, (
        f"the hosted plane sets {VAR}={hosted!r} and the prototype worker {worker!r}. "
        "They run the same agent; a plane that disagrees is one nobody meant to change."
    )


def test_that_shared_value_is_the_one_that_turns_memory_off(tmp_path, monkeypatch):
    pytest.importorskip("claude_agent_sdk")
    assert _hosted_env(tmp_path, monkeypatch).get(VAR) == OFF, (
        f'{VAR} must be "1". A falsy value is not a weaker disable -- the CLI reads '
        'it as forced_on, which overrides even a settings-level autoMemoryEnabled: false.'
    )
