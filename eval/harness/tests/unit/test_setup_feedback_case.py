"""Black-box tests for scripts/setup-feedback-case.sh.

The script is bash; the test shells out and asserts on the resulting
case directory. Covers the §11 contract in
docs/specs/feedback-case-spec.md.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[4]
SCRIPT = REPO_ROOT / "scripts" / "setup-feedback-case.sh"

def _find_bash() -> str | None:
    """Locate a bash interpreter, including a PATH-invisible Git for Windows one.

    These tests must name the interpreter rather than relying on the shebang:
    Windows has no shebang handling, so handing subprocess a bare `.sh` path
    fails with `OSError: [WinError 193] %1 is not a valid Win32 application`.
    That is how all 11 tests here failed on the Windows-based genealogist team's
    machines while staying green on CI's ubuntu runner.

    `shutil.which("bash")` suffices on Linux and macOS, but not on a default
    Git for Windows install: that puts only `cmd/git.exe` on PATH and leaves
    bash at `<git-root>/bin/bash.exe`, invisible to `which`. Deriving it from
    git's own location covers that without hardcoding an install path, and
    works for both the `cmd/` and `bin/` git layouts.
    """
    found = shutil.which("bash")
    if found:
        return found
    git = shutil.which("git")
    if not git:
        return None
    candidate = Path(git).resolve().parent.parent / "bin" / "bash.exe"
    return str(candidate) if candidate.is_file() else None


BASH = _find_bash()

pytestmark = pytest.mark.skipif(
    BASH is None,
    reason="setup-feedback-case.sh is bash; no bash interpreter found",
)


def _build_minimal_zip(zip_path: Path, slug: str) -> None:
    """Build a feedback zip matching the shape in
    apps/electron/docs/feedback-json-spec.md §3."""
    feedback = {
        "schema_version": 1,
        "submitted_at": "2026-05-25T18:22:31Z",
        "viewer_version": "0.4.2",
        "platform": "darwin",
        "email": "user@example.com",
        "project_folder_path": "/Users/example/genealogy/smith-family",
        "user_prompt": "Find a marriage record for John Smith born 1850 in Ohio.",
        "agent_did": "The agent searched only the 1860 census and stopped.",
        "agent_should_have": "The agent should have tried 1870 and 1880 censuses.",
        "notes": "",
    }
    research = {"project": {"id": "rp_test", "researcher_profile": {}}}
    tree = {"persons": [], "relationships": [], "sources": []}

    with zipfile.ZipFile(zip_path, "w") as z:
        z.writestr("research.json", json.dumps(research, indent=2))
        z.writestr("tree.gedcomx.json", json.dumps(tree, indent=2))
        z.writestr("FEEDBACK.md", "# Feedback\n\nstub.\n")
        z.writestr("_feedback/feedback.json", json.dumps(feedback, indent=2))


def _run_script(*args, cwd: Path | None = None, env_overrides: dict | None = None):
    env = os.environ.copy()
    env.setdefault("GIT_AUTHOR_NAME", "test")
    env.setdefault("GIT_AUTHOR_EMAIL", "test@example.com")
    env.setdefault("GIT_COMMITTER_NAME", "test")
    env.setdefault("GIT_COMMITTER_EMAIL", "test@example.com")
    if env_overrides:
        env.update(env_overrides)
    return subprocess.run(
        [BASH, str(SCRIPT), *args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        # The script emits UTF-8 (it prints "✓"). Without this, `text=True`
        # decodes with the platform default — cp1252 on Windows — so the
        # checkmark arrives as "âœ“" and any non-ASCII in a user_prompt is
        # mangled. Same rule as every other file read in this repo.
        encoding="utf-8",
        check=False,
    )


def test_imports_zip_into_default_dest(tmp_path, monkeypatch):
    slug = "feedback-2026-05-25T18-22-31"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)

    # Redirect $HOME so the script's default ~/feedback/<slug>/ lands in tmp_path.
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    result = _run_script(str(zip_path))
    assert result.returncode == 0, f"stderr:\n{result.stderr}\nstdout:\n{result.stdout}"

    dest = tmp_path / "home" / "feedback" / slug
    assert (dest / "research.json").is_file()
    assert (dest / "tree.gedcomx.json").is_file()
    assert (dest / "FEEDBACK.md").is_file()
    assert (dest / "_feedback" / "feedback.json").is_file()


def test_writes_feedback_repo_root_marker(tmp_path, monkeypatch):
    slug = "feedback-2026-05-25T18-22-31"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    result = _run_script(str(zip_path))
    assert result.returncode == 0, result.stderr

    dest = tmp_path / "home" / "feedback" / slug
    marker = dest / ".feedback-repo-root"
    assert marker.is_file()
    # Compare as paths, not strings: the script runs under bash, so on Windows
    # it writes the root with forward slashes ("C:/Users/...") while
    # `str(REPO_ROOT)` uses backslashes. Both name the same directory.
    assert Path(marker.read_text(encoding="utf-8").strip()) == REPO_ROOT


def test_initial_git_commit_titled_imported(tmp_path, monkeypatch):
    slug = "feedback-test"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    result = _run_script(str(zip_path))
    assert result.returncode == 0, result.stderr

    dest = tmp_path / "home" / "feedback" / slug
    assert (dest / ".git").is_dir()
    log = subprocess.run(
        ["git", "-C", str(dest), "log", "--oneline"],
        capture_output=True, text=True, encoding="utf-8", check=True,
    )
    # One commit, message "imported".
    assert log.stdout.count("\n") == 1
    assert "imported" in log.stdout


def test_gitignore_appended_when_zip_has_one(tmp_path, monkeypatch):
    """If the zip's project already has a .gitignore, we append `.claude/`
    rather than clobbering it."""
    slug = "feedback-with-gitignore"
    zip_path = tmp_path / f"{slug}.zip"

    feedback = {
        "schema_version": 1,
        "submitted_at": "2026-05-25T18:22:31Z",
        "viewer_version": "0.4.2",
        "platform": "darwin",
        "email": "",
        "project_folder_path": "",
        "user_prompt": "test",
        "agent_did": "test",
        "agent_should_have": "test",
        "notes": "",
    }
    with zipfile.ZipFile(zip_path, "w") as z:
        z.writestr("research.json", "{}")
        z.writestr("tree.gedcomx.json", "{}")
        z.writestr(".gitignore", "scratch/\n*.tmp\n")
        z.writestr("FEEDBACK.md", "# Feedback\n")
        z.writestr("_feedback/feedback.json", json.dumps(feedback))

    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    result = _run_script(str(zip_path))
    assert result.returncode == 0, result.stderr

    dest = tmp_path / "home" / "feedback" / slug
    gitignore = (dest / ".gitignore").read_text(encoding="utf-8")
    assert "scratch/" in gitignore, "existing entries preserved"
    assert "*.tmp" in gitignore, "existing entries preserved"
    assert ".claude/" in gitignore, ".claude/ appended"


def test_gitignore_created_when_absent(tmp_path, monkeypatch):
    slug = "feedback-no-gitignore"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    result = _run_script(str(zip_path))
    assert result.returncode == 0, result.stderr

    dest = tmp_path / "home" / "feedback" / slug
    assert (dest / ".gitignore").read_text(encoding="utf-8") == ".claude/\n"


@pytest.mark.skipif(
    os.name == "nt",
    reason=(
        "Git Bash's `ln -s` copies instead of symlinking on Windows unless "
        "MSYS=winsymlinks:nativestrict AND the user holds SeCreateSymbolicLink "
        "(admin or Developer Mode). The script's real behavior cannot be "
        "exercised here, so asserting on it would only encode the platform's "
        "limitation as a failure."
    ),
)
def test_claude_skills_dir_is_real_with_symlinks(tmp_path, monkeypatch):
    slug = "feedback-symlinks"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    result = _run_script(str(zip_path))
    assert result.returncode == 0, result.stderr

    dest = tmp_path / "home" / "feedback" / slug
    skills_dir = dest / ".claude" / "skills"
    assert skills_dir.is_dir()
    assert not skills_dir.is_symlink(), ".claude/skills/ itself must be a real dir"

    # Every plugin skill has a symlink. Spot-check by walking sources.
    plugin_skills_src = REPO_ROOT / "packages" / "engine" / "plugin" / "skills"
    plugin_skill_names = sorted(p.name for p in plugin_skills_src.iterdir() if p.is_dir())
    assert plugin_skill_names, "expected plugin skills in packages/engine/plugin/skills/"

    for name in plugin_skill_names:
        link = skills_dir / name
        assert link.is_symlink(), f"missing symlink for {name}"
        # Resolved target is the plugin skill dir.
        assert link.resolve() == (plugin_skills_src / name).resolve()


def test_refuses_overwrite_without_force(tmp_path, monkeypatch):
    slug = "feedback-overwrite"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    # First run succeeds.
    first = _run_script(str(zip_path))
    assert first.returncode == 0, first.stderr

    # Second run without --force must fail.
    second = _run_script(str(zip_path))
    assert second.returncode != 0
    assert "exists" in second.stderr or "Pass --force" in second.stderr


def test_force_overwrites_existing(tmp_path, monkeypatch):
    slug = "feedback-force"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    first = _run_script(str(zip_path))
    assert first.returncode == 0, first.stderr

    # Touch a marker file inside the dest to verify --force wipes it.
    dest = tmp_path / "home" / "feedback" / slug
    (dest / "stale-marker").write_text("should be gone", encoding="utf-8")

    second = _run_script(str(zip_path), "--force")
    assert second.returncode == 0, second.stderr
    assert not (dest / "stale-marker").exists()


def test_prints_user_prompt_in_next_steps(tmp_path, monkeypatch):
    slug = "feedback-prompt"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    result = _run_script(str(zip_path))
    assert result.returncode == 0, result.stderr
    # The stub zip's user_prompt is the John-Smith line.
    assert "Find a marriage record for John Smith" in result.stdout


def test_missing_zip_arg_returns_usage_error(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    result = _run_script()
    assert result.returncode != 0
    assert "Usage:" in result.stderr or "usage" in result.stderr.lower()


def test_nonexistent_zip_returns_error(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    result = _run_script(str(tmp_path / "does-not-exist.zip"))
    assert result.returncode != 0
    assert "not found" in result.stderr.lower()


def _build_windows_separator_zip(zip_path: Path, slug: str) -> None:
    r"""A feedback zip as the Windows viewer actually writes it.

    The submitted bundle from a `win32` viewer stores member names with
    **backslash** separators (`results\log_006.json`), not the forward
    slashes the zip format specifies. `unzip` extracts such an archive
    correctly but exits 1 with "appears to use backslashes as path
    separators" — a warning, not a failure.
    """
    feedback = {
        "schema_version": 1,
        "submitted_at": "2026-08-26T21:23:06.618Z",
        "viewer_version": "1.0.0-dev",
        "platform": "win32",
        "email": "user@example.com",
        "project_folder_path": r"C:\dev\Alpha testing\Checketts",
        "user_prompt": "Look for newspaper articles pertaining to Joseph Checketts.",
        "agent_did": "The automatic fetch was blocked.",
        "agent_should_have": "It should have searched the free archives.",
        "notes": "",
    }
    research = {"project": {"id": "rp_test", "researcher_profile": {}}}
    tree = {"persons": [], "relationships": [], "sources": []}

    with zipfile.ZipFile(zip_path, "w") as z:
        z.writestr("research.json", json.dumps(research, indent=2))
        z.writestr("tree.gedcomx.json", json.dumps(tree, indent=2))
        z.writestr("FEEDBACK.md", "# Feedback\n\nstub.\n")
        # The member that carries a separator — backslash, on purpose.
        # Backslash members must be written through a ZipInfo whose filename is
        # overridden *after* construction: ZipInfo.__init__ replaces os.sep with
        # "/", so on Windows a plain writestr("results\\x") silently stores
        # "results/x" and the test would assert nothing on the very platform the
        # bug comes from.
        back = zipfile.ZipInfo("placeholder")
        back.filename = "results\\log_006.json"
        z.writestr(back, json.dumps({"hits": []}))
        img = zipfile.ZipInfo("placeholder")
        img.filename = "images\\ark_61903_3_1_S3HY-6SHQ-BFK.jpg"
        z.writestr(img, "not-a-real-jpeg")
        # Mirrors the real bundle exactly: the viewer emits a mix — a forward
        # slash for the `_feedback/` directory entry, backslashes elsewhere.
        z.writestr("_feedback/", "")
        z.writestr("_feedback/feedback.json", json.dumps(feedback, indent=2))


def test_windows_backslash_zip_completes_setup(tmp_path, monkeypatch):
    """A win32-submitted zip must import fully, not abort mid-setup.

    Regression: `unzip` exits 1 on the backslash-separator warning, and
    `set -e` killed the script *after* extraction but *before* the
    `.feedback-repo-root` marker, the git baseline and the skill symlinks —
    with no output at all, so it looked like the script had done nothing.
    Every Windows submission hit this.

    HOW MUCH THIS GUARDS, AND WHERE. The failure needs an Info-ZIP build that
    actually emits "appears to use backslashes as path separators" and exits 1
    for it — observed on Git for Windows, which is where the genealogist team
    and the bug both live. A runner whose unzip stays silent returns 0 either
    way, so there this degrades to a smoke test that the script completes, not
    a regression guard. Stated rather than left implied: it was verified to
    fail against the pre-fix script on Windows, and CI is Linux, so a green
    tick here is weaker evidence than it looks.
    """
    slug = "feedback-2026-08-26T21-23-06-618Z"
    zip_path = tmp_path / f"{slug}.zip"
    _build_windows_separator_zip(zip_path, slug)
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    result = _run_script(str(zip_path))

    assert result.returncode == 0, result.stderr
    dest = home / "feedback" / slug

    # Forward-slash members land identically everywhere.
    assert (dest / "research.json").is_file()
    assert (dest / "_feedback" / "feedback.json").is_file()

    # A backslash member's LAYOUT is platform-dependent and deliberately not
    # asserted: Info-ZIP on Git-for-Windows rewrites "results\log_006.json"
    # into a real `results/` directory, while on Linux the backslash stays a
    # literal character in a single root-level filename. Both are "extracted";
    # pinning either one makes this test pass on one CI runner and fail on the
    # other, which is how it first went red. Assert only that the member
    # arrived, under whichever spelling this platform produced.
    extracted = {q.name for q in dest.rglob("*") if q.is_file()}
    assert any(n.endswith("log_006.json") for n in extracted), extracted
    assert any(n.endswith("S3HY-6SHQ-BFK.jpg") for n in extracted), extracted

    # The steps *after* unzip ran — this is what the bug actually skipped, and
    # the only thing this test exists to guard.
    assert (dest / ".feedback-repo-root").is_file()
    assert (dest / ".git").is_dir()
    assert (dest / ".claude" / "skills").is_dir()
    assert "Look for newspaper articles" in result.stdout


def _build_incomplete_zip(zip_path: Path) -> None:
    """A well-formed zip that is missing a file the bundle spec guarantees.

    `apps/electron/docs/feedback-json-spec.md` guarantees `research.json`,
    `tree.gedcomx.json` and `_feedback/feedback.json` in every submission. This
    one omits `research.json`, so `unzip` succeeds and exits 0 while the case
    directory is unusable — the exit code cannot tell you anything is wrong.
    """
    feedback = {
        "schema_version": 1,
        "submitted_at": "2026-08-26T21:23:06.618Z",
        "viewer_version": "1.0.0-dev",
        "platform": "win32",
        "email": "user@example.com",
        "project_folder_path": r"C:\dev\case",
        "user_prompt": "Look for newspaper articles.",
        "agent_did": "n/a",
        "agent_should_have": "n/a",
        "notes": "",
    }
    with zipfile.ZipFile(zip_path, "w") as z:
        z.writestr("tree.gedcomx.json", json.dumps({"persons": []}))
        z.writestr("FEEDBACK.md", "# Feedback\n")
        z.writestr("_feedback/feedback.json", json.dumps(feedback))


def test_incomplete_extraction_is_rejected_not_committed(tmp_path, monkeypatch):
    """An incomplete case must fail loudly, not be imported as if it were whole.

    The exit code alone cannot carry this. Info-ZIP documents exit 1 as covering
    both the backslash-separator warning this script deliberately tolerates and
    members skipped for an unsupported compression method or unknown password.
    (Measured 2026-09-02 on Info-ZIP 6.00 here, an unsupported method actually
    exits 81, which the `>= 2` branch already rejects — but the exit code is the
    wrong thing to reason from either way, and a bundle can be short a file with
    no nonzero exit at all, which is what this exercises.)

    What must not happen is the script continuing on to write the marker, commit
    a git baseline and wire up skill symlinks over a case that cannot be worked.
    """
    slug = "feedback-2026-08-26T21-23-06-618Z"
    zip_path = tmp_path / f"{slug}.zip"
    _build_incomplete_zip(zip_path)
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    result = _run_script(str(zip_path))

    assert result.returncode != 0, (
        "an incomplete bundle was accepted; stdout:\n" + result.stdout
    )
    assert "research.json" in result.stderr, result.stderr
    dest = home / "feedback" / slug
    assert not (dest / ".git").is_dir(), "git baseline committed over a partial case"
    assert not (dest / ".feedback-repo-root").is_file(), "marker written for a partial case"
