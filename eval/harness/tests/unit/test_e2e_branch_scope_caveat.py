"""Every e2e corpus reader must print the branch-scope caveat on its
empty-corpus path (issue #1444).

Before this test, the caveat was only proven for the *found-runs* path
(via `describe_window()`, exercised incidentally by other tests) and for
`inventory.py`'s unconditional print (`test_e2e_inventory.py`). The
empty-corpus path -- a bare `print("No committed runs found...")` followed
by `return 1` -- carried no caveat at all, which is exactly backwards: an
empty read is the one case a reader cannot rule out "the run exists, just
on another branch I haven't fetched" (the elena-asmundsdotter-origin case
T-FEH's review found live). Each reader below is called through its own
`main(argv)` with a fixture slug guaranteed not to exist, forcing the
empty-corpus branch.
"""

from __future__ import annotations

import pytest

from e2e import (
    agent_tool_usage_report,
    compaction_report,
    corpus_report,
    detector_before_after_report,
    guardrail_shadow_report,
    image_transcribe_report,
    nudge_report,
    skill_episode_report,
    wiki_failure_report,
)

_MISSING_SLUG = "nonexistent-fixture-slug-for-branch-scope-caveat-test"

# (module, extra argv beyond --test <slug>)
_READERS = [
    (corpus_report, []),
    (agent_tool_usage_report, []),
    (compaction_report, []),
    (guardrail_shadow_report, []),
    (image_transcribe_report, []),
    (nudge_report, []),
    (skill_episode_report, []),
    (wiki_failure_report, []),
    (detector_before_after_report, ["--detector", "lane-check"]),
]


@pytest.mark.parametrize(
    "module, extra_argv", _READERS, ids=[m.__name__ for m, _ in _READERS]
)
def test_empty_corpus_path_prints_the_branch_scope_caveat(module, extra_argv, capsys):
    rc = module.main([*extra_argv, "--test", _MISSING_SLUG])
    assert rc == 1
    err = capsys.readouterr().err
    assert "Scoped to this checkout" in err
    assert "make e2e-branch-only" in err


def test_latency_report_prints_the_caveat_on_a_not_found_test(capsys):
    from e2e import latency_report

    rc = latency_report.main(["--test", _MISSING_SLUG])
    assert rc == 1
    err = capsys.readouterr().err
    assert "Scoped to this checkout" in err


def test_latency_report_prints_the_caveat_on_a_found_test(capsys, tmp_path, monkeypatch):
    """The bug T-FEH found: `--test <slug>` never reached `describe_window()`
    (buried inside `if args.all:`), so a FOUND run got no caveat either --
    not just the not-found path above."""
    from e2e import latency_report

    run = tmp_path / "run-2026-08-01_00-00-00.json"
    run.write_text(
        '{"fixture": "found-slug", "duration_ms": 1000, "phases": {}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(latency_report, "latest_run_for", lambda slug: run)
    monkeypatch.setattr(latency_report, "_load", lambda p: {"fixture": "found-slug"})
    monkeypatch.setattr(latency_report, "format_breakdown", lambda bd: "")

    rc = latency_report.main(["--test", "found-slug"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "Scoped to this checkout" in out
