"""Unit tests for scripts/gh_annotations.py — the warn-only lints' shared sink.

The property under test is narrow and the whole point of the module: every
warning a lint emits reaches `$GITHUB_STEP_SUMMARY`, which has no render cap,
while `::warning::` annotations keep going to stdout for the first ten GitHub
chooses to draw. A lint whose warnings only exist as annotations is a lint the
PR author cannot read past #10.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"


def _load(name: str):
    """Load a scripts/ module the way the CI job does — by path, not package."""
    spec = importlib.util.spec_from_file_location(name, SCRIPTS_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def gh(monkeypatch, tmp_path: Path):
    module = _load("gh_annotations")
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    module.reset()
    return module, summary


def test_every_warning_reaches_the_uncapped_summary(gh, capsys):
    """GitHub renders 10 annotations per step; these lints emit ~186. All of
    them must land in the summary, or most of the signal is invisible to the
    author of the PR that tripped it."""
    module, summary = gh
    for i in range(25):
        module.gh_warning(f"warning number {i}", file=f"path/to/file{i}.md")
    module.write_step_summary("Some lint (warn-only)")

    body = summary.read_text(encoding="utf-8")
    for i in range(25):
        assert f"warning number {i}" in body
    assert body.count("\n- ") == 25
    assert "25 warning(s)" in body

    # Annotations still go to stdout unchanged — the summary is a second sink,
    # not a replacement.
    out = capsys.readouterr().out
    assert out.count("::warning file=") == 25


def test_a_clean_run_still_writes_its_section(gh):
    """"No warnings" and "the lint never ran" must not look the same in the
    job summary."""
    module, summary = gh
    module.write_step_summary("Some lint (warn-only)")

    body = summary.read_text(encoding="utf-8")
    assert "### Some lint (warn-only)" in body
    assert "No warnings." in body


def test_the_summary_is_appended_so_three_lints_can_share_one_file(gh):
    """The three lints are three steps writing one $GITHUB_STEP_SUMMARY. A
    truncating write would leave only the last one's warnings."""
    module, summary = gh
    module.gh_warning("first lint's finding")
    module.write_step_summary("First lint")
    module.reset()
    module.gh_warning("second lint's finding")
    module.write_step_summary("Second lint")

    body = summary.read_text(encoding="utf-8")
    assert "first lint's finding" in body
    assert "second lint's finding" in body


def test_outside_actions_nothing_is_written(monkeypatch, tmp_path: Path, capsys):
    """A developer running the script by hand sees the stdout they always did,
    and no stray file appears."""
    module = _load("gh_annotations")
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    module.reset()
    module.gh_warning("something")
    module.write_step_summary("Some lint")

    assert "::warning::something" in capsys.readouterr().out
    assert list(tmp_path.iterdir()) == []


def test_an_unwritable_summary_never_fails_the_lint(monkeypatch, tmp_path: Path, capsys):
    """These lints have already decided not to block the build. A diagnostic
    write that raised would turn a warn-only check into a red one."""
    module = _load("gh_annotations")
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(tmp_path / "no-such-dir" / "s.md"))
    module.reset()
    module.gh_warning("something")
    module.write_step_summary("Some lint")  # must not raise

    assert "could not write the step summary" in capsys.readouterr().out


@pytest.mark.parametrize(
    "script",
    ["check_tool_coverage", "check_rubric_tool_drift", "check_negative_reciprocity"],
)
def test_each_warn_only_lint_writes_a_summary_section(script, monkeypatch, tmp_path: Path):
    """End to end against the real corpus: run the lint the way CI does and
    assert it left a section behind. Each is warn-only, so the exit code is
    pinned at 0 in the same breath — this change must not turn any of them into
    a gate."""
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    module = _load(script)

    assert module.main() == 0
    assert summary.exists(), f"{script} wrote no step summary"
    assert summary.read_text(encoding="utf-8").lstrip().startswith("### ")
