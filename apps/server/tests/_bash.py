"""Locate a real bash for tests that run a snippet of a shipped shell script.

A bare `subprocess.run(["bash", ...])` is wrong on Windows: CreateProcess searches
System32 before PATH, so it starts WSL's `bash.exe`, which runs in Linux outside the
test's files and prints nothing (issue #4043). `shutil.which` searches PATH, but on a
default Git for Windows install PATH holds only `Git\\cmd`, so `which` can still land
on that same WSL launcher. Skip it and derive Git Bash from git's own location, as
`eval/harness/tests/unit/test_setup_feedback_case.py::_find_bash` does.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path


def _is_wsl_launcher(path: str) -> bool:
    system_root = os.environ.get("SystemRoot")
    resolved = str(Path(path).resolve()).lower()
    if system_root and resolved.startswith(str(Path(system_root).resolve()).lower()):
        return True
    return "windowsapps" in resolved


def find_bash() -> str | None:
    found = shutil.which("bash")
    if found and not _is_wsl_launcher(found):
        return found
    git = shutil.which("git")
    if not git:
        return None
    # git is <root>\cmd\git.exe on PATH, but <root>\mingw64\bin\git.exe inside Git Bash.
    for parent in list(Path(git).resolve().parents)[:3]:
        candidate = parent / "bin" / "bash.exe"
        if candidate.is_file():
            return str(candidate)
    return None
