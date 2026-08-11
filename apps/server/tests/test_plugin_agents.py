"""Plugin agents must spawn as THEMSELVES in the hosted path — issue #939.

The hosted control plane was the only environment that loaded the plugin's
agents through `plugins=[{"type": "local", …}]`. That mechanism registers them
only as `genealogy-research:<agent>`; every SKILL.md delegates by the bare name
(`@plugin:record-extractor`), so the Task call errored and the model fell back
to a general-purpose stand-in — one holding the session's full tool set and
none of the agent's `disallowedTools:` denies. Neither eval harness could see
it: both stage into `.claude/agents/`, so a green suite was not evidence.

Three guards, cheapest first:

1. ``test_build_options_stages_*`` — the fix itself, offline.
2. ``test_skills_delegate_to_agents_that_exist`` — the SKILL.md ↔ agent-name
   contract, offline. Catches a rename on either side.
3. ``test_bare_agent_names_are_registered`` — the one that would have caught
   #939. Connects a real SDK client with the hosted options and reads the
   registered agent list out of the init handshake. No model call, so it costs
   nothing but a process start. Skipped when its prerequisites are absent under
   an ordinary suite run, and FAILED when ``make agent-smoke`` (``AGENT_SMOKE=1``)
   asked for it by name — a silent skip there is a green suite reporting that a
   check ran when it did not.
"""
from __future__ import annotations

import os
import re
import shutil
from pathlib import Path

import pytest

from app.agent import real_agent

REPO_ROOT = Path(__file__).resolve().parents[3]
PLUGIN_DIR = REPO_ROOT / "packages" / "engine" / "plugin"
AGENTS_DIR = PLUGIN_DIR / "agents"
SKILLS_DIR = PLUGIN_DIR / "skills"


def _frontmatter_name(agent_file: Path) -> str:
    """The name the runtime registers the agent under (frontmatter `name:`)."""
    for line in agent_file.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^name:\s*(\S+)\s*$", line)
        if m:
            return m.group(1)
    raise AssertionError(f"{agent_file.name} has no `name:` in its frontmatter")


def _shipped_agents() -> list[Path]:
    files = sorted(AGENTS_DIR.glob("*.md"))
    assert files, f"no agent definitions under {AGENTS_DIR}"
    return files


# ── 1. the fix: bare-name registration via project staging ───────

def test_build_options_stages_plugin_agents_into_the_project(tmp_path, monkeypatch):
    monkeypatch.setattr(real_agent, "_PLUGIN_DIR", str(PLUGIN_DIR))
    real_agent.build_options(tmp_path)

    staged = tmp_path / ".claude" / "agents"
    assert sorted(p.name for p in staged.glob("*.md")) == [
        p.name for p in _shipped_agents()
    ]


def test_staged_agent_name_matches_its_filename(tmp_path, monkeypatch):
    # `.claude/agents/` registers by frontmatter `name:`, while every caller —
    # SKILL.md, both harnesses, this test — reasons about the filename. They
    # must agree or the bare name still misses.
    monkeypatch.setattr(real_agent, "_PLUGIN_DIR", str(PLUGIN_DIR))
    names = real_agent.stage_plugin_agents(tmp_path)

    assert names == [p.stem for p in _shipped_agents()]
    for agent_file in _shipped_agents():
        assert _frontmatter_name(agent_file) == agent_file.stem


def test_staging_refreshes_a_stale_definition(tmp_path, monkeypatch):
    # A session resumed after an engine upgrade must get the new body, not the
    # copy staged by the run that created the project.
    monkeypatch.setattr(real_agent, "_PLUGIN_DIR", str(PLUGIN_DIR))
    stale = tmp_path / ".claude" / "agents" / "record-extractor.md"
    stale.parent.mkdir(parents=True)
    stale.write_text("stale\n", encoding="utf-8")

    real_agent.stage_plugin_agents(tmp_path)

    assert stale.read_text(encoding="utf-8") != "stale\n"


def test_missing_plugin_agents_dir_is_survivable(tmp_path, monkeypatch):
    monkeypatch.setattr(real_agent, "_PLUGIN_DIR", str(tmp_path / "nope"))
    assert real_agent.stage_plugin_agents(tmp_path) == []


# ── 2. the SKILL.md ↔ agent-name contract ────────────────────────

