"""Tests for `**Touches:**` parsing.

The bug these exist for: `paths_from_touches` took the FIRST `**Touches:**` in a
body, so a review banner quoting the phrase won over the real line. 20 of 231 open
issues parsed the wrong line on 2026-09-16, and 8 reached the wrong eval slot.

Taking the LAST match instead is equally wrong, in the opposite direction, so both
shapes are pinned here. The reach cases (a banner-only body, a Touches line inside a
fenced block) and the both-directions case (legitimate variants that must still
parse) follow CLAUDE.md's "a new lint must be proven to fail" — a guard fails two
ways, and breaking the repo tests only one of them.

Run: python3 -m pytest .claude/skills/lib/tests/test_touches.py
"""

import json
import os
import shutil
import subprocess
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, ".."))
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.join(_HERE, "..", "..", "fill-ready"))

from _tree import make_tree, pin_repo_root  # noqa: E402
import touches  # noqa: E402
from touches import deleted_on_ref, paths_from_touches, slot_of  # noqa: E402
import collisions  # noqa: E402

# Read before the autouse pin replaces it: the value production computes.
_LIVE_ROOT = touches.REPO_ROOT


@pytest.fixture(autouse=True)
def repo_root(tmp_path, monkeypatch):
    """Every test reads a pinned tmp checkout, never the live one -- see _tree.py."""
    return pin_repo_root(tmp_path, monkeypatch)


def paths(body):
    return {p for _kind, p in paths_from_touches(body)}


def slots(body):
    return {s for _k, p in paths_from_touches(body) if (s := slot_of(p))}


# --- break 1: a banner QUOTES the phrase above the live line (issue #2589 shape) ---

BANNER_ABOVE = """\
> **Reviewed 2026-09-15 before junior handoff.** The card's `**Touches:**` line
> names packages/engine/plugin/agents/proof-conclusion.md, which is stale.

**Touches:** eval/harness/scripts/check_runlogs.py, .github/workflows/check-runlogs.yml
"""


def test_quoted_mention_in_a_banner_does_not_win():
    assert paths(BANNER_ABOVE) == {
        "eval/harness/scripts/check_runlogs.py",
        ".github/workflows/check-runlogs.yml",
    }
    # the quoted agent path must not pull this onto an eval slot it never touches
    assert slots(BANNER_ABOVE) == set()


# --- break 2: a retired body keeps a stale line BELOW the live one (issue #1851) ---

RETIRED_BELOW = """\
> **Rescoped 2026-09-01.** What moved out: the two agent-body edits are issue #2127.

**Touches:** eval/harness/harness/skill_invocation.py, docs/architecture.md

Some live body text.

---

## Original issue

---

**Touches:** packages/engine/plugin/skills/proof-conclusion/SKILL.md, packages/engine/plugin/agents/research-exhaustiveness.md
"""


def test_line_below_a_retiring_fold_does_not_win():
    assert paths(RETIRED_BELOW) == {
        "eval/harness/harness/skill_invocation.py",
        "docs/architecture.md",
    }
    # the retired line would have claimed two eval slots this card no longer holds
    assert slots(RETIRED_BELOW) == set()


def test_original_body_spelling_folds_too():
    body = RETIRED_BELOW.replace("## Original issue", "## Original body")
    assert slots(body) == set()


# --- break 3: both shapes at once, which is what defeats any positional rule ---

BOTH = """\
> **Reviewed.** Its `**Touches:**` line is stale.

**Touches:** eval/harness/e2e/orchestrator.py

## Original issue

**Touches:** packages/engine/plugin/skills/research/SKILL.md
"""


def test_banner_above_and_retired_below_together():
    assert paths(BOTH) == {"eval/harness/e2e/orchestrator.py"}


# --- the other direction: legitimate variants must still parse ---


def test_ordinary_single_line_is_unaffected():
    body = "Prose.\n\n**Touches:** packages/engine/plugin/skills/citation/SKILL.md\n"
    assert slots(body) == {"skill:citation"}


def test_backticked_and_comma_wrapped_paths_still_parse():
    body = "**Touches:** `eval/tests/unit/timeline/`, `docs/specs/unit-test-spec.md`.\n"
    assert paths(body) == {"eval/tests/unit/timeline", "docs/specs/unit-test-spec.md"}


def test_line_wrapped_touches_still_parses():
    body = (
        "**Touches:** packages/engine/plugin/skills/timeline/SKILL.md,\n"
        "eval/tests/unit/timeline/\n"
    )
    assert slots(body) == {"skill:timeline"}


def test_a_body_whose_only_mention_is_quoted_still_parses():
    """Fallback: excluding every candidate would put the card on no queue at all,
    which is worse than parsing a quoted line -- it is invisible rather than wrong."""
    body = "> **Touches:** packages/engine/plugin/skills/citation/SKILL.md\n"
    assert slots(body) == {"skill:citation"}


