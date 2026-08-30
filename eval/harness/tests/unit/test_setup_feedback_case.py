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


def _stub_unzip(tmp_path: Path, real_exit_code: int) -> Path:
    """Build a PATH-shadowing `unzip` that delegates to the real binary
    (so extraction still happens) and then forces the given exit code.

    Reproducing the actual real-world trigger for unzip's warning-only
    exit code 1 ("appears to use backslashes as path separators") is
    unzip-build-specific -- it depends on the archive's recorded host-OS
    byte and entry layout in a way that isn't reliably reconstructable
    with `zipfile`. This stub tests the fix's actual contract instead:
    given a specific unzip exit code, does the script continue (1) or
    abort (>=1)?
    """
    real_unzip = shutil.which("unzip")
    assert real_unzip, "test requires a real unzip on PATH to delegate to"
    stub_dir = tmp_path / "stub-bin"
    stub_dir.mkdir()
    stub = stub_dir / "unzip"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        f'"{real_unzip}" "$@"\n'
        'echo "warning:  stub simulating unzip exit code '
        f'{real_exit_code}" >&2\n'
        f"exit {real_exit_code}\n",
        encoding="utf-8",
    )
    stub.chmod(0o755)
    return stub_dir


def test_tolerates_unzip_warning_only_exit_code(tmp_path, monkeypatch):
    """unzip exits 1 for a warning-only condition (e.g. a Windows-zipped
    bundle triggering "appears to use backslashes as path separators")
    even though extraction succeeds. The script must continue past this,
    completing every remaining setup step, not abort silently."""
    slug = "feedback-unzip-warning"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    stub_dir = _stub_unzip(tmp_path, real_exit_code=1)
    env_overrides = {"PATH": str(stub_dir) + os.pathsep + os.environ.get("PATH", "")}
    result = _run_script(str(zip_path), env_overrides=env_overrides)

    assert result.returncode == 0, result.stderr
    dest = tmp_path / "home" / "feedback" / slug
    assert (dest / ".feedback-repo-root").exists()
    assert (dest / ".git").is_dir()
    assert (dest / "research.json").exists()


def test_aborts_on_real_unzip_failure(tmp_path, monkeypatch):
    """A genuine unzip failure (exit code >= 2) must still abort the
    script -- the fix tolerates the warning-only case, not every
    failure. Proves the fix didn't silence real extraction errors."""
    slug = "feedback-unzip-hard-error"
    zip_path = tmp_path / f"{slug}.zip"
    _build_minimal_zip(zip_path, slug)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    stub_dir = _stub_unzip(tmp_path, real_exit_code=2)
    env_overrides = {"PATH": str(stub_dir) + os.pathsep + os.environ.get("PATH", "")}
    result = _run_script(str(zip_path), env_overrides=env_overrides)

    assert result.returncode != 0
    assert "unzip failed" in result.stderr
    dest = tmp_path / "home" / "feedback" / slug
    assert not (dest / ".feedback-repo-root").exists()


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
