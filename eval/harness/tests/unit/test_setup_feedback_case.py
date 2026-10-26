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
import sys
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

# Tests that run the full script and expect exit 0 require real symlinks.
# On Windows, `ln -s` copies instead of linking and the script now fails by
# design (issue #2480), directing the user to `setup-feedback-case.bat`.
# Early-failure tests and the ln-shim test are unaffected.
_needs_symlinks = pytest.mark.skipif(
    os.name == "nt",
    reason=(
        "setup-feedback-case.sh now exits non-zero when ln -s copies instead "
        "of symlinking (issue #2480). On Windows, use setup-feedback-case.bat."
    ),
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


@_needs_symlinks
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


@_needs_symlinks
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


@_needs_symlinks
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


@_needs_symlinks
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


@_needs_symlinks
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


@_needs_symlinks
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


@_needs_symlinks
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


@_needs_symlinks
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


def _build_windows_separator_zip(zip_path: Path, slug: str, create_system: int = 0) -> None:
    r"""A feedback zip as the Windows viewer wrote it before #3706.

    The submitted bundle from a `win32` viewer stored member names with
    **backslash** separators (`results\log_006.json`), not the forward
    slashes the zip format specifies, and bundles already submitted still do.
    `create_system` is the "version made by" host byte, pinned so the zip is
    the same on every OS (see `_add_members`); the viewer's JSZip writes 0.
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
        back.create_system = create_system
        z.writestr(back, json.dumps({"hits": []}))
        img = zipfile.ZipInfo("placeholder")
        img.filename = "images\\ark_61903_3_1_S3HY-6SHQ-BFK.jpg"
        img.create_system = create_system
        z.writestr(img, "not-a-real-jpeg")
        # Mirrors the real bundle exactly: the viewer emits a mix — a forward
        # slash for the `_feedback/` directory entry, backslashes elsewhere.
        z.writestr("_feedback/", "")
        z.writestr("_feedback/feedback.json", json.dumps(feedback, indent=2))


@_needs_symlinks
@pytest.mark.parametrize("create_system", [0, 3])
def test_windows_backslash_zip_completes_setup(tmp_path, monkeypatch, create_system):
    r"""A win32-submitted zip must import fully, its `\` members in directories.

    Under the old `unzip` this aborted mid-setup (exit 1 on the
    backslash-separator warning, under `set -e`), and on POSIX the layout
    depended on the zip's host byte: Info-ZIP splits `results\log_006.json`
    only for host 0, and otherwise leaves one root-level file with a backslash
    in its name. The extractor rewrites `\` whatever the byte, so the layout is
    asserted exactly, for both bytes. On Windows `zipfile` splits the name
    itself, so the rewrite is proven only on Linux and macOS.
    """
    slug = "feedback-2026-08-26T21-23-06-618Z"
    zip_path = tmp_path / f"{slug}.zip"
    _build_windows_separator_zip(zip_path, slug, create_system)
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    result = _run_script(str(zip_path))

    assert result.returncode == 0, result.stderr
    dest = home / "feedback" / slug

    # Forward-slash members land identically everywhere.
    assert (dest / "research.json").is_file()
    assert (dest / "_feedback" / "feedback.json").is_file()

    assert (dest / "results" / "log_006.json").is_file()
    assert (dest / "images" / "ark_61903_3_1_S3HY-6SHQ-BFK.jpg").is_file()
    assert not [p.name for p in dest.iterdir() if "\\" in p.name]

    # The steps *after* extraction ran — what the original bug skipped.
    assert (dest / ".feedback-repo-root").is_file()
    assert (dest / ".git").is_dir()
    assert (dest / ".claude" / "skills").is_dir()
    assert "Look for newspaper articles" in result.stdout


def _build_incomplete_zip(zip_path: Path) -> None:
    """A well-formed zip that is missing a file the bundle spec guarantees.

    `apps/electron/docs/feedback-json-spec.md` guarantees `research.json`,
    `tree.gedcomx.json` and `_feedback/feedback.json` in every submission. This
    one omits `research.json`, so extraction succeeds and exits 0 while the case
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

    The exit code alone cannot carry this: a well-formed bundle can be short a
    file and still extract with exit 0, which is what this exercises.

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


@_needs_symlinks
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

@_needs_symlinks
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
    # `-c` must be the whole fix: writing the identity to any config also
    # makes the commit succeed, and would leave it on the user's machine.
    assert not (home / ".gitconfig").exists(), "the script wrote the user's global git config"
    assert not (tmp_path / "xdg" / "git" / "config").exists(), "the script wrote the user's global git config"
    local = subprocess.run(
        ["git", "-C", str(dest), "config", "--local", "--get-regexp", r"^user\."],
        capture_output=True, text=True, encoding="utf-8",
    )
    assert local.stdout == "", f"the script left an identity in the case repo:\n{local.stdout}"


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


@_needs_symlinks
def test_blank_user_prompt_is_reported_as_blank(tmp_path, monkeypatch):
    """An empty prompt is legitimate — the submission dialog does not require
    the box. Pointing the triager at the empty field tells them nothing."""
    out = _import_and_read_stdout(tmp_path, monkeypatch, "")
    assert _LEFT_BLANK in out, out
    assert _SEE_FIELD not in out, out


@_needs_symlinks
def test_null_user_prompt_reads_as_blank_and_never_prints_None(tmp_path, monkeypatch):
    """`.get('user_prompt', '')` returns None for an explicit JSON null, and
    `print(None)` emits the literal string `None` — which a triager would paste
    into the issue as the tester's words. Git for Windows ships no jq, so the
    python reader is the genealogist team's default path."""
    out = _import_and_read_stdout(tmp_path, monkeypatch, None)
    assert _LEFT_BLANK in out, out
    assert "None" not in out, out


@_needs_symlinks
def test_missing_user_prompt_key_reads_as_blank(tmp_path, monkeypatch):
    """A missing key counts as blank, the same as "" — the feedback-json spec
    says the field is always present, so its absence is not a failed read."""
    out = _import_and_read_stdout(tmp_path, monkeypatch, _DROP_KEY)
    assert _LEFT_BLANK in out, out
    assert _SEE_FIELD not in out, out


@_needs_symlinks
@pytest.mark.parametrize("body", ["NOT JSON AT ALL", "", "null", '"a string"'])
def test_unreadable_feedback_json_still_points_at_the_field(tmp_path, monkeypatch, body):
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
        z.writestr("_feedback/feedback.json", body)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    result = _run_script(str(zip_path))
    assert result.returncode == 0, f"stderr:\n{result.stderr}"
    assert _SEE_FIELD in result.stdout, result.stdout
    assert _LEFT_BLANK not in result.stdout, result.stdout


@_needs_symlinks
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


# --- #2480: ln -s that copies instead of symlinking must be detected ------

def test_ln_copy_instead_of_symlink_detected(tmp_path, monkeypatch):
    """On Git Bash for Windows, `ln -s` exits 0 but copies instead of linking.

    The script must detect this via `[ -L ... ]` and tell the user to run the
    .bat. Uses a PATH shim that makes `ln` do `cp -R` — the exact behavior
    Git Bash produces when symlinks are not available.
    """
    slug = "feedback-ln-shim"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)

    # Build a shim `ln` that copies instead of linking.
    shim_dir = tmp_path / "shim"
    shim_dir.mkdir()
    marker = tmp_path / "ln-shim-ran"
    (shim_dir / "ln").write_text(
        '#!/bin/sh\n'
        '# Shim: mimic Git Bash ln -s that copies instead of symlinking.\n'
        '# Drop the -s flag, pass the rest to cp -R.\n'
        'shift  # drop -s\n'
        f'echo x >> "{marker}"\n'
        'cp -R "$@"\n',
        encoding="utf-8",
    )
    (shim_dir / "ln").chmod(0o755)

    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    overrides = {"PATH": f"{shim_dir}{os.pathsep}{os.environ['PATH']}"}

    result = _run_script(str(zip_path), env_overrides=overrides)

    assert marker.is_file(), (
        "the ln shim never ran — the test exercised the real ln, not the shim"
    )
    assert result.returncode != 0, (
        "script should fail when ln -s copies instead of symlinking;\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    assert ".bat" in result.stderr, (
        "error message must mention the .bat alternative;\n"
        f"stderr:\n{result.stderr}"
    )


# --- #3706: non-ASCII and backslash member names must extract ----------------

EXTRACTOR = REPO_ROOT / "scripts" / "extract_feedback_zip.py"
_REPORT = "2026-10-21 Historical context - Danish naming and the Kjøller name.md"


def _add_members(zip_path: Path, members: dict, create_system: int = 0, mode: str = "w") -> None:
    r"""Write `members` with their names exactly as given, backslashes included.

    Through a ZipInfo whose filename is set after construction, for the reason
    `_build_windows_separator_zip` gives. `create_system` (the "version made by"
    host byte) is pinned so the zip is the same on every OS: Python defaults it
    to 0 on Windows and 3 elsewhere, and JSZip, which builds the desktop bundle,
    writes 0. Info-ZIP rewrites `\` only for host 0; `zipfile` ignores the byte.
    """
    with zipfile.ZipFile(zip_path, mode) as z:
        for name, body in members.items():
            info = zipfile.ZipInfo("placeholder")
            info.filename = name
            info.create_system = create_system
            z.writestr(info, body)


def _extract(zip_path: Path, dest: Path):
    return subprocess.run(
        [sys.executable, "-I", str(EXTRACTOR), str(zip_path), str(dest)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


def test_extractor_keeps_non_ascii_names(tmp_path):
    """macOS `unzip` stops on a UTF-8 member name, and a report titled with a
    Danish surname carries one (#3706). `zipfile` reads the UTF-8 flag."""
    zip_path = tmp_path / "bundle.zip"
    _add_members(zip_path, {f"reports/{_REPORT}": "report body"})

    result = _extract(zip_path, tmp_path / "out")

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "out" / "reports" / _REPORT).read_text(encoding="utf-8") == "report body"


@pytest.mark.parametrize("create_system", [0, 3])
def test_extractor_splits_backslash_names(tmp_path, create_system):
    r"""`reports\<name>` from the Windows viewer lands in `reports/`.

    On POSIX `zipfile` keeps a backslash as a literal character in one
    root-level name, so this fails there without the rewrite. On Windows
    `zipfile` splits it when reading, so there it passes either way.
    """
    zip_path = tmp_path / "bundle.zip"
    _add_members(
        zip_path,
        {f"reports\\{_REPORT}": "report body", "results\\log_006.json": "{}"},
        create_system=create_system,
    )

    result = _extract(zip_path, tmp_path / "out")

    assert result.returncode == 0, result.stderr
    out = tmp_path / "out"
    assert (out / "reports" / _REPORT).read_text(encoding="utf-8") == "report body"
    assert (out / "results" / "log_006.json").is_file()
    assert not [p.name for p in out.iterdir() if "\\" in p.name]


def test_extractor_keeps_backslash_traversal_inside_dest(tmp_path):
    r"""The rewrite turns a harmless literal `..\..\escape.txt` into
    `../../escape.txt`; `extract` must still drop the `..` components."""
    zip_path = tmp_path / "bundle.zip"
    _add_members(zip_path, {"..\\..\\escape.txt": "x"})
    dest = tmp_path / "a" / "b" / "out"

    result = _extract(zip_path, dest)

    assert result.returncode == 0, result.stderr
    assert (dest / "escape.txt").is_file()
    assert [p for p in tmp_path.rglob("escape.txt") if dest not in p.parents] == []


def test_extractor_rejects_a_corrupt_zip(tmp_path):
    zip_path = tmp_path / "x.zip"
    zip_path.write_bytes(b"not a zip at all")

    result = _extract(zip_path, tmp_path / "out")

    assert result.returncode == 1
    assert "error:" in result.stderr, result.stderr


def test_no_usable_python_fails_before_force_removes_the_case(tmp_path, monkeypatch):
    """With no interpreter the script must say so, and before `--force` deletes
    the case it was asked to replace.

    Under `set -e` a bare `PY="$(find_python)"` exits silently when no
    interpreter runs, so the probe has to be an `if` condition. Shims rather
    than an empty PATH, because the script still needs git and coreutils.
    """
    slug = "feedback-no-python"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    dest = tmp_path / "case"
    dest.mkdir()
    (dest / "keep-me").write_text("existing case", encoding="utf-8")

    shim_dir = tmp_path / "shim"
    shim_dir.mkdir()
    marker = tmp_path / "python-shim-ran"
    for name in ("python3", "python"):
        (shim_dir / name).write_text(
            f'#!/bin/sh\necho x >> "{marker}"\nexit 1\n', encoding="utf-8"
        )
        (shim_dir / name).chmod(0o755)
    overrides = {"PATH": f"{shim_dir}{os.pathsep}{os.environ['PATH']}"}

    result = _run_script(str(zip_path), str(dest), "--force", env_overrides=overrides)

    assert (dest / "keep-me").is_file(), "--force removed the case before the probe failed"
    assert result.returncode != 0, result.stdout
    assert "python" in result.stderr, result.stderr
    assert marker.is_file(), "the python shims never ran, so a real interpreter was found"


def test_corrupt_zip_is_rejected_before_anything_is_committed(tmp_path, monkeypatch):
    slug = "feedback-corrupt"
    zip_path = tmp_path / f"{slug}.zip"
    zip_path.write_bytes(b"not a zip at all")
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    result = _run_script(str(zip_path))

    assert result.returncode != 0, result.stdout
    assert "extraction failed" in result.stderr, result.stderr
    assert not (home / "feedback" / slug / ".git").exists()


def test_desktop_bundle_with_non_ascii_report_extracts(tmp_path, monkeypatch):
    r"""The bundle #3706 reported: a Windows desktop submission with a
    non-ASCII report title, stored as `reports\<name>`.

    macOS `unzip` stops on the name (exit 50); Linux's handles it. So `unzip`
    here is a shim that fails the way Apple's does, and the test asserts that
    extraction never goes through it. The assertions stop at extraction, so
    this also runs on Windows, where the script later exits at `ln -s`.
    """
    slug = "feedback-2026-10-21T08-00-00-000Z"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    _add_members(zip_path, {f"reports\\{_REPORT}": "report body"}, mode="a")
    shim_dir = tmp_path / "shim"
    shim_dir.mkdir()
    unzip_ran = tmp_path / "unzip-ran"
    (shim_dir / "unzip").write_text(
        f'#!/bin/sh\necho x >> "{unzip_ran}"\n'
        'echo "checkdir error: cannot create reports: Illegal byte sequence" >&2\n'
        "exit 50\n",
        encoding="utf-8",
    )
    (shim_dir / "unzip").chmod(0o755)
    overrides = {"PATH": f"{shim_dir}{os.pathsep}{os.environ['PATH']}"}
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    dest = tmp_path / "case"

    result = _run_script(str(zip_path), str(dest), env_overrides=overrides)

    assert not unzip_ran.exists(), "extraction went through unzip"
    assert (dest / "reports" / _REPORT).read_text(encoding="utf-8") == "report body", result.stderr
    assert "extraction failed" not in result.stderr, result.stderr


def test_probe_skips_a_python3_stub_that_prints_on_stdout(tmp_path, monkeypatch):
    """The Windows Store alias `python3` exists, fails, and on some builds
    prints its advert on stdout. find_python must fall through to `python`
    and must not capture that output as the interpreter's name. The assertions
    stop at extraction, so this runs on every OS."""
    slug = "feedback-stub-python3"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    shim_dir = tmp_path / "shim"
    shim_dir.mkdir()
    stub_ran = tmp_path / "stub-ran"
    (shim_dir / "python3").write_text(
        f'#!/bin/sh\necho x >> "{stub_ran}"\n'
        'echo "Python was not found; run without arguments to install from the Microsoft Store"\n'
        "exit 49\n",
        encoding="utf-8",
    )
    (shim_dir / "python").write_text(
        f'#!/bin/sh\nexec "{Path(sys.executable).as_posix()}" "$@"\n', encoding="utf-8"
    )
    for name in ("python3", "python"):
        (shim_dir / name).chmod(0o755)
    overrides = {"PATH": f"{shim_dir}{os.pathsep}{os.environ['PATH']}"}
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    dest = tmp_path / "case"

    result = _run_script(str(zip_path), str(dest), env_overrides=overrides)

    assert (dest / "research.json").is_file(), result.stderr
    assert "is required" not in result.stderr, result.stderr
    assert "extraction failed" not in result.stderr, result.stderr
    assert stub_ran.is_file(), "the python3 stub never ran, so the fallback was not exercised"


def test_extractor_expands_a_leading_tilde(tmp_path):
    """Step 8 of the guide passes `~/...` paths, and cmd and PowerShell do not
    expand them. Without the expansion the zip is not found, or a destination
    lands in a literal `~` folder under the cwd."""
    home = tmp_path / "home"
    home.mkdir()
    _add_members(home / "bundle.zip", {"research.json": "{}"})
    env = {**os.environ, "HOME": str(home), "USERPROFILE": str(home)}

    result = subprocess.run(
        [sys.executable, "-I", str(EXTRACTOR), "~/bundle.zip", "~/out"],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert (home / "out" / "research.json").is_file()
    assert not (tmp_path / "~").exists()


@_needs_symlinks
def test_relative_dest_still_prints_the_prompt(tmp_path, monkeypatch):
    """With a relative <dest-dir>, the script cds into the case and then read
    the prompt through the same relative path, resolving it a second time, so
    the prompt was reported unreadable."""
    slug = "feedback-relative-dest"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    result = _run_script(str(zip_path), "cases/x", cwd=tmp_path)

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "cases" / "x" / "research.json").is_file()
    assert "Find a marriage record for John Smith" in result.stdout, result.stdout


@_needs_symlinks
def test_bundle_python_files_are_never_imported(tmp_path, monkeypatch):
    """The prompt reader runs `python -c "import json ..."` from inside the case
    directory. Without `-I`, a `json.py` at the bundle root shadows the stdlib
    module and runs on the triager's machine."""
    slug = "feedback-planted-json"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    ran = tmp_path / "planted-json-ran"
    _add_members(
        zip_path,
        {"json.py": f"open({str(ran)!r}, 'w', encoding='utf-8').close()\n"},
        mode="a",
    )
    # jq fails, so the python reader is the one that reads the prompt.
    shim_dir = tmp_path / "shim"
    shim_dir.mkdir()
    jq_ran = tmp_path / "jq-ran"
    (shim_dir / "jq").write_text(f'#!/bin/sh\necho x >> "{jq_ran}"\nexit 127\n', encoding="utf-8")
    (shim_dir / "jq").chmod(0o755)
    overrides = {"PATH": f"{shim_dir}{os.pathsep}{os.environ['PATH']}"}
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    result = _run_script(str(zip_path), env_overrides=overrides)

    assert result.returncode == 0, result.stderr
    assert jq_ran.is_file(), "the jq shim never ran, so the python reader was not exercised"
    assert not ran.exists(), "a json.py from the bundle ran on import"
    assert "Find a marriage record for John Smith" in result.stdout, result.stdout
