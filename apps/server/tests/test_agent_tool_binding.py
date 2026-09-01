"""A granted tool must actually BIND at runtime — issue #1084.

Every other check stops at spelling. `test_plugin_agents.py` proves the agent is
registered under its bare name and its `tools:` entries name real tools under the
right spellings — but not that the agent can actually CALL them. The silent-failure
mode: the agent spawns fine, `tools:` looks right, the grant never binds, and the
agent quietly falls back to what it does have. That reads as success in every static
check and every eval.

The SDK init handshake cannot close this (it exposes agent name/description/model,
never tools — issue #1084's measurement). The only proof is behavioral: force the
agent to call the tool and read the recorded tool_use.

This is the repo's FIRST check that spends a model turn (`agent-smoke` bills nothing).
It is the most model-dependent thing in the check tier. Per the lead's ruling
(2026-08-27): if it proves flaky, DELETE it — do not loosen the assertion into
something that passes on narration. Scope is deliberately one agent × one tool × one
turn: gps-mentor × wiki_search, the one live case issue #1344 surfaced. A green probe
covers the `mcp__genealogy__` spelling only; it does not close the nothing-checks gap.

Opt-in exactly like `agent-smoke`: skipped under an ordinary suite run, and FAILED
(never skipped) when `make agent-tool-bind` (`AGENT_TOOL_BIND=1`) asked for it by name.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

import pytest

from app.agent import real_agent

REPO_ROOT = Path(__file__).resolve().parents[3]
PLUGIN_DIR = REPO_ROOT / "packages" / "engine" / "plugin"

_ENGINE_BUILD = Path(
    os.environ.get(
        "ENGINE_MCP_BUILD",
        str(REPO_ROOT / "packages/engine/mcp-server/build/index.js"),
    )
)

# Opt-in, and NOT via ANTHROPIC_API_KEY: conftest.py blanks that var on import.
# `make agent-tool-bind` sources eval/.env and exports it under this name.
_LIVE_KEY = os.environ.get("LIVE_ANTHROPIC_API_KEY", "")

# Set only by the `agent-tool-bind` target — i.e. by someone who asked for THIS
# check. A skip is right for a contributor with no key; it is wrong for the one
# command whose entire job is to run this probe (see test_plugin_agents.py).
_INVOKED_AS_PROBE = bool(os.environ.get("AGENT_TOOL_BIND"))

_TARGET_AGENT = "gps-mentor"
_TARGET_TOOL = "wiki_search"

# Force delegation to gps-mentor and a single wiki_search call. The main session
# also holds wiki_search, so the assertion below reads gps-mentor's OWN transcript,
# not "was the tool called anywhere" — a main-agent call must not pass.
_PROMPT = (
    "Use the Task tool to launch the gps-mentor subagent, and do nothing else "
    "yourself. Give it EXACTLY this instruction: \"Call the wiki_search tool once "
    "with the query 'Ireland civil registration'. Report the title of the first "
    "result verbatim. Call no other tool.\""
)


def _missing_prerequisites() -> list[str]:
    """What stops the live probe from running, each with its remedy. Read twice:
    as the skip reason for an ordinary run, and as the failure message when
    `make agent-tool-bind` asked for this check by name."""
    missing = []
    if not _LIVE_KEY:
        missing.append(
            "no Anthropic key — set ANTHROPIC_API_KEY, or put ANTHROPIC_API_KEY=... "
            "in eval/.env (this probe spends one model turn, so it needs a real key)"
        )
    if not _ENGINE_BUILD.exists():
        missing.append(f"no compiled engine at {_ENGINE_BUILD} — run `make engine-build`")
    if shutil.which("node") is None:
        missing.append("node is not on PATH — the MCP server is a node process")
    return missing


def _bare_tool_name(name: str) -> str:
    """`mcp__genealogy__wiki_search` / `mcp__…__wiki_search` -> `wiki_search`."""
    return (name or "").split("__")[-1]


def _subagent_tool_calls(project_dir: Path, agent_type: str) -> list[str] | None:
    """The bare tool names recorded in `agent_type`'s OWN subagent transcript for
    this run, or None if that agent produced no transcript.

    Subagent transcripts live at
    `~/.claude/projects/<slug>/**/subagents/agent-*.jsonl` (+ a `<stem>.meta.json`
    carrying `agentType`). The CLI slugifies the workspace path into <slug>,
    rewriting `_` / `.` / `/` to `-`, and the match is `slug.endswith(leaf)` — which
    is why the caller's workspace leaf must be dash/alnum only (no underscores), or
    this never matches and every run looks like "agent not spawned" (issue #1084
    plan review). Reimplemented inline rather than importing
    eval/harness/e2e/subagent_capture (a separate uv project, not importable here)."""
    projects = Path.home() / ".claude" / "projects"
    if not projects.is_dir():
        return None
    leaf = project_dir.name
    jsonls: list[Path] = []
    for d in projects.iterdir():
        if d.is_dir() and d.name.endswith(leaf):
            jsonls.extend(d.rglob("agent-*.jsonl"))

    # Pick this agent's transcript by its meta `agentType`. No fallback: a transcript
    # whose meta names a DIFFERENT agent must not be read as this one, or a
    # general-purpose stand-in (issue #939) passes the probe — that stand-in is not
    # bound by gps-mentor's `tools:`, so it CAN call wiki_search, and a spawn failure
    # would report as a bound grant. Measured across 665 committed subagent summaries:
    # `agentType` is non-null in every one, so the missing-meta case a fallback would
    # cover has never occurred, while 19 general-purpose stand-ins have.
    # UNION every matching transcript rather than picking one. gps-mentor is
    # delegated more than once in ordinary runs, `rglob` order carries no dispatch
    # information (real names are `agent-<random hex>`), and the reference function
    # this reimplements -- `subagent_capture.find_subagent_transcripts` -- sorts by
    # mtime for exactly that reason. First-match could report a BOUND grant as
    # unbound: two gps-mentor transcripts, one recording `Read` and one
    # `wiki_search`, would return only `['Read']` and fail with the very message
    # this probe exists to raise. Every match's meta already names gps-mentor, so a
    # `wiki_search` in any of them proves the grant bound.
    mine: list[Path] = []
    for jsonl in jsonls:
        meta = jsonl.parent / (jsonl.stem + ".meta.json")
        if meta.exists():
            try:
                at = json.loads(meta.read_text(encoding="utf-8")).get("agentType")
            except (OSError, json.JSONDecodeError):
                continue
            # Observed bare ("gps-mentor") in the passing run; also accept a
            # namespaced form ("genealogy-research:gps-mentor") so the primary
            # match stays live if the SDK ever namespaces it, rather than
            # silently leaning on the sole-transcript fallback below.
            if isinstance(at, str) and at.split(":")[-1] == agent_type:
                mine.append(jsonl)
    if not mine:
        return None

    calls: list[str] = []
    for jsonl in mine:
        for line in jsonl.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            content = (rec.get("message") or {}).get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    calls.append(_bare_tool_name(block.get("name", "")))
    return calls


# Gated on the OPT-IN FLAG, never on a missing prerequisite. Keying the skip on
# `_missing_prerequisites()` meant anyone holding a live key with a built engine
# spent a model turn on a plain `make server-test` or `make test-all` without
# asking. This is the only check in the repo that bills, so the flag is the gate.
@pytest.mark.skipif(
    not _INVOKED_AS_PROBE,
    reason="live probe that SPENDS A MODEL TURN — run `make agent-tool-bind`",
)
async def test_gps_mentor_wiki_search_grant_binds(monkeypatch):
    """Spawn gps-mentor for real, force one wiki_search call, and assert it appears
    in gps-mentor's OWN tool-call record.

    Asserts on the tool_use RECORD, never the prose: a model that narrates "I would
    call wiki_search" leaves no tool_use and must fail. The recorded call proves the
    grant bound even if the wiki API then errors (the tool_use is the request,
    emitted before the tool runs; any error is a separate tool_result).
    """
    missing = _missing_prerequisites()
    if missing:
        # Reached only under AGENT_TOOL_BIND — the skipif covers every other caller.
        pytest.fail(
            "make agent-tool-bind could not run the ONLY check that proves a granted "
            "tool actually binds at runtime:\n  - " + "\n  - ".join(missing)
        )

    from claude_agent_sdk import ClaudeSDKClient

    monkeypatch.setattr(real_agent, "_PLUGIN_DIR", str(PLUGIN_DIR))
    monkeypatch.setattr(real_agent, "_MCP_BUILD", str(_ENGINE_BUILD))

    # Dash/alnum-only leaf (no `_`): the CLI slug transform + endswith match in
    # _subagent_tool_calls require it — pytest's tmp_path leaf has underscores and
    # would never match (issue #1084 plan review, blocking finding).
    project_dir = Path(tempfile.gettempdir()) / f"agent-tool-bind-{uuid.uuid4().hex}"
    project_dir.mkdir()
    try:
        client = ClaudeSDKClient(
            options=real_agent.build_options(project_dir, api_key=_LIVE_KEY)
        )
        await client.connect()
        cost: float | None = None

        async def _drain() -> None:
            nonlocal cost
            await client.query(_PROMPT)
            async for message in client.receive_response():
                # The final ResultMessage carries the turn's billed cost — captured
                # so the run can report the figure the target's help text quotes.
                c = getattr(message, "total_cost_usd", None)
                if isinstance(c, (int, float)):
                    cost = c

        try:
            # A check that bills must have a ceiling. `build_options` sets no
            # max_turns and the receive loop has no time limit, so the FAILING case
            # is the expensive one: the grant does not bind, gps-mentor cannot finish
            # the instruction, and the main agent retries past the ~$0.35 the target
            # promises. Wall clock rather than max_turns because a gps-mentor subagent
            # reaches 66 assistant turns in the corpus and whether those count against
            # the parent's budget is unconfirmed. Cf. the e2e orchestrator, which caps
            # wall clock, inactivity, max_turns and max_cost_usd for the same reason.
            await asyncio.wait_for(_drain(), timeout=300)
        finally:
            await client.disconnect()
        if cost is not None:
            print(f"\n[agent-tool-bind] one-turn cost: ${cost:.4f}")

        calls = _subagent_tool_calls(project_dir, _TARGET_AGENT)
        assert calls is not None, (
            f"no {_TARGET_AGENT} subagent transcript for this run — the agent was not "
            f"spawned as itself (Task delegation failed, or it fell back to a "
            f"general-purpose stand-in). This is a spawn failure, not a binding result."
        )
        assert _TARGET_TOOL in calls, (
            f"{_TARGET_AGENT} spawned but never called {_TARGET_TOOL}; its recorded "
            f"tool_use calls were {sorted(set(calls))}. The `{_TARGET_TOOL}` grant in "
            f"its tools: did not bind — the silent fallback this probe exists to catch."
        )
    finally:
        shutil.rmtree(project_dir, ignore_errors=True)


# ── Offline guards. These bill NOTHING and are deliberately not gated behind
# `_INVOKED_AS_PROBE`: they hold the two properties that decide whether the live
# probe means anything, and both were reverted-green before they existed.


def _write_subagent(
    root: Path, leaf: str, agent_type: str | None, tool: str, name: str = "agent-x"
) -> None:
    """One fake subagent transcript under a fake ~/.claude/projects.

    `name` exists so a test can write TWO transcripts for the same agent -- the
    repeat-delegation case. Real names are `agent-<random hex>`, so the name
    carries no dispatch information either way.
    """
    d = root / ".claude" / "projects" / f"-tmp-{leaf}"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{name}.jsonl").write_text(
        json.dumps({"message": {"content": [{"type": "tool_use", "name": tool, "input": {}}]}})
        + "\n",
        encoding="utf-8",
    )
    if agent_type is not None:
        (d / f"{name}.meta.json").write_text(
            json.dumps({"agentType": agent_type}), encoding="utf-8"
        )


def test_a_different_agents_transcript_is_never_read_as_this_ones(monkeypatch, tmp_path):
    """The #939 failure: Task delegation falls back to a general-purpose stand-in,
    whose transcript is then the ONLY one on disk. A stand-in is not bound by
    gps-mentor's `tools:`, so it CAN call wiki_search — and a sole-transcript
    fallback would read that as proof the grant bound, turning a spawn failure into
    a green probe. Measured before this guard: the fallback returned
    `['wiki_search']` and both live assertions passed."""
    leaf = "agent-tool-bind-deadbeef"
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    _write_subagent(tmp_path, leaf, "general-purpose", "mcp__genealogy__wiki_search")

    assert _subagent_tool_calls(Path("/tmp") / leaf, "gps-mentor") is None, (
        "a transcript whose meta names a DIFFERENT agent was read as this agent's — "
        "a general-purpose stand-in (#939) would pass the live probe"
    )


def test_this_agents_own_transcript_is_still_found(monkeypatch, tmp_path):
    """The positive control, so the guard above cannot pass by matching nothing."""
    leaf = "agent-tool-bind-cafebabe"
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    _write_subagent(tmp_path, leaf, "gps-mentor", "mcp__genealogy__wiki_search")

    assert _subagent_tool_calls(Path("/tmp") / leaf, "gps-mentor") == ["wiki_search"]


def test_namespaced_agent_type_still_matches(monkeypatch, tmp_path):
    """The SDK may namespace it; the bare form is what was observed."""
    leaf = "agent-tool-bind-feedface"
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    _write_subagent(tmp_path, leaf, "genealogy-research:gps-mentor", "mcp__genealogy__wiki_search")

    assert _subagent_tool_calls(Path("/tmp") / leaf, "gps-mentor") == ["wiki_search"]


_GATE_PROBE = """
import importlib.util, sys
sys.path.insert(0, {server!r})
spec = importlib.util.spec_from_file_location("probe", {test!r})
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
mark = [k for k in m.test_gps_mentor_wiki_search_grant_binds.pytestmark
        if k.name == "skipif"]
