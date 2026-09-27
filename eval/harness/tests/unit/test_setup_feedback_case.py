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


_OMIT = object()
_DROP_KEY = object()


def _build_minimal_zip(zip_path: Path, slug: str, user_prompt=_OMIT) -> None:
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
        # overwritten below when the caller passes one; _OMIT drops the key
        "agent_did": "The agent searched only the 1860 census and stopped.",
        "agent_should_have": "The agent should have tried 1870 and 1880 censuses.",
        "notes": "",
    }
    # `user_prompt` is optional in the submission dialog, so "" is legitimate,
    # and a missing key or an explicit null must read the same way. _DROP_KEY
    # removes the key entirely — something None cannot express, because None is
    # itself one of the cases under test.
    if user_prompt is not _OMIT:
        if user_prompt is _DROP_KEY:
            del feedback["user_prompt"]
        else:
            feedback["user_prompt"] = user_prompt
    research = {"project": {"id": "rp_test", "researcher_profile": {}}}
    tree = {"persons": [], "relationships": [], "sources": []}

    with zipfile.ZipFile(zip_path, "w") as z:
        z.writestr("research.json", json.dumps(research, indent=2))
        z.writestr("tree.gedcomx.json", json.dumps(tree, indent=2))
        z.writestr("FEEDBACK.md", "# Feedback\n\nstub.\n")
        z.writestr("_feedback/feedback.json", json.dumps(feedback, indent=2))


_GIT_IDENTITY_VARS = (
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
)


def _run_script(
    *args,
    cwd: Path | None = None,
    env_overrides: dict | None = None,
    git_identity: bool = True,
):
    """Run the script. `git_identity=False` leaves git with no identity at all.

    The four vars must be POPPED, not merely left un-setdefault-ed: `env` is a
    copy of the real environment, so an ambient `GIT_AUTHOR_EMAIL` survives.
    And the pop matters in both directions — measured, `GIT_AUTHOR_EMAIL`
    OVERRIDES `git -c user.email`, so leaving it set makes the identity test
    fail after the fix as well as before it.

    `user.useConfigOnly` is what makes the unfixed script actually fail: with no
    identity and no config, git otherwise guesses one from the hostname and
    commits successfully, so an exit-0 assertion would pass against the bug.
    """
    env = os.environ.copy()
    if git_identity:
        env.setdefault("GIT_AUTHOR_NAME", "test")
        env.setdefault("GIT_AUTHOR_EMAIL", "test@example.com")
        env.setdefault("GIT_COMMITTER_NAME", "test")
        env.setdefault("GIT_COMMITTER_EMAIL", "test@example.com")
    else:
        for var in _GIT_IDENTITY_VARS:
            env.pop(var, None)
        env["GIT_CONFIG_NOSYSTEM"] = "1"
        env["GIT_CONFIG_COUNT"] = "1"
        env["GIT_CONFIG_KEY_0"] = "user.useConfigOnly"
        env["GIT_CONFIG_VALUE_0"] = "true"
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


def test_injected_config_is_stripped_and_claude_md_renamed(tmp_path, monkeypatch):
    slug = "feedback-injected-config"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    with zipfile.ZipFile(zip_path, "a") as z:
        z.writestr(".claude/settings.json", "{}")
        z.writestr(".claude.json", "{}")
        z.writestr(".mcp.json", '{"mcpServers":{"evil":{"command":"sh"}}}')
        z.writestr(".gitattributes", "* filter=evil\n")
        z.writestr(".git/config", '[filter "evil"]\n\tclean = sh -c "curl ..."\n')
        z.writestr("CLAUDE.md", "INJECTED\n")
        z.writestr("results/CLAUDE.md", "NESTED INJECTED\n")

    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    result = _run_script(str(zip_path))
    assert result.returncode == 0, result.stderr

    dest = tmp_path / "home" / "feedback" / slug
    assert not (dest / ".claude" / "settings.json").exists()
    assert not (dest / ".claude.json").exists()
    assert not (dest / ".mcp.json").exists()
    assert not (dest / ".gitattributes").exists()
    assert not (dest / "CLAUDE.md").exists()
    assert (dest / "CLAUDE.md.submitted").read_text(encoding="utf-8") == "INJECTED\n"
    assert not (dest / "results" / "CLAUDE.md").exists()
    assert (dest / "results" / "CLAUDE.md.submitted").read_text(encoding="utf-8") == "NESTED INJECTED\n"


# --- #2878: the baseline commit needs no global git identity ----------

def test_imported_commit_works_with_no_git_identity(tmp_path, monkeypatch):
    """The script must not need a global git identity to make its baseline.

    The guide tells the Windows-based genealogist team to use GitHub Desktop,
    which configures no global identity. Under `set -euo pipefail` a failed
    `git commit` kills the run before the skill links and the closing printout,
    so the genealogist never sees the prompt block and `reset-feedback-case.sh`
    has no `imported` commit to reset to.

    Asserts the AUTHOR EMAIL, not the exit code. With no identity and no config
    git guesses one from the hostname and commits successfully — measured here,
    author `<user>@<host>.local` — so an exit-0 assertion passes against the
    unfixed script. `_run_script(git_identity=False)` sets
    `user.useConfigOnly` to turn that guess off.
    """
    slug = "feedback-2026-05-25T18-22-31"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    result = _run_script(
        str(zip_path),
        git_identity=False,
        env_overrides={
            "HOME": str(home),
            "XDG_CONFIG_HOME": str(tmp_path / "xdg"),
        },
    )
    assert result.returncode == 0, f"stderr:\n{result.stderr}\nstdout:\n{result.stdout}"

    dest = home / "feedback" / slug
    author = subprocess.run(
        ["git", "-C", str(dest), "log", "-1", "--format=%ae"],
        capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout.strip()
    assert author == "feedback-case@localhost", (
        f"the imported commit was authored by {author!r}. The script must pass "
        "its own identity with `git -c`, so it never depends on a global one."
    )


# --- #2878: a blank user_prompt is not a failed read ------------------

_LEFT_BLANK = "left blank"
_SEE_FIELD = "(user_prompt field)"


def _import_and_read_stdout(tmp_path, monkeypatch, user_prompt, env_overrides=None):
    slug = "feedback-2026-05-25T18-22-31"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug, user_prompt=user_prompt)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    result = _run_script(str(zip_path), env_overrides=env_overrides)
    assert result.returncode == 0, f"stderr:\n{result.stderr}"
    return result.stdout


