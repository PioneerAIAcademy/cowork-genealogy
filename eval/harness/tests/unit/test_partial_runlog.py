"""Tests for the partial (in-progress) run-log helpers — the Ctrl-C safety
net that keeps completed tests when a harness run is stopped part-way.
"""

import json

import pytest

from harness.runlog import (
    JudgeResult,
    SingleRun,
    ValidatorResult,
    assemble_test_entry,
    build_run_log,
    partial_runlog_path,
    promote_partial_to_scratch,
    validate_run_log,
    write_partial_runlog,
)
from harness.versioning import classify


def _entry(test_id="ut_demo_001", outcome="pass"):
    run = SingleRun(
        outcome=outcome,
        aborted_reason=None,
        duration_ms=1000.0,
        input_tokens=100,
        cached_input_tokens=0,
        output_tokens=10,
        skill_cost_usd=0.01,
        output={
            "text_response": "did the thing",
            "activated": True,
            "skills_invoked": ["search-familysearch-wiki"],
            "tool_calls": [],
            "files_created": [],
        },
        validators=ValidatorResult(passed=True, results=[]),
        judge=JudgeResult(
            skipped=False,
            dimensions=[
                {"source": "base", "name": "Correctness", "score": 3, "rationale": "ok"},
                {"source": "base", "name": "Completeness", "score": 3, "rationale": "ok"},
                {"source": "base", "name": "Tool Arguments", "score": None,
                 "rationale": "no tool calls — N/A"},
            ],
            judge_cost_usd=0.001,
        ),
    )
    return assemble_test_entry(
        test_id=test_id,
        test_type="positive",
        expected_outcome="pass",
        scenario=None,
        mcp_fixtures=[],
        runs=[run],
        timestamp_for_run_id="2026-06-28_10-00-00",
    )


def _envelope(entries):
    # A partial is always scratch-shaped: no version, not releasable.
    return build_run_log(
        skill="search-familysearch-wiki",
        version=None,
        released=False,
        releasable=False,
        invocation="skill",
        timestamp="2026-06-28_10-00-00",
        harness_version="0.2.0",
        model="claude-sonnet-4-6",
        judge_prompt_hash="a" * 64,
        snapshot={},
        tests=entries,
    )


TS = "2026-06-28_10-00-00"
SKILL = "search-familysearch-wiki"


def test_write_partial_creates_dotfile_thats_a_valid_envelope(tmp_path):
    log = _envelope([_entry()])
    out = write_partial_runlog(log, runlogs_root=tmp_path, skill=SKILL, timestamp=TS)

    assert out == partial_runlog_path(tmp_path, SKILL, TS)
    assert out.name == f".partial_{TS}.json"
    # Round-trips and still validates against the v2 schema.
    reloaded = json.loads(out.read_text(encoding="utf-8"))
    validate_run_log(reloaded)
    assert len(reloaded["tests"]) == 1


def test_partial_dotfile_is_not_classified_as_a_run_log():
    # The dotfile must stay invisible to version numbering / the release gate.
    assert classify(f".partial_{TS}.json").kind == "other"


def test_write_partial_overwrites_in_place_and_leaves_no_tmp(tmp_path):
    write_partial_runlog(_envelope([_entry("ut_a")]),
                         runlogs_root=tmp_path, skill=SKILL, timestamp=TS)
    out = write_partial_runlog(_envelope([_entry("ut_a"), _entry("ut_b")]),
                               runlogs_root=tmp_path, skill=SKILL, timestamp=TS)

    reloaded = json.loads(out.read_text(encoding="utf-8"))
    assert len(reloaded["tests"]) == 2  # second write replaced the first
    # The atomic-write staging file is gone.
    assert not (out.parent / (out.name + ".tmp")).exists()
    assert list(out.parent.glob(".partial_*")) == [out]


def test_promote_partial_to_scratch_renames(tmp_path):
    partial = write_partial_runlog(_envelope([_entry()]),
                                   runlogs_root=tmp_path, skill=SKILL, timestamp=TS)
    scratch = promote_partial_to_scratch(partial, timestamp=TS)

    assert scratch.name == f"scratch_{TS}.json"
    assert classify(scratch.name).kind == "scratch"
    assert not partial.exists()  # the dotfile was moved, not copied
    validate_run_log(json.loads(scratch.read_text(encoding="utf-8")))