def test_no_touches_line_reaches_no_queue():
    assert paths_from_touches("Prose with no Touches line.") == set()
    assert paths_from_touches("") == set()
    assert paths_from_touches(None) == set()


def test_prose_mention_after_the_fold_heading_does_not_resurrect_it():
    body = (
        "**Touches:** docs/architecture.md\n\n"
        "## Original issue\n\n"
        "**Touches:** packages/engine/plugin/agents/gps-mentor.md\n"
    )
    assert slots(body) == set()


def test_fold_cutoff_is_load_bearing_when_no_line_initial_mention_precedes_it():
    """Isolates the fold cutoff from the line-initial check.

    Every other fixture puts the live line above the fold AND line-initial, so the
    scan returns on the first iteration and never consults `cutoff` -- deleting the
    cutoff leaves them all green. A blockquote does NOT isolate it either: the
    prefix check strips `> `, so a quoted line counts as line-initial and still
    returns early. The case that reaches the cutoff is a body whose only above-fold
    mention is genuinely INLINE, leaving the retired line as the sole line-initial
    candidate -- the cutoff is then the one thing standing between this card and an
    eval slot it gave up.
    """
    body = (
        "Reviewed: its `**Touches:** eval/harness/harness/skill_invocation.py`"
        " line is what we keep.\n\n"
        "## Original issue\n\n"
        "**Touches:** packages/engine/plugin/skills/research/SKILL.md\n"
    )
    # the retired line below the fold must not supply a slot this card gave up
    assert slots(body) == set()
    # no line-initial candidate above the fold -> falls back to the first match
    assert paths(body) == {"eval/harness/harness/skill_invocation.py"}


def test_a_quoted_line_still_counts_as_line_initial():
    """Pins the behaviour the test above depends on: `> ` is stripped, so a live
    line inside a review banner is still the card's own claim, not a mention."""
    body = "> **Touches:** packages/engine/plugin/skills/citation/SKILL.md\n"
    assert slots(body) == {"skill:citation"}


# --- a skill converted to an agent keeps one slot, named for the agent -------------
#
# `repo_root` pins touches.REPO_ROOT to a tmp tree; each test here adds to it.

CONVERTED = ("packages/engine/plugin/skills/zz-converted/SKILL.md",
             "packages/engine/plugin/skills/zz-converted",
             "eval/tests/unit/zz-converted/ut_zz_001.json",
             "eval/tests/unit/zz-converted",
             "packages/engine/plugin/agents/zz-converted.md")


def test_every_path_of_a_converted_skill_names_the_agent_slot(repo_root):
    """The skill directory is gone and the agent exists: the stale skill path, the
    suite that stays, and the agent body are one paid run and must be one slot."""
    make_tree(repo_root, agents=["zz-converted"])

    assert {slot_of(p) for p in CONVERTED} == {"agent:zz-converted"}


def test_a_live_skill_with_a_same_named_agent_keeps_its_skill_slot(repo_root):
    """The other direction: a live skill with a same-named agent, as person-evidence has."""
    make_tree(repo_root, skills=["zz-converted"], agents=["zz-converted"])

    assert slot_of(CONVERTED[0]) == "skill:zz-converted"
    assert slot_of(CONVERTED[2]) == "skill:zz-converted"


def test_a_skill_not_yet_created_keeps_its_skill_slot(repo_root):
    """A card creating a new skill names a directory that is not on disk yet, and no
    agent of that name exists. That is not a conversion."""
    assert slot_of(CONVERTED[0]) == "skill:zz-converted"
    assert slot_of(CONVERTED[2]) == "skill:zz-converted"


def test_repo_root_is_the_checkout_this_file_lives_in():
    """Every other test pins REPO_ROOT, so an off-by-one here would pass them all while
    the remap, the @plugin: expansion and check_slot_queue's own-suite arm all read a
    directory with no skills in it -- each silently, returning nothing."""
    assert os.path.isfile(os.path.join(_LIVE_ROOT, ".claude", "skills", "lib", "touches.py"))
    assert os.path.isdir(os.path.join(_LIVE_ROOT, "packages", "engine", "plugin", "skills"))


# --- a Touches path deleted on origin/main (issue #3148) ----------------------------
#
# A tmp repo with its own refs/remotes/origin/main, never the real checkout's: a test
# against the live ref flips the day that path changes (see _tree.py). Global and
# system git config are cut off so a user's hooks or signing cannot reach the repo.

GONE = "packages/engine/plugin/skills/zz-gone/SKILL.md"


