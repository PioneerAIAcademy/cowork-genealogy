"""The unit harness's step boundary: opt-in, and inert until a test asks for it.

The gate itself is tested twice over -- the pure predicate in
`test_step_boundary.py`, the stateful half in `apps/server/tests/test_step_gate.py`.
What is tested HERE is the wiring: that the harness loads the same file the worker
does, that a test with no `execution.step_mode` gets no boundary at all, and that
the mode a test declares reaches the runner.

The default matters more than it looks. Enforcing by default would change what every
test in the committed corpus measures, and the only place that would show is a PAID
run -- so the default is the one that cannot surprise anyone.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "eval" / "harness"))

from harness import orchestrator  # noqa: E402
from harness import skill_runner  # noqa: E402


# ── the harness loads the plugin's own copy ─────────────────────────────────────


def test_the_harness_loads_the_same_file_the_worker_does():
    """One copy, three planes. A second copy would drift exactly as the
    write-lockdown's did (#1228)."""
    assert skill_runner._STEP_BOUNDARY == (
        REPO / "packages" / "engine" / "plugin" / "hooks" / "step_boundary.py"
    )
    assert skill_runner._STEP_BOUNDARY.is_file()


def test_the_loaded_module_carries_the_predicate_and_the_gate():
    boundary = skill_runner.load_step_boundary()
    assert callable(boundary.step_allowed)
    assert callable(boundary.step_mode)
    gate = boundary.StepGate(boundary=boundary, mode="step")
    assert gate.check("Task", {"subagent_type": "search-records"}, subagent=False) is None
    assert gate.check("Task", {"subagent_type": "proof-conclusion"}, subagent=False)[0] == "deny"


def test_a_missing_boundary_raises_rather_than_enforcing_nothing(monkeypatch, tmp_path):
    monkeypatch.setattr(skill_runner, "_STEP_BOUNDARY", tmp_path / "absent.py")
    with pytest.raises((ImportError, FileNotFoundError)):
        skill_runner.load_step_boundary()


# ── the per-test mode ───────────────────────────────────────────────────────────


class _Spec:
    def __init__(self, execution):
        self.execution = execution


@pytest.mark.parametrize(
    "execution,expected",
    [
        (None, None),
        ({}, None),
        ({"stop_at_stub": True}, None),
        ({"step_mode": "step"}, "step"),
        ({"step_mode": "job"}, "job"),
        ({"step_mode": "wrapup"}, "wrapup"),
        ({"step_mode": ""}, None),
        ({"step_mode": "   "}, None),
        ({"step_mode": 3}, None),
    ],
)
def test_the_mode_is_read_off_the_test(execution, expected):
    assert orchestrator._step_mode(_Spec(execution)) is expected or \
        orchestrator._step_mode(_Spec(execution)) == expected


def test_no_declared_mode_means_no_boundary_which_is_the_whole_corpus_today():
    """Every committed test omits it, so none of them changes behaviour."""
    corpus = sorted((REPO / "eval" / "tests" / "unit").glob("*/*.json"))
    assert corpus, "no tests found; this assertion would pass vacuously"
    declaring = [
        p.relative_to(REPO).as_posix()
        for p in corpus
        if isinstance(
            (json.loads(p.read_text(encoding="utf-8")).get("execution") or {}).get("step_mode"),
            str,
        )
    ]
    assert declaring == [], (
        f"these tests declare execution.step_mode: {declaring}. That is allowed, but each one "
        "changes what that test measures and owes a paid run, so it must be a deliberate choice "
        "rather than something that arrived with a refactor."
    )


# ── the schema admits it, and only the three modes ──────────────────────────────


def test_the_schema_admits_the_three_modes_and_nothing_else():
    schema = json.loads(
        (REPO / "docs" / "specs" / "schemas" / "unit-test.schema.json").read_text(encoding="utf-8")
    )
    field = schema["properties"]["execution"]["properties"]["step_mode"]
    assert field["enum"] == ["step", "job", "wrapup"]
    assert "step_mode" not in (schema["properties"]["execution"].get("required") or [])


# ── rider 3: three planes, one file ─────────────────────────────────────────────


def test_all_three_planes_load_the_same_boundary_file():
    """The worker, the unit harness and the e2e orchestrator each load the plugin's
    `step_boundary.py` with importlib. Three loaders, ONE file -- which is the whole
    reason StepGate lives in the plugin rather than in the worker.

    A plane that grew its own copy would drift exactly as the write-lockdown's three
    copies did, one of which was a silent no-op on Windows for two releases (#1228).
    """
    sys.path.insert(0, str(REPO / "apps" / "server"))
    from e2e import orchestrator
    from proto.worker import options

    expected = REPO / "packages" / "engine" / "plugin" / "hooks" / "step_boundary.py"
    assert skill_runner._STEP_BOUNDARY == expected
    assert orchestrator._STEP_BOUNDARY == expected
    # The worker resolves its path through ENGINE_PLUGIN_DIR, so compare what it loads.
    assert options._default_plugin_dir() / "hooks" / "step_boundary.py" == expected


def test_each_plane_gets_a_module_carrying_the_gate():
    sys.path.insert(0, str(REPO / "apps" / "server"))
    from e2e import orchestrator
    from proto.worker import options

    for load in (skill_runner.load_step_boundary, orchestrator.load_step_boundary,
                 options.load_step_boundary):
        module = load()
        assert callable(module.step_allowed), load
        assert hasattr(module, "StepGate"), load
