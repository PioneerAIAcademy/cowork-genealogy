"""Unit tests for scripts/check_slot_queue.py.

The check is warn-only and makes a network call, which is the combination that
produces a silently useless guard: a 403, a parse failure or an AttributeError all
render as a green step with no annotation, and "no queued work" looks exactly the
same. So these tests are weighted towards the degraded paths — every one asserts the
exit code AND the emitted text, because exit 0 is what the check does when it works
too.

Per CLAUDE.md § "A new lint must be proven to fail", both directions are covered:
the fires-correctly cases (skill dir, referenced agent body, unit test JSON) and the
stays-quiet cases (validators, an unqueued skill, an issue with no `**Touches:**`,
a Touches line under a different skill).

The `gh` boundary is injected (`fetch_open_issues(runner=...)`) rather than
monkeypatched globally, and the multi-page case is built from the SHAPE gh really
returns — an array per page — because a stub that hands back one tidy object cannot
catch the flatten bug that shape causes.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

_SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
_SPEC = importlib.util.spec_from_file_location(
    "check_slot_queue", _SCRIPTS / "check_slot_queue.py"
)
check_slot_queue = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(check_slot_queue)

# The gh_annotations module object the script imported its `gh_warning` FROM is the one
# that records warnings. Read the recording off that reference: a second
# `spec_from_file_location` load of the same file is a DIFFERENT module object with its
# own empty `_warnings` list, so every assertion below would pass vacuously.
_recorded = check_slot_queue.gh_warning.__globals__["recorded_warnings"]
_reset = check_slot_queue.gh_warning.__globals__["reset"]


@pytest.fixture(autouse=True)
def repo_root(tmp_path, monkeypatch):
    """Pin the checkout `touches.slot_of` and the own-suite arm read. Against the real
    one, `proof-conclusion` below would change slot the day that skill is converted."""
    root = tmp_path / "repo"
    for skill in ("citation", "timeline", "person-evidence", "proof-conclusion"):
        (root / "packages" / "engine" / "plugin" / "skills" / skill).mkdir(parents=True)
    (root / "packages" / "engine" / "plugin" / "agents").mkdir(parents=True)
    monkeypatch.setattr(check_slot_queue.touches, "REPO_ROOT", str(root))
    return root


@pytest.fixture(autouse=True)
def _clean_warnings():
    _reset()
    yield
    _reset()


def warnings_text() -> str:
    return "\n".join(m for _f, m in _recorded())


# An agent map of the shape skills_referencing_agents returns: one agent body
# delegated to by three skills, which is the case a skill-directory match misses.
AGENT_MAP = {
    "proof-conclusion": {"proof-conclusion", "research", "hypothesis-tracking"},
    "record-extractor": {"record-extraction"},
}


def issue(number: int, body, title: str = "an issue") -> dict:
    return {"number": number, "title": title, "body": body}


# --------------------------------------------------------------------------
# path_to_skills / affected_skills — it fires
# --------------------------------------------------------------------------


def test_a_skill_body_edit_reaches_its_own_skill():
    assert check_slot_queue.path_to_skills(
        "packages/engine/plugin/skills/citation/SKILL.md", AGENT_MAP
    ) == {"citation"}


def test_a_unit_test_json_reaches_its_skill():
    assert check_slot_queue.path_to_skills(
        "eval/tests/unit/proof-conclusion/ut_pc_001.json", AGENT_MAP
    ) == {"proof-conclusion"}


def test_an_agent_body_reaches_every_skill_that_delegates_to_it():
    """The case a skill-directory match gets wrong.

    `packages/engine/plugin/agents/proof-conclusion.md` is in the run-log snapshot of
    every skill whose SKILL.md says `@plugin:proof-conclusion`, not just the skill
    that happens to share its name. If this ever returns only {"proof-conclusion"},
    the expansion through skills_referencing_agents has been dropped.
    """
    got = check_slot_queue.path_to_skills(
        "packages/engine/plugin/agents/proof-conclusion.md", AGENT_MAP
    )
    assert got == {"proof-conclusion", "research", "hypothesis-tracking"}
    assert got != {"proof-conclusion"}


def test_an_agent_nothing_references_reaches_no_skill():
    assert (
        check_slot_queue.path_to_skills(
            "packages/engine/plugin/agents/orphaned-agent.md", AGENT_MAP
        )
        == set()
    )


def test_a_converted_skills_paths_reach_its_own_suite(repo_root):
    """Skill directory gone, agent and suite kept: slot_of names every path
    `agent:<x>`, and the suite of the same name embeds the agent body."""
    root_agents = repo_root / "packages" / "engine" / "plugin" / "agents"
    (root_agents / "convert-dates.md").write_text("# convert-dates\n", encoding="utf-8")
    (repo_root / "eval" / "tests" / "unit" / "convert-dates").mkdir(parents=True)

    for path in ("packages/engine/plugin/skills/convert-dates/SKILL.md",
                 "eval/tests/unit/convert-dates/ut_cd_001.json",
                 "packages/engine/plugin/agents/convert-dates.md"):
        assert check_slot_queue.path_to_skills(
            path, {"convert-dates": {"research"}}
        ) == {"convert-dates", "research"}, path


def test_affected_skills_unions_over_paths():
    assert check_slot_queue.affected_skills(
        [
            "packages/engine/plugin/skills/citation/SKILL.md",
            "eval/tests/unit/timeline/ut_tl_001.json",
            "README.md",
        ],
        AGENT_MAP,
    ) == {"citation", "timeline"}


# --------------------------------------------------------------------------
# path_to_skills — it stays quiet
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        # Validators are NOT a snapshot input: build_snapshot embeds skill dirs,
        # unit tests, referenced agent bodies and referenced fixtures — never
        # eval/harness/**. A validator-only PR stales no run log and buys no run.
        "eval/harness/validators/test_convert_dates.py",
        "eval/harness/harness/snapshot.py",
        # A run log is not an input to the snapshot it certifies, so an issue that
        # names only one takes no slot (touches._SLOT excludes it deliberately).
        "eval/runlogs/unit/citation/v1_2026-09-01_00-00-00.json",
        # Shared fixtures belong to every skill referencing them, so they name no
        # single slot — see path_to_skills' docstring.
        "eval/fixtures/scenarios/some-scenario/research.json",
        "packages/engine/mcp-server/src/tools/research-append.ts",
        "docs/architecture.md",
        ".github/workflows/check-runlogs.yml",
        "",
    ],
)
def test_paths_that_are_not_snapshot_inputs_reach_no_skill(path):
    assert check_slot_queue.path_to_skills(path, AGENT_MAP) == set()


def test_an_empty_changed_path_list_reaches_no_skill():
    """The degenerate input that makes a tool exit 0 having done nothing."""
    assert check_slot_queue.affected_skills([], AGENT_MAP) == set()


# --------------------------------------------------------------------------
# issue_skills — the **Touches:** side
# --------------------------------------------------------------------------


def test_issue_skills_unwraps_the_tuples_paths_from_touches_returns():
    """`paths_from_touches` yields ("file"|"prefix", path) TUPLES.

    Passing the tuple to slot_of raises AttributeError on `path.rstrip("/")`, and
    main()'s blanket failure path would then park the check in its warn-degraded
    branch on every PR while still exiting 0 — invisible. A non-empty result here is
    the pin.
    """
    body = "**Touches:** packages/engine/plugin/skills/citation/SKILL.md\n"
    assert check_slot_queue.issue_skills(body, AGENT_MAP) == {"citation"}


def test_an_issue_touching_an_agent_body_claims_every_delegating_skill():
    body = "**Touches:** packages/engine/plugin/agents/proof-conclusion.md\n"
    assert check_slot_queue.issue_skills(body, AGENT_MAP) == {
        "proof-conclusion",
        "research",
        "hypothesis-tracking",
    }


@pytest.mark.parametrize("body", [None, "", "Prose with no Touches line at all."])
def test_an_issue_with_no_touches_line_is_never_counted(body):
    """Unverified, and never counted as holding a slot (issue #2589).

    `None` is the live shape — an issue opened with no description comes back from
    the REST API with `body: null`.
    """
    assert check_slot_queue.issue_skills(body, AGENT_MAP) == set()


def test_a_touches_line_under_a_different_skill_does_not_match():
    body = "**Touches:** packages/engine/plugin/skills/timeline/SKILL.md\n"
    assert "citation" not in check_slot_queue.issue_skills(body, AGENT_MAP)


def test_a_touches_line_at_end_of_body_with_no_trailing_blank_line_parses():
    """The regex's `\\Z` branch — the alternative to its `\\n\\n` terminator."""
    body = "Some prose.\n\n**Touches:** eval/tests/unit/citation/ut_c_001.json"
    assert check_slot_queue.issue_skills(body, AGENT_MAP) == {"citation"}


def test_a_retired_touches_line_below_a_fold_is_not_counted():
    """Issue #1731's shape, and the one this plan got wrong once.

    A re-scoped card keeps its superseded body under `## Original body`. The line
    down there names paths the card explicitly gave up — #1731 says in its live body
    "takes no slot and costs no paid run ... do not widen the change into
    person-evidence/SKILL.md". Counting it would warn that a tool-only PR should fold
    in work that card has ruled out.
    """
    body = (
        "Reviewed: the ruling's `**Touches:**` line is corrected by the checklist"
        " below.\n\n"
        "## Original body\n\n"
        "**Touches:** packages/engine/plugin/skills/person-evidence/SKILL.md\n"
    )
    assert check_slot_queue.issue_skills(body, AGENT_MAP) == set()


# --------------------------------------------------------------------------
# queued_by_skill
# --------------------------------------------------------------------------


def test_queued_by_skill_lists_every_match_sorted_and_uncapped():
    """No cap: 13 open issues name search-records, and a cap hides the one that
    mattered. Sorted by number so the output is stable across runs."""
    issues = [
        issue(n, "**Touches:** packages/engine/plugin/skills/citation/SKILL.md\n")
        for n in (300, 100, 200)
    ]
    got = check_slot_queue.queued_by_skill(issues, {"citation"}, AGENT_MAP)
    assert [n for n, _t in got["citation"]] == [100, 200, 300]


def test_queued_by_skill_omits_a_skill_nothing_is_queued_on():
    issues = [issue(1, "**Touches:** packages/engine/plugin/skills/timeline/SKILL.md\n")]
    assert check_slot_queue.queued_by_skill(issues, {"citation"}, AGENT_MAP) == {}


def test_queued_by_skill_survives_a_row_with_no_number():
    assert (
        check_slot_queue.queued_by_skill(
            [{"title": "x", "body": "**Touches:** packages/engine/plugin/skills/citation/"}],
            {"citation"},
            AGENT_MAP,
        )
        == {}
    )


# --------------------------------------------------------------------------
# fetch_open_issues — the network boundary
# --------------------------------------------------------------------------


class _Proc:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_slurp_output_is_flattened_page_by_page(monkeypatch):
    """`gh --paginate --slurp` returns one array PER PAGE.

    Measured against this repo on 2026-09-16: `[list:100, list:100, list:20]`. A
    `json.loads` with no flatten leaves every "row" a list, and the first `.get()`
    raises — which the caller turns into a permanent warn-degraded check. A stub that
    returns one tidy object cannot catch this, so the stub mirrors the real shape.
    """
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
    pages = [[issue(1, None), issue(2, None)], [issue(3, None)]]
    rows, err = check_slot_queue.fetch_open_issues(
        runner=lambda *a, **k: _Proc(stdout=json.dumps(pages))
    )
    assert err is None
    assert [r["number"] for r in rows] == [1, 2, 3]


def test_pull_requests_are_dropped(monkeypatch):
    """/issues returns PRs too — 22 of 220 live rows. Without this every open PR
    reads as queued work."""
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
    pages = [[issue(1, None), {**issue(2, None), "pull_request": {"url": "..."}}]]
    rows, err = check_slot_queue.fetch_open_issues(
        runner=lambda *a, **k: _Proc(stdout=json.dumps(pages))
    )
    assert err is None
    assert [r["number"] for r in rows] == [1]


def test_a_nonzero_gh_is_an_error_not_an_empty_queue(monkeypatch):
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
    rows, err = check_slot_queue.fetch_open_issues(
        runner=lambda *a, **k: _Proc(returncode=1, stderr="gh: HTTP 403: Resource not accessible")
    )
    assert rows == []
    assert err is not None and "403" in err


def test_gh_missing_from_path_is_an_error_not_an_empty_queue(monkeypatch):
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")

    def boom(*a, **k):
        raise FileNotFoundError("gh")

    rows, err = check_slot_queue.fetch_open_issues(runner=boom)
    assert rows == []
    assert err is not None and "gh" in err


@pytest.mark.parametrize("payload", ["not json at all", '{"number": 1}'])
def test_malformed_or_unexpected_gh_output_is_an_error(monkeypatch, payload):
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
    rows, err = check_slot_queue.fetch_open_issues(runner=lambda *a, **k: _Proc(stdout=payload))
    assert rows == []
    assert err is not None


# --------------------------------------------------------------------------
# main() — warn-only, and never silent about its own failure
# --------------------------------------------------------------------------


def test_main_warns_and_exits_zero_when_the_diff_cannot_be_read(monkeypatch, capsys):
    """BASE_SHA unset. Must say so — a silent exit 0 is indistinguishable from
    "no queued work", which is the only way this lands green and wrong."""
    monkeypatch.delenv("BASE_SHA", raising=False)
    monkeypatch.delenv("HEAD_SHA", raising=False)

    assert check_slot_queue.main() == 0
    text = warnings_text()
    assert "could not read this PR's changed paths" in text
    assert "made NO claim" in text


def test_main_warns_and_exits_zero_when_the_issue_list_cannot_be_read(monkeypatch):
    """A 403 from a token without `issues: read` is the live shape of this."""
    monkeypatch.setattr(
        check_slot_queue.check_runlogs,
        "git_diff_touched_paths",
        lambda: ["packages/engine/plugin/skills/citation/SKILL.md"],
    )
    monkeypatch.setattr(
        check_slot_queue, "fetch_open_issues", lambda: ([], "gh exited 1: HTTP 403")
    )

    assert check_slot_queue.main() == 0
    text = warnings_text()
    assert "could not read the open issue list" in text
    assert "403" in text
    assert "citation" in text


def test_main_makes_no_api_call_when_no_snapshot_input_is_touched(monkeypatch, capsys):
    """This PR's own shape: .github/**, eval/harness/scripts/**. No warning, and the
    issue list is never fetched."""
    monkeypatch.setattr(
        check_slot_queue.check_runlogs,
        "git_diff_touched_paths",
        lambda: [
            ".github/workflows/check-runlogs.yml",
            "eval/harness/scripts/check_slot_queue.py",
            "eval/harness/tests/unit/test_check_slot_queue.py",
        ],
    )

    def fail(*a, **k):
        raise AssertionError("fetch_open_issues must not be called")

    monkeypatch.setattr(check_slot_queue, "fetch_open_issues", fail)

    assert check_slot_queue.main() == 0
    assert _recorded() == []
    assert "no eval snapshot input" in capsys.readouterr().out


def test_main_warns_naming_every_queued_issue(monkeypatch):
    monkeypatch.setattr(
        check_slot_queue.check_runlogs,
        "git_diff_touched_paths",
        lambda: ["eval/tests/unit/citation/ut_c_001.json"],
    )
    monkeypatch.setattr(
        check_slot_queue,
        "fetch_open_issues",
        lambda: (
            [
                issue(42, "**Touches:** packages/engine/plugin/skills/citation/SKILL.md\n", "fix A"),
                issue(7, "**Touches:** eval/tests/unit/citation/ut_c_002.json\n", "fix B"),
                issue(99, "**Touches:** packages/engine/plugin/skills/timeline/SKILL.md\n", "other"),
            ],
            None,
        ),
    )

    assert check_slot_queue.main() == 0
    text = warnings_text()
    assert "#7 (fix B)" in text and "#42 (fix A)" in text
    assert "#99" not in text
    assert text.index("#7") < text.index("#42"), "listed sorted by number"


def test_main_is_quiet_when_the_touched_skill_has_no_queue(monkeypatch, capsys):
    monkeypatch.setattr(
        check_slot_queue.check_runlogs,
        "git_diff_touched_paths",
        lambda: ["packages/engine/plugin/skills/citation/SKILL.md"],
    )
    monkeypatch.setattr(
        check_slot_queue,
        "fetch_open_issues",
        lambda: ([issue(99, "**Touches:** packages/engine/plugin/skills/timeline/SKILL.md\n")], None),
    )

    assert check_slot_queue.main() == 0
    assert _recorded() == []
    assert "no open issue names a path in its snapshot" in capsys.readouterr().out


def test_main_never_raises_and_never_returns_nonzero_on_a_git_failure(monkeypatch):
    def boom():
        raise subprocess.CalledProcessError(128, ["git", "diff"])

    monkeypatch.setattr(check_slot_queue.check_runlogs, "git_diff_touched_paths", boom)
    assert check_slot_queue.main() == 0
    assert "could not read this PR's changed paths" in warnings_text()


# --------------------------------------------------------------------------
# Against REAL captured input, not a shape we imagined
# --------------------------------------------------------------------------
#
# `tests/fixtures/gh_issues_slurp_capture.json` is live output from
#
#     gh api "repos/PioneerAIAcademy/cowork-genealogy/issues?state=open&per_page=100" \
#            --paginate --slurp
#
# captured 2026-09-16, trimmed to 5 rows while keeping the real PAGE BOUNDARIES
# (3 pages) and the real field shape. Issue #1731's body is byte-for-byte as the API
# returned it, because #1731 is the case this check got wrong once (see the
# retraction in the PR body): a first-draft change to the shared parser would have
# made it claim `person-evidence`, which its live body explicitly rules out.
#
# A hand-built stub cannot serve here. The whole class of bug being guarded is "the
# response is not the shape I assumed", and a stub encodes the assumption.

_CAPTURE = Path(__file__).resolve().parents[1] / "fixtures" / "gh_issues_slurp_capture.json"


def test_the_capture_fixture_is_the_shape_gh_really_returns():
    """Non-vacuity: if this file is ever regenerated flat, the two tests below stop
    testing the flatten and nothing else would say so."""
    pages = json.loads(_CAPTURE.read_text(encoding="utf-8"))
    assert isinstance(pages, list) and len(pages) > 1, "capture must keep >1 page"
    assert all(isinstance(p, list) for p in pages), "--slurp returns one array PER PAGE"
    assert any("pull_request" in r for p in pages for r in p), "capture must include a PR row"


def test_a_real_captured_gh_response_flattens_and_drops_pull_requests(monkeypatch):
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
    rows, err = check_slot_queue.fetch_open_issues(
        runner=lambda *a, **k: _Proc(stdout=_CAPTURE.read_text(encoding="utf-8"))
    )
    assert err is None
    numbers = [r["number"] for r in rows]
    assert 1731 in numbers
    assert 2614 not in numbers, "the pull-request row must be dropped"
    assert len(numbers) == 4


def test_issue_1731s_live_body_claims_no_slot():
    """Q6, against the body the API actually returned.

    #1731 was re-scoped by lead ruling: its live text says the work "takes no slot
    and costs no paid run ... do not widen the change into person-evidence/SKILL.md",
    and the `**Touches:**` line naming that path sits under `## Original body`.
    Claiming `person-evidence` here would tell a tool-only PR to fold in work the
    card has ruled out.
    """
    pages = json.loads(_CAPTURE.read_text(encoding="utf-8"))
    body = next(r["body"] for p in pages for r in p if r["number"] == 1731)
    assert "## Original body" in body and "**Touches:**" in body, "fixture drifted"
    assert check_slot_queue.issue_skills(body, AGENT_MAP) == set()


def test_live_bodies_with_a_real_touches_line_do_reach_their_skill():
    """The other direction of the test above — otherwise "no slot" could be coming
    from a parser that returns nothing for every real body."""
    pages = json.loads(_CAPTURE.read_text(encoding="utf-8"))
    by = {r["number"]: r.get("body") for p in pages for r in p}
    assert check_slot_queue.issue_skills(by[2393], AGENT_MAP) == {"search-records"}
    assert check_slot_queue.issue_skills(by[2502], AGENT_MAP) == {"historical-context"}


def test_main_on_an_empty_changed_path_list_makes_no_call_and_says_so(monkeypatch, capsys):
    """D1 — the degenerate input that has made tools in this repo exit 0 having done
    nothing, past a guard added beside them."""
    monkeypatch.setattr(check_slot_queue.check_runlogs, "git_diff_touched_paths", lambda: [])

    def fail(*a, **k):
        raise AssertionError("fetch_open_issues must not be called")

    monkeypatch.setattr(check_slot_queue, "fetch_open_issues", fail)

    assert check_slot_queue.main() == 0
    assert _recorded() == []
    assert "0 changed path(s)" in capsys.readouterr().out


# --------------------------------------------------------------------------
# Step summary, the fixture arm, and the never-raise guarantee
# --------------------------------------------------------------------------


def test_main_writes_a_step_summary_section(monkeypatch, tmp_path):
    """The sibling lints pin this through test_gh_annotations.py's parametrize list.

    This one does NOT join that list on purpose: that test runs each lint "the way CI
    does" with nothing stubbed, and this is the only warn-only lint that makes a
    network call — with BASE_SHA/HEAD_SHA exported in a shell (a documented local
    repro step) it would fire a live `gh api --paginate` over ~250 issues from inside
    the unit suite. Pinned here instead, with both boundaries stubbed.
    """
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    monkeypatch.setattr(check_slot_queue.check_runlogs, "git_diff_touched_paths", lambda: [])
    monkeypatch.setattr(
        check_slot_queue, "fetch_open_issues", lambda: (_ for _ in ()).throw(AssertionError)
    )

    assert check_slot_queue.main() == 0
    assert summary.exists()
    assert summary.read_text(encoding="utf-8").lstrip().startswith("### ")


def test_a_shared_fixture_reaches_every_skill_whose_tests_reference_it():
    fixture_map = {
        ("scenarios", "mid-research-flynn"): {"citation", "timeline", "record-extraction"},
        ("mcp", "some-fixture"): {"search-records"},
    }
    assert check_slot_queue.fixture_affected_skills(
        ["eval/fixtures/scenarios/mid-research-flynn/research.json"], fixture_map
    ) == {"citation", "timeline", "record-extraction"}
    assert check_slot_queue.fixture_affected_skills(
        ["eval/fixtures/mcp/some-fixture.json"], fixture_map
    ) == {"search-records"}
    assert check_slot_queue.fixture_affected_skills(["README.md"], fixture_map) == set()


def test_a_fixture_only_pr_warns_once_not_once_per_skill(monkeypatch, capsys):
    """A scenario referenced by 21 skills would otherwise bury the direct arm under
    21 near-identical annotations. Also pins that it no longer prints "it buys no paid
    run" on the PR shape that could oblige the most."""
    monkeypatch.setattr(
        check_slot_queue.check_runlogs,
        "git_diff_touched_paths",
        lambda: ["eval/fixtures/scenarios/mid-research-flynn/research.json"],
    )
    monkeypatch.setattr(
        check_slot_queue.check_runlogs,
        "skills_referencing_fixtures",
        lambda _root: {("scenarios", "mid-research-flynn"): {"citation", "timeline"}},
    )
    monkeypatch.setattr(
        check_slot_queue,
        "fetch_open_issues",
        lambda: (
            [
                issue(5, "**Touches:** packages/engine/plugin/skills/citation/SKILL.md\n", "a"),
                issue(6, "**Touches:** eval/tests/unit/timeline/ut_t_001.json\n", "b"),
            ],
            None,
        ),
    )

    assert check_slot_queue.main() == 0
    assert len(_recorded()) == 1, "the fixture arm must be ONE annotation"
    text = warnings_text()
    assert "shared fixture" in text
    assert "citation (1)" in text and "timeline (1)" in text, "counts, by skill"
    # Counts, NOT the issue lists: listing them for `mid-research-flynn`'s 21 skills
    # measured a single 17,328-character annotation.
    assert "#5" not in text and "#6" not in text
    assert len(text) < 1000, f"fixture annotation must stay readable, got {len(text)}"
    assert "buys no paid run" not in capsys.readouterr().out


def test_main_returns_zero_even_when_the_decision_raises(monkeypatch, capsys):
    """The blanket guard. This step sits in a REQUIRED workflow with no
    `continue-on-error`, so an escaping exception would red a PR over a diagnostic."""

    def boom(*a, **k):
        raise RuntimeError("something nobody anticipated")

    monkeypatch.setattr(check_slot_queue.check_runlogs, "skills_referencing_agents", boom)

    assert check_slot_queue.main() == 0
    assert "crashed (RuntimeError" in warnings_text()
    assert "RuntimeError" in capsys.readouterr().err, "traceback must still be printed"


def test_the_gh_call_carries_a_timeout(monkeypatch):
    """Without it a stalled upstream holds the whole `runlogs` job open to the
    360-minute Actions cap. Asserted on the call, because a missing `timeout=` changes
    no behaviour any other test can observe."""
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
    seen = {}

    def runner(cmd, **kwargs):
        seen.update(kwargs)
        return _Proc(stdout="[]")

    check_slot_queue.fetch_open_issues(runner=runner)
    assert seen.get("timeout") == check_slot_queue.GH_TIMEOUT_SECONDS
    assert seen.get("encoding") == "utf-8", "cp1252 on Windows otherwise"


def test_a_gh_timeout_is_an_error_not_an_empty_queue(monkeypatch):
    """`subprocess.TimeoutExpired` is NOT an OSError, so it needs its own arm — and
    without one it would escape into main()'s blanket guard and report a crash rather
    than the real cause."""
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")

    def runner(*a, **k):
        raise subprocess.TimeoutExpired(cmd=["gh"], timeout=check_slot_queue.GH_TIMEOUT_SECONDS)

    rows, err = check_slot_queue.fetch_open_issues(runner=runner)
    assert rows == []
    assert err is not None and "did not respond" in err


def test_an_issue_naming_only_a_shared_fixture_reaches_that_fixtures_skills():
    """The two halves must resolve a path the SAME way (module docstring).

    The PR side gained a fixture arm; without this the issue side had none, so an
    issue whose `**Touches:**` names only a shared fixture resolved to nothing and
    was invisible. Measured on the live pool when this was found: 10 of 28 skills had
    at least one issue hidden this way, including #1972, whose Touches names three
    `eval/fixtures/scenarios/*/research.json` paths and which was in flight at the
    time.
    """
    fixture_map = {("scenarios", "flynn-multi-conflict"): {"validate-schema", "timeline"}}
    body = "**Touches:** eval/fixtures/scenarios/flynn-multi-conflict/research.json\n"

    assert check_slot_queue.issue_skills(body, AGENT_MAP) == set(), "no map -> no claim"
    assert check_slot_queue.issue_skills(body, AGENT_MAP, fixture_map) == {
        "validate-schema",
        "timeline",
    }


def test_the_two_halves_agree_on_a_fixture_path():
    """Stated as the invariant rather than the mechanism: whatever a fixture path
    means on the PR side, it means the same on the issue side."""
    fixture_map = {("mcp", "some-fixture"): {"search-records"}}
    path = "eval/fixtures/mcp/some-fixture.json"
    body = f"**Touches:** {path}\n"
    assert check_slot_queue.fixture_affected_skills(
        [path], fixture_map
    ) == check_slot_queue.issue_skills(body, AGENT_MAP, fixture_map)


def test_the_board_lib_test_suite_is_actually_collected():
    """`testpaths` fails OPEN.

    `eval/harness/pyproject.toml` adds `../../.claude/skills/lib/tests` so the module
    this script imports is covered. Measured: with that directory renamed, pytest
    collects 12 fewer tests and emits no warning and no error — the coverage vanishes
    silently. A rename of `touches.py` itself breaks this script's import loudly; a
    rename of the test directory alone does not.
    """
    # <repo>/eval/harness/tests/unit/<this file> -> parents[4] == <repo>, same as
    # test_encoding_lint.py's REPO_ROOT.
    root = Path(__file__).resolve().parents[4]
    assert (root / ".claude" / "skills" / "lib" / "tests" / "test_touches.py").is_file(), (
        "eval/harness/pyproject.toml's testpaths entry no longer resolves — "
        "test_touches.py has stopped running and pytest will not say so"
    )