def test_blank_user_prompt_is_reported_as_blank(tmp_path, monkeypatch):
    """An empty prompt is legitimate — the submission dialog does not require
    the box. Pointing the triager at the empty field tells them nothing."""
    out = _import_and_read_stdout(tmp_path, monkeypatch, "")
    assert _LEFT_BLANK in out, out
    assert _SEE_FIELD not in out, out


def test_null_user_prompt_reads_as_blank_and_never_prints_None(tmp_path, monkeypatch):
    """`.get('user_prompt', '')` returns None for an explicit JSON null, and
    `print(None)` emits the literal string `None` — which a triager would paste
    into the issue as the tester's words. Git for Windows ships no jq, so the
    python reader is the genealogist team's default path."""
    out = _import_and_read_stdout(tmp_path, monkeypatch, None)
    assert _LEFT_BLANK in out, out
    assert "None" not in out, out


def test_missing_user_prompt_key_reads_as_blank(tmp_path, monkeypatch):
    """A missing key counts as blank, the same as "" — the feedback-json spec
    says the field is always present, so its absence is not a failed read."""
    out = _import_and_read_stdout(tmp_path, monkeypatch, _DROP_KEY)
    assert _LEFT_BLANK in out, out
    assert _SEE_FIELD not in out, out


def test_unreadable_feedback_json_still_points_at_the_field(tmp_path, monkeypatch):
    """The other direction. Without this, a script that prints "left blank" for
    everything passes the three tests above."""
    slug = "feedback-2026-05-25T18-22-31"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    # Rebuild with an unparseable report.
    with zipfile.ZipFile(zip_path, "w") as z:
        z.writestr("research.json", json.dumps({"project": {"id": "rp_test"}}))
        z.writestr("tree.gedcomx.json", json.dumps({"persons": []}))
        z.writestr("FEEDBACK.md", "# Feedback\n")
        z.writestr("_feedback/feedback.json", "NOT JSON AT ALL")
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    result = _run_script(str(zip_path))
    assert result.returncode == 0, f"stderr:\n{result.stderr}"
    assert _SEE_FIELD in result.stdout, result.stdout
    assert _LEFT_BLANK not in result.stdout, result.stdout


def test_blank_prompt_is_read_correctly_without_jq(tmp_path, monkeypatch):
    """The path the Windows team actually runs.

    Every other test here runs with real `jq` — present on macOS and
    preinstalled on the ubuntu runner — so the python reader is never entered.
    That branch is where the null-prints-`None` bug lives and where the
    read-succeeded flag has to be set independently, so without this the suite
    goes green with both defects shipped.

    The shim keeps `command -v jq` succeeding and makes jq itself fail, which
    is the shape a Git for Windows box produces. It records that it ran, so a
    shim that is silently not picked up cannot leave this test passing while
    exercising the jq path twice.
    """
    shim_dir = tmp_path / "shim"
    shim_dir.mkdir()
    marker = tmp_path / "jq-ran"
    (shim_dir / "jq").write_text(
        f'#!/bin/sh\necho x >> "{marker}"\nexit 127\n', encoding="utf-8"
    )
    (shim_dir / "jq").chmod(0o755)
    overrides = {"PATH": f"{shim_dir}{os.pathsep}{os.environ['PATH']}"}

    # "   \n\t " pins the whitespace-only rule spec row 7 now guarantees.
    # Without it, reverting the [[:space:]] strip to a plain emptiness test
    # leaves the suite at 20/20 while a whitespace-only prompt prints a
    # heading and two rules with nothing between them — defect 3 exactly.
    # It is also the only thing keeping the .sh in step with the .bat's
    # IsNullOrWhiteSpace; nothing else in the repo pins that parity.
    for prompt in ("", None, _DROP_KEY, "   \n\t "):
        case = tmp_path / f"case-{id(prompt)}"
        case.mkdir()
        out = _import_and_read_stdout(case, monkeypatch, prompt, env_overrides=overrides)
        assert _LEFT_BLANK in out, f"prompt={prompt!r}\n{out}"
        assert "None" not in out, f"prompt={prompt!r}\n{out}"

    # The other direction, and it is not decoration: without it a python reader
    # that returned blank for EVERY input would still pass the three cases
    # above. No other test reaches this branch with real text — the one prompt
    # assertion in this file runs with real jq on PATH.
    case = tmp_path / "case-text"
    case.mkdir()
    out = _import_and_read_stdout(
        case, monkeypatch, "Find the 1880 census household.", env_overrides=overrides
    )
    assert "Find the 1880 census household." in out, out
    assert _LEFT_BLANK not in out, out

    assert marker.is_file(), (
        "the jq shim never ran, so this test exercised the jq path instead of "
        "the python fallback it exists to cover"
    )
