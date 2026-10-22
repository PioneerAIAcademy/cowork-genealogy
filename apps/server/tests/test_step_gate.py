"""The worker's step boundary: deny first, halt only on a second attempt.

This worker is the ONLY plane that enforces the boundary (decision 25). Cowork
ships no hook and the alpha gets nothing, so what is tested here is the whole
enforcement story -- and the halt rate it logs is the only measure we get of how
often a run tries to cross a boundary it was told to stop at.

`StepGate` is the stateful half: the pure predicate lives in the plugin's
`step_boundary.py` and is tested in `eval/harness/tests/unit/test_step_boundary.py`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "apps" / "server"))

from proto.worker import options as o  # noqa: E402


@pytest.fixture()
def boundary():
    return o.load_step_boundary()


def gate(boundary, **kw):
    return o.StepGate(boundary=boundary, **kw)


def spawn(name, tool="Task"):
    return (tool, {"subagent_type": name})


# ── what counts as a step ───────────────────────────────────────────────────────


@pytest.mark.parametrize("tool", sorted(o.STEP_TOOLS))
def test_every_spawn_tool_is_a_step(tool):
    assert o.step_candidate(tool, {"subagent_type": "research-plan"}) == "research-plan"


def test_an_ordinary_tool_is_not_a_step():
    assert o.step_candidate("Read", {"file_path": "/x"}) is None
    assert o.step_candidate("mcp__genealogy__research_append", {}) is None


def test_a_skill_call_names_the_skill():
    assert o.step_candidate("Skill", {"skill": "genealogy-research:research"}) == \
        "genealogy-research:research"


def test_a_spawn_with_no_name_is_not_treated_as_a_step():
    """Better to let an unreadable call through than to deny every call in the turn."""
    assert o.step_candidate("Task", {}) is None
    assert o.step_candidate("Task", {"subagent_type": "   "}) is None
    assert o.step_candidate("Task", None) is None


# ── the boundary ────────────────────────────────────────────────────────────────


def test_the_turns_first_step_is_allowed_and_recorded(boundary):
    g = gate(boundary)
    assert g.check(*spawn("research-plan"), subagent=False) is None
    assert g.steps == ["research-plan"]
    assert g.first_step == "research-plan"


def test_a_group_member_follows_and_an_outsider_is_denied(boundary):
    g = gate(boundary)
    g.check(*spawn("search-records"), subagent=False)
    assert g.check(*spawn("search-images"), subagent=False) is None
    decision, reason = g.check(*spawn("proof-conclusion"), subagent=False)
    assert decision == "deny"
    assert "Continue with" in reason and "end your turn" in reason


def test_the_plugin_prefix_is_cut_at_the_last_colon(boundary):
    """Cowork spawns `genealogy-research:research-plan` (ADR-0005)."""
    g = gate(boundary)
    assert g.check(*spawn("genealogy-research:research-plan"), subagent=False) is None
    assert g.steps == ["research-plan"]


def test_the_router_is_never_recorded_as_a_step(boundary):
    g = gate(boundary)
    assert g.check("Skill", {"skill": "genealogy-research:research"}, subagent=False) is None
    assert g.steps == []


def test_a_subagent_call_is_never_a_step(boundary):
    """Work inside a step is that step running; gating it would cut a step in half."""
    g = gate(boundary)
    g.check(*spawn("search-records"), subagent=False)
    assert g.check(*spawn("proof-conclusion"), subagent=True) is None


# ── deny first, halt second ─────────────────────────────────────────────────────


def test_the_first_crossing_is_denied_and_the_second_halts(boundary):
    g = gate(boundary)
    g.check(*spawn("search-records"), subagent=False)
    assert g.check(*spawn("proof-conclusion"), subagent=False)[0] == "deny"
    assert g.check(*spawn("proof-conclusion"), subagent=False)[0] == "halt"


def test_a_second_crossing_of_a_DIFFERENT_step_also_halts(boundary):
    """The deny says report and end the turn. Spawning anything else ignored it."""
    g = gate(boundary)
    g.check(*spawn("search-records"), subagent=False)
    assert g.check(*spawn("proof-conclusion"), subagent=False)[0] == "deny"
    assert g.check(*spawn("person-evidence"), subagent=False)[0] == "halt"


def test_a_model_that_obeys_the_deny_never_reaches_the_halt(boundary):
    g = gate(boundary)
    g.check(*spawn("search-records"), subagent=False)
    g.check(*spawn("proof-conclusion"), subagent=False)
    assert g.denials == 1


def test_every_crossing_is_logged(boundary):
    """Rider 2: the rate is the only measure we get of Cowork, which has no hook."""
    seen = []
    g = gate(boundary, log=lambda **kw: seen.append(kw), turn_id="t_1")
    g.check(*spawn("search-records"), subagent=False)
    g.check(*spawn("proof-conclusion"), subagent=False)
    g.check(*spawn("proof-conclusion"), subagent=False)
    assert [e["decision"] for e in seen] == ["deny", "halt"]
    assert all(e["ev"] == "step_boundary" and e["turn_id"] == "t_1" for e in seen)
    assert seen[0]["opened_with"] == "search-records"
    assert seen[0]["candidate"] == "proof-conclusion"


# ── redelivery ──────────────────────────────────────────────────────────────────


def test_a_redelivered_attempt_seeds_from_the_turn_row(boundary):
    """The hook is rebuilt per attempt and redelivery is the normal resume path.

    Without the seed a resumed attempt thinks it is starting the turn's first step,
    and lets a SECOND step through in one turn.
    """
    g = gate(boundary, steps=["search-records"])
    assert g.first_step == "search-records"
    assert g.check(*spawn("search-images"), subagent=False) is None
    assert g.check(*spawn("proof-conclusion"), subagent=False)[0] == "deny"


def test_without_the_seed_a_resumed_attempt_would_let_a_second_step_through(boundary):
    """The negative of the test above -- the bug the seed exists to stop."""
    g = gate(boundary)  # no seed
    assert g.check(*spawn("proof-conclusion"), subagent=False) is None


# ── modes ───────────────────────────────────────────────────────────────────────


def test_job_mode_allows_every_step(boundary):
    g = gate(boundary, mode="job")
    g.check(*spawn("search-records"), subagent=False)
    assert g.check(*spawn("proof-conclusion"), subagent=False) is None


def test_wrapup_mode_follows_its_order(boundary):
    g = gate(boundary, mode="wrapup", ctx={"open_items": True})
    assert g.check(*spawn("research-plan"), subagent=False) is None
    assert g.check(*spawn("person-evidence"), subagent=False) is None
    assert g.check(*spawn("search-records"), subagent=False)[0] == "deny"


def test_the_gated_follower_is_denied_when_the_host_could_not_read_ctx(boundary):
    """A host that cannot read research.json passes no ctx: one needless pause,
    never an unasked plan."""
    g = gate(boundary, ctx=None)
    g.check(*spawn("research-exhaustiveness"), subagent=False)
    assert g.check(*spawn("research-plan"), subagent=False)[0] == "deny"
    g2 = gate(boundary, ctx={"open_items": True})
    g2.check(*spawn("research-exhaustiveness"), subagent=False)
    assert g2.check(*spawn("research-plan"), subagent=False) is None


# ── the loader ──────────────────────────────────────────────────────────────────


def test_the_loader_reads_engine_plugin_dir(monkeypatch, tmp_path):
    """worker.py reads ENGINE_PLUGIN_DIR the same way, so the two cannot point at
    different copies of the rule."""
    monkeypatch.setenv("ENGINE_PLUGIN_DIR", str(tmp_path / "nope"))
    with pytest.raises((ImportError, FileNotFoundError)):
        o.load_step_boundary()


def test_a_missing_boundary_is_loud_not_silent(tmp_path):
    """A worker that enforced nothing would look exactly like the feature working."""
    with pytest.raises((ImportError, FileNotFoundError)):
        o.load_step_boundary(tmp_path / "absent.py")
