"""calibrate_judge must read eval/.env, and must fail loudly without a key.

The judge reads ANTHROPIC_API_KEY from the process env; the key normally lives
in eval/.env. calibrate_judge used to be the only e2e entry point that didn't
load it, so `make e2e-calibrate` on a machine with the key only in eval/.env
graded nothing, errored on every case, and — because case errors block the
target — reported "BELOW target". An auth misconfiguration is not a
judge-quality result, and must not be reported as one.
"""

from __future__ import annotations

import subprocess
import sys

from e2e import calibrate_judge


def test_calibrate_judge_does_not_import_agent_sdk():
    """Calibration stays runnable offline — the shared env helper must not drag
    in claude_agent_sdk the way importing run_e2e would (calibrate_judge's
    module docstring depends on this). Checked in a subprocess: under pytest,
    sibling test modules have already imported the SDK into sys.modules, so an
    in-process assertion would pass vacuously.
    """
    proc = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; import e2e.calibrate_judge; "
            "print('claude_agent_sdk' in sys.modules)",
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip() == "False", (
        "calibrate_judge now pulls in claude_agent_sdk at import time — "
        "it must stay runnable offline"
    )


def test_env_helper_is_shared_with_run_e2e():
    """One loader, not two copies (the repo's code-reuse rule)."""
    from e2e.env import load_env_file as shared
    from e2e.run_e2e import load_env_file as reexported

    assert calibrate_judge.load_env_file is shared
    assert reexported is shared


def test_missing_key_aborts_before_grading(tmp_path, monkeypatch, capsys):
    """No key -> exit 2 with an auth message, and zero judge calls. The old
    behavior graded every case into an auth error and printed BELOW target."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    # eval/.env may exist on a dev machine — point the loader at an empty dir
    # so the test measures the no-key path rather than the developer's key.
    monkeypatch.setattr(calibrate_judge, "load_env_file", lambda *a, **k: None)

    monkeypatch.setattr(
        calibrate_judge, "load_annotated_runs",
        lambda *a, **k: ([{"slug": "x"}], []),
    )

    def _boom(*a, **k):  # pragma: no cover - must never run
        raise AssertionError("graded a case despite having no API key")

    monkeypatch.setattr(calibrate_judge, "grade_case", _boom)

    runlog_root = tmp_path / "runlogs"
    runlog_root.mkdir()
    rc = calibrate_judge.main(["--runlog-root", str(runlog_root)])

    assert rc == 2
    err = capsys.readouterr().err
    assert "ANTHROPIC_API_KEY" in err
    assert "not a calibration result" in err
    assert "BELOW target" not in err


def test_key_present_proceeds_to_grading(tmp_path, monkeypatch):
    """With a key, the sweep runs — the guard must not block the happy path."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setattr(calibrate_judge, "load_env_file", lambda *a, **k: None)
    monkeypatch.setattr(
        calibrate_judge, "load_annotated_runs",
        lambda *a, **k: ([{"slug": "x"}], []),
    )
    graded = []
    monkeypatch.setattr(
        calibrate_judge, "grade_case",
        lambda case, model=None: graded.append(case) or _stub_result(),
    )
    monkeypatch.setattr(calibrate_judge, "print_report", lambda r: None)
    monkeypatch.setattr(
        calibrate_judge.CalibrationReport, "meets_target", property(lambda self: True)
    )

    runlog_root = tmp_path / "runlogs"
    runlog_root.mkdir()
    rc = calibrate_judge.main(["--runlog-root", str(runlog_root)])

    assert graded, "expected the sweep to grade the case"
    assert rc == 0


def _stub_result():
    from e2e.calibrate_judge import CaseResult

    return CaseResult(case_id="x/run-1")