# --- the flush guard -------------------------------------------------------
#
# `_flush_partials()` is called from inside the drain loop, whose `try` catches
# only KeyboardInterrupt. Anything else escaping it unwinds past the summary,
# the promote-to-scratch block and the return, so every finished test is left
# in a gitignored dotfile that nothing surfaces. That is how one out-of-range
# `judge_cost_usd` took a whole suite down: `build_run_log` validates, so a
# schema violation on one test discarded the others.
#
# `test_cli.py` cannot catch this — it monkeypatches `write_partial_runlog`
# away in every test that drives `main()`, so the failure mode is invisible
# there by construction. Hence this test, with a writer that really raises.

import sys as _sys
from pathlib import Path as _Path

_HARNESS_ROOT = _Path(__file__).resolve().parents[2]
if str(_HARNESS_ROOT) not in _sys.path:
    _sys.path.insert(0, str(_HARNESS_ROOT))

import run_tests as _run_tests  # noqa: E402


def test_a_raising_partial_writer_does_not_discard_finished_tests(tmp_path, monkeypatch):
    """A failure in the save step must not lose the work it is saving.

    The writer here succeeds once and raises forever after — the real shape,
    since `build_run_log` re-validates every completed entry on each flush, so
    one bad entry poisons every flush after it while the earlier partial is
    already on disk. The run must still reach the promote-to-scratch block and
    report a failure, rather than unwinding and stranding the dotfile.
    """
    import json as _json
    from harness.auth import AuthConfig

    # main()'s staleness gate runs before anything else and exits 2 on a
    # checkout without a compiled engine, which would mask the behaviour under
    # test. Nothing here executes a real skill, so the gate is not needed.
    # (test_cli.py isolates itself the same way, via an autouse fixture.)
    monkeypatch.setattr(_run_tests, "_check_mcp_build_fresh", lambda: [])

    # Likewise the judge key-validity preflight, which would otherwise make a
    # real API call and abort on the stub key.
    import anthropic as _anthropic

    class _FakeMessages:
        def create(self, **kwargs):
            return None

    class _FakeClient:
        def __init__(self, **kwargs):
            self.messages = _FakeMessages()

    monkeypatch.setattr(_anthropic, "Anthropic", _FakeClient)

    root = tmp_path / "unit"
    skill_dir = root / "skill-a"
    skill_dir.mkdir(parents=True)
    (skill_dir / "rubric.md").write_text(
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n",
        encoding="utf-8",
    )
    for i in range(3):
        (skill_dir / f"t{i}.json").write_text(_json.dumps({
            "test": {"id": f"ut_a_{i:03d}", "skill": "skill-a", "name": "n",
                     "type": "positive", "description": "x", "tags": []},
            "input": {"user_message": "m", "scenario": None},
            "judge_context": [],
        }), encoding="utf-8")

    monkeypatch.setattr(
        _run_tests, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )
    monkeypatch.setattr(_run_tests, "run_one_test",
                        lambda spec, **kw: _entry(test_id=spec.id, outcome="pass"))
    monkeypatch.setattr(_run_tests, "write_run_log",
                        lambda log, *, runlogs_root, filename, **kw: tmp_path / filename)

    calls = {"n": 0}
    real_partial = _run_tests.write_partial_runlog

    def flaky_partial(log, *, runlogs_root, skill, timestamp):
        calls["n"] += 1
        if calls["n"] == 1:
            return real_partial(log, runlogs_root=runlogs_root, skill=skill,
                                timestamp=timestamp)
        raise ValueError("-0.0001 is less than the minimum of 0")

    monkeypatch.setattr(_run_tests, "write_partial_runlog", flaky_partial)

    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()
    rc = _run_tests.main([
        "--skill", "skill-a",
        "--tests-dir", str(root), "--runlogs-root", str(runlogs),
        "--concurrency", "1",
    ])

    # Reported as a harness failure rather than a clean run...
    assert rc == 1
    # ...the raising path was taken (call 2), and submission then STOPPED —
    # a third call would mean test 3 was run, judged and paid for after the
    # guard fired, which is what stop_submitting exists to prevent.
    assert calls["n"] == 2, (
        "stop_submitting must halt the third test; a third flush means it did not"
    )
    # ...and the finished work survives as a scratch log the CRUD UI can open,
    # not as an orphaned gitignored dotfile.
    scratch = list((runlogs / "unit" / "skill-a").glob("scratch_*.json"))
    assert scratch, "the partial that DID land was never promoted to a scratch run log"