def test_skills_delegate_to_agents_that_exist():
    shipped = {p.stem for p in _shipped_agents()}
    referenced: dict[str, str] = {}
    for skill in sorted(SKILLS_DIR.glob("*/SKILL.md")):
        for name in re.findall(r"@plugin:([a-z0-9-]+)", skill.read_text(encoding="utf-8")):
            referenced.setdefault(name, skill.parent.name)

    assert referenced, "no @plugin: delegation found — did the convention change?"
    unknown = {n: s for n, s in referenced.items() if n not in shipped}
    assert not unknown, f"SKILL.md delegates to agents that do not ship: {unknown}"


# ── 3. the live guard (deterministic, no model call) ─────────────

_ENGINE_BUILD = Path(
    os.environ.get(
        "ENGINE_MCP_BUILD",
        str(REPO_ROOT / "packages/engine/mcp-server/build/index.js"),
    )
)


# Opt-in, and NOT via ANTHROPIC_API_KEY: conftest.py blanks that var on import
# to keep the operator key out of test assertions. `make agent-smoke` sources
# eval/.env and exports it under this name. Setting it is the opt-in.
_LIVE_KEY = os.environ.get("LIVE_ANTHROPIC_API_KEY", "")

# Set only by the `agent-smoke` Makefile target — i.e. by someone who asked for
# THIS check specifically, rather than by `make server-test` sweeping the file
# up with the rest of the suite. The distinction is the whole point: a skip is
# correct for a contributor with no key, and wrong for the one command whose
# entire job is to run this test. Without it `make agent-smoke` printed
# "143 passed, 1 skipped" and read as fully green — indistinguishable from the
# check having run.
_INVOKED_AS_SMOKE = bool(os.environ.get("AGENT_SMOKE"))


def _missing_prerequisites() -> list[str]:
    """What stops the live check from running, each with its remedy.

    One list, read twice: as the skip reason for an ordinary suite run, and as
    the failure message when `make agent-smoke` asked for this check by name.
    """
    missing = []
    if not _LIVE_KEY:
        missing.append(
            "no Anthropic key — set ANTHROPIC_API_KEY, or put ANTHROPIC_API_KEY=... "
            "in eval/.env (no model call is made; the CLI just refuses to start "
            "without one)"
        )
    if not _ENGINE_BUILD.exists():
        missing.append(f"no compiled engine at {_ENGINE_BUILD} — run `make engine-build`")
    if shutil.which("node") is None:
        missing.append("node is not on PATH — the MCP server is a node process")
    return missing


@pytest.mark.skipif(
    bool(_missing_prerequisites()) and not _INVOKED_AS_SMOKE,
    reason=(
        "live check — run `make agent-smoke`: "
        + "; ".join(_missing_prerequisites())
    ),
)
async def test_bare_agent_names_are_registered(tmp_path, monkeypatch):
    """Start a real SDK client with the hosted options and assert every shipped
    agent is registered under its BARE name.

    `get_server_info()` returns the init handshake, which carries the runtime's
    resolved agent list — the ground truth a Task call is matched against, read
    without spending a token. Before the fix this list held only
    `genealogy-research:record-extractor` and friends.

    This spawns a CLI process but issues NO query, so it bills nothing; the key
    is needed only because the CLI refuses to start without one.

    Under `AGENT_SMOKE` a missing prerequisite FAILS instead of skipping. The
    skip is right for a contributor running `make server-test` with no key; it
    is wrong for the one command whose entire job is this check, which reported
    "143 passed, 1 skipped" and read as fully green.
    """
    missing = _missing_prerequisites()
    if missing:
        # Reached only under AGENT_SMOKE — the skipif above covers every other
        # caller. The target sets LIVE_ANTHROPIC_API_KEY to the empty string
        # when neither source supplies a key, so a missing key arrives here as
        # a silent skip rather than as a shell error.
        pytest.fail(
            "make agent-smoke could not run the ONLY check that reads what the "
            "runtime resolved the hosted agent options to:\n  - "
            + "\n  - ".join(missing)
        )

    from claude_agent_sdk import ClaudeSDKClient

    monkeypatch.setattr(real_agent, "_PLUGIN_DIR", str(PLUGIN_DIR))
    monkeypatch.setattr(real_agent, "_MCP_BUILD", str(_ENGINE_BUILD))

    client = ClaudeSDKClient(options=real_agent.build_options(tmp_path, api_key=_LIVE_KEY))
    await client.connect()
    try:
        info = await client.get_server_info() or {}
    finally:
        await client.disconnect()

    registered = {a["name"] for a in info.get("agents", [])}
    missing = {p.stem for p in _shipped_agents()} - registered
    assert not missing, (
        f"plugin agents not registered under their bare names: {sorted(missing)}; "
        f"runtime offers {sorted(registered)}"
    )