print("NOMARK" if len(mark) != 1 else ("SKIP" if mark[0].args[0] else "RUNS"))
"""


def _gate_verdict(*, key: bool, flag: bool, prereqs: bool = False) -> str:
    """Import the module in a CHILD process under one key/flag combination and report
    what its skipif actually evaluates to. A child is required: the marker condition
    is evaluated once at import time, so the value in THIS process only reflects the
    environment pytest itself was started in."""
    env = dict(os.environ)
    env.pop("LIVE_ANTHROPIC_API_KEY", None)
    env.pop("AGENT_TOOL_BIND", None)
    if key:
        env["LIVE_ANTHROPIC_API_KEY"] = "sk-not-a-real-key"
    if flag:
        env["AGENT_TOOL_BIND"] = "1"
    if prereqs:
        # Both remaining prerequisites ARE conjurable, so the hazard cell can be
        # evaluated rather than reasoned about: _ENGINE_BUILD reads ENGINE_MCP_BUILD
        # (any existing file satisfies .exists()), and node only has to be findable
        # on PATH. Without this the cell is environment-dependent — with no build a
        # prerequisite-keyed gate skips too, and the assertion passes vacuously
        # against the very bug it exists to catch.
        stub = Path(tempfile.mkdtemp(prefix="agent-tool-bind-stub-"))
        (stub / "node").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        (stub / "node").chmod(0o755)
        env["ENGINE_MCP_BUILD"] = sys.executable
        env["PATH"] = str(stub) + os.pathsep + env.get("PATH", "")
    out = subprocess.run(
        [
            sys.executable,
            "-c",
            _GATE_PROBE.format(server=str(Path(__file__).parents[1]), test=str(Path(__file__))),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
    )
    return out.stdout.strip()


def test_the_billing_probe_is_gated_on_opt_in_not_on_prerequisites():
    """This is the only check in the repo that spends a model turn, so the gate must be
    the OPT-IN FLAG alone. Keyed on `_missing_prerequisites()` as well, anyone holding a
    live key with a built engine billed a turn on a plain `make server-test` or
    `make test-all` without asking.

    The hazard cell is key present + engine built + node on PATH + flag absent, and
    both middle legs are conjurable — `_ENGINE_BUILD` honours `ENGINE_MCP_BUILD`, and
    node need only be on PATH — so that cell is evaluated below. The property is ALSO
    pinned on the gate's SOURCE, the way the #1741 window guard reads the
    orchestrator's, because that assertion names the regression that actually happened
    and gives the better failure message. Evaluating the marker instead does not work — with any
    prerequisite missing the old and new conditions agree, so a value comparison
    passes against the very bug it exists to catch (measured, twice)."""
    src = Path(__file__).read_text(encoding="utf-8")
    gate = src.split("@pytest.mark.skipif(", 1)[1].split("\n)", 1)[0]
    assert "_INVOKED_AS_PROBE" in gate, "the billing probe's gate no longer reads the opt-in flag"
    assert "_missing_prerequisites" not in gate, (
        "the billing probe's skip is keyed on a missing prerequisite again — a developer "
        "with a live key, a built engine and node on PATH is then charged a model turn by "
        "a plain `make server-test` or `make test-all`, without asking. Gate on "
        "AGENT_TOOL_BIND alone; `_missing_prerequisites()` belongs in the pytest.fail "
        "remedy list inside the body, which is reached only under the flag."
    )

    # The two cells that ARE reachable without a built engine, evaluated for real.
    assert _gate_verdict(key=False, flag=False) == "SKIP"
    # Opt-in runs the body: with no key it reaches the pytest.fail remedy list rather
    # than skipping silently, which is what makes `make agent-tool-bind` loud.
    assert _gate_verdict(key=False, flag=True) == "RUNS"

    # The hazard cell itself, EVALUATED rather than asserted about: every prerequisite
    # present and the flag absent must still skip. This catches a gate that re-reads a
    # prerequisite under a spelling that never names _missing_prerequisites — which the
    # source assertion above cannot see, being a substring check.
    assert _gate_verdict(key=True, flag=False, prereqs=True) == "SKIP"


def test_every_matching_transcript_is_unioned_not_just_the_first(monkeypatch, tmp_path):
    """gps-mentor is delegated more than once in ordinary runs, and `rglob` order
    carries no dispatch information. A first-match pick could therefore report a
    BOUND grant as unbound -- the exact defect this probe exists to detect -- by
    reading whichever transcript happens not to hold the `wiki_search` call.

    Measured on the committed corpus: 13 of 64 runs containing gps-mentor spawned
    it more than once, and in 6 of those the transcripts disagree on which tools
    they called. Reverting the union to break-on-first fails this test and nothing
    else in the suite.
    """
    leaf = "agent-tool-bind-d0ubled"
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    _write_subagent(tmp_path, leaf, "gps-mentor", "Read", name="agent-first")
    _write_subagent(
        tmp_path, leaf, "gps-mentor", "mcp__genealogy__wiki_search", name="agent-second"
    )

    calls = _subagent_tool_calls(Path("/tmp") / leaf, "gps-mentor")
    assert calls is not None
    assert sorted(calls) == ["Read", "wiki_search"], (
        "only one gps-mentor transcript was read; a repeat delegation whose "
        f"wiki_search call sits in the other would read as unbound (got {calls})"
    )