def _git_env():
    env = {k: v for k, v in os.environ.items()
           if k not in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE")}
    env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1",
               GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t",
               GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
    return env


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True,
                          text=True, encoding="utf-8", env=_git_env()).stdout.strip()


def _init(root, monkeypatch):
    """Also seals the environment the code under test inherits, not only these calls."""
    if shutil.which("git") is None:
        pytest.skip("git is not available")
    for k in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    root.mkdir(parents=True, exist_ok=True)
    _git(root, "init", "-q")
    return root


def _commit(repo, add=(), rm=(), msg="c"):
    for rel in add:
        f = repo / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(rel + "\n", encoding="utf-8")
        _git(repo, "add", rel)
    for rel in rm:
        _git(repo, "rm", "-q", rel)
    _git(repo, "commit", "-q", "--no-verify", "-m", msg)
    return _git(repo, "rev-parse", "--short", "HEAD")


@pytest.fixture
def board_repo(tmp_path, monkeypatch):
    """GONE committed then deleted, then an unrelated commit on top, so the tip is not
    the deleting commit. Returns the deleting commit's short sha."""
    repo = _init(tmp_path / "board-repo", monkeypatch)
    _commit(repo, add=[GONE, "packages/engine/plugin/skills/zz-live/SKILL.md", "docs/live/a.md"])
    deleting = _commit(repo, rm=[GONE])
    _commit(repo, add=["docs/live/b.md"])
    _git(repo, "update-ref", "refs/remotes/origin/main", "HEAD")
    monkeypatch.setattr(touches, "REPO_ROOT", str(repo))
    return deleting


def test_a_deleted_path_is_flagged_with_the_commit_that_deleted_it(board_repo):
    entries = paths_from_touches(f"**Touches:** {GONE}, packages/engine/plugin/skills/zz-gone\n")
    assert deleted_on_ref(entries) == {
        GONE: board_repo,
        "packages/engine/plugin/skills/zz-gone": board_repo,
    }


def test_a_glob_into_a_deleted_directory_is_flagged_wherever_its_star_falls(board_repo):
    gone_dir = "packages/engine/plugin/skills/zz-gone"
    entries = paths_from_touches(f"**Touches:** {gone_dir}/*, {gone_dir}/SKILL*.md\n")
    assert set(deleted_on_ref(entries).values()) == {board_repo}
    assert len(deleted_on_ref(entries)) == 2


def test_new_files_live_dirs_and_globs_are_not_flagged(board_repo):
    """The other direction: absent-but-never-committed is a file the card will create."""
    body = ("**Touches:** packages/engine/plugin/agents/zz-new.md, docs/live, "
            "docs/*/b.md, packages/engine/plugin/skills/zz-new-*\n")
    entries = paths_from_touches(body)
    assert len(entries) == 4
    assert deleted_on_ref(entries) == {}


def test_an_unresolvable_ref_skips_rather_than_flagging_everything(tmp_path, monkeypatch):
    repo = _init(tmp_path / "no-origin", monkeypatch)
    _commit(repo, add=["docs/live/a.md"])
    monkeypatch.setattr(touches, "REPO_ROOT", str(repo))
    assert deleted_on_ref({("file", GONE)}) is None


def _run_collisions(tmp_path, capsys, bodies):
    board = {"items": [{"content": {"number": n}, "status": "Ready"} for n in bodies]}
    issues = [{"number": n, "title": "t", "body": b} for n, b in bodies.items()]
    files = {"board.json": board, "open.json": issues, "prs.json": []}
    for name, data in files.items():
        (tmp_path / name).write_text(json.dumps(data), encoding="utf-8")
    collisions.main(*(str(tmp_path / n) for n in files), {"Ready"})
    return capsys.readouterr().out


def test_collisions_prints_deleted_paths_and_counts_them(board_repo, tmp_path, capsys):
    out = _run_collisions(tmp_path, capsys, {
        7: f"**Touches:** {GONE}\n",
        8: "**Touches:** packages/engine/plugin/agents/zz-new.md\n",
    })
    section = out.split("=== Touches paths deleted on origin/main ===")[1]
    assert f"issue #7: {GONE} (deleted in {board_repo})" in section
    assert "issue #8" not in section
    assert out.splitlines()[-1].endswith(", 1 deleted")


def test_collisions_says_the_check_was_skipped_without_origin_main(tmp_path, monkeypatch, capsys):
    repo = _init(tmp_path / "no-origin", monkeypatch)
    _commit(repo, add=["docs/live/a.md"])
    monkeypatch.setattr(touches, "REPO_ROOT", str(repo))
    out = _run_collisions(tmp_path, capsys, {7: f"**Touches:** {GONE}\n"})
    assert "skipped: origin/main does not resolve" in out
    assert out.splitlines()[-1].endswith(", 0 deleted")
